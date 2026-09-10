/**
 * Optional Firebase web Analytics for the static Chatre UI.
 * Persistence/writes go through chatre-api (Admin SDK) — not this client.
 *
 * Enable with:
 *   window.CHATRE_ENABLE_ANALYTICS = true;
 *   window.CHATRE_FIREBASE_CONFIG = { apiKey, authDomain, projectId, ... };
 */
(function () {
  "use strict";

  if (!window.CHATRE_ENABLE_ANALYTICS) return;
  if (!window.CHATRE_FIREBASE_CONFIG) {
    console.warn("Chatre Analytics: set window.CHATRE_FIREBASE_CONFIG first");
    return;
  }

  const firebaseConfig = window.CHATRE_FIREBASE_CONFIG;
  const s = document.createElement("script");
  s.type = "module";
  s.textContent =
    'import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";' +
    'import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";' +
    "const app = initializeApp(" +
    JSON.stringify(firebaseConfig) +
    "); getAnalytics(app);";
  document.head.appendChild(s);
})();
