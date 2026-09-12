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

  /**
   * Firebase web app config for Auth (email/password + Google).
   * apiKey is required. Prefer Worker env FIREBASE_API_KEY, or paste once
   * on the auth setup screen (saved to localStorage).
   * Project default: re-el-eed0d
   */
  if (!window.CHATRE_FIREBASE) {
    window.CHATRE_FIREBASE = {
      apiKey: localStorage.getItem("chatre_firebase_api_key") || "",
      authDomain:
        localStorage.getItem("chatre_firebase_auth_domain") ||
        "re-el-eed0d.firebaseapp.com",
      projectId:
        localStorage.getItem("chatre_firebase_project_id") || "re-el-eed0d",
      appId: localStorage.getItem("chatre_firebase_app_id") || "",
    };
  }
})();
