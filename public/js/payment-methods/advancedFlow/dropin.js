/* =========================================================
   dropin-advanced.js  
========================================================= */

const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, Dropin } = window.AdyenWeb;
const uuid = () => crypto.randomUUID();
let componentInstance = null;

// reference helpers (digits + storeId + hash)
const STORE_ID = "OG-Store";
function gen8Digits() {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
}
function genRefHash() {
  return crypto.randomUUID(); // UUID complet avec tirets
}

// current refs for the active checkout session
let __currentOrderDigits = null;
let __currentMerchantOrderReference8 = null;
let __currentRefHash = null;
let __currentUnifiedReference = null;

function __initRefsOncePerStart() {
  __currentOrderDigits = gen8Digits();
  __currentMerchantOrderReference8 = __currentOrderDigits; // digits-only, 8 chars
  __currentRefHash = genRefHash();
  __currentUnifiedReference = `${__currentOrderDigits}||${STORE_ID}||${__currentRefHash}`;
}

function __rotateRefUuidOnly() {
  // keep orderDigits + merchantOrderReference8 stable
  __currentRefHash = genRefHash();
  __currentUnifiedReference = `${__currentOrderDigits}||${STORE_ID}||${__currentRefHash}`;
  return {
    unifiedReference: __currentUnifiedReference,
    merchantOrderReference8: __currentMerchantOrderReference8
  };
}

/* --------------------------------------------------------
   1) Build AdyenCheckout using PaymentHandlers config
--------------------------------------------------------- */
async function createAdyenCheckout(paymentMethodsResponse, additionalSettings = {}) {
  console.log(additionalSettings.countryCode, additionalSettings.currency, additionalSettings.amountValue, additionalSettings.shopperConversionId);
  console.log(paymentMethodsResponse);

  const countryCode = additionalSettings.countryCode;
  const currency = additionalSettings.currency;
  const amount = additionalSettings.amountValue;
  const shopperConversionId = additionalSettings.shopperConversionId;
  const shopperReference = additionalSettings.shopperReference;

  const configuration =
    window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
      paymentMethodsResponse, shopperConversionId, shopperReference,
      {
        clientKey,
        environment: "test",
        amount: { value: amount, currency: currency },
        countryCode,
        locale: getLocaleForCountry(countryCode),
        showPayButton: true,
        translations: {
          "fr-FR": {
            "creditCard.securityCode.label": "CVV/CVC"
          }
        },

        // pass unified reference context to PaymentHandlers
        storeId: additionalSettings.storeId,
        orderDigits: additionalSettings.orderDigits,
        refHash: additionalSettings.refHash,
        unifiedReference: additionalSettings.unifiedReference,
        merchantOrderReference8: additionalSettings.merchantOrderReference8
      }
    );

  console.log("PM RESPONSE FROM BACKEND", paymentMethodsResponse);
  console.log("FINAL CONFIG →", configuration);
  return AdyenCheckout(configuration);
}

/* --------------------------------------------------------
   2) Redirect handlers (inchangés)
--------------------------------------------------------- */
function handleOnPaymentCompleted(resultCode) {
  const routes = {
    Authorised: "/result/success",
    Pending: "/result/pending",
    Received: "/result/pending"
  };
  window.location.href = routes[resultCode] || "/result/error";
}

function handleOnPaymentFailed(resultCode) {
  const routes = { Cancelled: "/result/failed", Refused: "/result/failed" };
  window.location.href = routes[resultCode] || "/result/error";
}

/* --------------------------------------------------------
   3) Start checkout (advanced)
--------------------------------------------------------- */
async function startCheckout(countryCode = 'FR') {
  function cleanupLocal3DS() {
    try { window.__threeDSActionComponent?.unmount?.(); } catch (_) {}
    window.__threeDSActionComponent = null;
    window.setThreeDS2Modal?.(false, { clear: true });
  }

  cleanupLocal3DS();
  window.setAuthOverlay?.(false);

  if (componentInstance) {
    try { componentInstance.unmount(); } catch (e) {}
    componentInstance = null;
  }

  const shopperConversionId = uuid();
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);
  const amountElement = document.getElementById('total-amount-formatted');
  const amountValue = amountElement ? parseInt(amountElement.textContent, 10) : 999;

  // init refs ONCE per startCheckout
  __initRefsOncePerStart();

  const additionalSettings = {
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue,

    // refs
    storeId: STORE_ID,
    orderDigits: __currentOrderDigits,
    merchantOrderReference8: __currentMerchantOrderReference8,
    refHash: __currentRefHash,
    unifiedReference: __currentUnifiedReference
  };

  console.log("amountElement:", amountElement);
  console.log("amountElement?.textContent:", amountElement?.textContent);

  console.log("REFS →", {
    unifiedReference: __currentUnifiedReference,
    merchantOrderReference8: __currentMerchantOrderReference8,
    storeId: STORE_ID,
    orderDigits: __currentOrderDigits,
    refHash: __currentRefHash
  });

  try {
    const r = await fetch(`/api/paymentMethods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryCode,
        amount: { value: amountValue, currency: currency },
        shopperConversionId,
        shopperReference,
        shopperLocale: getLocaleForCountry(countryCode)
      })
    });
    const paymentMethodsResponse = await r.json();

    console.log(paymentMethodsResponse);
    const checkout = await createAdyenCheckout(paymentMethodsResponse, additionalSettings);

    // EXISTANT (3DS)
    window.PaymentHandlers.registerCreateFromAction(checkout.createFromAction.bind(checkout));

    // safe hook "comme 3DS" pour permettre checkout.update(...)
    window.PaymentHandlers.registerCheckoutUpdate(checkout.update.bind(checkout));

    // allow PaymentHandlers to rotate ONLY the UUID part after onOrderCancel
    window.PaymentHandlers.registerReferenceReset(() => {
      const next = __rotateRefUuidOnly();
      console.log("UUID ROTATED (keep orderDigits) →", {
        orderDigits: __currentOrderDigits,
        merchantOrderReference8: __currentMerchantOrderReference8,
        unifiedReference: next.unifiedReference
      });
      return next;
    });

    componentInstance = new Dropin(checkout, {
      paymentMethodsConfiguration: {
        card: {
          enableStoreDetails: true,
          billingAddressRequired: false,
          showBrandIcon: true,
          hasHolderName: true,
          holderNameRequired: true,
          placeholders: {
            cardNumber: "1234 5678 9012 3456",
            expiryDate: "MM/YY",
            securityCodeThreeDigits: "123",
            securityCodeFourDigits: "1234",
            holderName: "J. Smith"
          }
        }
      },

      openFirstStoredPaymentMethod: false,
      openFirstPaymentMethod: false,
      instantPaymentTypes: ['applepay', 'googlepay']
    });

    componentInstance.mount('#dropin-container');
  } catch (error) {
    console.error("Advanced Checkout Error:", error);
    alert("An error occurred. Check console.");
  }
}

// Initialize with stored country or default
const storedCountry = localStorage.getItem('selectedCountry') || 'FR';
console.log('Dropin initializing with country:', storedCountry);

// Ensure we have just the country ID, not an object
let cleanCountryId = 'FR';
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (e) {
  cleanCountryId = storedCountry;
}

console.log('Clean country ID for Dropin:', cleanCountryId);
startCheckout(cleanCountryId);

// Listen for country changes from the country picker
window.addEventListener('countryChanged', (event) => {
  console.log('Country changed event received in Dropin :', event.detail);
  const newCountryId = event.detail.countryId;
  console.log('Current country:', cleanCountryId, 'New country:', newCountryId);

  if (newCountryId && newCountryId !== cleanCountryId) {
    console.log('Reloading Dropin with new country:', newCountryId);
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  } else {
    console.log('No country change needed or invalid country ID');
  }
});

console.log('Dropin component event listener registered for country changes');
