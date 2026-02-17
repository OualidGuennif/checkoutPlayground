/**
 * adyenService.js
 * Adyen API Service
 * Handles all Adyen API interactions
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
const { RiskData } = require("@adyen/api-library/lib/src/typings/checkout/riskData");

console.log(config.adyen.ADYEN_ENVIRONMENT);

// Adyen NodeJS library configuration
const client = new Client({
  apiKey: config.adyen.ADYEN_API_KEY,
  environment: config.adyen.ADYEN_ENVIRONMENT
});
const checkout = new CheckoutAPI(client);

/* ---------- small utils ---------- */
function __sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}

/* --------------------------------------------------------
   Get payment methods
--------------------------------------------------------- */
const getPaymentMethods = async (paymentMethodsData = {}) => {
  console.log("📡 Calling Adyen /paymentMethods with payload:", {
    channel: "Web",
    merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
    countryCode: paymentMethodsData.countryCode,
    amount: paymentMethodsData.amount,
    order: paymentMethodsData.order,
    shopperLocale: paymentMethodsData.shopperLocale,
    shopperConversionId: paymentMethodsData.shopperConversionId,
    shopperReference: paymentMethodsData.shopperReference,
  });

  try {
    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.paymentMethods({
        channel: "Web",
        merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
        countryCode: paymentMethodsData.countryCode,
        amount: paymentMethodsData.amount,
        order: paymentMethodsData.order,
        shopperLocale: paymentMethodsData.shopperLocale,
        shopperConversionId: paymentMethodsData.shopperConversionId,
        shopperReference: paymentMethodsData.shopperReference,
      });
    });

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Create an order (partial payments)
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

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Cancel order
   (kept)
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

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Balance check
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

    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/* --------------------------------------------------------
   Create a payment session (session flow)
--------------------------------------------------------- */
const createSession = async (sessionData) => {
  try {
    const {
      orderRef,
      baseUrl,
      paymentMethod = "default",
      selectedCountry = "FR",
      shopperReference = getDailyShopperReference(),

      // allow overriding Adyen refs from controller/front
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

      reference: providedReference || orderRef,

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
--------------------------------------------------------- */
const submitPayment = async (paymentData = {}) => {
  console.log("🟦 submitPayment(): received payload:", {
    hasPaymentMethod: !!paymentData.paymentMethod,
    methodType: paymentData.paymentMethod?.type,
    hasOrder: !!paymentData.order,
    hasTopLevelAmount: !!paymentData.amount,
    hasReference: !!paymentData.reference,
    hasMerchantOrderReference: !!paymentData.merchantOrderReference
  });

  try {
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
      street: "6 avenue Daumesnil",
      houseNumberOrName: "",
      postalCode: "75012",
      city: "Paris",
      stateOrProvince: undefined,
      country: finalCountryCode
    };

    // fallback total (still used if front doesn't send amount)
    const totalAmountFromFront = paymentData.additionalData?.amount ?? {
      value: 2000,
      currency: getCurrencyForCountry(finalCountryCode)
    };

    // ✅ amount is accepted as sent by the front (or fallback)
    const chosenAmount = paymentData.amount ?? totalAmountFromFront;

    const paymentRequest = {
      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
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
      telephoneNumber: "+33612341212",


      // this is specific merchants fields to build risk rules upon
      // you use your own internal fields as you want for example "riskdata.YOUR_FIELD"
      // only string value
      additionalData:{
        "riskdata.isGuest": "true",
        "riskdata.loyaltyPoints": "237"
      },


      // keep paymentMethod as-is (sdkData stays if provided)
      paymentMethod: paymentData.paymentMethod,

      ...(paymentData.merchantOrderReference
        ? { merchantOrderReference: paymentData.merchantOrderReference }
        : {}),

      recurringProcessingModel: isUnscheduledMit
        ? "UnscheduledCardOnFile"
        : (paymentData.storePaymentMethod || !!paymentData.paymentMethod?.storedPaymentMethodId)
          ? "CardOnFile"
          : undefined,

      shopperInteraction: isUnscheduledMit ? "ContAuth" : "Ecommerce",
      storePaymentMethod: paymentData.storePaymentMethod ?? undefined,

      browserInfo: isUnscheduledMit ? undefined : paymentData.browserInfo ?? undefined,

      billingAddress:
        paymentData.billingAddress && Object.keys(paymentData.billingAddress).length > 0
          ? paymentData.billingAddress
          : billingAdressMock,
        
      deliveryAddress:
        paymentData.billingAddress && Object.keys(paymentData.billingAddress).length > 0
          ? paymentData.billingAddress
          : billingAdressMock,

      lineItems: paymentData.lineItems ?? [
        {
          id: "1",
          quantity: 1,
          sku:"762001876399",
          amountExcludingTax: 4500,
          amountIncludingTax: 5000,
          taxAmount: 500,
          // PHYSICAL_GOODS or SHIPPING_AND_PACKING or DIGITAL_GOODS
          itemCategory: "PHYSICAL_GOODS",
          description: "Sunglasses"
        },
        {
          id: "2",
          sku:"762126876399",
          quantity: 1,
          amountExcludingTax: 4500,
          amountIncludingTax: 5000,
          taxAmount: 500,
          // PHYSICAL_GOODS or SHIPPING_AND_PACKING or DIGITAL_GOODS
          itemCategory: "PHYSICAL_GOODS",
          description: "Headphones"
        }
      ],

      authenticationData: isUnscheduledMit ? undefined : { threeDSRequestData: { nativeThreeDS: "preferred" } },
      

      accountInfo: { 
        accountAgeIndicator: "from30To60Days",
        accountChangeIndicator:"lessThan30Days", 
        deliveryAddressUsageIndicator: "thisTransaction" 
      },

      merchantRiskIndicator: { 
        addressMatch: true,
        deliveryAddressIndicator:"shipToNewAddress", 
        deliveryTimeframe: "twoOrMoreDaysShipping" }


    };

    console.log("🟩 Normalized backend paymentRequest:", {
      reference: paymentRequest.reference,
      merchantOrderReference: paymentRequest.merchantOrderReference,
      amount: paymentRequest.amount,
      hasOrder: !!paymentRequest.order,
      orderPsp: paymentRequest.order?.pspReference
    });

    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.payments(paymentRequest);
    });



    return  response;
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
--------------------------------------------------------- */
const submitPaymentDetails = async (requestBody) => {
  try {
    console.log("---------- [🔍 submitPaymentDetails()] ----------");
    console.log("RAW requestBody from frontend:", {
      hasPaymentData: !!requestBody.paymentData,
      hasDetails: !!requestBody.details,
      hasRedirectResult: !!requestBody.redirectResult
    });
    console.log(requestBody);

    const response = await retryRequest(async () => {
      let payload = requestBody;

      // Redirect flows (url param "redirectResult")
      if (requestBody.redirectResult) {
        payload = { details: { redirectResult: requestBody.redirectResult } };
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
