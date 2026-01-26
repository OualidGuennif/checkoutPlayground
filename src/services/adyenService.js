/**
 * adyenService.js
 * Adyen API Service
 * Handles all Adyen API interactions with proper error handling
 *
 * ✅ AJOUTS UNIQUEMENT (rien supprimé, rien refactoré)
 * - createSession(): utilise reference + merchantOrderReference si fournis par le controller
 * - submitPayment(): utilise paymentData.reference + paymentData.merchantOrderReference si présents
 * - createOrder(): reference déjà supporté (inchangé)
 *
 * ✅ AJOUT (cette demande)
 * - checkoutAttemptId: supprimé de paymentMethod, envoyé à la racine du payload /payments
 * - ignore les valeurs non valides (ex: 'fetch-checkoutAttemptId-failed', 'do-not-track')
 */

const { Client, CheckoutAPI } = require("@adyen/api-library");
const { hmacValidator } = require("@adyen/api-library");
const {
  config,
  getCurrencyForCountry,
  getLineItemsForPaymentMethod,
  getLocaleForCountry,
  getDailyShopperReference
} = require("../config");
const { ConfigurationError, retryRequest, handleAdyenError } = require("../utils/errorHandler");

const { v4: uuid } = require("uuid");
const crypto = require("crypto");

console.log(config.adyen.ADYEN_API_KEY, config.adyen.ADYEN_ENVIRONMENT);

// Adyen NodeJS library configuration
const client = new Client({
  apiKey: config.adyen.ADYEN_API_KEY,
  environment: config.adyen.ADYEN_ENVIRONMENT
});
const checkout = new CheckoutAPI(client);

/* --------------------------------------------------------
   ✅ Partial payments helpers (server-side cache)

   1) Balance cache keyed by encrypted instrument (giftcard/voucher)
   2) Remaining cache keyed by ORDER PSP reference (/orders pspReference)

   Goals:
   - If Drop-in omits paymentData.amount during partial payments,
     still debit correctly.
   - Support N partial payments (2, 3, 10...) by always syncing
     remainingAmount from BOTH /payments AND /payments/details.
--------------------------------------------------------- */

/* ---------- small utils ---------- */
function __now() { return Date.now(); }
function __sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

function __isPartialPaymentMethod(type) {
  return ["giftcard", "ancv", "voucher"].includes(String(type || "").toLowerCase());
}

function __sameCurrency(a, b) {
  if (!a?.currency || !b?.currency) return true;
  return a.currency === b.currency;
}

function __capAmount(amount, cap) {
  if (!amount || amount.value == null) return amount;
  if (!cap || cap.value == null) return amount;
  if (!__sameCurrency(amount, cap)) return amount;

  return {
    currency: amount.currency,
    value: Math.min(Number(amount.value), Number(cap.value))
  };
}

/* --------------------------------------------------------
   ✅ checkoutAttemptId helpers
   - We remove checkoutAttemptId from paymentMethod (always)
   - We set checkoutAttemptId at root of /payments when valid
--------------------------------------------------------- */
function __isValidCheckoutAttemptId(val) {
  if (val == null) return false;
  const s = String(val).trim();
  if (!s) return false;

  // Known "bad" values you explicitly don't want to send
  if (s === "fetch-checkoutAttemptId-failed") return false;

  // When analytics disabled in some configs
  if (s === "do-not-track") return false;

  // Docs: max length 256
  if (s.length > 256) return false;

  return true;
}

function __extractCheckoutAttemptId(paymentData = {}) {
  // Prefer root if already provided by your frontend/controller
  const root = paymentData.checkoutAttemptId;

  // Fallback: some people stick it in additionalData (optional)
  const alt =
    paymentData.additionalData?.checkoutAttemptId ||
    paymentData.additionalDataNetwork?.checkoutAttemptId;

  // Legacy: web component historically placed it under paymentMethod
  const pm = paymentData.paymentMethod?.checkoutAttemptId;

  const candidate = root ?? alt ?? pm;
  return __isValidCheckoutAttemptId(candidate) ? String(candidate).trim() : null;
}

function __sanitizePaymentMethod(paymentMethod = {}) {
  // Always remove checkoutAttemptId from paymentMethod (your requirement)
  const pm = { ...(paymentMethod || {}) };
  if ("checkoutAttemptId" in pm) delete pm.checkoutAttemptId;
  return pm;
}

/* ---------- balance cache (instrument -> balance) ---------- */
const __balanceCache = new Map(); // keyHash -> { balance, currency, expiresAt }
const __BALANCE_TTL_MS = 5 * 60 * 1000;

function __getEncryptedIdentifier(paymentMethod = {}) {
  return (
    paymentMethod.encryptedCardNumber ||
    paymentMethod.encryptedVoucherNumber ||
    paymentMethod.encryptedNumber ||
    paymentMethod.encryptedAccountNumber ||
    null
  );
}

function __cacheBalanceForPaymentMethod(paymentMethod, balanceAmount) {
  const encryptedId = __getEncryptedIdentifier(paymentMethod);
  if (!encryptedId) return;

  const key = __sha256(encryptedId);
  __balanceCache.set(key, {
    balance: Number(balanceAmount?.value ?? 0),
    currency: balanceAmount?.currency,
    expiresAt: __now() + __BALANCE_TTL_MS
  });
}

function __getCachedBalanceForPaymentMethod(paymentMethod) {
  const encryptedId = __getEncryptedIdentifier(paymentMethod);
  if (!encryptedId) return null;

  const key = __sha256(encryptedId);
  const entry = __balanceCache.get(key);
  if (!entry) return null;

  if (__now() > entry.expiresAt) {
    __balanceCache.delete(key);
    return null;
  }

  return { value: entry.balance, currency: entry.currency };
}

/* ---------- remaining cache (ORDER PSP -> remainingAmount) ---------- */
const __remainingCache = new Map(); // keyHash -> { remainingAmount: {currency,value}, expiresAt }
const __REMAINING_TTL_MS = 30 * 60 * 1000;

function __orderKeyFromOrder(order) {
  const orderPsp = order?.pspReference; // PSP ref from /orders (NOT payment PSP)
  if (!orderPsp) return null;
  return __sha256(orderPsp);
}

function __cacheRemainingAmountForOrder(order, remainingAmount) {
  const k = __orderKeyFromOrder(order);
  if (!k) return;

  const cur = remainingAmount?.currency;
  const val = remainingAmount?.value;
  if (!cur || val == null) return;

  __remainingCache.set(k, {
    remainingAmount: { currency: cur, value: Number(val) },
    expiresAt: __now() + __REMAINING_TTL_MS
  });
}

function __getCachedRemainingAmountForOrder(order) {
  const k = __orderKeyFromOrder(order);
  if (!k) return null;

  const entry = __remainingCache.get(k);
  if (!entry) return null;

  if (__now() > entry.expiresAt) {
    __remainingCache.delete(k);
    return null;
  }

  return entry.remainingAmount;
}

function __deleteRemainingForOrder(order) {
  const k = __orderKeyFromOrder(order);
  if (k) __remainingCache.delete(k);
}

/* --------------------------------------------------------
   ✅ Remaining cache sync helper
   Must be called for BOTH /payments and /payments/details responses
--------------------------------------------------------- */
function __updateRemainingFromAdyenResponse(response) {
  const order = response?.order;
  if (!order?.pspReference) return;

  if (order.remainingAmount?.currency && order.remainingAmount?.value != null) {
    __cacheRemainingAmountForOrder(order, order.remainingAmount);
    if (Number(order.remainingAmount.value) <= 0) __deleteRemainingForOrder(order);
    return;
  }

  // Fallback: sometimes remainingAmount isn't present but order.amount is
  if (order.amount?.currency && order.amount?.value != null) {
    __cacheRemainingAmountForOrder(order, order.amount);
    if (Number(order.amount.value) <= 0) __deleteRemainingForOrder(order);
  }
}

/* --------------------------------------------------------
   Get payment methods
--------------------------------------------------------- */
const getPaymentMethods = async (countryCode, amount, shopperLocale, shopperConversionId, shopperReference) => {
  console.log("📡 Calling Adyen /paymentMethods with payload:", {
    channel: "Web",
    merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
    countryCode,
    amount,
    shopperLocale,
    shopperConversionId,
    shopperReference
  });

  try {
    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.paymentMethods({
        channel: "Web",
        merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
        countryCode,
        amount,
        shopperLocale,
        shopperConversionId,
        shopperReference
      });
    });

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Create an order (partial payments)
   ✅ Seed remaining cache: initial remaining = order.amount
   (/orders: reference only) ✅ already correct
--------------------------------------------------------- */
const createOrder = async ({ amount, reference }) => {
  try {
    const orderRequest = {
      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
      amount,
      reference
    };

    console.log("📡 Calling Adyen /orders with payload:", orderRequest);

    const response = await retryRequest(async () => {
      return await checkout.OrdersApi.orders(orderRequest);
    });

    console.log("✅ Order created:", { pspReference: response.pspReference, expiresAt: response.expiresAt });

    // seed remaining with initial order amount
    __cacheRemainingAmountForOrder({ pspReference: response.pspReference }, response.amount);

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Cancel order
   ✅ Cleanup remaining cache
--------------------------------------------------------- */
const cancelOrder = async ({ order }) => {
  try {
    const payload = {
      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
      order
    };

    console.log("📡 Calling Adyen /orders/cancel with payload:", { hasOrder: !!order });
    console.log(payload);

    const response = await retryRequest(async () => {
      return await checkout.OrdersApi.cancelOrder(payload);
    });

    __deleteRemainingForOrder(order);

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Giftcard balance check
   ✅ still cached by instrument
--------------------------------------------------------- */
const balanceCheckGiftcard = async ({ paymentMethod, amount }) => {
  try {
    const payload = {
      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
      paymentMethod,
      amount
    };

    console.log("📡 Calling Adyen /paymentMethods/balance with payload:", payload);

    const response = await retryRequest(async () => {
      return await checkout.OrdersApi.getBalanceOfGiftCard(payload);
    });

    console.log("✅ Balance check response:", response);

    if (response?.balance?.value != null && response?.balance?.currency) {
      __cacheBalanceForPaymentMethod(paymentMethod, response.balance);
      console.log("🧠 Balance cached:", { currency: response.balance.currency, value: response.balance.value });
    } else {
      console.log("⚠️ Balance response had no balance field to cache.");
    }

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Create a payment session
   ✅ /sessions: reference + merchantOrderReference (if provided)
--------------------------------------------------------- */
const createSession = async (sessionData) => {
  try {
    const {
      orderRef,
      baseUrl,
      paymentMethod = "default",
      selectedCountry = "FR",
      shopperReference = getDailyShopperReference(),

      // ✅ AJOUT: allow overriding Adyen refs from controller/front
      reference: providedReference,
      merchantOrderReference: providedMerchantOrderReference
    } = sessionData;

    let currency = getCurrencyForCountry(selectedCountry);
    let lineItems = getLineItemsForPaymentMethod(paymentMethod);
    let countryCode = selectedCountry;

    if (paymentMethod === "vipps" || selectedCountry === "NO") {
      currency = "NOK";
      countryCode = "NO";
      lineItems = config.lineItems.vipps;
    }

    if (paymentMethod === "mobilepay" || selectedCountry === "DK") {
      currency = "DKK";
      countryCode = "DK";
      lineItems = config.lineItems.mobilepay;
    }

    if (paymentMethod === "ideal" || selectedCountry === "NL") {
      currency = "EUR";
      countryCode = "NL";
      lineItems = config.lineItems.ideal;
    }

    const sessionRequest = {
      amount: { currency, value: config.payment.defaultAmount },
      countryCode,
      shopperLocale: getLocaleForCountry(countryCode),

      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,

      // ✅ AJOUT: /sessions reference (fallback to existing orderRef)
      reference: providedReference || orderRef,

      // ✅ AJOUT: /sessions merchantOrderReference (digits-only, 8 chars in your case)
      ...(providedMerchantOrderReference
        ? { merchantOrderReference: providedMerchantOrderReference }
        : {}),

      returnUrl: `${baseUrl}/handleShopperRedirect?orderRef=${orderRef}`,
      lineItems,

      shopperReference,
      shopperInteraction: "Ecommerce",

      storePaymentMethodMode: "askForConsent",
      recurringProcessingModel: "CardOnFile",
      channel: "Web",

      authenticationData: { threeDSRequestData: { nativeThreeDS: "preferred" } }
    };

    console.log("📡 Calling Adyen /sessions with:", {
      reference: sessionRequest.reference,
      merchantOrderReference: sessionRequest.merchantOrderReference,
      countryCode,
      amount: sessionRequest.amount
    });

    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.sessions(sessionRequest);
    });

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Submit payment (Advanced Flow)

   ✅ Core rules:
   - If "order" exists:
       - use paymentData.amount if present (Drop-in)
       - else use cached remaining (by /orders PSP ref)
       - always cap by remaining (if we have it)
       - AND for giftcard/voucher/ancv: cap by balance (instrument cache)
   - If no "order": normal flow, optional cap by balance for partial methods
   ✅ /payments: reference + merchantOrderReference (if provided)
   ✅ checkoutAttemptId: root only, NEVER inside paymentMethod
--------------------------------------------------------- */
const submitPayment = async (paymentData = {}) => {
  console.log("🟦 submitPayment(): received payload:", {
    hasPaymentMethod: !!paymentData.paymentMethod,
    hasBrowserInfo: !!paymentData.browserInfo,
    hasRiskData: !!paymentData.riskData,
    methodType: paymentData.paymentMethod?.type,
    hasOrder: !!paymentData.order,
    hasTopLevelAmount: !!paymentData.amount,

    // ✅ AJOUT
    hasReference: !!paymentData.reference,
    hasMerchantOrderReference: !!paymentData.merchantOrderReference,

    // ✅ AJOUT (checkoutAttemptId)
    hasRootCheckoutAttemptId: !!paymentData.checkoutAttemptId,
    hasPmCheckoutAttemptId: !!paymentData.paymentMethod?.checkoutAttemptId
  });

  try {
    // ✅ AJOUT: prefer frontend reference (your unifiedReference)
    const orderRef = paymentData.reference ?? uuid();

    let finalCountryCode = paymentData.additionalData?.countryCode;
    const baseUrl = paymentData.additionalDataNetwork?.baseUrl;
    const shopperIP = paymentData.additionalDataNetwork?.shopperIP;
    const currentOrigin = paymentData.origin ?? baseUrl;

    const recurringModelFromFront =
      paymentData.additionalData?.recurringProcessingModel || paymentData.recurringProcessingModel;
    const isUnscheduledMit = recurringModelFromFront === "UnscheduledCardOnFile";

    if (paymentData.paymentMethod?.type === "vipps") finalCountryCode = "NO";
    if (paymentData.paymentMethod?.type === "mobilepay") finalCountryCode = "DK";
    if (paymentData.paymentMethod?.type === "ideal") finalCountryCode = "NL";

    const billingAdressMock = {
      street: "Teststrasse",
      houseNumberOrName: "1",
      postalCode: "10115",
      city: "Berlin",
      country: finalCountryCode
    };

    const totalAmountFromFront = paymentData.additionalData?.amount ?? {
      value: 2000,
      currency: getCurrencyForCountry(finalCountryCode)
    };

    // ------------------------------
    // ✅ AMOUNT DECISION (bulletproof)
    // ------------------------------
    let chosenAmount = paymentData.amount ?? null;

    if (paymentData.order) {
      // A) remaining
      const cachedRemaining = __getCachedRemainingAmountForOrder(paymentData.order);

      if (!chosenAmount) {
        if (!cachedRemaining) {
          // Safer to fail than debit full order.
          throw { message: "Missing amount for partial payment and remainingAmount not cached.", statusCode: 400 };
        }
        chosenAmount = cachedRemaining;
      }

      // cap by remaining if we have it
      if (cachedRemaining) {
        chosenAmount = __capAmount(chosenAmount, cachedRemaining);
      }

      // B) for giftcard/voucher/ancv cap by instrument balance too
      if (__isPartialPaymentMethod(paymentData.paymentMethod?.type)) {
        const cachedBalance = __getCachedBalanceForPaymentMethod(paymentData.paymentMethod);
        if (cachedBalance) {
          chosenAmount = __capAmount(chosenAmount, cachedBalance);
        }
      }
    } else {
      // normal flow
      chosenAmount = chosenAmount ?? totalAmountFromFront;

      if (__isPartialPaymentMethod(paymentData.paymentMethod?.type) && !paymentData.amount) {
        const cachedBalance = __getCachedBalanceForPaymentMethod(paymentData.paymentMethod);
        if (cachedBalance) chosenAmount = __capAmount(chosenAmount, cachedBalance);
      }
    }

    // ✅ AJOUT: checkoutAttemptId (root only)
    const checkoutAttemptId = __extractCheckoutAttemptId(paymentData);

    // ✅ AJOUT: sanitize paymentMethod to remove checkoutAttemptId
    const sanitizedPaymentMethod = __sanitizePaymentMethod(paymentData.paymentMethod);

    const paymentRequest = {
      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,

      // ✅ /payments reference (unifiedReference)
      reference: orderRef,

      amount: chosenAmount,

      channel: "Web",
      countryCode: finalCountryCode,
      returnUrl: `${currentOrigin}/handleShopperRedirect?orderRef=${orderRef}`,
      origin: currentOrigin ?? undefined,

      order: paymentData.order ?? undefined,

      shopperReference: paymentData.additionalData?.shopperReference ?? "TestShopper",
      shopperEmail: paymentData.shopperEmail ?? "test@example.com",
      shopperName: { firstName: "Test", lastName: "Shopper" },
      shopperLocale: getLocaleForCountry(finalCountryCode),
      shopperConversionId: paymentData.additionalData?.shopperConversionId ?? undefined,
      shopperIP,

      // ✅ sanitized payment method (NO checkoutAttemptId inside)
      paymentMethod: sanitizedPaymentMethod,

      // ✅ AJOUT: merchantOrderReference for /payments (digits-only 8 chars)
      ...(paymentData.merchantOrderReference
        ? { merchantOrderReference: paymentData.merchantOrderReference }
        : {}),

      // ✅ AJOUT: checkoutAttemptId at ROOT ONLY (when valid)
      ...(checkoutAttemptId ? { checkoutAttemptId } : {}),

      recurringProcessingModel: isUnscheduledMit
        ? "UnscheduledCardOnFile"
        : (paymentData.storePaymentMethod || !!paymentData.paymentMethod?.storedPaymentMethodId)
          ? "CardOnFile"
          : undefined,

      shopperInteraction: isUnscheduledMit ? "ContAuth" : "Ecommerce",
      storePaymentMethod: paymentData.storePaymentMethod ?? undefined,

      browserInfo: isUnscheduledMit ? undefined : paymentData.browserInfo ?? undefined,
      riskData: paymentData.riskData ?? undefined,

      billingAddress:
        paymentData.billingAddress && Object.keys(paymentData.billingAddress).length > 0
          ? paymentData.billingAddress
          : billingAdressMock,

      lineItems: paymentData.lineItems ?? [
        {
          id: "1",
          quantity: 1,
          amountExcludingTax: 0,
          amountIncludingTax: 5000,
          taxAmount: 0,
          taxPercentage: 0,
          description: "Sunglasses"
        },
        {
          id: "2",
          quantity: 1,
          amountExcludingTax: 0,
          amountIncludingTax: 5000,
          taxAmount: 0,
          taxPercentage: 0,
          description: "Headphones"
        }
      ],

      authenticationData: isUnscheduledMit ? undefined : { threeDSRequestData: { nativeThreeDS: "preferred" } }
    };

    console.log("🟩 Normalized backend paymentRequest:", {
      reference: paymentRequest.reference,
      merchantOrderReference: paymentRequest.merchantOrderReference,
      checkoutAttemptId: paymentRequest.checkoutAttemptId,
      amount: paymentRequest.amount,
      hasOrder: !!paymentRequest.order,
      orderPsp: paymentRequest.order?.pspReference,
      pmHasCheckoutAttemptId: !!paymentRequest.paymentMethod?.checkoutAttemptId
    });

    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.payments(paymentRequest);
    });

    // ✅ CRITICAL: keep remaining cache in sync after /payments
    __updateRemainingFromAdyenResponse(response);

    return response;
  } catch (error) {
    console.error("🟥 Payment FAILED:", {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      raw: error
    });

    throw {
      message: error.message,
      statusCode: error.statusCode ?? 500
    };
  }
};

/* --------------------------------------------------------
   Submit payment details (3DS2 or redirect)
   ✅ FIX: update remaining cache from /payments/details too
--------------------------------------------------------- */
const submitPaymentDetails = async (requestBody) => {
  try {
    console.log("---------- [🔍 submitPaymentDetails()] ----------");
    console.log("RAW requestBody from frontend:", {
      hasPaymentData: !!requestBody.paymentData,
      hasDetails: !!requestBody.details,
      hasRedirectResult: !!requestBody.redirectResult
    });

    const response = await retryRequest(async () => {
      let payload = requestBody;

      // Redirect flows
      if (requestBody.redirectResult) {
        payload = { details: { redirectResult: requestBody.redirectResult } };
      }

      // 3DS flows
      if (requestBody.paymentData && requestBody.details) {
        payload = { paymentData: requestBody.paymentData, details: requestBody.details };
      }

      return await checkout.PaymentsApi.paymentsDetails(payload);
    });

    console.log("------ [✅ DETAILS SUBMITTED SUCCESSFULLY] ------");
    console.log({
      resultCode: response.resultCode,
      pspReference: response.pspReference,
      orderPsp: response?.order?.pspReference,
      remaining: response?.order?.remainingAmount
    });

    // ✅ CRITICAL: keep remaining cache in sync after /payments/details
    __updateRemainingFromAdyenResponse(response);

    return response;
  } catch (error) {
    console.error("------ [❌ submitPaymentDetails FAILED] ------");
    console.error("Message:", error.message);
    console.error("Status Code:", error.statusCode);
    console.error("Adyen Error Code:", error.errorCode);
    console.error("Full Error Object:", error);

    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Create Payment Link (Pay by Link)
--------------------------------------------------------- */
const createPaymentLink = async ({ amountValue, countryCode, shopperEmail, shopperReference, baseUrl }) => {
  if (!amountValue || !countryCode) {
    throw new ConfigurationError("amountValue and countryCode are required for payment link");
  }

  const currency = getCurrencyForCountry(countryCode);
  const reference = `PBL-${uuid()}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const paymentLinkRequest = {
    merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
    reference,
    amount: { value: Number(amountValue), currency },
    countryCode,

    shopperReference: shopperReference || `pbl-${Date.now()}`,
    shopperEmail: shopperEmail || undefined,
    shopperLocale: getLocaleForCountry(countryCode),

    expiresAt,
    storePaymentMethodMode: "askForConsent",
    recurringProcessingModel: "CardOnFile",
    reusable: false,

    returnUrl: `${baseUrl}/`
  };

  try {
    const response = await retryRequest(async () => {
      return await checkout.PaymentLinksApi.paymentLinks(paymentLinkRequest);
    });

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

module.exports = {
  createPaymentLink,
  getPaymentMethods,
  createSession,
  submitPaymentDetails,
  submitPayment,

  // partial payments
  balanceCheckGiftcard,
  createOrder,
  cancelOrder,

  hmacValidator: new hmacValidator(),
  adyenConfig: config.adyen
};