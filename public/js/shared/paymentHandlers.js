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

  // ✅ AJOUT: safe hook pour checkout.update(...) (comme createFromAction)
  let __checkoutUpdate = null;       // function(payload) => void

  // ✅ AJOUT: amount memory (base + current) to keep Drop-in amount in sync
  let __baseAmount = null;           // { value, currency } initial amount passed in options
  let __lastKnownAmount = null;      // { value, currency } last applied amount

  // ✅ AJOUT: shared references (stable across partial payments within the same checkout)
  let __unifiedReference = null;         // "${orderDigits}||${storeId}||${refHash}"
  let __merchantOrderReference8 = null;  // "12345678" digits-only

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
  ------------------------------ */
  function registerCreateFromAction(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("[PaymentHandlers] registerCreateFromAction expects a function");
    }
    __createFromAction = fn;
  }

  // ✅ AJOUT: register checkout.update binder
  function registerCheckoutUpdate(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("[PaymentHandlers] registerCheckoutUpdate expects a function");
    }
    __checkoutUpdate = fn;
  }

  // ✅ AJOUT: wrapper safe
  function __safeCheckoutUpdate(payload) {
    if (typeof __checkoutUpdate !== "function") {
      console.warn("[PaymentHandlers] checkout.update not registered — cannot update Drop-in state");
      return;
    }
    try {
      __checkoutUpdate(payload);
    } catch (e) {
      console.warn("[PaymentHandlers] checkout.update threw:", e);
    }
  }

  // ✅ AJOUT: normalize + set checkout amount (guarded)
  function __normalizeAmount(a) {
    if (!a) return null;
    const cur = a.currency;
    const val = a.value;
    if (!cur || val == null) return null;
    return { currency: cur, value: Number(val) };
  }

  function __setCheckoutAmount(nextAmount) {
    const norm = __normalizeAmount(nextAmount);
    if (!norm) return;

    // avoid noisy updates
    if (
      __lastKnownAmount &&
      __lastKnownAmount.currency === norm.currency &&
      Number(__lastKnownAmount.value) === Number(norm.value)
    ) {
      return;
    }

    __lastKnownAmount = norm;
    __safeCheckoutUpdate({ amount: norm }); // ✅ NOTE: "amount" (not "amout")
  }

  // ✅ AJOUT: sync amount from order.remainingAmount (truth) if present
  function __syncAmountFromOrder(order) {
    const remaining = order?.remainingAmount;
    const norm = __normalizeAmount(remaining);
    if (norm) __setCheckoutAmount(norm);
  }

  // ✅ AJOUT: reset order UI + restore amount after cancel
  function __resetOrderAfterCancel(order) {
    if (!order) return;

    // Strategy A (doc-ish): remove remainingAmount value/currency
    const cleanedOrder = {
      ...order,
      remainingAmount: { currency: undefined, value: undefined }
    };

    __safeCheckoutUpdate({ order: cleanedOrder });

    // Strategy B (fallback): hard reset order (certain versions behave better)
    setTimeout(() => {
      __safeCheckoutUpdate({ order: null });

      // ✅ CRITICAL: restore amount back to initial total (100€)
      if (__baseAmount) __setCheckoutAmount(__baseAmount);
    }, 0);
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

    // ✅ AJOUT: capture base amount once (used to restore after cancel)
    // (we keep it stable across giftcard add/remove)
    __baseAmount = __normalizeAmount(amount) || __baseAmount;
    __lastKnownAmount = __normalizeAmount(amount) || __lastKnownAmount;

    // ✅ AJOUT: capture shared references once
    __unifiedReference = options.unifiedReference || __unifiedReference;
    __merchantOrderReference8 = options.merchantOrderReference8 || __merchantOrderReference8;

    const computedLocale = (typeof getLocaleForCountry === "function")
      ? getLocaleForCountry(countryCode)
      : locale;

    function patchHandleActionToModal(component) {
      if (!component?.handleAction || component.__patched3dsToModal) return;

      const original = component.handleAction.bind(component);

      component.handleAction = (action) => {
        if (UI.isThreeDS2Action(action)) {
          if (typeof __createFromAction !== "function") {
            console.warn("[PaymentHandlers] 3DS2 action received but createFromAction not registered");
            return original(action);
          }

          UI.setThreeDS2Modal(true);

          try { __active3DSComponent?.unmount?.(); } catch (_) {}
          __active3DSComponent = null;

          const mountEl = document.getElementById("threeDS2ActionMount");
          if (!mountEl) {
            console.warn("[PaymentHandlers] #threeDS2ActionMount not found");
            return original(action);
          }
          mountEl.innerHTML = "";

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

      onBalanceCheck: (resolve, reject, data) => {
        fetch("/api/paymentMethods/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethod: data.paymentMethod,
            amount: data.amount ?? amount
          })
        })
          .then(r => r.json())
          .then(balanceResponse => resolve(balanceResponse))
          .catch(err => reject(err));
      },

      onOrderRequest: async (resolve, reject, data) => {
        try {
          const r = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: data.amount ?? amount,
              // ✅ AJOUT: force SAME reference for /orders
              reference: __unifiedReference || data.reference || `ORDER-${Date.now()}`
            })
          });
          const orderResponse = await r.json();
          resolve(orderResponse);
        } catch (e) {
          reject(e);
        }
      },

      // ✅ FIX: parse order correctly + reset Drop-in order state after cancel
      onOrderCancel: (orderOrData) => {
        const order = orderOrData?.order ? orderOrData.order : orderOrData;

        console.log("[onOrderCancel] payload:", orderOrData);
        console.log("[onOrderCancel] normalized order:", order);

        return fetch("/api/orders/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order })
        })
          .then(r => r.json())
          .then(cancelResponse => {
            // ✅ update UI state (remove applied giftcard line)
            __resetOrderAfterCancel(order);

            // ✅ ALSO: ensure amount is restored immediately (some UIs render before timeout)
            if (__baseAmount) __setCheckoutAmount(__baseAmount);

            return cancelResponse;
          });
      },

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

              // ✅ AJOUT: force SAME reference for ALL /payments (all partial payments)
              reference: __unifiedReference || state.data?.reference,

              // ✅ AJOUT: digits-only 8 chars (ONLY for /payments and /sessions)
              merchantOrderReference: __merchantOrderReference8 || state.data?.merchantOrderReference,

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

        // ✅ AJOUT: keep Drop-in amount synced with remainingAmount after partial payment
        __syncAmountFromOrder(order);

        patchHandleActionToModal(component);
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

        // ✅ AJOUT: payments/details can also return remainingAmount -> keep synced
        __syncAmountFromOrder(order);

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
    registerCheckoutUpdate, // ✅ AJOUT
    cleanup3DSModal,
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