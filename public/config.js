/**
 * Chatre frontend config — loaded before remote.js / chat.js.
 * Override anytime with window.CHATRE_* or localStorage.
 */
(function () {
  "use strict";

  // Production Vercel API (no trailing slash)
  if (!window.CHATRE_API_BASE) {
    window.CHATRE_API_BASE = "https://chatre-api.vercel.app";
  }

  // Prefer a key already saved in localStorage; otherwise leave empty
  // until the user enters it in the UI (or set window.CHATRE_API_KEY here).
  if (!window.CHATRE_API_KEY) {
    window.CHATRE_API_KEY = localStorage.getItem("chatre_api_key") || "";
  }

  // Keep localStorage in sync with the default base so remote.js sees it
  if (!localStorage.getItem("chatre_api_base")) {
    localStorage.setItem("chatre_api_base", window.CHATRE_API_BASE);
  }
})();
