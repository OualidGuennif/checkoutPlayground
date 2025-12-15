document.addEventListener("DOMContentLoaded", () => {
  const refInput = document.getElementById("pbl-shopper-reference");
  const emailInput = document.getElementById("pbl-shopper-email");
  const amountInput = document.getElementById("pbl-amount");
  const generateBtn = document.getElementById("pbl-generate");

  const resultBlock = document.getElementById("pbl-result");
  const urlInput = document.getElementById("pbl-url-input");
  const copyBtn = document.getElementById("pbl-copy");

  const countryLabel = document.getElementById("pbl-country-label");

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

  // Shopper ref par défaut : stable sur 24h
  if (refInput && !refInput.value) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    refInput.value = `pbl-${today}`;
  }

  // Pays affiché au chargement
  updateCountryLabel();

  // Mise à jour quand le footer change le pays
  window.addEventListener("countryChanged", (event) => {
    const newCode = event.detail?.countryId;
    if (countryLabel) {
      countryLabel.textContent = newCode || getCurrentCountryCode();
    }
  });

  // ---------- Génération du lien ----------
  if (!generateBtn) return;

  generateBtn.addEventListener("click", async () => {
    const amountValue = parseInt(amountInput.value, 10);
    const shopperEmail = emailInput.value.trim();
    const shopperReference = refInput.value.trim() || `pbl-${Date.now()}`;

    if (!amountValue || amountValue <= 0) {
      alert("Montant invalide.");
      return;
    }

    const countryCode = getCurrentCountryCode();
    console.log("Creating payment link for country:", countryCode);

    try {
      const res = await fetch(
        `/api/paymentLinks?country=${encodeURIComponent(countryCode)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountValue,
            shopperEmail,
            shopperReference
          })
        }
      );

      const data = await res.json();

      if (!res.ok) {
        console.error("Error creating payment link:", data);
        alert(`Erreur Pay by Link: ${data.message || "voir console"}`);
        return;
      }

      console.log("Payment link created:", data);

      if (urlInput) {
        urlInput.value = data.url;
        urlInput.focus();
        urlInput.select();
      }

      if (resultBlock) {
        resultBlock.classList.remove("hidden");
      }

      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(data.url);
            const original = copyBtn.textContent;
            copyBtn.textContent = "Copié !";
            setTimeout(() => {
              copyBtn.textContent = original;
            }, 1500);
          } catch (e) {
            console.warn("Clipboard error:", e);
            alert("Impossible de copier le lien automatiquement.");
          }
        };
      }
    } catch (err) {
      console.error("Network error creating payment link:", err);
      alert("Erreur réseau lors de la création du lien.");
    }
  });
});