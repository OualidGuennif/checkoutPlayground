/**
 * API-only (encrypted card data) — Custom Card (secured fields)
 * Advanced Flow style: PaymentHandlers.createPaymentConfigurationAdvancedFlow()
 *
 * DOM requirements:
 * - #clientKey (div.hidden)
 * - #customCard-container with spans data-cse
 * - #apiOnlyPayBtn
 * - #apiOnlyStatus (optional)
 * - #cardBrandBadge (optional)
 *
 * Dual brand UI:
 * - #dualBrandContainer (optional)
 * - #dualBrandLabel (optional)
 * - #dualBrandOptions (optional)
 */

const clientKey = document.getElementById("clientKey")?.textContent?.trim();
const { AdyenCheckout, CustomCard } = window.AdyenWeb;

const uuid = () => crypto.randomUUID();

// instance globale pour éviter les doublons
let customCardInstance = null;

// dual-brand state
let selectedDualBrand = null;
let lastAutoSelectSignature = null;
let lastSupportedBrands = []; // normalized [{brand, brandImageUrl}]
let hasNetworkInfo = false;   // once we have onBinLookup brands, we hide the top badge

/* --------------------------------------------------------
   Small UI helpers
--------------------------------------------------------- */
function setStatus(message = "") {
  const el = document.getElementById("apiOnlyStatus");
  if (el) el.textContent = message;
}

function setPayEnabled(enabled) {
  const btn = document.getElementById("apiOnlyPayBtn");
  if (btn) btn.disabled = !enabled;
}

function setBrandBadge(brand) {
  const badge = document.getElementById("cardBrandBadge");
  if (!badge) return;

  // If we already have network info (binLookup), hide the badge to avoid duplication.
  if (hasNetworkInfo) {
    badge.hidden = true;
    badge.textContent = "";
    return;
  }

  if (!brand) {
    badge.hidden = true;
    badge.textContent = "";
    return;
  }

  badge.hidden = false;
  badge.textContent = String(brand).toUpperCase();
}

function prettyBrandName(brand) {
  const b = String(brand || "").toLowerCase();
  if (b === "cartebancaire") return "Carte Bancaire"; // UI only
  return brand ? brand.toUpperCase() : "";
}

/* --------------------------------------------------------
   Dual brand UI helpers
--------------------------------------------------------- */
function ensureDualBrandUI() {
  const container = document.getElementById("dualBrandContainer");
  const label = document.getElementById("dualBrandLabel");
  const options = document.getElementById("dualBrandOptions");

  return {
    container: container || null,
    label: label || null,
    options: options || null
  };
}

function showDualBrandContainer(show) {
  const { container } = ensureDualBrandUI();
  if (container) container.hidden = !show;
}

function setDualBrandLabel(text) {
  const { label } = ensureDualBrandUI();
  if (label) label.textContent = text || "";
}

function clearDualBrandUI() {
  const { options } = ensureDualBrandUI();
  if (options) options.innerHTML = "";

  showDualBrandContainer(false);
  setDualBrandLabel("");

  selectedDualBrand = null;
  lastAutoSelectSignature = null;
  lastSupportedBrands = [];
  hasNetworkInfo = false; // reset so badge can show again for next run
}

function normalizeSupportedBrands(callbackObj) {
  const raw =
    callbackObj?.supportedBrandsRaw ??
    callbackObj?.supportedBrands ??
    callbackObj?.brands ??
    [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((b) => {
      if (!b) return null;
      if (typeof b === "string") return { brand: b, brandImageUrl: null };
      return { brand: b.brand, brandImageUrl: b.brandImageUrl ?? null };
    })
    .filter((x) => x?.brand);
}

function applySelectedStyle(el, selected) {
  el.classList.toggle("is-selected", !!selected);
}

function renderSingleNetworkPill({ brand, brandImageUrl }, securedFieldsInstance) {
  const { options } = ensureDualBrandUI();
  if (!options) return;

  options.innerHTML = "";

  const pill = document.createElement("div");
  pill.className = "dual-brand__pill is-static";
  pill.setAttribute("data-value", brand);

  if (brandImageUrl) {
    const img = document.createElement("img");
    img.src = brandImageUrl;
    img.alt = brand;
    img.className = "dual-brand__img";
    pill.appendChild(img);
  }

  const txt = document.createElement("span");
  txt.textContent = prettyBrandName(brand);
  pill.appendChild(txt);

  options.appendChild(pill);

  // Force the default brand into the secured fields once per signature
  const signature = JSON.stringify([brand]);
  if (signature !== lastAutoSelectSignature) {
    lastAutoSelectSignature = signature;
    selectedDualBrand = brand;

    // Build a fake event-like object that dualBrandingChangeHandler can read:
    // It typically reads target.dataset.value
    const fakeEvent = { target: pill };
    if (typeof securedFieldsInstance?.dualBrandingChangeHandler === "function") {
      try {
        securedFieldsInstance.dualBrandingChangeHandler(fakeEvent);
      } catch (e) {
        console.warn("[apiOnly] dualBrandingChangeHandler failed for single brand", e);
      }
    }
  }
}

function renderMultiNetworkOptions(brands, securedFieldsInstance) {
  const { options } = ensureDualBrandUI();
  if (!options) return;

  options.innerHTML = "";

  const btnRefs = [];

  brands.forEach(({ brand, brandImageUrl }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dual-brand__pill"; // re-use pill styling
    btn.setAttribute("data-value", brand);

    if (brandImageUrl) {
      const img = document.createElement("img");
      img.src = brandImageUrl;
      img.alt = brand;
      img.className = "dual-brand__img";
      btn.appendChild(img);
    }

    const txt = document.createElement("span");
    txt.textContent = prettyBrandName(brand);
    btn.appendChild(txt);

    btn.addEventListener("click", (e) => {
      if (typeof securedFieldsInstance?.dualBrandingChangeHandler === "function") {
        try {
          securedFieldsInstance.dualBrandingChangeHandler(e);
        } catch (err) {
          console.warn("[apiOnly] dualBrandingChangeHandler failed", err);
        }
      }

      selectedDualBrand = brand;
      btnRefs.forEach((b) => applySelectedStyle(b, b.getAttribute("data-value") === selectedDualBrand));
    });

    options.appendChild(btn);
    btnRefs.push(btn);
  });

  // Preselect (first if none / invalid)
  const available = brands.map((b) => b.brand);
  if (!selectedDualBrand || !available.includes(selectedDualBrand)) selectedDualBrand = available[0];

  btnRefs.forEach((b) => applySelectedStyle(b, b.getAttribute("data-value") === selectedDualBrand));

  // Auto-trigger selection once per signature so it ends in state.data
  const signature = JSON.stringify(available);
  if (signature !== lastAutoSelectSignature) {
    lastAutoSelectSignature = signature;
    const targetBtn = btnRefs.find((b) => b.getAttribute("data-value") === selectedDualBrand) || btnRefs[0];
    setTimeout(() => {
      try { targetBtn?.click?.(); } catch (_) {}
    }, 0);
  }
}

function renderNetworkUIFromBinLookup(callbackObj, securedFieldsInstance) {
  const { container, options, label } = ensureDualBrandUI();
  if (!container || !options || !label) return;

  const brands = normalizeSupportedBrands(callbackObj);
  if (!brands.length) return;

  // From now on: we have network info => hide the top badge to avoid duplicate "MC"
  hasNetworkInfo = true;
  setBrandBadge(null);

  lastSupportedBrands = brands;
  showDualBrandContainer(true);

  if (brands.length === 1) {
    // Single brand => no "choice" UI. Just a subtle info row.
    setDualBrandLabel("Detected network :");
    renderSingleNetworkPill(brands[0], securedFieldsInstance);
    options.classList.remove("is-choice");
    options.classList.add("is-info");
  } else {
    // Multiple => user chooses
    setDualBrandLabel("Choose the network :");
    renderMultiNetworkOptions(brands, securedFieldsInstance);
    options.classList.remove("is-info");
    options.classList.add("is-choice");
  }
}

/* --------------------------------------------------------
   1) Build AdyenCheckout using PaymentHandlers config
--------------------------------------------------------- */
async function createAdyenCheckout(paymentMethodsResponse, additionalSettings = {}) {
  const countryCode = additionalSettings.countryCode;
  const currency = additionalSettings.currency;
  const amount = additionalSettings.amountValue;
  const shopperConversionId = additionalSettings.shopperConversionId;
  const shopperReference = additionalSettings.shopperReference;

  const configuration =
    window.PaymentHandlers.createPaymentConfigurationAdvancedFlow(
      paymentMethodsResponse,
      shopperConversionId,
      shopperReference,
      {
        clientKey,
        environment: "test",
        amount: { value: amount, currency },
        countryCode,
        locale: getLocaleForCountry(countryCode),

        // IMPORTANT: pay button is ours (HTML)
        showPayButton: false,

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
   2) Start checkout (advanced)
--------------------------------------------------------- */
async function startCheckout(countryCode = "FR") {
  function cleanupLocal3DS() {
    try { window.__threeDSActionComponent?.unmount?.(); } catch (_) {}
    window.__threeDSActionComponent = null;
    window.setThreeDS2Modal?.(false, { clear: true });
  }

  cleanupLocal3DS();
  window.setAuthOverlay?.(false);

  setStatus("");
  setBrandBadge(null);
  setPayEnabled(false);
  clearDualBrandUI();

  if (customCardInstance) {
    try { customCardInstance.unmount(); } catch (_) {}
    customCardInstance = null;
  }

  const shopperConversionId = uuid();
  const shopperReference = "ogaccountnew";
  const currency = getCurrencyForCountry(countryCode);

  const amountElement = document.getElementById("total-amount-formatted");
  const amountValue = amountElement ? parseInt(amountElement.textContent, 10) : 999;

  const additionalSettings = {
    countryCode,
    shopperConversionId,
    shopperReference,
    currency,
    amountValue
  };

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

    // Required for your 3DS modal patching inside PaymentHandlers
    window.PaymentHandlers.registerCreateFromAction(checkout.createFromAction.bind(checkout));

    // Secured fields (CustomCard)
    customCardInstance = new CustomCard(checkout, {
      type: "card",
      autoFocus: true,

      onLoad: () => {
        setStatus("Secure fields loading…");
      },

      onConfigSuccess: () => {
        setStatus("");
        setPayEnabled(true);
      },

      onBrand: (event) => {
        // Only show badge before binLookup gives us explicit network info
        setBrandBadge(event?.brand);
      },

      onBinLookup: (callbackObj) => {
        // Render clean network UI:
        // - single brand => "Réseau détecté" (static pill)
        // - multiple => real choice (pills)
        renderNetworkUIFromBinLookup(callbackObj, customCardInstance);
      },

      onError: (error) => {
        if (error?.fieldType) setStatus(`Check ${error.fieldType}.`);
      }
    });

    customCardInstance.mount("#customCard-container");

    // Custom HTML button triggers the Adyen flow
    const payBtn = document.getElementById("apiOnlyPayBtn");
    if (payBtn) {
      payBtn.onclick = () => {
        setStatus("");
        customCardInstance?.submit?.();
      };
    }
  } catch (error) {
    console.error("Advanced Checkout Error:", error);
    alert("An error occurred. Check console.");
  }
}

/* --------------------------------------------------------
   3) Init + country change
--------------------------------------------------------- */
const storedCountry = localStorage.getItem("selectedCountry") || "FR";

let cleanCountryId = "FR";
try {
  const parsed = JSON.parse(storedCountry);
  cleanCountryId = parsed.id || parsed;
} catch (_) {
  cleanCountryId = storedCountry;
}

console.log("Clean country ID for apiOnly:", cleanCountryId);
startCheckout(cleanCountryId);

window.addEventListener("countryChanged", (event) => {
  const newCountryId = event.detail?.countryId;

  if (newCountryId && newCountryId !== cleanCountryId) {
    console.log("Reloading apiOnly with new country:", newCountryId);
    cleanCountryId = newCountryId;
    startCheckout(newCountryId);
  }
});