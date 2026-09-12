/**
 * Chatre Auth — Firebase Auth bootstrap, configure, and account actions.
 */
(function () {
  "use strict";

  var state = {
    user: null,
    idToken: null,
    profile: null,
    ready: false,
    initError: null,
  };

  var listeners = [];
  var authUnsub = null;

  function cfg() {
    return window.CHATRE_FIREBASE || {};
  }

  function configured() {
    var c = cfg();
    return !!(c.apiKey && c.authDomain && c.projectId);
  }

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn(state);
      } catch (e) {
        /* ignore */
      }
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    if (state.ready) fn(state);
  }

  function persistConfig(partial) {
    var next = Object.assign({}, cfg(), partial || {});
    window.CHATRE_FIREBASE = next;
    try {
      if (next.apiKey) localStorage.setItem("chatre_firebase_api_key", next.apiKey);
      if (next.appId) localStorage.setItem("chatre_firebase_app_id", next.appId);
      if (next.authDomain) {
        localStorage.setItem("chatre_firebase_auth_domain", next.authDomain);
      }
      if (next.projectId) {
        localStorage.setItem("chatre_firebase_project_id", next.projectId);
      }
    } catch (e) {
      /* ignore */
    }
    return next;
  }

  async function hydrateFromServer() {
    try {
      var res = await fetch("/api/firebase-config", { method: "GET" });
      if (!res.ok) return null;
      var data = await res.json();
      if (data && data.apiKey) {
        persistConfig({
          apiKey: data.apiKey,
          authDomain: data.authDomain || cfg().authDomain,
          projectId: data.projectId || cfg().projectId,
          appId: data.appId || cfg().appId || "",
        });
        return data;
      }
    } catch (e) {
      /* offline / static host */
    }
    return null;
  }

  async function refreshProfile() {
    if (!state.user || !window.ChatreRemote) {
      state.profile = null;
      return null;
    }
    try {
      var data = await window.ChatreRemote.getMe();
      state.profile = data.user || null;
      notify();
      return state.profile;
    } catch (e) {
      console.warn("getMe failed", e);
      return null;
    }
  }

  async function getIdToken(force) {
    if (!state.user) return null;
    try {
      state.idToken = await state.user.getIdToken(!!force);
      return state.idToken;
    } catch (e) {
      return null;
    }
  }

  function mapAuthError(err) {
    var code = (err && err.code) || "";
    var msg = (err && err.message) || String(err || "Auth failed");
    var map = {
      "auth/invalid-email": "Enter a valid email address.",
      "auth/user-disabled": "This account has been disabled.",
      "auth/user-not-found": "No account with that email. Create one?",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/email-already-in-use": "That email already has an account. Sign in instead.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/popup-blocked": "Pop-up blocked. Allow pop-ups for this site.",
      "auth/unauthorized-domain":
        "This domain is not authorized in Firebase Auth settings.",
      "auth/operation-not-allowed":
        "That sign-in method is disabled in Firebase Console.",
      "auth/too-many-requests": "Too many attempts. Try again later.",
      "auth/network-request-failed": "Network error. Check your connection.",
      "auth/api-key-not-valid":
        "Firebase API key is invalid. Re-check Project settings → Your apps.",
      "auth/invalid-api-key":
        "Firebase API key is invalid. Re-check Project settings → Your apps.",
    };
    if (map[code]) return map[code];
    if (/API key not valid|api-key/i.test(msg)) {
      return "Firebase API key is invalid. Paste the web apiKey from Project settings.";
    }
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "");
  }

  function attachAuthListener() {
    if (authUnsub) {
      try {
        authUnsub();
      } catch (e) {
        /* ignore */
      }
      authUnsub = null;
    }
    firebase.auth().onAuthStateChanged(async function (user) {
      state.user = user;
      if (user) {
        await getIdToken(true);
        await refreshProfile();
        // Browser service key must not override user RBAC sessions.
        try {
          if (localStorage.getItem("chatre_api_key")) {
            localStorage.removeItem("chatre_api_key");
            window.CHATRE_API_KEY = "";
            var inp = document.getElementById("api-key-input");
            if (inp) inp.value = "";
            if (window.ChatreKit) {
              window.ChatreKit.toast(
                "Cleared admin service key from this browser — using your user session",
                "success",
              );
            }
          }
        } catch (e) {
          /* ignore */
        }
      } else {
        state.idToken = null;
        state.profile = null;
      }
      state.ready = true;
      state.initError = null;
      notify();
      if (window.ChatrePanels && window.ChatrePanels.refreshAuthStatus) {
        window.ChatrePanels.refreshAuthStatus();
      }
      if (window.ChatreUIAdv && window.ChatreUIAdv.refreshEmptyState) {
        window.ChatreUIAdv.refreshEmptyState();
      }
    });
  }

  async function startFirebase() {
    state.initError = null;
    if (!configured()) {
      state.ready = true;
      state.initError = "missing_config";
      notify();
      return false;
    }
    if (!window.firebase) {
      state.ready = true;
      state.initError = "sdk_missing";
      notify();
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(cfg());
      } else {
        // Already initialized — config changes need a reload in practice
      }
      attachAuthListener();
      return true;
    } catch (e) {
      state.ready = true;
      state.initError = mapAuthError(e);
      notify();
      return false;
    }
  }

  async function configure(partial) {
    persistConfig(partial);
    if (window.firebase && firebase.apps.length) {
      // Firebase JS does not allow re-init with a new key cleanly.
      location.reload();
      return;
    }
    return startFirebase();
  }

  async function bootstrap() {
    await hydrateFromServer();
    // localStorage already applied in config.js; re-merge in case hydrate filled gaps
    persistConfig({
      apiKey: cfg().apiKey || localStorage.getItem("chatre_firebase_api_key") || "",
      appId: cfg().appId || localStorage.getItem("chatre_firebase_app_id") || "",
      authDomain:
        cfg().authDomain ||
        localStorage.getItem("chatre_firebase_auth_domain") ||
        "re-el-eed0d.firebaseapp.com",
      projectId:
        cfg().projectId ||
        localStorage.getItem("chatre_firebase_project_id") ||
        "re-el-eed0d",
    });
    await startFirebase();
  }

  async function signUp(email, password) {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    try {
      var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      return cred.user;
    } catch (e) {
      throw new Error(mapAuthError(e));
    }
  }

  async function signIn(email, password) {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    try {
      var cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      return cred.user;
    } catch (e) {
      throw new Error(mapAuthError(e));
    }
  }

  async function signInGoogle() {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      var cred = await firebase.auth().signInWithPopup(provider);
      return cred.user;
    } catch (e) {
      throw new Error(mapAuthError(e));
    }
  }

  async function sendPasswordReset(email) {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    try {
      await firebase.auth().sendPasswordResetEmail(email);
    } catch (e) {
      throw new Error(mapAuthError(e));
    }
  }

  async function signOut() {
    if (!window.firebase || !firebase.apps.length) return;
    await firebase.auth().signOut();
  }

  function currentUser() {
    return state.user;
  }

  function isSignedIn() {
    return !!state.user;
  }

  window.ChatreAuth = {
    init: bootstrap,
    bootstrap: bootstrap,
    configured: configured,
    configure: configure,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signInGoogle: signInGoogle,
    sendPasswordReset: sendPasswordReset,
    signOut: signOut,
    getIdToken: getIdToken,
    refreshProfile: refreshProfile,
    currentUser: currentUser,
    isSignedIn: isSignedIn,
    mapAuthError: mapAuthError,
    state: state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bootstrap();
    });
  } else {
    bootstrap();
  }
})();
