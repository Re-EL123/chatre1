/**
 * Chatre Auth Gate — full-screen sign in / sign up / setup flow.
 */
(function () {
  "use strict";

  var SKIP_KEY = "chatre.auth.skip_gate";
  var tab = "signin"; // signin | signup | reset | setup

  function $(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.ChatreKit;
  }

  function skipped() {
    try {
      return localStorage.getItem(SKIP_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setSkipped(on) {
    try {
      if (on) localStorage.setItem(SKIP_KEY, "1");
      else localStorage.removeItem(SKIP_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function setError(msg) {
    var el = $("auth-gate-error");
    if (el) el.textContent = msg || "";
  }

  function setBusy(busy) {
    var gate = $("auth-gate");
    if (gate) gate.classList.toggle("is-busy", !!busy);
    [
      "auth-gate-submit",
      "auth-gate-google",
      "auth-gate-setup-save",
    ].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!busy;
    });
  }

  function showTab(name) {
    tab = name;
    var configured = window.ChatreAuth && window.ChatreAuth.configured();
    if (!configured && name !== "setup") name = "setup";
    tab = name;

    var setup = $("auth-gate-setup");
    var forms = $("auth-gate-forms");
    var tabs = $("auth-gate-tabs");
    var google = $("auth-gate-google");
    var resetLink = $("auth-gate-forgot");
    var sub = $("auth-gate-sub");

    if (setup) setup.hidden = name !== "setup";
    if (forms) forms.hidden = name === "setup";
    if (tabs) tabs.hidden = name === "setup" || name === "reset";
    if (google) google.hidden = name === "setup" || name === "reset";
    if (resetLink) resetLink.hidden = name !== "signin";

    if (tabs) {
      tabs.querySelectorAll("[data-auth-tab]").forEach(function (btn) {
        var on = btn.getAttribute("data-auth-tab") === name;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    var signin = $("auth-form-signin");
    var signup = $("auth-form-signup");
    var reset = $("auth-form-reset");
    if (signin) signin.hidden = name !== "signin";
    if (signup) signup.hidden = name !== "signup";
    if (reset) reset.hidden = name !== "reset";

    if (sub) {
      if (name === "setup") {
        sub.textContent =
          "Paste your Firebase web apiKey once. Providers can stay enabled in the console.";
      } else if (name === "signup") {
        sub.textContent = "Create an account to sync threads, workspaces, and BYOK keys.";
      } else if (name === "reset") {
        sub.textContent = "We’ll email you a link to reset your password.";
      } else {
        sub.textContent = "Sign in to sync threads, workspaces, and BYOK keys.";
      }
    }

    var submit = $("auth-gate-submit");
    if (submit) {
      submit.hidden = name === "setup";
      submit.textContent =
        name === "signup"
          ? "Create account"
          : name === "reset"
            ? "Send reset link"
            : "Sign in";
    }

    setError("");
  }

  function shouldShowGate() {
    if (!window.ChatreAuth) return true;
    if (window.ChatreAuth.isSignedIn()) return false;
    if (skipped()) return false;
    return true;
  }

  function openGate(opts) {
    var gate = $("auth-gate");
    if (!gate) return;
    setSkipped(false);
    gate.hidden = false;
    gate.classList.add("open");
    document.body.classList.add("auth-gate-open");
    var configured = window.ChatreAuth && window.ChatreAuth.configured();
    if (opts && opts.tab) showTab(opts.tab);
    else showTab(configured ? "signin" : "setup");
    var focusId =
      !configured
        ? "auth-setup-apikey"
        : tab === "signup"
          ? "auth-signup-email"
          : "auth-signin-email";
    setTimeout(function () {
      var el = $(focusId);
      if (el) el.focus();
    }, 50);
  }

  function closeGate() {
    var gate = $("auth-gate");
    if (!gate) return;
    gate.classList.remove("open");
    gate.hidden = true;
    document.body.classList.remove("auth-gate-open");
    setError("");
  }

  function paint() {
    if (!window.ChatreAuth) return;
    if (window.ChatreAuth.isSignedIn()) {
      closeGate();
      return;
    }
    if (shouldShowGate()) openGate();
    else closeGate();

    // Reflect config state in setup fields
    var c = window.CHATRE_FIREBASE || {};
    if ($("auth-setup-apikey") && !$("auth-setup-apikey").value) {
      $("auth-setup-apikey").value = c.apiKey || "";
    }
    if ($("auth-setup-appid") && !$("auth-setup-appid").value) {
      $("auth-setup-appid").value = c.appId || "";
    }
  }

  async function saveSetup() {
    var apiKey = ($("auth-setup-apikey") && $("auth-setup-apikey").value.trim()) || "";
    var appId = ($("auth-setup-appid") && $("auth-setup-appid").value.trim()) || "";
    if (!apiKey) {
      setError("Paste the web apiKey from Firebase Project settings → Your apps.");
      return;
    }
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) {
      setError("That doesn’t look like a Firebase web API key (usually starts with AIza).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await window.ChatreAuth.configure({
        apiKey: apiKey,
        appId: appId,
        authDomain: "re-el-eed0d.firebaseapp.com",
        projectId: "re-el-eed0d",
      });
      // configure may reload; if not:
      showTab("signin");
      if (kit()) kit().toast("Firebase connected", "success");
    } catch (e) {
      setError((e && e.message) || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCurrent() {
    if (!window.ChatreAuth) return;
    setError("");
    setBusy(true);
    try {
      if (tab === "signin") {
        var email = ($("auth-signin-email") && $("auth-signin-email").value.trim()) || "";
        var pass = ($("auth-signin-password") && $("auth-signin-password").value) || "";
        if (!email || !pass) throw new Error("Enter email and password.");
        await window.ChatreAuth.signIn(email, pass);
        if (kit()) kit().toast("Signed in", "success");
      } else if (tab === "signup") {
        var e2 = ($("auth-signup-email") && $("auth-signup-email").value.trim()) || "";
        var p2 = ($("auth-signup-password") && $("auth-signup-password").value) || "";
        var p3 = ($("auth-signup-password2") && $("auth-signup-password2").value) || "";
        if (!e2 || !p2) throw new Error("Enter email and password.");
        if (p2.length < 6) throw new Error("Password should be at least 6 characters.");
        if (p2 !== p3) throw new Error("Passwords do not match.");
        await window.ChatreAuth.signUp(e2, p2);
        if (kit()) kit().toast("Account created", "success");
      } else if (tab === "reset") {
        var e3 = ($("auth-reset-email") && $("auth-reset-email").value.trim()) || "";
        if (!e3) throw new Error("Enter your email.");
        await window.ChatreAuth.sendPasswordReset(e3);
        if (kit()) kit().toast("Reset email sent", "success");
        setError("Check your inbox for a reset link.");
        showTab("signin");
      }
    } catch (e) {
      setError((e && e.message) || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!window.ChatreAuth) return;
    setError("");
    setBusy(true);
    try {
      await window.ChatreAuth.signInGoogle();
      if (kit()) kit().toast("Signed in", "success");
    } catch (e) {
      setError((e && e.message) || String(e));
    } finally {
      setBusy(false);
    }
  }

  function continueLocal() {
    setSkipped(true);
    closeGate();
    if (kit()) {
      kit().toast("Continuing without account — local mode", "info");
    }
  }

  function init() {
    var gate = $("auth-gate");
    if (!gate) return;

    var tabs = $("auth-gate-tabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-auth-tab]");
        if (btn) showTab(btn.getAttribute("data-auth-tab"));
      });
    }

    var forgot = $("auth-gate-forgot");
    if (forgot) {
      forgot.addEventListener("click", function (e) {
        e.preventDefault();
        var email = ($("auth-signin-email") && $("auth-signin-email").value) || "";
        showTab("reset");
        if ($("auth-reset-email") && email) $("auth-reset-email").value = email;
      });
    }

    var back = $("auth-gate-back-signin");
    if (back) {
      back.addEventListener("click", function (e) {
        e.preventDefault();
        showTab("signin");
      });
    }

    var setupSave = $("auth-gate-setup-save");
    if (setupSave) setupSave.addEventListener("click", saveSetup);

    var submit = $("auth-gate-submit");
    if (submit) submit.addEventListener("click", submitCurrent);

    var googleBtn = $("auth-gate-google");
    if (googleBtn) googleBtn.addEventListener("click", google);

    var localBtn = $("auth-gate-continue-local");
    if (localBtn) localBtn.addEventListener("click", continueLocal);

    ["auth-form-signin", "auth-form-signup", "auth-form-reset"].forEach(
      function (id) {
        var form = $(id);
        if (!form) return;
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          submitCurrent();
        });
      },
    );

    var reopenSetup = $("auth-gate-reopen-setup");
    if (reopenSetup) {
      reopenSetup.addEventListener("click", function (e) {
        e.preventDefault();
        showTab("setup");
      });
    }

    if (window.ChatreAuth && window.ChatreAuth.onChange) {
      window.ChatreAuth.onChange(function () {
        paint();
      });
    } else {
      paint();
    }

    if (kit()) kit().refreshIcons(gate);
  }

  window.ChatreAuthGate = {
    init: init,
    open: openGate,
    close: closeGate,
    paint: paint,
    showTab: showTab,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
