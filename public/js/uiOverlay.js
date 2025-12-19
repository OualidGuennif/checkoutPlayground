/**
 * uiOverlay.js
 * Helpers UI (loading overlay + 3DS2 modal)
 * STRICT 3DS: action.type === "threeDS2"
 */
(function () {
  const Z = {
    modal: 99999,
    overlay: 100001 // > modal
  };

  /* ---------------------------
     AUTH OVERLAY (no flash)
  ---------------------------- */
  function ensureAuthOverlay() {
    const el = document.getElementById("auth-overlay");
    if (!el) return null;

    // Put overlay at document.body root to avoid stacking contexts
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }

    // Force base state before any "open" call => prevents 1s flash
    el.classList.remove("is-open");
    el.style.display = "none";

    // Inline styles: deterministic + above modal
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(Z.overlay),
      placeItems: "center",
      background: "rgba(0,0,0,0.35)",
      padding: "16px",
      pointerEvents: "auto" // block clicks behind
    });

    return el;
  }

  function setAuthOverlay(open, label = "Authentification en cours…") {
    const el = ensureAuthOverlay();
    if (!el) return;

    const title = el.querySelector(".auth-overlay-title");
    if (title) title.textContent = label;

    el.classList.toggle("is-open", !!open);
    el.style.display = open ? "grid" : "none";

    // If the 3DS modal is open and we show overlay: keep modal visible behind
    // Scroll lock only while overlay visible
    if (open) document.body.style.overflow = "hidden";
    else if (document.getElementById("threeDS2Modal")?.style.display !== "grid") {
      document.body.style.overflow = "";
    }
  }

  // Ensure no-flash as early as possible
  // (runs immediately when script is parsed)
  ensureAuthOverlay();

  /* ---------------------------
     3DS2 MODAL (iframe sized)
  ---------------------------- */
  function getIframeSize(iframe) {
    const wAttr = parseInt(iframe?.getAttribute?.("width") || "", 10);
    const hRaw = String(iframe?.getAttribute?.("height") || "").replace("px", "");
    const hAttr = parseInt(hRaw, 10);

    const width = Number.isFinite(wAttr) && wAttr > 0 ? wAttr : 390;
    const height = Number.isFinite(hAttr) && hAttr > 0 ? hAttr : 400;
    return { width, height };
  }

  function ensure3DS2Modal() {
    const modal = document.getElementById("threeDS2Modal");
    const mount = document.getElementById("threeDS2ActionMount");
    const card = modal?.querySelector(".threeds-card");
    const closeBtn = document.getElementById("threeDS2CloseBtn");

    if (!modal || !mount || !card) {
      console.warn("[uiOverlay] Missing 3DS2 modal markup (#threeDS2Modal / #threeDS2ActionMount / .threeds-card)");
      return { modal: null, mount: null, card: null };
    }

    // Hide the close button (requested)
    if (closeBtn) {
      closeBtn.style.display = "none";
      closeBtn.setAttribute("aria-hidden", "true");
      closeBtn.tabIndex = -1;
    }

    // Backdrop
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      display: "none",            // default closed => no flash
      placeItems: "center",
      zIndex: String(Z.modal),
      background: "rgba(0,0,0,0.55)",
      padding: "16px",
      margin: "0"
    });
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");

    // Card default (will be synced to iframe once injected)
    Object.assign(card.style, {
      position: "relative",
      width: "min(390px, calc(100vw - 32px))",
      height: "min(400px, calc(100vh - 32px))",
      background: "#fff",
      borderRadius: "16px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      overflow: "hidden",
      padding: "0",
      margin: "0"
    });

    // Mount: full bleed
    Object.assign(mount.style, {
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0"
    });

    // Sync card + iframe sizing to the ACS iframe "native" size to avoid blank space
    function syncToIframe() {
      const iframe = mount.querySelector("iframe");
      if (!iframe) return;

      const { width, height } = getIframeSize(iframe);

      // Card follows iframe dimensions (responsive clamp on viewport)
      card.style.width = `min(${width}px, calc(100vw - 32px))`;
      card.style.height = `min(${height}px, calc(100vh - 32px))`;

      // Keep iframe at native width to avoid "white space on the right"
      // But still clamp on mobile
      iframe.style.width = `${width}px`;
      iframe.style.height = `${height}px`;
      iframe.style.maxWidth = "100%";
      iframe.style.display = "block";
      iframe.style.border = "0";
      iframe.style.margin = "0";
      iframe.style.padding = "0";
    }

    // Observe when Adyen injects iframe
    if (!mount.__iframeObserver) {
      const obs = new MutationObserver(() => syncToIframe());
      obs.observe(mount, { childList: true, subtree: true });
      mount.__iframeObserver = obs;
    }

    // Timing safety (injection can be async)
    setTimeout(syncToIframe, 0);
    setTimeout(syncToIframe, 50);
    setTimeout(syncToIframe, 200);

    return { modal, mount, card };
  }

  // Ensure modal base state early => no flash
  ensure3DS2Modal();

  function setThreeDS2Modal(open, { clear = false } = {}) {
    const { modal, mount } = ensure3DS2Modal();
    if (!modal) return;

    if (open) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      modal.style.display = "grid";
      document.body.style.overflow = "hidden";
    } else {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      modal.style.display = "none";

      // Restore scroll only if auth overlay isn't open
      const overlayOpen = document.getElementById("auth-overlay")?.classList.contains("is-open");
      if (!overlayOpen) document.body.style.overflow = "";

      if (clear && mount) mount.innerHTML = "";
    }
  }

  // STRICT: only this
  function isThreeDS2Action(action) {
    return action?.type === "threeDS2";
  }

  function shouldHideOverlayForResultCode(resultCode) {
    return ["Authorised", "Refused", "Cancelled", "Error", "Pending", "Received"].includes(resultCode);
  }

  // Expose
  window.setAuthOverlay = setAuthOverlay;
  window.setThreeDS2Modal = setThreeDS2Modal;
  window.isThreeDS2Action = isThreeDS2Action;
  window.shouldHideOverlayForResultCode = shouldHideOverlayForResultCode;
})();