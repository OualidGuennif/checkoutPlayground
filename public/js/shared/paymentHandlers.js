/**
 * paymentHandlers.js
 */

(function () {
  "use strict";

  /* -----------------------------
     Private refs (NOT on window)
  ------------------------------ */
  let __createFromAction = null;     // function(action) => component
  let __active3DSComponent = null;   // mounted action component (private)

  // safe hook pour checkout.update(...) (comme createFromAction)
  let __checkoutUpdate = null;       // function(payload) => void

  //  amount memory (base + current) to keep Drop-in amount in sync
  let __baseAmount = null;           // { value, currency } initial amount passed in options
  let __lastKnownAmount = null;      // { value, currency } last applied amount

  //  shared references (stable across partial payments within the same checkout)
  let __unifiedReference = null;         // "${orderDigits}||${storeId}||${refHash}"
  let __merchantOrderReference8 = null;  // "12345678" digits-only

  // ✅ NEW: reference reset hook (provided by page)
  // returns: { unifiedReference, merchantOrderReference8 }
  let __onReferenceReset = null;

  //  browserInfo cache (for sizing 3DS challenge)
  let __cachedBrowserInfo = null;  // last known browserInfo from state.data

  // ✅ NEW: session caches (client-side)
  const __balanceSessionCache = new Map(); // instrumentKey -> { balance: {currency,value}, cachedAt }
  let __sessionRemainingAmount = null;     // { currency, value } updated via onOrderUpdated

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

  // register checkout.update binder
  function registerCheckoutUpdate(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("[PaymentHandlers] registerCheckoutUpdate expects a function");
    }
    __checkoutUpdate = fn;
  }

  // ✅ NEW: register ref reset callback
  function registerReferenceReset(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("[PaymentHandlers] registerReferenceReset expects a function");
    }
    __onReferenceReset = fn;
  }

  //  wrapper
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

  // normalize + set checkout amount (guarded)
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
    __safeCheckoutUpdate({ amount: norm });
  }

  // ✅ AJOUT: reset order UI + restore amount after cancel
  function __resetOrderAfterCancel(order) {
    if (!order) return;

    const cleanedOrder = {
      ...order,
      remainingAmount: { currency: undefined, value: undefined }
    };

    __safeCheckoutUpdate({ order: cleanedOrder });

    setTimeout(() => {
      __safeCheckoutUpdate({ order: null });

      if (__baseAmount) __setCheckoutAmount(__baseAmount);
    }, 0);
  }

  /* -----------------------------
     ✅ NEW: client-side balance cache helpers
  ------------------------------ */

  async function __sha256Hex(input) {
    const s = String(input);
    if (window.crypto?.subtle) {
      const buf = new TextEncoder().encode(s);
      const digest = await window.crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return `fallback-${s}`;
  }

  function __getInstrumentIdentifier(paymentMethod = {}) {
    return paymentMethod.encryptedCardNumber || paymentMethod.number || null;
  }

  async function __getInstrumentKey(paymentMethod = {}) {
    const id = __getInstrumentIdentifier(paymentMethod);
    if (!id) return null;

    const s = String(id);
    if (s.includes("*")) return null; // refuse masked

    return await __sha256Hex(s);
  }

  function __capAmount(amount, cap) {
    const a = __normalizeAmount(amount);
    const c = __normalizeAmount(cap);
    if (!a || !c) return a || amount || null;
    if (a.currency !== c.currency) return a;
    return { currency: a.currency, value: Math.min(Number(a.value), Number(c.value)) };
  }

  function __resetSessionCaches() {
    __balanceSessionCache.clear();
    __sessionRemainingAmount = null;
  }

  /* -----------------------------
     3DS modal size
  ------------------------------ */
  function __cacheBrowserInfo(browserInfo) {
    if (!browserInfo) return;
    const w = Number(browserInfo.screenWidth);
    const h = Number(browserInfo.screenHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    __cachedBrowserInfo = { ...browserInfo };
  }

  function __getBestBrowserInfo(stateData) {
    if (stateData?.browserInfo) return stateData.browserInfo;
    if (__cachedBrowserInfo) return __cachedBrowserInfo;

    return {
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height
    };
  }

  function __computeChallengeWindowSize(browserInfo) {
    const w = Number(browserInfo?.screenWidth);
    const h = Number(browserInfo?.screenHeight);

    if (!Number.isFinite(w) || !Number.isFinite(h)) return "02";

    const minSide = Math.min(w, h);

    if (minSide <= 480) return "05";
    if (minSide <= 768) return "02";
    if (minSide <= 900) return "03";
    return "04";
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
      amount = { value: 9999, currency: "EUR" },
      locale = "fr-FR",
      countryCode = "FR",
      showPayButton = true,
      translations = {}
    } = options;

    __baseAmount = __normalizeAmount(amount) || __baseAmount;
    __lastKnownAmount = __normalizeAmount(amount) || __lastKnownAmount;

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

          const bi = __getBestBrowserInfo(null);
          const challengeWindowSizeComputed = __computeChallengeWindowSize(bi);

          document.getElementById("threeDS2Modal")?.setAttribute(
            "data-fullscreen",
            challengeWindowSizeComputed === "05" ? "1" : "0"
          );

          UI.setThreeDS2Modal(true);

          const actionComponent = __createFromAction(action, { challengeWindowSize: challengeWindowSizeComputed });
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
          .then(async (balanceResponse) => {
            // cache balance 
            try {
              const instrumentKey = await __getInstrumentKey(data.paymentMethod);
              const bal = balanceResponse?.balance;

              if (instrumentKey && bal?.currency && bal?.value != null) {
                __balanceSessionCache.set(instrumentKey, {
                  balance: { currency: bal.currency, value: Number(bal.value) },
                  cachedAt: Date.now()
                });
              } else {
                console.log("⚠️ Balance NOT cached on client (missing key or balance).", {
                  hasKey: !!instrumentKey,
                  hasBalance: !!bal,
                  type: data?.paymentMethod?.type
                });
              }
            } catch (e) {
              console.log("⚠️ Balance client cache error (ignored):", e);
            }

            resolve(balanceResponse);
          })
          .catch(err => reject(err));
      },

      onOrderRequest: async (resolve, reject, data) => {
        try {
          const r = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: data.amount ?? amount,
              reference: __unifiedReference || data.reference || `ORDER-${Date.now()}`
            })
          });
          const orderResponse = await r.json();
          resolve(orderResponse);
        } catch (e) {
          reject(e);
        }
      },

      onOrderUpdated: async (orderStatus) => {
        const rem = orderStatus?.order?.remainingAmount;
        const norm = __normalizeAmount(rem);
        if (norm) __sessionRemainingAmount = norm;

        console.log(orderStatus);
        console.log(orderStatus?.order?.remainingAmount?.value);
      },

      onPaymentMethodsRequest: async (data, { resolve, reject }) => {
        console.log(data.order);

        try {
          const r = await fetch(`/api/paymentMethods`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              countryCode,
              order: data.order,
              amount,
              shopperConversionId,
              shopperReference,
              shopperLocale: data.locale
            })
          });
          const paymentsMethodsResponse = await r.json();

          resolve(paymentsMethodsResponse);
        } catch (e) {
          reject(e);
        }
      },

      // critical order to avoid race conditions
      onOrderCancel: async (data) => {
        const order = data?.order ? data.order : data;

        console.log("[onOrderCancel] order:", order?.pspReference);

        // 1) backend cancel
        const cancelResponse = await fetch("/api/orders/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order })
        }).then(r => r.json());

        console.log("[onOrderCancel] cancelResponse:", cancelResponse);

        // ✅ rotate ONLY the UUID part of the reference (keep orderDigits/merchantOrderReference8 stable)
        if (typeof __onReferenceReset === "function") {
          try {
            const next = __onReferenceReset();
            if (next?.unifiedReference) __unifiedReference = next.unifiedReference;
            if (next?.merchantOrderReference8) __merchantOrderReference8 = next.merchantOrderReference8;
          } catch (e) {
            console.warn("[PaymentHandlers] reference reset failed (ignored):", e);
          }
        }

        // reset local caches for safety
        __resetSessionCaches();

        // purge order in Drop-in
        __safeCheckoutUpdate({ order: null });

        // next tick => avoid the last dropin state
        setTimeout(() => {
          __safeCheckoutUpdate({
            paymentMethodsResponse,
            amount: (__baseAmount ? __baseAmount : amount)
          });
        }, 0);

        return cancelResponse;
      },

      onSubmit: async (state, component, actions) => {
        if (!state?.isValid) return actions.reject();

        UI.setAuthOverlay(true, "Autorisation en cours…");
        __cacheBrowserInfo(state.data?.browserInfo);

        //  inject holderName (custom HTML input) into paymentMethod if present
        // - By default, Adyen puts card data under state.data.paymentMethod
        // - In API-only (secured fields) holderName is NOT a secured field, so we force-add it if available
        const holderName = document.getElementById("holderName")?.value?.trim();
        if (holderName) {
          state.data.paymentMethod = state.data.paymentMethod || {};
          state.data.paymentMethod.holderName = holderName;
        }

        

        // compute amount client-side (best effort)
        let amountToSend = state.data?.amount ?? amount;

        try {
          const hasOrder = !!state.data?.order;

          if (hasOrder) {
            if (__sessionRemainingAmount) {
              amountToSend = __capAmount(amountToSend, __sessionRemainingAmount);
            }

            const instrumentKey = await __getInstrumentKey(state.data?.paymentMethod);
            if (instrumentKey && __balanceSessionCache.has(instrumentKey)) {
              const cached = __balanceSessionCache.get(instrumentKey);
              if (cached?.balance) {
                amountToSend = __capAmount(amountToSend, cached.balance);
              }
            } else {
              console.log("ℹ️ No client balance cap applied (missing cache entry).", {
                hasKey: !!instrumentKey,
                cacheSize: __balanceSessionCache.size,
                pmType: state.data?.paymentMethod?.type
              });
            }
          }
        } catch (e) {
          console.log("⚠️ Client amount capping failed (ignored):", e);
        }

        let response;
        try {
          console.log(state.data);
          response = await fetch("/api/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...state.data,

              // enforce amount chosen client-side
              amount: amountToSend,

              reference: __unifiedReference || state.data?.reference,
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

        patchHandleActionToModal(component);
        return actions.resolve({ resultCode, action, order, donationToken });
      },

      onAdditionalDetails: async (state, component, actions) => {
        console.log(state);
        console.log(state.data);
        UI.setAuthOverlay(true, "Authentification en cours…");
        __cacheBrowserInfo(state?.data?.browserInfo);

        let response;
        try {
          response = await fetch("/api/payments/details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: state.data ? JSON.stringify(state.data) : "",
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
    registerCheckoutUpdate,
    registerReferenceReset, // ✅ NEW
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