/**
 * Shared Payment Handlers
 * Centralized payment event handling for all payment methods
 */

/**
 * Handle payment completion
 */
function handleOnPaymentCompleted(resultCode) {
  console.info('Payment completed:', resultCode);
  
  const routes = {
    'Authorised': '/result/success',
    'Pending': '/result/pending',
    'Received': '/result/pending',
    'Refused': '/result/failed',
    'Cancelled': '/result/failed',
    'Error': '/result/error'
  };

  const route = routes[resultCode];
  if (!route) {
    console.error(`Unknown result code: ${resultCode}`);
    window.location.href = '/result/error';
    return;
  }

  window.location.href = route;
}

/**
 * Handle payment failure
 */
function handleOnPaymentFailed(resultCode) {
  console.error('Payment failed:', resultCode);
  window.location.href = '/result/failed';
}

/**
 * Handle general errors
 */
function handleOnError(error, component) {
  console.error('Payment error:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    component: component
  });
  window.location.href = '/result/error';
}


/**
 * Create standardized payment configuration
 */
function createPaymentConfigurationSessionFlow(session, options = {}) {
  const {
    clientKey,
    environment = 'test',
    amount = { value: 10000, currency: 'EUR' },
    locale = 'en_US',
    countryCode = 'NL',
    showPayButton = true,
    translations = {}
  } = options;

  return {
    session: session,
    clientKey,
    environment,
    amount,
    locale,
    countryCode,
    showPayButton,
    translations,
    onPaymentCompleted: (result, component) => {
      if (window.errorHandler) {
        window.errorHandler.handlePaymentCompleted(result, component);
      } else {
        console.info("onPaymentCompleted", result, component);
        handleOnPaymentCompleted(result.resultCode);
      }
    },
    onPaymentFailed: (result, component) => {
      if (window.errorHandler) {
        window.errorHandler.handlePaymentFailed(result, component);
      } else {
        console.info("onPaymentFailed", result, component);
        handleOnPaymentFailed(result.resultCode);
      }
    },
    onError: (error, component) => {
      if (window.errorHandler) {
        window.errorHandler.handleGeneralError(error, component);
      } else {
        console.error("onError", error.name, error.message, error.stack, component);
        handleOnError(error, component);
      }
    }
  };
}





function createPaymentConfigurationAdvancedFlow(
  paymentMethodsResponse,
  shopperConversionId,
  shopperReference,
  options = {}
) {
  const {
    clientKey,
    environment = "test",
    amount = { value: 999, currency: "EUR" },
    locale = "en_US",
    countryCode = "NL",
    showPayButton = true,
    translations = {}
  } = options;

  console.log("[PaymentHandlers] createPaymentConfigurationAdvancedFlow", {
    shopperConversionId,
    shopperReference,
    countryCode,
    amount,
    hasPMs: !!paymentMethodsResponse?.paymentMethods
  });

  return {
    clientKey,
    paymentMethodsResponse,
    environment,
    amount,
    locale,
    countryCode,
    showPayButton,
    translations,

    // 1) /payments
    onSubmit: async (state, component, actions) => {
      console.log("[PaymentHandlers] onSubmit", {
        isValid: state.isValid,
        paymentMethodType: state?.data?.paymentMethod?.type
      });

      if (!state.isValid) {
        console.warn("[PaymentHandlers] onSubmit: invalid state → reject");
        actions.reject();
        return;
      }

      const payload = {
        ...state.data,
        additionalData: {
          locale: getLocaleForCountry(countryCode),
          countryCode,
          shopperConversionId,
          shopperReference,
          amount
        }
      };

      let response;
      try {
        response = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then((r) => r.json());
      } catch (err) {
        console.error("[PaymentHandlers] onSubmit /payments ERROR", err);
        actions.reject();
        return;
      }

      console.log("🔵 [PaymentHandlers] /payments response:", response);

      const { action, resultCode, order, donationToken } = response || {};

      if (!resultCode && !action) {
        console.warn(
          "[PaymentHandlers] /payments: missing resultCode and action → reject"
        );
        actions.reject();
        return;
      }

      // 🔑 v6: toujours resolve avec resultCode + action (éventuellement)
      actions.resolve({
        resultCode,
        action,
        order,
        donationToken
      });
    },

        // 2) /payments/details
        onAdditionalDetails: async (state, component, actions) => {
      console.info("onAdditionalDetails", {
        stateData: state.data,
        hasRedirectResult: !!state.data.redirectResult,
        hasPaymentData: !!state.data.paymentData,
        hasDetails: !!state.data.details
      });

      let payload;

      // 🔹 Cas redirect (iDEAL, Sofort, Bancontact redirect, etc.)
      if (state.data.redirectResult) {
        payload = {
          details: {
            redirectResult: state.data.redirectResult
          }
        };
      }
      // 🔹 Cas 3DS "classique" : paymentData + details
      else if (state.data.paymentData && state.data.details) {
        payload = {
          paymentData: state.data.paymentData,
          details: state.data.details
        };
      }
      // 🔹 Cas que tu vois dans ton log : uniquement details (threeDSResult)
      else if (state.data.details) {
        // Exemple : { details: { threeDSResult: "..." } }
        payload = {
          details: state.data.details
        };
      }
      // 🔹 Tout le reste → vraiment non supporté
      else {
        console.warn("Unsupported state.data format in onAdditionalDetails", state.data);
        actions.reject();
        return;
      }

      let response;
      try {
        response = await fetch("/api/payments/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then((r) => r.json());
      } catch (err) {
        console.error("onAdditionalDetails ERROR:", err);
        actions.reject();
        return;
      }

      console.log("🟣 /api/payments/details response:", response);

      const { action, resultCode, order } = response || {};

      if (!resultCode && !action) {
        console.warn(
          "[PaymentHandlers] /payments/details: missing resultCode and action → reject"
        );
        actions.reject();
        return;
      }

      // v6 : on passe tout par resolve (le SDK gère action / next steps)
      actions.resolve({
        resultCode,
        action,
        order
      });
    },
        onPaymentCompleted: (result, component) => {
      console.log("[PaymentHandlers] onPaymentCompleted", result);
      if (window.errorHandler) {
        window.errorHandler.handlePaymentCompleted(result, component);
      } else {
        handleOnPaymentCompleted(result.resultCode);
      }
    },

    onPaymentFailed: (result, component) => {
      console.log("[PaymentHandlers] onPaymentFailed", result);
      if (window.errorHandler) {
        window.errorHandler.handlePaymentFailed(result, component);
      } else {
        handleOnPaymentFailed(result.resultCode || "Error");
      }
    },

    onError: (error, component) => {
      console.error("[PaymentHandlers] onError", error);
      if (window.errorHandler) {
        window.errorHandler.handleGeneralError(error, component);
      } else {
        handleOnError(error, component);
      }
    }
  };
}
/**
 * Create payment method configuration
 */
function createPaymentMethodConfiguration(type, options = {}) {
  const baseConfig = {
    card: {
      showBrandIcon: true,
      hasHolderName: true,
      holderNameRequired: true,
      billingAddressRequired: false
    },
    ideal: {
      showImage: true
    },
    vipps: {
      showImage: true
    },
    klarna: {
      showImage: true
    },
    sepa: {
      showImage: true
    },
    googlepay: {
      showImage: true
    },
    applepay: {
      showImage: true
    }
  };

  return {
    [type]: {
      ...baseConfig[type],
      ...options
    }
  };
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleOnPaymentCompleted,
    handleOnPaymentFailed,
    handleOnError,
    createPaymentConfigurationSessionFlow,
    createPaymentConfigurationAdvancedFlow,
    createPaymentMethodConfiguration
  };
} else {
  // Browser environment
  window.PaymentHandlers = {
    handleOnPaymentCompleted,
    handleOnPaymentFailed,
    handleOnError,
    createPaymentConfigurationSessionFlow,
    createPaymentConfigurationAdvancedFlow,
    createPaymentMethodConfiguration
  };
}
