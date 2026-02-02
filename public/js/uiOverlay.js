/**
 * uiOverlay.js
 * Helpers UI (loading overlay + 3DS2 modal)
 * STRICT 3DS: action.type === "threeDS2"
 *
 * Fixes:
 * - Robust scroll lock (counter + restore previous overflow)
 * - No flash on load
 * - Overlay always above modal
 * - If #threeDS2Modal[data-fullscreen="1"] => TRUE fullscreen (card + iframe 100%)
 * - Otherwise => size to injected iframe width/height attrs
 * - No close button
 */
(function () {
  "use strict";

  const Z = { modal: 99999, overlay: 100001 };

  /* ---------------------------
     Scroll lock (robust)
  ---------------------------- */
  let __scrollLockCount = 0;
  let __prevOverflow = "";

  function lockScroll() {
    if (__scrollLockCount === 0) {
      __prevOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
    }
    __scrollLockCount += 1;
  }

  function forceUnlockScroll() {
    __scrollLockCount = 0;
    document.body.style.overflow = __prevOverflow || "";
    __prevOverflow = "";
  }

  function isGridDisplayed(el) {
    return !!(el && el.style && el.style.display === "grid");
  }

  function unlockScrollIfNothingOpen() {
    const overlayOpen = document.getElementById("auth-overlay")?.classList.contains("is-open");
    const modalOpen = isGridDisplayed(document.getElementById("threeDS2Modal"));
    if (!overlayOpen && !modalOpen) forceUnlockScroll();
  }

  /* ---------------------------
     AUTH OVERLAY (no flash)
  ---------------------------- */
  function ensureAuthOverlay() {
    const el = document.getElementById("auth-overlay");
    if (!el) return null;

    if (el.parentElement !== document.body) document.body.appendChild(el);

    el.classList.remove("is-open");
    el.style.display = "none";

    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(Z.overlay),
      display: "none",
      placeItems: "center",
      background: "rgba(0,0,0,0.35)",
      padding: "16px",
      pointerEvents: "auto"
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

    if (open) lockScroll();
    else unlockScrollIfNothingOpen();
  }

  ensureAuthOverlay();

  /* ---------------------------
     3DS2 MODAL
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

    // Hide close button
    if (closeBtn) {
      closeBtn.style.display = "none";
      closeBtn.setAttribute("aria-hidden", "true");
      closeBtn.tabIndex = -1;
    }

    // Backdrop base state
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      placeItems: "center",
      zIndex: String(Z.modal),
      background: "rgba(0,0,0,0.55)",
      padding: "16px",
      margin: "0"
    });
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");

    // Card base state
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

    // Mount full bleed inside card
    Object.assign(mount.style, {
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0"
    });

    function applyFullscreen() {
      // modal takes the whole viewport
      modal.style.padding = "0";
      modal.style.placeItems = "stretch";

      // card truly fullscreen
      card.style.width = "100vw";
      card.style.height = "100vh";
      card.style.borderRadius = "0";
      card.style.boxShadow = "none";

      // mount full
      mount.style.width = "100%";
      mount.style.height = "100%";

      // IMPORTANT: force iframe to fill (override width/height attrs)
      const iframe = mount.querySelector("iframe");
      if (iframe) {
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.maxWidth = "100%";
        iframe.style.display = "block";
        iframe.style.border = "0";
        iframe.style.margin = "0";
        iframe.style.padding = "0";
      }
    }

    function applySizedToIframe() {
      // restore centered modal
      modal.style.padding = "16px";
      modal.style.placeItems = "center";

      const iframe = mount.querySelector("iframe");
      if (!iframe) return;

      const { width, height } = getIframeSize(iframe);

      card.style.width = `min(${width}px, calc(100vw - 32px))`;
      card.style.height = `min(${height}px, calc(100vh - 32px))`;
      card.style.borderRadius = "16px";
      card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.25)";

      // keep iframe at its native size
      iframe.style.width = `${width}px`;
      iframe.style.height = `${height}px`;
      iframe.style.maxWidth = "100%";
      iframe.style.display = "block";
      iframe.style.border = "0";
      iframe.style.margin = "0";
      iframe.style.padding = "0";
    }

    function sync() {
      const fullscreen = modal.getAttribute("data-fullscreen") === "1";
      if (fullscreen) applyFullscreen();
      else applySizedToIframe();
    }

    if (!mount.__iframeObserver) {
      const obs = new MutationObserver(() => sync());
      obs.observe(mount, { childList: true, subtree: true });
      mount.__iframeObserver = obs;
    }

    setTimeout(sync, 0);
    setTimeout(sync, 50);
    setTimeout(sync, 200);

    return { modal, mount, card, sync };
  }

  ensure3DS2Modal();

  function setThreeDS2Modal(open, { clear = false } = {}) {
    const { modal, mount, sync } = ensure3DS2Modal();
    if (!modal) return;

    if (open) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      modal.style.display = "grid";
      lockScroll();

      // re-apply sizing mode immediately
      try { sync?.(); } catch (_) {}
    } else {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      modal.style.display = "none";
      modal.setAttribute("data-fullscreen", "0");

      if (clear && mount) mount.innerHTML = "";
      unlockScrollIfNothingOpen();
    }
  }

  function isThreeDS2Action(action) {
    return action?.type === "threeDS2";
  }

  function shouldHideOverlayForResultCode(resultCode) {
    return ["Authorised", "Refused", "Cancelled", "Error", "Pending", "Received"].includes(resultCode);
  }

  window.setAuthOverlay = setAuthOverlay;
  window.setThreeDS2Modal = setThreeDS2Modal;
  window.isThreeDS2Action = isThreeDS2Action;
  window.shouldHideOverlayForResultCode = shouldHideOverlayForResultCode;
  window.__forceUnlockScroll = forceUnlockScroll;
})();