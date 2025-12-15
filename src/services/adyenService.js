/**
 * Adyen API Service
 * Handles all Adyen API interactions with proper error handling
 */

const { Client, Config, CheckoutAPI } = require("@adyen/api-library");
const { hmacValidator } = require('@adyen/api-library');
const { config, getCurrencyForCountry, getLineItemsForPaymentMethod,getLocaleForCountry,getDailyShopperReference } = require('../config');
const { ConfigurationError, retryRequest, handleAdyenError } = require('../utils/errorHandler');

const { v4: uuid } = require("uuid");

console.log(config.adyen.ADYEN_API_KEY,config.adyen.ADYEN_ENVIRONMENT);
// Adyen NodeJS library configuration
const client = new Client({
  apiKey: config.adyen.ADYEN_API_KEY,
  environment: config.adyen.ADYEN_ENVIRONMENT
});





const checkout = new CheckoutAPI(client);

/**
 * Get payment methods
 */
const getPaymentMethods = async (countryCode, amount, shopperLocale,shopperConversionId,shopperReference) => {


    console.log("📡 Calling Adyen /paymentMethods with payload:", {
    channel: "Web",
    merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
    countryCode: countryCode,
    amount : amount,
    shopperLocale: shopperLocale,
    shopperConversionId: shopperConversionId,
    shopperReference: shopperReference
  });
  try {
    console.log(shopperConversionId);
    console.log(shopperReference);
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
    console.log(response);
    return response;
  } catch (error) {
    throw handleAdyenError(error);
  }
};

/**
 * Create a payment session
 */
const createSession = async (sessionData) => {
  try {
    const {
      orderRef,
      baseUrl,
      paymentMethod = 'default',
      selectedCountry = 'FR',
      shopperReference = getDailyShopperReference()
    } = sessionData;

    // Get currency and line items based on payment method and country
    let currency = getCurrencyForCountry(selectedCountry);
    let lineItems = getLineItemsForPaymentMethod(paymentMethod);
    let countryCode = selectedCountry;

    // -specific configuration (only for Norway)
    if (paymentMethod === 'vipps' || selectedCountry === 'NO') {
      currency = "NOK";
      countryCode = "NO";
      lineItems = config.lineItems.vipps;
    }

    // MobilePay-specific configuration (only for Denmark)
    if (paymentMethod === 'mobilepay' || selectedCountry === 'DK') {
      currency = "DKK";
      countryCode = "DK";
      lineItems = config.lineItems.mobilepay;
    }


       // MobilePay-specific configuration (only for NL)
    if (paymentMethod === 'ideal' || selectedCountry === 'NL') {
      currency = "EUR";
      countryCode = "NL";
      lineItems = config.lineItems.ideal;
    }


    const sessionRequest = {
      amount: { currency: currency, value: config.payment.defaultAmount },

      
      countryCode: countryCode,
      shopperLocale: getLocaleForCountry(countryCode),


      merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
      reference: orderRef,
      returnUrl: `${baseUrl}/handleShopperRedirect?orderRef=${orderRef}`,
      lineItems: lineItems,

      shopperReference,
      shopperInteraction:"Ecommerce",

      storePaymentMethodMode:"askForConsent",
      recurringProcessingModel: "CardOnFile",

      channel:"Web",

      authenticationData:{ 
      threeDSRequestData:{ 
      nativeThreeDS:'preferred'
      }
      }


    };

    console.log('Creating session with request:', {
      amount: sessionRequest.amount,
      countryCode: sessionRequest.countryCode,
      reference: sessionRequest.reference,
      returnUrl: sessionRequest.returnUrl,
      shopperReference: sessionRequest.shopperReference
    });

    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.sessions(sessionRequest);
    });

    console.log('Session created successfully:', {
      sessionId: response.id,
      returnUrl: sessionRequest.returnUrl
    });

    return response;
  } catch (error) {
    console.error('Session creation failed:', {
      message: error.message,
      errorCode: error.errorCode,
      statusCode: error.statusCode,
      sessionData
    });

    throw handleAdyenError(error);
  }
};

/**
 * Submit payment (Advanced Flow)
 */
const submitPayment = async (paymentData = {}) => {
  console.log("🟦 submitPayment(): received payload:", {
    hasPaymentMethod: !!paymentData.paymentMethod,
    hasBrowserInfo: !!paymentData.browserInfo,
    hasRiskData: !!paymentData.riskData,
    hasMethodType: paymentData.paymentMethod?.type,
    hasLocale: !!paymentData.additionalData.locale,
    hasShopperConversionId: !!paymentData.additionalData.shopperConversionId,
    hasShopperIP: !!paymentData.additionalDataNetwork.shopperIP,
    hasBaseUrl: !!paymentData.additionalDataNetwork.baseUrl,
    hasShopperReference: !!paymentData.additionalData.shopperReference
  });

  try {
    // Always generate a backend reference
    let orderRef = paymentData.reference ?? uuid();
    let finalCountryCode = paymentData.additionalData.countryCode;
    let baseUrl = paymentData.additionalDataNetwork.baseUrl;
    let shopperIP = paymentData.additionalDataNetwork.shopperIP;
    let currentOrigin = paymentData.origin ?? baseUrl;
    const recurringModelFromFront = paymentData.additionalData?.recurringProcessingModel || paymentData.recurringProcessingModel;


const isUnscheduledMit = recurringModelFromFront === "UnscheduledCardOnFile";


    console.log(baseUrl,orderRef,finalCountryCode,currentOrigin);



    // -specific configuration (only for Norway)
    if (paymentData.paymentMethod.type === 'vipps' ) {
      finalCountryCode = "NO";
    }

    // MobilePay-specific configuration (only for Denmark)
    if (paymentData.paymentMethod.type === 'mobilepay' ) {
      finalCountryCode = "DK";
    }

        // MobilePay-specific configuration (only for Denmark)
    if (paymentData.paymentMethod.type === 'ideal' ) {
      finalCountryCode = "NL";

    };




    const billingAdressMock =   {
    street: 'Teststrasse',
    houseNumberOrName: '1',
    postalCode: '10115',
    city: 'Berlin',
    country: finalCountryCode
  };




    /**
     * ---------------------------------------------------------
     * CLEAN PAYMENT REQUEST MERGE
     * ---------------------------------------------------------
     * - The Component sends ONLY:
     *   → paymentMethod
     *   → browserInfo
     *   → riskData
     *   → billingAddress (if requested)
     *   → checkoutAttemptId
     *
     * - The backend MUST provide the rest.
     */






      const paymentRequest = {
        /**
         * 1) Core payment
         */
        merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,

        reference: orderRef,

        amount: paymentData.additionalData?.amount ?? {
          value: 999,
          currency: getCurrencyForCountry(finalCountryCode)
        },

        channel: "Web",

        countryCode: finalCountryCode,

        returnUrl: `${currentOrigin}/handleShopperRedirect?orderRef=${orderRef}`,

        origin: currentOrigin ?? undefined,

        /**
         * 2) Shopper
         */
        shopperReference: paymentData.additionalData.shopperReference ?? "TestShopper",

        shopperEmail: paymentData.shopperEmail ?? "test@example.com",

        shopperName: {
          firstName: "Test",
          lastName: "Shopper"
        },

        shopperLocale: getLocaleForCountry(finalCountryCode),

        shopperConversionId: paymentData.additionalData?.shopperConversionId ?? undefined,

        shopperIP, 


        /**
         * 3) Payment method + device + risk
         */
        paymentMethod: paymentData.paymentMethod, // REQUIRED

        recurringProcessingModel: isUnscheduledMit ? "UnscheduledCardOnFile" : (paymentData.storePaymentMethod || !!paymentData.paymentMethod?.storedPaymentMethodId) ? "CardOnFile"
      : undefined,

        shopperInteraction: isUnscheduledMit ? "ContAuth" : "Ecommerce",

        storePaymentMethod: paymentData.storePaymentMethod ?? undefined,

        browserInfo: isUnscheduledMit ? undefined : paymentData.browserInfo ?? undefined, // REQUIRED for 3DS

        riskData: paymentData.riskData ?? undefined,       //  HIGHLY recommended

        /**
         * 4) Order details
         */
        billingAddress:
          paymentData.billingAddress &&
          Object.keys(paymentData.billingAddress).length > 0
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
        

        /**
         * 5) 3DS options
         */
        authenticationData: isUnscheduledMit ? undefined : { threeDSRequestData: { nativeThreeDS: "preferred" } },
      };
    console.log("RAW DATA FROM FRONT:", paymentData);
    console.log("🟩 Normalized backend paymentRequest:", paymentRequest);

    /**
     * ---------------------------------------------------------
     * CALL ADYEN PAYMENTS API
     * ---------------------------------------------------------
     */
    const response = await retryRequest(async () => {
      return await checkout.PaymentsApi.payments(paymentRequest);
    });

    console.log("🟩 Payment SUCCESS:", {
      resultCode: response.resultCode,
      pspReference: response.pspReference
    });

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






/**
 * Submit payment details (3DS2 or redirect)
 * Expects req.body à la forme:
 *   { paymentData: 'xxx', details: { ... } }
 * exactement comme envoyé par le Component.
 */
const submitPaymentDetails = async (requestBody) => {
  try {
    console.log("---------- [🔍 submitPaymentDetails()] ----------");
    console.log("RAW requestBody from frontend:", requestBody, {
      hasPaymentData: !!requestBody.paymentData,
      hasDetails: !!requestBody.details
    });

    const response = await retryRequest(async () => {
      // On forward TEL QUEL à Adyen
      // Normalize payload
    let payload = requestBody;
    console.log('YESsssss',requestBody);

    // Redirect flows
    if (requestBody.redirectResult) {
      payload = {
        details: { redirectResult: requestBody.redirectResult }
      };
    }

    // 3DS flows
    if (requestBody.paymentData && requestBody.details) {
      payload = {
        paymentData: requestBody.paymentData,
        details: requestBody.details
      };
    }

    return await checkout.PaymentsApi.paymentsDetails(payload);
    });

    console.log("------ [✅ DETAILS SUBMITTED SUCCESSFULLY] ------");
    console.log({
      resultCode: response.resultCode,
      pspReference: response.pspReference
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





/**
 * Create Payment Link (Pay by Link)
 */
const createPaymentLink = async ({
  amountValue,
  countryCode,
  shopperEmail,
  shopperReference,
  baseUrl
}) => {
  if (!amountValue || !countryCode) {
    throw new ConfigurationError("amountValue and countryCode are required for payment link");
  }

  const currency = getCurrencyForCountry(countryCode);
  const reference = `PBL-${uuid()}`;

  // Expiration à 24h
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const paymentLinkRequest = {
    merchantAccount: config.adyen.ADYEN_MERCHANT_ACCOUNT,
    reference,
    amount: {
      value: Number(amountValue),
      currency
    },
    countryCode,

    shopperReference: shopperReference || `pbl-${Date.now()}`,
    shopperEmail: shopperEmail || undefined,
    shopperLocale: getLocaleForCountry(countryCode),

    // Infos pratiques
    expiresAt,
    storePaymentMethodMode: "askForConsent",
    recurringProcessingModel: "CardOnFile",
    reusable: false,
    //requiredShopperFields: ["shopperEmail"],

    // Là où le bouton "Continuer" de la page PBL renvoie
    returnUrl: `${baseUrl}/`
  };

  console.log("📡 Creating payment link with payload:", paymentLinkRequest);

  try {
    const response = await retryRequest(async () => {
      return await checkout.PaymentLinksApi.paymentLinks(paymentLinkRequest);
    });

    console.log("✅ Payment link created:", {
      id: response.id,
      url: response.url,
      expiresAt: response.expiresAt
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
  hmacValidator: new hmacValidator(),
  adyenConfig: config.adyen // Export Adyen specific config
};
