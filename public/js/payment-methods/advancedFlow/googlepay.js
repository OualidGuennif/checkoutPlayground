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
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue
  };

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
    alert("An error occurred. Check console.");
  }
}

/* --------------------------------------------------------
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