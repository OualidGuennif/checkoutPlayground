const clientKey = document.getElementById("clientKey").innerHTML;
const { AdyenCheckout, Klarna } = window.AdyenWeb;

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

// On garde une référence sur les instances pour pouvoir unmount
let klarnaComponents = [];

// --- Helpers ---------------------------------------------------------

function getKlarnaTypesForCountry(countryCode) {
  const cfg = KLARNA_SUPPORT[countryCode];
  if (!cfg) return [];

  const types = [];
  if (cfg.payNow)      types.push("klarna_paynow");
  if (cfg.payLater)    types.push("klarna");
  if (cfg.payOverTime) types.push("klarna_account");
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

// --- AdyenCheckout config (Sessions flow) ----------------------------

async function createAdyenCheckout(session) {
  console.log("Klarna session", session);

  const configuration = window.PaymentHandlers.createPaymentConfigurationSessionFlow(
    session,
    {
      clientKey,
      environment: "test",
      // On se base sur la session pour rester cohérent
      amount: session.amount,
      locale: session.shopperLocale,
      countryCode: session.countryCode,
      showPayButton: true,
      translations: {
        "en_US": {
          "creditCard.securityCode.label": "CVV/CVC"
        }
      }
    }
  );

  console.log("Klarna checkout config", configuration);
  return AdyenCheckout(configuration);
}

// --- Main: démarrer Klarna pour un pays donné ------------------------

async function startCheckout(countryCode = "FR") {
  try {
    // Très important : on nettoie l’ancien état avant de recréer quoi que ce soit
    cleanupKlarnaComponents();

    const session = await fetch(
      `/api/sessions?country=${encodeURIComponent(countryCode)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }
    ).then((response) => response.json());

    console.log("[Klarna] Session reçue:", session);

    const checkout = await createAdyenCheckout(session);

    const effectiveCountry = session.countryCode || countryCode;
    const klarnaTypes = getKlarnaTypesForCountry(effectiveCountry);

    console.log(
      `[Klarna] Country=${effectiveCountry}, types supportés=`,
      klarnaTypes
    );

    if (klarnaTypes.length === 0) {
      console.warn(`[Klarna] Aucun produit Klarna pour ${effectiveCountry}`);
      return;
    }

    // On monte seulement ce qui est théoriquement supporté pour ce pays
    klarnaTypes.forEach((type) => mountKlarnaType(checkout, type));
  } catch (error) {
    console.error("[Klarna] Erreur startCheckout", error);
    alert("Error occurred. Look at console for details");
  }
}

// --- Intégration avec le country picker -----------------------------

const storedCountry = localStorage.getItem("selectedCountry") || "FR";
console.log("Klarna page initializing with country:", storedCountry);

let cleanCountryId = "FR";
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (e) {
  cleanCountryId = storedCountry;
}

console.log("Clean country ID for Klarna:", cleanCountryId);
startCheckout(cleanCountryId);

window.addEventListener("countryChanged", (event) => {
  console.log("Country changed event received in Klarna page:", event.detail);
  const newCountryId = event.detail.countryId;
  console.log("Current country:", cleanCountryId, "New country:", newCountryId);

  if (newCountryId && newCountryId !== cleanCountryId) {
    console.log("Reloading Klarna components with new country:", newCountryId);
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  } else {
    console.log("No country change needed or invalid country ID");
  }
});

console.log("Klarna event listener registered for country changes");