<<<<<<< HEAD
const clientKey = document.getElementById("clientKey")?.innerHTML?.trim();
const { AdyenCheckout, GooglePay } = window.AdyenWeb;
const uuid = () => crypto.randomUUID();

let componentInstance = null;

function cleanupLocal3DS() {
  try { window.__threeDSActionComponent?.unmount?.(); } catch (_) {}
  window.__threeDSActionComponent = null;
  window.setThreeDS2Modal?.(false, { clear: true });
}

async function createAdyenCheckout(paymentMethodsResponse, additionalSettings = {}) {
  const { countryCode, currency, amountValue, shopperConversionId, shopperReference } = additionalSettings;

  const configuration = window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
    paymentMethodsResponse,
    shopperConversionId,
    shopperReference,
    {
      clientKey,
      environment: "test",
      amount: { value: amountValue, currency },
      countryCode,
      locale: (typeof getLocaleForCountry === "function") ? getLocaleForCountry(countryCode) : "en_US",
      showPayButton: true
    }
  );

  return AdyenCheckout(configuration);
}

async function startCheckout(countryCode = "FR") {
  // reset component + modal
  if (componentInstance) {
    try { componentInstance.unmount(); } catch (_) {}
    componentInstance = null;
  }
  cleanupLocal3DS();
  window.setAuthOverlay?.(false);

  const shopperConversionId = uuid();
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);

  const amountEl = document.getElementById("total-amount-formatted");
  const amountValue = amountEl ? parseInt(amountEl.textContent, 10) : 999;

  const additionalSettings = {
=======
const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, GooglePay } = window.AdyenWeb;
const uuid = () => crypto.randomUUID();

// instance globale pour éviter les doublons
let componentInstance = null;

/* --------------------------------------------------------
   1) Build AdyenCheckout using PaymentHandlers config
--------------------------------------------------------- */
async function createAdyenCheckout(paymentMethodsResponse, additionalSettings = {}) {
  console.log(additionalSettings.countryCode, additionalSettings.currency, additionalSettings.amountValue, additionalSettings.shopperConversionId,additionalSettings.shopperReference);
  console.log(paymentMethodsResponse);

  const countryCode = additionalSettings.countryCode;
  const currency = additionalSettings.currency;
  const amount = additionalSettings.amountValue;
  const shopperConversionId = additionalSettings.shopperConversionId;
  const shopperReference = additionalSettings.shopperReference;

  const configuration =
    window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
      paymentMethodsResponse, shopperConversionId,shopperReference,
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
        }
      }
    );

  console.log("PM RESPONSE FROM BACKEND", paymentMethodsResponse);
  console.log("FINAL CONFIG →", configuration);
  return AdyenCheckout(configuration);
}

/* --------------------------------------------------------
   2) Redirect handlers
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


  if (componentInstance) {
    try { componentInstance.unmount(); } catch (e) {}
    componentInstance = null;x
  };


  const shopperConversionId = uuid(); 
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);
  const amountElement = document.getElementById('total-amount-formatted');
  const amountValue = amountElement ? parseInt(amountElement.textContent, 10) : 999;


  const additionalSettings  = { 
>>>>>>> 3ff7b21 (init)
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue
  };

<<<<<<< HEAD
  try {
    const paymentMethodsResponse = await fetch(
      `/api/paymentMethods?country=${encodeURIComponent(countryCode)}&shopperConversionId=${encodeURIComponent(shopperConversionId)}&shopperReference=${encodeURIComponent(shopperReference)}`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    ).then((res) => res.json());

    const checkout = await createAdyenCheckout(paymentMethodsResponse, additionalSettings);

    // on évite d'exposer tout adyenCheckout dans le dom, juste la focntion qui nous intérésse pour avoir le 
    // sous composant 3DS, security first ! O.G 
    window.PaymentHandlers.registerCreateFromAction(checkout.createFromAction.bind(checkout));

    componentInstance = new GooglePay(checkout, {
      configuration: {
        merchantName: "OG Wear",
        gatewayMerchantId: "OGAccountECOM",
        merchantId: "0023022202"
      },
      buttonType: "checkout",
      allowedCardNetworks: ["MASTERCARD", "VISA"],
      emailRequired: true,
      billingAddressRequired: false,
      shippingAddressRequired: false
    });

    componentInstance.mount("#component-container");
  } catch (error) {
    console.error("Advanced Checkout Error:", error);
    cleanupLocal3DS();
    window.setAuthOverlay?.(false);
=======


  console.log("amountElement:", amountElement);
  console.log("amountElement?.textContent:", amountElement?.textContent); 


  try {
    const paymentMethodsResponse = await fetch(`/api/paymentMethods?country=${encodeURIComponent(countryCode)}&shopperConversionId=${encodeURIComponent(shopperConversionId)}&shopperReference=${encodeURIComponent(shopperReference)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
    }).then(res => res.json());


    console.log(paymentMethodsResponse);
    const checkout = await createAdyenCheckout(paymentMethodsResponse, additionalSettings);

    componentInstance = new GooglePay(checkout, {
      
      configuration:{
            // Sample data in test -> OK
            // for prod get the merchantName and merchantId from your Google company account 
            // the gatewayMerchantId is the adyen merchant account name 
            merchantName:"OG Wear",
            gatewayMerchantId: "OGAccountECOM",
            merchantId: "0023022202",
      },

      buttonType: "checkout",

      //allowedCardNetworks: ["MASTERCARD", "VISA"],

      emailRequired: true,
      billingAddressRequired: false,
      shippingAddressRequired: false,

    });

    componentInstance.mount('#component-container');

  } catch (error) {
    console.error("Advanced Checkout Error:", error);
>>>>>>> 3ff7b21 (init)
    alert("An error occurred. Check console.");
  }
}

/* --------------------------------------------------------
<<<<<<< HEAD
   Init
--------------------------------------------------------- */
const storedCountry = localStorage.getItem("selectedCountry") || "FR";
let cleanCountryId = "FR";
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (_) {
  cleanCountryId = storedCountry;
}

startCheckout(cleanCountryId);

/* --------------------------------------------------------
   Listen for country changes
--------------------------------------------------------- */
window.addEventListener("countryChanged", (event) => {
  const newCountryId = event.detail?.countryId;
  if (newCountryId && newCountryId !== cleanCountryId) {
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  }
});
=======
   4) Initialisation
--------------------------------------------------------- */
const storedCountry = localStorage.getItem('selectedCountry') || 'FR';
console.log('Dropin initializing with country:', storedCountry);

let cleanCountryId = 'FR';
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (e) {
  cleanCountryId = storedCountry;
}

console.log('Clean country ID for scheme component:', cleanCountryId);
startCheckout(cleanCountryId);

/* --------------------------------------------------------
   5) Listen for country changes
--------------------------------------------------------- */
window.addEventListener('countryChanged', (event) => {
  console.log('Country changed event received in Google component:', event.detail);
  const newCountryId = event.detail.countryId;
  console.log('Current country:', cleanCountryId, 'New country:', newCountryId);

  if (newCountryId && newCountryId !== cleanCountryId) {
    console.log('Reloading Google component with new country:', newCountryId);
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  } else {
    console.log('No country change needed or invalid country ID');
  }
});

console.log('Scheme component event listener registered for country changes');
>>>>>>> 3ff7b21 (init)
