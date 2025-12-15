

const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, Dropin } = window.AdyenWeb;
const uuid = () => crypto.randomUUID();
let componentInstance = null;


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
        }
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

  if (componentInstance) {
    try { componentInstance.unmount(); } catch (e) {}
    componentInstance = null;
  };


  const shopperConversionId = uuid(); 
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);
  const amountElement = document.getElementById('total-amount-formatted');
  const amountValue = amountElement ? parseInt(amountElement.textContent, 10) : 999;


  const additionalSettings  = { 
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue
  };



  console.log("amountElement:", amountElement);
  console.log("amountElement?.textContent:", amountElement?.textContent); 


  try {
    const paymentMethodsResponse = await fetch(`/api/paymentMethods?country=${encodeURIComponent(countryCode)}&shopperConversionId=${encodeURIComponent(shopperConversionId)}&shopperReference=${encodeURIComponent(shopperReference)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
    }).then(res => res.json());



    console.log(paymentMethodsResponse);
    const checkout = await createAdyenCheckout(paymentMethodsResponse,additionalSettings);
    

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
