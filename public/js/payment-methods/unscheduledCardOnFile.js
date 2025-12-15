document.addEventListener("DOMContentLoaded", () => {
  const shopperRefInput = document.getElementById("unsched-shopper-reference");
  const loadCardsBtn = document.getElementById("unsched-load-cards");

  const cardsSection = document.getElementById("unsched-cards-section");
  const cardsList = document.getElementById("unsched-cards-list");
  const paymentSection = document.getElementById("unsched-payment-section");

  const orderRefInput = document.getElementById("unsched-order-ref");
  const amountInput = document.getElementById("unsched-amount");
  const payBtn = document.getElementById("unsched-pay");
  const resultBox = document.getElementById("unsched-result");

  const countryLabel = document.getElementById("unsched-country-label");

  let selectedStoredPaymentMethodId = null;
  let currentShopperReference = null;

  // ---------- Helpers ----------
  function getCurrentCountryCode() {
    const stored = localStorage.getItem("selectedCountry") || "FR";
    try {
      const parsed = JSON.parse(stored);
      return parsed.id || parsed;
    } catch {
      return stored;
    }
  }

  function updateCountryLabel() {
    const code = getCurrentCountryCode();
    if (countryLabel) countryLabel.textContent = code;
  }

  function generateShopperConversionId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `unsched-${Date.now()}`;
  }

  function renderCards(storedPaymentMethods) {
    if (!cardsList) return;

    if (!storedPaymentMethods.length) {
      cardsList.innerHTML = `
        <p>Aucune carte stockée éligible à <code>UnscheduledCardOnFile</code> pour ce shopper.</p>
      `;
      paymentSection.classList.add("hidden");
      return;
    }

    cardsList.innerHTML = storedPaymentMethods
      .map((pm) => {
        const brand = pm.brand || "Card";
        const last4 = pm.lastFour || "????";
        const expMonth = pm.expiryMonth || "--";
        const expYear = pm.expiryYear || "--";

        return `
          <article
            class="unsched-card-item"
            data-stored-payment-method-id="${pm.id}"
          >
            <div class="unsched-card-brand">${brand.toUpperCase()}</div>
            <div class="unsched-card-pan">•••• ${last4}</div>
            <div class="unsched-card-meta">Exp: ${expMonth}/${expYear}</div>
          </article>
        `;
      })
      .join("");

    cardsSection.classList.remove("hidden");
  }

  // Pays affiché au chargement
  updateCountryLabel();

  // Mise à jour quand le footer change le pays
  window.addEventListener("countryChanged", (event) => {
    const newCode = event.detail?.countryId;
    countryLabel.textContent = newCode || getCurrentCountryCode();
  });

  // ---------- Sélection de carte (event delegation) ----------
  if (cardsList) {
    cardsList.addEventListener("click", (event) => {
      const cardEl = event.target.closest(".unsched-card-item");
      if (!cardEl) return;

      selectedStoredPaymentMethodId =
        cardEl.dataset.storedPaymentMethodId || null;

      document
        .querySelectorAll(".unsched-card-item")
        .forEach((el) => el.classList.remove("unsched-card-item--selected"));

      cardEl.classList.add("unsched-card-item--selected");

      if (selectedStoredPaymentMethodId) {
        paymentSection.classList.remove("hidden");
      }
    });
  }

  // ---------- Chargement des cartes stockées ----------
  if (!loadCardsBtn) return;

  loadCardsBtn.addEventListener("click", async () => {
    const shopperReference = shopperRefInput.value.trim();
    if (!shopperReference) {
      alert("Merci de renseigner un shopperReference.");
      return;
    }

    const countryCode = getCurrentCountryCode();
    const shopperConversionId = generateShopperConversionId();

    currentShopperReference = shopperReference;
    selectedStoredPaymentMethodId = null;
    paymentSection.classList.add("hidden");
    resultBox.classList.add("hidden");
    resultBox.textContent = "";

    console.log(
      "Fetching stored payment methods for",
      shopperReference,
      "country:",
      countryCode
    );

    try {
      const query = new URLSearchParams({
        country: countryCode,
        shopperConversionId,
        shopperReference,
      }).toString();

      const res = await fetch(`/api/paymentMethods?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Error fetching payment methods:", data);
        alert(
          `Erreur lors de la récupération des cartes : ${
            data.message || "voir console"
          }`
        );
        return;
      }

      console.log("PaymentMethods response:", data);

      const stored = data?.storedPaymentMethods || [];

      const eligible = stored.filter(
        (pm) =>
          pm.type === "scheme" &&
          Array.isArray(pm.supportedRecurringProcessingModels) &&
          pm.supportedRecurringProcessingModels.includes(
            "UnscheduledCardOnFile"
          )
      );

      renderCards(eligible);
    } catch (err) {
      console.error("Network error fetching payment methods:", err);
      alert("Erreur réseau lors de la récupération des cartes.");
    }
  });

  // ---------- Déclenchement du paiement UNSCHEDULED ----------
  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      if (!selectedStoredPaymentMethodId) {
        alert("Merci de sélectionner une carte.");
        return;
      }

      const orderRef = orderRefInput.value.trim() || `UNSCHED-${Date.now()}`;
      const amountMinor = parseInt(amountInput.value, 10);

      if (!amountMinor || amountMinor <= 0) {
        alert("Montant invalide (en minor units).");
        return;
      }

      const countryCode = getCurrentCountryCode();
      const currency = getCurrencyForCountry(countryCode);
      const shopperConversionId = generateShopperConversionId();

      const amount = {
        currency,
        value: amountMinor,
      };

      const payload = {
        paymentMethod: {
          type: "scheme",
          storedPaymentMethodId: selectedStoredPaymentMethodId,
        },
        reference: orderRef,
        // Pas de browserInfo ni 3DS : UNSCHEDULED MIT
        additionalData: {
          amount,
          countryCode,
          shopperReference: currentShopperReference,
          locale: getLocaleForCountry(countryCode),
          shopperConversionId,
          // IMPORTANT: c'est ici que tu peux ajouter des flags si besoin
          recurringProcessingModel: "UnscheduledCardOnFile",
        },
      };

      console.log("Unscheduled payment payload:", payload);

      resultBox.classList.remove("hidden");
      resultBox.textContent = "Processing…";

      try {
        const res = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
          console.error("Unscheduled payment error:", data);
          alert(
            `Erreur paiement (unscheduled) : ${
              data.message || "voir console"
            }`
          );
        }

        console.log("Unscheduled payment result:", data);
        resultBox.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        console.error("Network error on unscheduled payment:", err);
        alert("Erreur réseau lors du paiement unscheduled.");
        resultBox.textContent = "Network error, see console.";
      }
    });
  }
});