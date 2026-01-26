// /js/payment-methods/advancedFlow/klarna.js

const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, Klarna } = window.AdyenWeb;
const uuid = () =>
  (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

/**
 * Matrice de support Klarna par pays
 * Pay now       -> klarna_paynow
 * Pay later     -> klarna
 * Pay over time -> klarna_account
 */
const KLARNA_SUPPORT = {
  AU: { payNow: false, payLater: false, payOverTime: true },
  AT: { payNow: true,  payLater: true,  payOverTime: true },
  BE: { payNow: true,  payLater: true,  payOverTime: false },
  CA: { payNow: false, payLater: false, payOverTime: true },
  CZ: { payNow: false, payLater: false, payOverTime: true },
  DK: { payNow: false, payLater: true,  payOverTime: true },
  FI: { payNow: true,  payLater: true,  payOverTime: true },
  FR: { payNow: false, payLater: true,  payOverTime: true },
  DE: { payNow: true,  payLater: true,  payOverTime: true },
  GR: { payNow: false, payLater: false, payOverTime: true },
  IE: { payNow: false, payLater: false, payOverTime: true },
  IT: { payNow: false, payLater: true,  payOverTime: true },
  NO: { payNow: false, payLater: true,  payOverTime: true },
  PL: { payNow: false, payLater: true,  payOverTime: true },
  PT: { payNow: false, payLater: false, payOverTime: true },
  RO: { payNow: false, payLater: false, payOverTime: true },
  ES: { payNow: false, payLater: true,  payOverTime: true },
  SE: { payNow: true,  payLater: true,  payOverTime: true },
  CH: { payNow: true,  payLater: true,  payOverTime: false },
  NL: { payNow: true,  payLater: true,  payOverTime: true },
  GB: { payNow: true,  payLater: true,  payOverTime: true },
  US: { payNow: false, payLater: true,  payOverTime: true }
};

// Mapping type Klarna -> container DOM
const KLARNA_CONTAINERS = {
  klarna_paynow:  "#klarna-paynow-container",
  klarna:         "#klarna-paylater-container",
  klarna_account: "#klarna-account-container"
};

// On garde une référence sur les instances pour pouvoir unmount proprement
let klarnaComponents = [];

/* ------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------*/

// Types Klarna réellement présents dans le paymentMethodsResponse
function getAvailableKlarnaTypesFromPMs(paymentMethodsResponse) {
  const list = paymentMethodsResponse?.paymentMethods || [];
  const allowed = ["klarna", "klarna_paynow", "klarna_account"];

  return list
    .map(pm => pm.type)
    .filter(type => allowed.includes(type));
}

// Intersection : ce que Klarna supporte dans le pays + ce que ton backend expose
function getKlarnaTypesForCountry(countryCode, paymentMethodsResponse) {
  const cfg = KLARNA_SUPPORT[countryCode];
  if (!cfg) {
    console.warn("[Klarna] No KLARNA_SUPPORT entry for country", countryCode);
    return [];
  }

  const available = new Set(getAvailableKlarnaTypesFromPMs(paymentMethodsResponse));
  const types = [];

  if (cfg.payNow && available.has("klarna_paynow")) {
    types.push("klarna_paynow");
  }
  if (cfg.payLater && available.has("klarna")) {
    types.push("klarna");
  }
  if (cfg.payOverTime && available.has("klarna_account")) {
    types.push("klarna_account");
  }

  return types;
}

function resetKlarnaContainers() {
  Object.values(KLARNA_CONTAINERS).forEach((selector) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = "";
    el.style.display = "none";
  });
}

function cleanupKlarnaComponents() {
  klarnaComponents.forEach((c) => {
    try {
      c.unmount();
    } catch (e) {
      console.warn("[Klarna] Error during unmount", e);
    }
  });
  klarnaComponents = [];
  resetKlarnaContainers();
}

// Monte un type Klarna, et si ça plante on n’affiche rien pour ce type
function mountKlarnaType(checkout, type) {
  const selector = KLARNA_CONTAINERS[type];
  if (!selector) return;

  const el = document.querySelector(selector);
  if (!el) return;

  try {
    console.log(`[Klarna] Mount type=${type} on ${selector}`);

    const klarnaComponent = new Klarna(checkout, {
      type,               // "klarna", "klarna_paynow", "klarna_account"
      useKlarnaWidget: false
    });

    klarnaComponents.push(klarnaComponent);
    el.style.display = "";
    klarnaComponent.mount(selector);
  } catch (e) {
    console.error(`[Klarna] Error mounting ${type}`, e);
    el.innerHTML = "";
    el.style.display = "none";
  }
}

// Lit le montant à partir de #total-amount-formatted (ton HTML actuel)
function getAmountValueFromDOM() {
  const span = document.getElementById("total-amount-formatted");
  if (!span) return 10000;

  // Si un data-amount-value est ajouté plus tard, on le privilégie
  const fromData = span.dataset?.amountValue;
  if (fromData && !Number.isNaN(parseInt(fromData, 10))) {
    return parseInt(fromData, 10);
  }

  // Sinon, on parse le texte (ex: "10000")
  const text = (span.textContent || "").trim();
  const numeric = parseInt(text.replace(/[^\d]/g, ""), 10);
  return Number.isNaN(numeric) ? 10000 : numeric;
}

/* ------------------------------------------------------------------
 * AdyenCheckout config (Advanced flow)
 * -----------------------------------------------------------------*/

async function createAdyenCheckout(paymentMethodsResponse, additionalSettings = {}) {
  const { countryCode, currency, amountValue, shopperConversionId,shopperReference } = additionalSettings;

  console.log("[Klarna Advanced] createAdyenCheckout settings:", {
    countryCode,
    currency,
    amountValue,
    shopperConversionId,
    shopperReference
  });

  console.log("[Klarna Advanced] paymentMethodsResponse:", paymentMethodsResponse);

  const configuration = window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
    paymentMethodsResponse,
    shopperConversionId,shopperReference,
    {
      clientKey,
      environment: "test",
      amount: { value: amountValue, currency },
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

  console.log("[Klarna Advanced] FINAL CONFIG →", configuration);
  return AdyenCheckout(configuration);
}

/* ------------------------------------------------------------------
 * Main: démarrer Klarna Advanced pour un pays donné
 * -----------------------------------------------------------------*/

async function startCheckout(countryCode = "FR") {


  function cleanupLocal3DS() {
  try { window.__threeDSActionComponent?.unmount?.(); } catch (_) {}
  window.__threeDSActionComponent = null;
  window.setThreeDS2Modal?.(false, { clear: true });
}

  cleanupLocal3DS();
  window.setAuthOverlay?.(false);




  try {
    // Nettoyage de l'état précédent (unmount + reset containers)
    cleanupKlarnaComponents();

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


    const paymentMethodsResponse = await fetch(`/api/paymentMethods?country=${encodeURIComponent(countryCode)}&shopperConversionId=${encodeURIComponent(shopperConversionId)}&shopperReference=${encodeURIComponent(shopperReference)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
    }).then(res => res.json());


    console.log("[Klarna Advanced] paymentMethodsResponse:", paymentMethodsResponse);

    // 2) AdyenCheckout instance
    const checkout = await createAdyenCheckout(paymentMethodsResponse, additionalSettings);
    window.PaymentHandlers.registerCreateFromAction(checkout.createFromAction.bind(checkout));

    const effectiveCountry = countryCode; // on se base sur le param (clair)
    const klarnaTypes = getKlarnaTypesForCountry(effectiveCountry, paymentMethodsResponse);

    console.log(
      `[Klarna Advanced] Country=${effectiveCountry}, types supportés=`,
      klarnaTypes
    );

    if (klarnaTypes.length === 0) {
      console.warn(`[Klarna Advanced] Aucun produit Klarna à monter pour ${effectiveCountry}`);
      return;
    }

    // 3) Montre uniquement les produits supportés ET disponibles
    klarnaTypes.forEach((type) => mountKlarnaType(checkout, type));
  } catch (error) {
    console.error("[Klarna Advanced] Erreur startCheckout", error);
    alert("An error occurred. Check console.");
  }
}

/* ------------------------------------------------------------------
 * Initialisation + gestion du changement de pays
 * -----------------------------------------------------------------*/

const storedCountry = localStorage.getItem("selectedCountry") || "FR";
console.log("[Klarna Advanced] initializing with stored country:", storedCountry);

let cleanCountryId = "FR";
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (e) {
  cleanCountryId = storedCountry;
}

console.log("[Klarna Advanced] Clean country ID:", cleanCountryId);
startCheckout(cleanCountryId);

// Changement de pays depuis le country picker global
window.addEventListener("countryChanged", (event) => {
  console.log("[Klarna Advanced] countryChanged event:", event.detail);
  const newCountryId = event.detail.countryId;
  console.log("[Klarna Advanced] Current:", cleanCountryId, "New:", newCountryId);

  if (newCountryId && newCountryId !== cleanCountryId) {
    console.log("[Klarna Advanced] Reloading Klarna for country:", newCountryId);
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  } else {
    console.log("[Klarna Advanced] No change or invalid country ID");
  }
});

console.log("[Klarna Advanced] Listener registered for country changes");