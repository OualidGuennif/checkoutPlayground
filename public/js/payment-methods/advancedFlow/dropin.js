/* =========================================================
   dropin-advanced.js  (ta page)
   ✅ Ajouts UNIQUEMENT:
   - unifiedReference + merchantOrderReference8 (digits only)
   - pass those into PaymentHandlers options (so /orders + /payments share same reference)
   (rien supprimé, rien refactoré)
========================================================= */

const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, Dropin } = window.AdyenWeb;
const uuid = () => crypto.randomUUID();
let componentInstance = null;

// ✅ AJOUT: reference helpers (digits + storeId + hash)
const STORE_ID = "OG-Store";
function gen8Digits() {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
}
function genRefHash() {
  return crypto.randomUUID(); // ✅ UUID complet avec tirets
}


/* --------------------------------------------------------
   1) Build AdyenCheckout using PaymentHandlers config
--------------------------------------------------------- */
async function createAdyenCheckout(paymentMethodsResponse,additionalSettings={}) {
  console.log(additionalSettings.countryCode,additionalSettings.currency,additionalSettings.amountValue,additionalSettings.shopperConversionId);
  console.log(paymentMethodsResponse);

  const countryCode = additionalSettings.countryCode;
  const currency = additionalSettings.currency;
  const amount = additionalSettings.amountValue;
  const shopperConversionId = additionalSettings.shopperConversionId;
  const shopperReference = additionalSettings.shopperReference;



  const configuration =
    window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
      paymentMethodsResponse,shopperConversionId,shopperReference,
      {
        clientKey,
        environment: "test",
        amount: { value: amount, currency: currency},
        countryCode,
        locale: getLocaleForCountry(countryCode),
        showPayButton: true,
        translations: {
          "fr-FR": {
            "creditCard.securityCode.label": "CVV/CVC"
          }
        },

        // ✅ AJOUT: pass unified reference context to PaymentHandlers
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
async function startCheckout(countryCode= 'FR') {


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
  };


  const shopperConversionId = uuid(); 
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);
  const amountElement = document.getElementById('total-amount-formatted');
  const amountValue = amountElement ? parseInt(amountElement.textContent, 10) : 999;

  // ✅ AJOUT: build reference context ONCE per checkout start
  const orderDigits = gen8Digits();
  const merchantOrderReference8 = orderDigits; // digits-only, 8 chars
  const refHash = genRefHash();
  const unifiedReference = `${orderDigits}||${STORE_ID}||${refHash}`;


  const additionalSettings  = { 
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue,

    // ✅ AJOUT
    storeId: STORE_ID,
    orderDigits,
    merchantOrderReference8,
    refHash,
    unifiedReference
  };



  console.log("amountElement:", amountElement);
  console.log("amountElement?.textContent:", amountElement?.textContent); 

  // ✅ AJOUT: debug refs
  console.log("REFS →", {
    unifiedReference,
    merchantOrderReference8,
    storeId: STORE_ID,
    orderDigits,
    refHash
  });


  try {
    const paymentMethodsResponse = await fetch(`/api/paymentMethods?country=${encodeURIComponent(countryCode)}&shopperConversionId=${encodeURIComponent(shopperConversionId)}&shopperReference=${encodeURIComponent(shopperReference)}&amount=${encodeURIComponent(amountValue)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
    }).then(res => res.json());



    console.log(paymentMethodsResponse);
    const checkout = await createAdyenCheckout(paymentMethodsResponse,additionalSettings);

    // ✅ EXISTANT (3DS)
    window.PaymentHandlers.registerCreateFromAction(checkout.createFromAction.bind(checkout));

    // ✅ AJOUT: safe hook "comme 3DS" pour permettre checkout.update(...) depuis PaymentHandlers
    window.PaymentHandlers.registerCheckoutUpdate(checkout.update.bind(checkout));

    

    componentInstance = new Dropin(checkout, {paymentMethodsConfiguration: {
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
      }
    ,


        openFirstStoredPaymentMethod: false,
        openFirstPaymentMethod: false,
        instantPaymentTypes: ['applepay', 'googlepay']
    },
  

  
  );
    componentInstance.mount('#dropin-container');
    

  } catch (error) {
    console.error("Advanced Checkout Error:", error);
    alert("An error occurred. Check console.");
  }
}





// Initialize with stored country or default to Netherlands
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
        cleanCountryId = newCountryId; // Update the current country
        startCheckout(newCountryId);
    } else {
        console.log('No country change needed or invalid country ID');
    }
});

console.log('Dropin component event listener registered for country changes');