/**
 * Payments Controller
 * Handles payment-related API endpoints
 */

const { asyncHandler } = require('../utils/errorHandler');
const { getBaseUrl, getLocaleForCountry, getClientIp } = require('../config');
const adyenService = require('../services/adyenService');
const paymentService = require('../services/paymentService');
const { shouldRouteCancelledToPending } = require('../utils/paymentMethodOverrides');

/**
 * Create a payment session
 */
const createSession = asyncHandler(async (req, res) => {
  try {
    // Generate unique order reference
    const orderRef = paymentService.generateOrderRef();

    // Get base URL for redirects
    const baseUrl = getBaseUrl(req);

    // ✅ AJOUT: allow passing Adyen reference + merchantOrderReference from frontend
    const bodyReference = req.body?.reference;
    const bodyMerchantOrderReference = req.body?.merchantOrderReference;

    // Get payment method type and country from query parameters
    const paymentMethod = req.query.type || 'default';
    let selectedCountry = req.query.country || 'FR';

    // Enforce country per payment method where applicable
    const methodLower = String(paymentMethod).toLowerCase();
    if (methodLower === 'vipps') {
      selectedCountry = 'NO';
    } else if (methodLower === 'mobilepay') {
      selectedCountry = 'DK';
    } else if (methodLower === 'ideal') {
      selectedCountry = 'NL';
    };

    console.log('Session creation request:', {
      orderRef,
      paymentMethod,
      selectedCountry,
      baseUrl,

      // ✅ AJOUT
      hasBodyReference: !!bodyReference,
      hasBodyMerchantOrderReference: !!bodyMerchantOrderReference
    });

    // Ensure we have just the country code, not an object
    if (typeof selectedCountry === 'string' && selectedCountry.startsWith('{')) {
      try {
        const parsed = JSON.parse(selectedCountry);
        selectedCountry = parsed.id || 'FR';
      } catch (e) {
        console.warn('Failed to parse country parameter, using default');
        selectedCountry = 'FR';
      }
    }

    const sessionData = {
      orderRef,
      baseUrl,
      paymentMethod,
      selectedCountry,
      countryCode: selectedCountry,

      // ✅ AJOUT
      reference: bodyReference,
      merchantOrderReference: bodyMerchantOrderReference
    };

    const response = await adyenService.createSession(sessionData);

    // Persist payment method metadata for later redirect handling
    try {
      paymentService.storeOrderMetadata(orderRef, { paymentMethod, selectedCountry });
    } catch (e) {
      console.warn('Failed to store order metadata', e);
    }

    console.log('Session created with returnUrl:', `${baseUrl}/handleShopperRedirect?orderRef=${orderRef}`);
    res.json(response);
  } catch (error) {
    console.error('Session creation error:', {
      message: error.message,
      errorCode: error.errorCode,
      statusCode: error.statusCode,
      query: req.query
    });
    throw error;
  }
});

/**
 * ✅ Create order (partial payments: ANCV)
 * POST /api/orders
 * body: { amount: {currency, value}, reference: "..." }
 */
const createOrder = asyncHandler(async (req, res) => {
  const { amount, reference } = req.body || {};

  console.log("=== /api/orders ===");
  console.log("Incoming payload:", { amount, reference });

  try {
    const response = await adyenService.createOrder({ amount, reference });
    res.json(response);
  } catch (error) {
    console.error("createOrder FAILED:", {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      raw: error
    });

    res.status(error.statusCode ?? 500).json({
      message: error.message,
      errorCode: error.errorCode
    });
  }
});

/**
 * Gift card: balance check
 * POST /api/paymentMethods/balance
 */
const balanceCheckGiftcard = asyncHandler(async (req, res) => {
  const { paymentMethod, amount } = req.body || {};

  const payload = {
    paymentMethod,
    amount
  };

  const response = await adyenService.balanceCheckGiftcard(payload);
  res.json(response);
});

/**
 * ✅ Cancel order (partial payments)
 * POST /api/orders/cancel
 * body: { order: { pspReference, orderData } }
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const { order } = req.body || {};

  console.log("=== /api/orders/cancel ===");
  console.log("Incoming payload:", { hasOrder: !!order });

  try {
    const response = await adyenService.cancelOrder({ order });
    res.json(response);
  } catch (error) {
    console.error("cancelOrder FAILED:", {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      raw: error
    });

    res.status(error.statusCode ?? 500).json({
      message: error.message,
      errorCode: error.errorCode
    });
  }
});

/**
 * Submit a payment (Advanced Flow)
 */
const submitPayment = asyncHandler(async (req, res) => {
  const paymentData = req.body;
  console.log(paymentData);

  const baseUrl = getBaseUrl(req);
  const shopperIP = getClientIp(req);

  paymentData.additionalDataNetwork = {
    shopperIP,
    baseUrl,
  };

  console.log("=== /api/payments (ADVANCED FLOW) ===");
  console.log("Incoming payload:", {
    hasPaymentMethod: !!paymentData.paymentMethod,
    hasBrowserInfo: !!paymentData.browserInfo,
    hasAmount: !!paymentData.additionalData.amount,
    hasPayload: !!paymentData?.details?.payload,
    hasRedirectResult: !!paymentData.redirectResult,
    hasShopperIP: !!paymentData.additionalDataNetwork.shopperIP,
    hasBaseUrl: !!paymentData.additionalDataNetwork.baseUrl,
    hasShopperReference: !!paymentData.additionalData.shopperReference,
    hasOrder: !!paymentData.order, 

    // ✅ AJOUT
    hasReference: !!paymentData.reference,
    hasMerchantOrderReference: !!paymentData.merchantOrderReference
  });

  try {
    const response = await adyenService.submitPayment(paymentData);

    console.log(response);

    console.log("submitPayment SUCCESS:", {
      resultCode: response.resultCode,
      pspReference: response.pspReference
    });

    res.json(response);
  } catch (error) {
    console.error("submitPayment FAILED:", {
      message: error.message,
      statusCode: error.statusCode,
      raw: error
    });

    res.status(error.statusCode ?? 500).json({
      message: error.message,
      errorCode: error.errorCode
    });
  }
});

/**
 * Submit payment details (redirect or additionalDetails)
 */
const submitPaymentDetails = asyncHandler(async (req, res) => {
  const details = req.body;

  console.log("=== /api/payments/details ===");
  console.log("Incoming redirect/details:", {
    hasRedirectResult: !!details.redirectResult,
    hasPayload: !!details.payload
  });

  try {
    const response = await adyenService.submitPaymentDetails(details);

    console.log("submitPaymentDetails SUCCESS:", {
      resultCode: response.resultCode,
      pspReference: response.pspReference
    });

    res.json(response);
  } catch (error) {
    console.error("submitPaymentDetails FAILED:", {
      message: error.message,
      errorCode: error.errorCode,
      raw: error
    });

    res.status(error.statusCode ?? 500).json({
      message: error.message,
      errorCode: error.errorCode
    });
  }
});

/**
 * Get payment methods (Advanced Flow)
 */
const getPaymentMethods = asyncHandler(async (req, res) => {

  console.log("=== /api/paymentMethods (ADVANCED FLOW) ===");
  
  const paymentMethodsData = req.body;
  console.log(paymentMethodsData);


  try {
    // 2️⃣ Appel Adyen
    const response = await adyenService.getPaymentMethods(paymentMethodsData);

    console.log("Payment methods retrieved:", {
      pmCount: response.paymentMethods?.length || 0
    });

    // 3️⃣ Retourner la réponse
    res.json(response);

  } catch (error) {
    console.error("Failed to retrieve payment methods:", {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode
    });

    res.status(error.statusCode ?? 500).json({
      message: error.message,
      errorCode: error.errorCode
    });
  }
});

/**
 * Handle shopper redirect
 */
const handleShopperRedirect = asyncHandler(async (req, res) => {
  console.log('=== REDIRECT RECEIVED ===');
  console.log('Method:', req.method);
  console.log('Query params:', Object.keys(req.query));
  console.log('Body keys:', Object.keys(req.body || {}));
  console.log('Headers keys:', Object.keys(req.headers));

  try {
    // Create the payload for submitting payment details
    const redirect = req.method === "GET" ? req.query : req.body;
    const details = {};

    if (redirect.redirectResult) {
      details.redirectResult = redirect.redirectResult;
    } else if (redirect.payload) {
      details.payload = redirect.payload;
    } else {
      throw new Error('Missing payment details');
    }

    console.log('Redirect details:', details);

    // Validate order reference
    const orderRef = redirect.orderRef;
    if (!orderRef) {
      throw new Error('Missing order reference');
    }

    // Submit payment details to Adyen
    const response = await adyenService.submitPaymentDetails(details);

    // Store the result code for status tracking
    if (response.resultCode) {
      paymentService.storePaymentStatus(orderRef, response.resultCode);
      console.log(`Payment status stored for ${orderRef}: ${response.resultCode}`);

      if (response.resultCode === 'Received' || response.resultCode === 'Pending') {
        console.log(`Payment ${orderRef} is in transient state: ${response.resultCode}. Final status will be updated via webhook.`);
      }
    }

    // Store redirect data for potential status check
    const redirectData = {
      redirectResult: redirect.redirectResult || redirect.payload,
      sessionId: redirect.sessionId
    };

    // Encode the redirect data to pass to result page
    const encodedRedirectData = encodeURIComponent(JSON.stringify(redirectData));

    // Fetch stored metadata to enable method-specific handling (e.g., MobilePay workaround)
    const metadata = paymentService.getOrderMetadata(orderRef) || {};
    const method = (metadata.paymentMethod || '').toLowerCase();
    const metaCountry = metadata.selectedCountry;

    switch (response.resultCode) {
      case "Authorised":
        res.redirect(`/result/success?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        break;
      case "Pending":
      case "Received":
        res.redirect(`/result/pending?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        break;
      case "Refused":
        res.redirect(`/result/failed?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        break;
      case "Error":
        res.redirect(`/result/failed?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        break;
      case "Cancelled":
        if (shouldRouteCancelledToPending(method, metaCountry)) {
          console.log(`Workaround active: routing Cancelled to pending for order ${orderRef} (method=${method || 'unknown'}, country=${metaCountry})`);
          res.redirect(`/result/pending?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        } else {
          res.redirect(`/result/failed?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        }
        break;
      default:
        console.warn(`Unknown result code: ${response.resultCode}`);
        res.redirect(`/result/error?orderRef=${orderRef}&redirectData=${encodedRedirectData}`);
        break;
    }
  } catch (error) {
    console.error('Redirect handling error:', {
      message: error.message,
      errorCode: error.errorCode,
      statusCode: error.statusCode,
      redirectData: req.method === "GET" ? req.query : req.body
    });
    throw error;
  }
});

/**
 * Get payment status
 */
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { orderRef } = req.params;

  if (!orderRef) {
    return res.status(400).json({
      error: 'Order reference is required',
      code: 'MISSING_ORDER_REF'
    });
  }

  const status = paymentService.getPaymentStatus(orderRef);

  if (!status) {
    return res.status(404).json({
      error: 'Payment not found',
      code: 'PAYMENT_NOT_FOUND',
      orderRef
    });
  }

  res.json(status);
});

/**
 * Debug endpoint to get all payment statuses
 */
const getAllPaymentStatuses = asyncHandler(async (req, res) => {
  const statuses = paymentService.getAllPaymentStatuses();
  res.json({
    count: Object.keys(statuses).length,
    statuses
  });
});

/**
 * Re-check payment status using redirect result
 */
const recheckPaymentStatus = asyncHandler(async (req, res) => {
  const { orderRef, redirectResult, sessionId } = req.body;

  if (!orderRef) {
    return res.status(400).json({
      error: 'Order reference is required',
      code: 'MISSING_ORDER_REF'
    });
  }

  if (!redirectResult && !req.body.payload) {
    return res.status(400).json({
      error: 'Redirect result or payload is required',
      code: 'MISSING_PAYMENT_DETAILS'
    });
  }

  try {
    // Prepare payment details
    const details = {};
    if (redirectResult) {
      details.redirectResult = redirectResult;
    } else if (req.body.payload) {
      details.payload = req.body.payload;
    }

    // Submit payment details to Adyen to get updated status
    const response = await adyenService.submitPaymentDetails(details);

    // Update stored status
    if (response.resultCode) {
      paymentService.storePaymentStatus(orderRef, response.resultCode);
      console.log(`Payment status re-checked for ${orderRef}: ${response.resultCode}`);
    }

    // Return the updated status
    res.json({
      orderRef,
      status: response.resultCode,
      pspReference: response.pspReference,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Status re-check error:', {
      message: error.message,
      errorCode: error.errorCode,
      orderRef
    });

    res.status(500).json({
      error: 'Failed to re-check payment status',
      code: 'RECHECK_ERROR',
      details: error.message
    });
  }
});

const createPaymentLink = async (req, res) => {
  try {
    const { amountValue, shopperEmail, shopperReference } = req.body;

    // On récupère le pays comme pour /api/sessions
    const countryCode = req.query.country || "FR";

    // Base URL de ton site (http://localhost:8080 ...)
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const paymentLink = await adyenService.createPaymentLink({
      amountValue,
      countryCode,
      shopperEmail,
      shopperReference,
      baseUrl
    });

    return res.json({
      id: paymentLink.id,
      url: paymentLink.url,
      status: paymentLink.status,
      expiresAt: paymentLink.expiresAt
    });
  } catch (error) {
    console.error("Error creating payment link:", error);
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

module.exports = {
  createPaymentLink,
  createSession,
  handleShopperRedirect,
  getPaymentStatus,
  getAllPaymentStatuses,
  recheckPaymentStatus,

  // Advanced Flow
  submitPayment,
  submitPaymentDetails,
  getPaymentMethods,

  // ✅ partial payments / ANCV
  balanceCheckGiftcard,
  createOrder,
  cancelOrder
};