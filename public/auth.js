/**
 * Chatre Auth — Firebase Auth (email/password + Google) for user accounts.
 */
(function () {
  "use strict";

  var state = {
    user: null,
    idToken: null,
    profile: null,
    ready: false,
  };

  var listeners = [];

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

  function initFirebase() {
    if (!configured()) {
      state.ready = true;
      notify();
      return;
    }
    if (!window.firebase) {
      console.warn("Firebase SDK not loaded");
      state.ready = true;
      notify();
      return;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(cfg());
    }
    firebase.auth().onAuthStateChanged(async function (user) {
      state.user = user;
      if (user) {
        await getIdToken(true);
        await refreshProfile();
      } else {
        state.idToken = null;
        state.profile = null;
      }
      state.ready = true;
      notify();
      if (window.ChatrePanels && window.ChatrePanels.refreshAuthStatus) {
        window.ChatrePanels.refreshAuthStatus();
      }
    });
  }

  async function signUp(email, password) {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signIn(email, password) {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    var cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signInGoogle() {
    if (!configured()) throw new Error("Firebase Auth is not configured");
    var provider = new firebase.auth.GoogleAuthProvider();
    var cred = await firebase.auth().signInWithPopup(provider);
    return cred.user;
  }

  async function signOut() {
    if (!window.firebase) return;
    await firebase.auth().signOut();
  }

  function currentUser() {
    return state.user;
  }

  function isSignedIn() {
    return !!state.user;
  }

  window.ChatreAuth = {
    init: initFirebase,
    configured: configured,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signInGoogle: signInGoogle,
    signOut: signOut,
    getIdToken: getIdToken,
    refreshProfile: refreshProfile,
    currentUser: currentUser,
    isSignedIn: isSignedIn,
    state: state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFirebase);
  } else {
    initFirebase();
  }
})();
