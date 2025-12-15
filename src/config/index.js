/**
 * Configuration management for Adyen integration
 * Centralizes all configuration settings and environment variables
 */

const dotenv = require('dotenv');



// Load environment variables
dotenv.config({
  path: "./.env",
});

/**
 * Application configuration
 */
const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 8080,
    baseUrl: process.env.BASE_URL,
    environment: process.env.NODE_ENV || 'development'
  },

  // Adyen configuration
  adyen: {
    ADYEN_API_KEY: process.env.ADYEN_API_KEY,
    ADYEN_MERCHANT_ACCOUNT: process.env.ADYEN_MERCHANT_ACCOUNT,
    ADYEN_CLIENT_KEY: process.env.ADYEN_CLIENT_KEY,
    ADYEN_HMAC_KEY: process.env.ADYEN_HMAC_KEY,
    ADYEN_ENVIRONMENT: process.env.ADYEN_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'LIVE' : 'TEST')
  },

  // Payment configuration
  payment: {
    defaultCurrency: 'EUR',
    defaultCountry: 'FR',
    defaultAmount: 10000, // 100 EUR in minor units
    supportedCurrencies: {
      'US': 'USD',
      'GB': 'GBP',
      'NO': 'NOK',
      'SE': 'SEK',
      'DK': 'DKK',
      'CH': 'CHF',
      'JP': 'JPY',
      'CN': 'CNY',
      'KR': 'KRW',
      'BR': 'BRL',
      'MX': 'MXN',
      'AU': 'AUD',
      'CA': 'CAD',
      'IN': 'INR',
      'SG': 'SGD',
      'HK': 'HKD',
      'MY': 'MYR',
      'TH': 'THB',
      'ID': 'IDR',
      'PH': 'PHP',
      'VN': 'VND',
      'RU': 'RUB',
      'PL': 'PLN',
      'CZ': 'CZK',
      'AE': 'AED',
      'KE': 'KES',
      'NZ': 'NZD'
    }
  },

  // Line items configuration
  lineItems: {
    default: [
      { quantity: 1, amountIncludingTax: 5000, description: "Sunglasses" },
      { quantity: 1, amountIncludingTax: 5000, description: "Headphones" }
    ],
    vipps: [
      { quantity: 1, amountIncludingTax: 5000, description: "Sunglasses" },
      { quantity: 1, amountIncludingTax: 5000, description: "Headphones" }
    ],
    ideal: [
      { quantity: 1, amountIncludingTax: 5000, description: "Sunglasses" },
      { quantity: 1, amountIncludingTax: 5000, description: "Headphones" }
    ],
    mobilepay: [
      { quantity: 1, amountIncludingTax: 5000, description: "Sunglasses" },
      { quantity: 1, amountIncludingTax: 5000, description: "Headphones" }
    ]
  }
};

/**
 * Validate required configuration
 */
const validateConfig = () => {
  const requiredVars = [
    'ADYEN_API_KEY',
    'ADYEN_MERCHANT_ACCOUNT',
    'ADYEN_ENVIRONMENT',
    'ADYEN_CLIENT_KEY'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // HMAC key is optional - only needed for webhook validation
  if (!process.env.ADYEN_HMAC_KEY) {
    console.log('Note: ADYEN_HMAC_KEY is not set. Webhook validation will be skipped.');
  }

  return true;
};

/**
 * Get currency for country
 */
const getCurrencyForCountry = (countryCode) => {
  return config.payment.supportedCurrencies[countryCode] || config.payment.defaultCurrency;
};

/**
 * Get line items for payment method
 */
const getLineItemsForPaymentMethod = (paymentMethod) => {
  if (paymentMethod === 'vipps') {
    return config.lineItems.vipps;
  }
  return config.lineItems.default;
};

/**
 * Get base URL for redirects
 */
const getBaseUrl = (req) => {
  // Check for custom base URL override
  if (config.server.baseUrl) {
    return config.server.baseUrl;
  }
  
  // Use the actual request host and protocol
  const host = req.get('host');
  const protocol = req.socket.encrypted ? 'https' : 'http';
  return `${protocol}://${host}`;
};



function getLocaleForCountry(countryId) {
  const localeMap = {
    BR: "pt-BR",
    CN: "zh-CN",
    DK: "da-DK",
    DE: "de-DE",
    ES: "es-ES",
    FR: "fr-FR",
    IT: "it-IT",
    JP: "ja-JP",
    NL: "nl-NL",
    NO: "no-NO",
    PL: "pl-PL",
    RU: "ru-RU",
    SE: "sv-SE",
    TW: "zh-TW",
    US: "en-US",
    GB: "en-GB",
    AU: "en-AU",
    CA: "en-CA",
    MX: "es-MX",
    KR: "ko-KR",
    FI: "fi-FI",
    AT: "de-AT",
    CH: "de-CH",
    BE: "fr-BE",
    PT: "pt-PT",
    IN: "en-IN",
    SG: "en-SG",
    HK: "en-HK",
    MY: "en-MY",
    TH: "th-TH",
    ID: "id-ID",
    PH: "en-PH",
    VN: "vi-VN",
    CZ: "cs-CZ",
    AE: "en-AE",
    KE: "en-KE",
    NZ: "en-NZ",
  };
  return localeMap[countryId] || "en-US";
};



const getClientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // Premier IP dans la liste (cas proxy / load balancer)
    return xff.split(',')[0].trim();
  }

  const rawIp = req.socket?.remoteAddress || req.connection?.remoteAddress || "";
  // Nettoyage IPv6 / IPv4-mapped
  if (rawIp.startsWith("::ffff:")) {
    return rawIp.substring(7);
  }
  if (rawIp === "::1") {
    return "127.0.0.1";
  }
  return rawIp || "127.0.0.1";
};



function getDailyShopperReference() {
  const now = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day   = String(now.getDate()).padStart(2, "0");

  // ex: DEMO_SHOPPER_20251129
  return `DEMO_SHOPPER_${year}${month}${day}`;
}





module.exports = {
  config,
  validateConfig,
  getCurrencyForCountry,
  getLineItemsForPaymentMethod,
  getLocaleForCountry,
  getBaseUrl,
  getClientIp,
  getDailyShopperReference
};
