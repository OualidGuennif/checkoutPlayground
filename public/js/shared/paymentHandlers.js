/**
 * paymentHandlers.js
 * Shared Payment Handlers (Sessions + Advanced)
 * 3DS detection STRICT: action.type === "threeDS2"
 *
 * Security posture:
 * - Does NOT expose checkout instance globally
 * - Only receives a bound createFromAction(action) function
 * - Keeps mounted 3DS action component ref private
 * - Freezes exported API and locks it on window
 */

(function () {
  "use strict";

  /* -----------------------------
     Private refs (NOT on window)
  ------------------------------ */
  let __createFromAction = null;     // function(action) => component
  let __active3DSComponent = null;   // mounted action component (private)

  /* -----------------------------
     UI helpers (delegate to uiOverlay.js if present)
  ------------------------------ */
  const UI = {
    setAuthOverlay(open, label) {
      window.setAuthOverlay?.(open, label);
    },
    setThreeDS2Modal(open, opts) {
      window.setThreeDS2Modal?.(open, opts);
    },
    isThreeDS2Action(action) {
      return action?.type === "threeDS2";
    },
    shouldHideOverlayForResultCode(resultCode) {
      return ["Authorised", "Refused", "Cancelled", "Error", "Pending", "Received"].includes(resultCode);
    }
  };

  function cleanup3DSModal() {
    try { __active3DSComponent?.unmount?.(); } catch (_) {}
    __active3DSComponent = null;
    UI.setThreeDS2Modal(false, { clear: true });
  }

  /* -----------------------------
     Public hook: register action factory
     (ONLY thing you need from checkout)
  ------------------------------ */
  function registerCreateFromAction(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("[PaymentHandlers] registerCreateFromAction expects a function");
    }
    __createFromAction = fn;
  }

  /* -----------------------------
     Result routing
  ------------------------------ */
  function handleOnPaymentCompleted(resultCode) {
    const routes = {
      Authorised: "/result/success",
      Pending: "/result/pending",
      Received: "/result/pending",
      Refused: "/result/failed",
      Cancelled: "/result/failed",
      Error: "/result/error"
    };
    window.location.href = routes[resultCode] || "/result/error";
  }

  function handleOnPaymentFailed(_) {
    window.location.href = "/result/failed";
  }

  function handleOnError(error, component) {
    console.error("Payment error:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      component
    });
    window.location.href = "/result/error";
  }

  /* -----------------------------
     SESSION FLOW
  ------------------------------ */
  function createPaymentConfigurationSessionFlow(session, options = {}) {
    const {
      clientKey,
      environment = "test",
      amount = { value: 10000, currency: "EUR" },
      locale = "en_US",
      countryCode = "NL",
      showPayButton = true,
      translations = {}
    } = options;

    return {
      session,
      clientKey,
      environment,
      amount,
      locale,
      countryCode,
      showPayButton,
      translations,

      onPaymentCompleted: (result, component) => {
        cleanup3DSModal();
        UI.setAuthOverlay(false);
        if (window.errorHandler) window.errorHandler.handlePaymentCompleted(result, component);
        else handleOnPaymentCompleted(result?.resultCode);
      },

      onPaymentFailed: (result, component) => {
        cleanup3DSModal();
        UI.setAuthOverlay(false);
        if (window.errorHandler) window.errorHandler.handlePaymentFailed(result, component);
        else handleOnPaymentFailed(result?.resultCode);
      },

      onError: (error, component) => {
        cleanup3DSModal();
        UI.setAuthOverlay(false);
        if (window.errorHandler) window.errorHandler.handleGeneralError(error, component);
        else handleOnError(error, component);
      }
    };
  }

  /* -----------------------------
     ADVANCED FLOW (3DS -> your modal)
  ------------------------------ */
  function createPaymentConfigurationAdvancedFlow(paymentMethodsResponse, shopperConversionId, shopperReference, options = {}) {
    const {
      clientKey,
      environment = "test",
      amount = { value: 999, currency: "EUR" },
      locale = "en_US",
      countryCode = "NL",
      showPayButton = true,
      translations = {}
    } = options;

    const computedLocale = (typeof getLocaleForCountry === "function")
      ? getLocaleForCountry(countryCode)
      : locale;

    function patchHandleActionToModal(component) {
      if (!component?.handleAction || component.__patched3dsToModal) return;

      const original = component.handleAction.bind(component);

      component.handleAction = (action) => {
        // STRICT: only threeDS2
        if (UI.isThreeDS2Action(action)) {
          if (typeof __createFromAction !== "function") {
            console.warn("[PaymentHandlers] 3DS2 action received but createFromAction not registered");
            return original(action);
          }

          UI.setThreeDS2Modal(true);

          // kill previous
          try { __active3DSComponent?.unmount?.(); } catch (_) {}
          __active3DSComponent = null;

          const mountEl = document.getElementById("threeDS2ActionMount");
          if (!mountEl) {
            console.warn("[PaymentHandlers] #threeDS2ActionMount not found");
            return original(action);
          }
          mountEl.innerHTML = "";

          // mount inside modal
          const actionComponent = __createFromAction(action);
          __active3DSComponent = actionComponent;
          actionComponent.mount("#threeDS2ActionMount");

          return actionComponent;
        }

        return original(action);
      };

      component.__patched3dsToModal = true;
    }

    return {
      clientKey,
      paymentMethodsResponse,
      environment,
      amount,
      locale: computedLocale,
      countryCode,
      showPayButton,
      translations,

      onSubmit: async (state, component, actions) => {
        if (!state?.isValid) return actions.reject();

        UI.setAuthOverlay(true, "Authentification en cours…");

        let response;
        try {
          response = await fetch("/api/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...state.data,
              additionalData: {
                locale: computedLocale,
                countryCode,
                shopperConversionId,
                shopperReference,
                amount
              }
            })
          }).then(r => r.json());
        } catch (_) {
          UI.setAuthOverlay(false);
          cleanup3DSModal();
          return actions.reject();
        }

        UI.setAuthOverlay(false);

        const { action, resultCode, order, donationToken } = response || {};
        if (!action && !resultCode) {
          cleanup3DSModal();
          return actions.reject();
        }

        // Patch BEFORE resolve (so SDK calls patched handleAction)
        patchHandleActionToModal(component);

        // Always resolve with action (GooglePay needs it for correct UX)
        return actions.resolve({ resultCode, action, order, donationToken });
      },

      onAdditionalDetails: async (state, component, actions) => {
        UI.setAuthOverlay(true, "Validation en cours…");

        let payload;
        if (state?.data?.redirectResult) payload = { details: { redirectResult: state.data.redirectResult } };
        else if (state?.data?.paymentData && state?.data?.details) payload = { paymentData: state.data.paymentData, details: state.data.details };
        else if (state?.data?.details) payload = { details: state.data.details };
        else {
          UI.setAuthOverlay(false);
          cleanup3DSModal();
          return actions.reject();
        }

        let response;
        try {
          response = await fetch("/api/payments/details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }).then(r => r.json());
        } catch (_) {
          UI.setAuthOverlay(false);
          cleanup3DSModal();
          return actions.reject();
        }

        UI.setAuthOverlay(false);

        const { action, resultCode, order, donationToken } = response || {};
        if (!action && !resultCode) {
          cleanup3DSModal();
          return actions.reject();
        }

        if (!action && resultCode && UI.shouldHideOverlayForResultCode(resultCode)) {
          cleanup3DSModal();
        }

        return actions.resolve({ resultCode, action, order, donationToken });
      },

      onPaymentCompleted: (result, component) => {
        UI.setAuthOverlay(false);
        cleanup3DSModal();
        if (window.errorHandler) window.errorHandler.handlePaymentCompleted(result, component);
        else handleOnPaymentCompleted(result?.resultCode);
      },

      onPaymentFailed: (result, component) => {
        UI.setAuthOverlay(false);
        cleanup3DSModal();
        if (window.errorHandler) window.errorHandler.handlePaymentFailed(result, component);
        else handleOnPaymentFailed(result?.resultCode || "Error");
      },

      onError: (error, component) => {
        UI.setAuthOverlay(false);
        cleanup3DSModal();
        if (window.errorHandler) window.errorHandler.handleGeneralError(error, component);
        else handleOnError(error, component);
      }
    };
  }

  /* -----------------------------
     Payment method config helper
  ------------------------------ */
  function createPaymentMethodConfiguration(type, options = {}) {
    const baseConfig = {
      card: { showBrandIcon: true, hasHolderName: true, holderNameRequired: true, billingAddressRequired: false },
      ideal: { showImage: true },
      vipps: { showImage: true },
      klarna: { showImage: true },
      sepa: { showImage: true },
      googlepay: { showImage: true },
      applepay: { showImage: true }
    };
    return { [type]: { ...baseConfig[type], ...options } };
  }

  /* -----------------------------
     Export (locked)
  ------------------------------ */
  const PaymentHandlers = Object.freeze({
    registerCreateFromAction,
    cleanup3DSModal, // utile si tu veux forcer un close depuis une page
    handleOnPaymentCompleted,
    handleOnPaymentFailed,
    handleOnError,
    createPaymentConfigurationSessionFlow,
    createPaymentConfigurationAdvancedFlow,
    createPaymentMethodConfiguration
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PaymentHandlers;
  } else {
    // lock on window (non writable / non configurable)
    if (!window.PaymentHandlers) {
      Object.defineProperty(window, "PaymentHandlers", {
        value: PaymentHandlers,
        writable: false,
        configurable: false,
        enumerable: true
      });
    }
  }
})();