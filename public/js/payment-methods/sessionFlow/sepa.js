

const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, SepaDirectDebit } = window.AdyenWeb;

// Function to create AdyenCheckout instance
async function createAdyenCheckout(session) {
  // Use shared payment configuration
  console.log(session);
  const configuration = window.PaymentHandlers.createPaymentConfigurationSessionFlow(session, {
    clientKey,
    environment: "test",
    //since we are in session flow these options are not required if you handle locale logic in your backend /sessions call
    //amount: {
      //value: session.amount,
      //currency: session.amount.currency
    //},
    countryCode : session.countryCode,
    locale :session.shopperLocale,
    showPayButton: true,
    translations: {
      'en_US': {
        'creditCard.securityCode.label': 'CVV/CVC'
      }
    }
  });
  console.log(configuration);
  return AdyenCheckout(configuration);
}

// Function to handle payment completion redirects
function handleOnPaymentCompleted(resultCode) {
  switch (resultCode) {
    case "Authorised":
      window.location.href = "/result/success";
      break;
    case "Pending":
    case "Received":
      window.location.href = "/result/pending";
      break;
    default:
      window.location.href = "/result/error";
      break;
  }
}

// Function to handle payment failure redirects
function handleOnPaymentFailed(resultCode) {
  switch (resultCode) {
    case "Cancelled":
    case "Refused":
      window.location.href = "/result/failed";
      break;
    default:
      window.location.href = "/result/error";
      break;
  }
}

// Function to start checkout
async function startCheckout(countryCode = 'FR') {

  try {
    const session = await fetch(`/api/sessions?country=${encodeURIComponent(countryCode)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    }).then(response => response.json());

    const checkout = await createAdyenCheckout(session);
    const sepa = new SepaDirectDebit(checkout, {
      // Optional configuration.
      holderName: true
    }).mount('#component-container');

  } catch (error) {
    console.error(error);
    alert("Error occurred. Look at console for details");
  }
}

startCheckout();




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

console.log('Clean country ID for dropin:', cleanCountryId);
startCheckout(cleanCountryId);

// Listen for country changes from the country picker
window.addEventListener('countryChanged', (event) => {
    console.log('Country changed event received in dropin:', event.detail);
    const newCountryId = event.detail.countryId;
    console.log('Current country:', cleanCountryId, 'New country:', newCountryId);
    
    if (newCountryId && newCountryId !== cleanCountryId) {
        console.log('Reloading dropin with new country:', newCountryId);
        cleanCountryId = newCountryId; // Update the current country
        startCheckout(newCountryId);
    } else {
        console.log('No country change needed or invalid country ID');
    }
});

console.log('Dropin event listener registered for country changes');



