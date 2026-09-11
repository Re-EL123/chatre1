/**
 * Chatre UX — run command center, settings drawer, density, keyboard, onboarding.
 */
(function () {
  "use strict";

  var state = {
    running: false,
    goal: "",
    phase: "",
    step: "",
    usedSteps: 0,
    maxSteps: null,
    remainingSteps: null,
    pauseReason: "",
    lastFailed: "",
    lastShell: null,
    lastBrowserAction: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.ChatreKit;
  }

  function iconHtml(name, size) {
    return kit() ? kit().iconHtml(name, size || 14) : "";
  }

  // ── Density ─────────────────────────────────────────────────────────
  function applyDensity(mode) {
    var m = mode === "comfortable" ? "comfortable" : "compact";
    document.body.setAttribute("data-density", m);
    try {
      localStorage.setItem("chatre.density", m);
    } catch (e) {
      /* ignore */
    }
    var sel = $("density-select");
    if (sel) sel.value = m;
  }

  function initDensity() {
    var saved = "compact";
    try {
      saved = localStorage.getItem("chatre.density") || "compact";
    } catch (e) {
      /* ignore */
    }
    applyDensity(saved);
    var sel = $("density-select");
    if (sel) {
      sel.addEventListener("change", function () {
        applyDensity(sel.value);
      });
    }
  }

  // ── Settings drawer ─────────────────────────────────────────────────
  function openSettings() {
    var d = $("settings-drawer");
    if (!d) return;
    d.classList.add("open");
    d.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    var d = $("settings-drawer");
    if (!d) return;
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
  }

  function initSettings() {
    var openBtn = $("settings-open");
    var closeBtn = $("settings-close");
    var drawer = $("settings-drawer");
    if (openBtn) openBtn.addEventListener("click", openSettings);
    if (closeBtn) closeBtn.addEventListener("click", closeSettings);
    if (drawer) {
      drawer.addEventListener("click", function (e) {
        if (e.target === drawer) closeSettings();
      });
    }
    var modelHost = $("settings-model-slot");
    var keyHost = $("settings-key-slot");
    var model = $("model-select");
    var key = $("api-key-input");
    if (modelHost && model && model.parentNode !== modelHost) {
      var modelLabel = document.querySelector('label[for="model-select"]');
      if (modelLabel) modelHost.appendChild(modelLabel);
      modelHost.appendChild(model);
    }
    if (keyHost && key && key.parentNode !== keyHost) {
      var keyLabel = document.querySelector('label[for="api-key-input"]');
      if (keyLabel) keyHost.appendChild(keyLabel);
      keyHost.appendChild(key);
      var hint = document.createElement("p");
      hint.style.cssText = "margin:0;font-size:0.78rem;color:var(--text-light)";
      hint.textContent =
        "Optional service token. Prefer signing in with your account.";
      keyHost.appendChild(hint);
    }
    initAuthUi();
    initByokUi();
    refreshModelCatalog();
  }

  function setAuthError(msg) {
    var el = $("auth-error");
    if (el) el.textContent = msg || "";
  }

  function paintAuthUi() {
    var out = $("auth-signed-out");
    var inn = $("auth-signed-in");
    var label = $("auth-user-label");
    var signed = window.ChatreAuth && window.ChatreAuth.isSignedIn();
    if (out) out.hidden = !!signed;
    if (inn) inn.hidden = !signed;
    if (label && signed) {
      var u = window.ChatreAuth.currentUser();
      label.textContent = (u && (u.email || u.uid)) || "Signed in";
    }
    refreshByokStatus();
    refreshModelCatalog();
  }

  function initAuthUi() {
    function run(fn) {
      return function () {
        setAuthError("");
        Promise.resolve()
          .then(fn)
          .then(function () {
            paintAuthUi();
            if (window.ChatreKit) window.ChatreKit.toast("Signed in", "success");
          })
          .catch(function (e) {
            setAuthError((e && e.message) || String(e));
          });
      };
    }
    var email = function () {
      return ($("auth-email") && $("auth-email").value.trim()) || "";
    };
    var pass = function () {
      return ($("auth-password") && $("auth-password").value) || "";
    };
    if ($("auth-signin")) {
      $("auth-signin").addEventListener(
        "click",
        run(function () {
          return window.ChatreAuth.signIn(email(), pass());
        }),
      );
    }
    if ($("auth-signup")) {
      $("auth-signup").addEventListener(
        "click",
        run(function () {
          return window.ChatreAuth.signUp(email(), pass());
        }),
      );
    }
    if ($("auth-google")) {
      $("auth-google").addEventListener(
        "click",
        run(function () {
          return window.ChatreAuth.signInGoogle();
        }),
      );
    }
    if ($("auth-signout")) {
      $("auth-signout").addEventListener("click", function () {
        window.ChatreAuth.signOut().then(paintAuthUi);
      });
    }
    if (window.ChatreAuth) window.ChatreAuth.onChange(paintAuthUi);
  }

  function refreshByokStatus() {
    var el = $("byok-status");
    if (!el) return;
    var profile =
      window.ChatreAuth &&
      window.ChatreAuth.state &&
      window.ChatreAuth.state.profile;
    if (!profile) {
      el.textContent = "Sign in to save provider keys.";
      return;
    }
    var byok = profile.byok || {};
    var saved = Object.keys(byok).filter(function (k) {
      return byok[k];
    });
    el.textContent = saved.length
      ? "Saved: " + saved.join(", ")
      : "No provider keys saved yet.";
  }

  function initByokUi() {
    if ($("byok-save")) {
      $("byok-save").addEventListener("click", function () {
        var provider = $("byok-provider") && $("byok-provider").value;
        var key = $("byok-key") && $("byok-key").value.trim();
        if (!window.ChatreRemote || !window.ChatreRemote.saveByok) return;
        window.ChatreRemote
          .saveByok(provider, key)
          .then(function () {
            if ($("byok-key")) $("byok-key").value = "";
            return window.ChatreAuth.refreshProfile();
          })
          .then(function () {
            refreshByokStatus();
            refreshModelCatalog();
            if (window.ChatreKit) window.ChatreKit.toast("Key saved", "success");
          })
          .catch(function (e) {
            if (window.ChatreKit) {
              window.ChatreKit.toast(e.message || String(e), "error");
            }
          });
      });
    }
    if ($("byok-delete")) {
      $("byok-delete").addEventListener("click", function () {
        var provider = $("byok-provider") && $("byok-provider").value;
        window.ChatreRemote
          .deleteByok(provider)
          .then(function () {
            return window.ChatreAuth.refreshProfile();
          })
          .then(function () {
            refreshByokStatus();
            refreshModelCatalog();
          })
          .catch(function (e) {
            if (window.ChatreKit) {
              window.ChatreKit.toast(e.message || String(e), "error");
            }
          });
      });
    }
    if ($("byok-test")) {
      $("byok-test").addEventListener("click", function () {
        var provider = $("byok-provider") && $("byok-provider").value;
        if (!window.ChatreRemote || !window.ChatreRemote.testByok) return;
        window.ChatreRemote
          .testByok(provider)
          .then(function (r) {
            if (window.ChatreKit) {
              window.ChatreKit.toast(
                r && r.ok
                  ? "Connected to " + provider
                  : (r && r.error) || "Test failed",
                r && r.ok ? "success" : "error",
              );
            }
            var el = $("byok-status");
            if (el) {
              el.textContent =
                r && r.ok
                  ? "Test OK: " + provider + (r.sample ? " → " + r.sample : "")
                  : "Test failed: " + ((r && r.error) || "unknown");
            }
          })
          .catch(function (e) {
            if (window.ChatreKit) {
              window.ChatreKit.toast(e.message || String(e), "error");
            }
          });
      });
    }
  }

  async function refreshModelCatalog() {
    var sel = $("model-select");
    if (!sel || !window.ChatreRemote || !window.ChatreRemote.listModels) return;
    if (!window.ChatreRemote.hasAuth || !window.ChatreRemote.hasAuth()) return;
    try {
      var data = await window.ChatreRemote.listModels();
      var current = sel.value;
      sel.innerHTML = "";
      (data.groups || []).forEach(function (g) {
        var og = document.createElement("optgroup");
        og.label = g.label || g.provider;
        (g.models || []).forEach(function (m) {
          var opt = document.createElement("option");
          opt.value = m.value || m.id;
          opt.textContent = m.label || m.id;
          og.appendChild(opt);
        });
        sel.appendChild(og);
      });
      if (current) sel.value = current;
      if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    } catch (e) {
      /* keep existing options */
    }
  }

  // ── Run command center ──────────────────────────────────────────────
  function showRunCenter(on) {
    var bar = $("run-center");
    if (!bar) return;
    bar.hidden = !on;
    bar.classList.toggle("active", !!on);
    document.body.classList.toggle("has-run-center", !!on);
  }

  function updateRunCenter( partial) {
    if (partial) Object.assign(state, partial);
    var bar = $("run-center");
    if (!bar) return;
    var goalEl = $("run-center-goal");
    var stepEl = $("run-center-step");
    var budgetEl = $("run-center-budget");
    var phaseEl = $("run-center-phase");
    if (goalEl) {
      goalEl.textContent = state.goal
        ? String(state.goal).slice(0, 90)
        : "Agent run";
    }
    if (phaseEl) phaseEl.textContent = state.phase || "—";
    if (stepEl) {
      stepEl.textContent =
        state.step ||
        (state.lastFailed
          ? "Last fail: " + String(state.lastFailed).slice(0, 40)
          : state.pauseReason
            ? state.pauseReason
            : "Working…");
    }
    if (budgetEl) {
      if (state.maxSteps != null) {
        budgetEl.textContent =
          (state.usedSteps || 0) +
          "/" +
          state.maxSteps +
          " steps" +
          (state.remainingSteps != null
            ? " · " + state.remainingSteps + " left"
            : "");
      } else {
        budgetEl.textContent = "";
      }
    }
    var resume = $("run-center-resume");
    var stop = $("run-center-stop");
    if (resume) {
      resume.hidden = !state.pauseReason;
    }
    if (stop) stop.disabled = !state.running && !state.pauseReason;
    showRunCenter(!!(state.running || state.pauseReason));
  }

  function startRun(goal) {
    state.running = true;
    state.pauseReason = "";
    state.goal = goal || state.goal || "";
    state.phase = "analyze";
    state.step = "Starting…";
    updateRunCenter();
  }

  function endRun() {
    state.running = false;
    state.pauseReason = "";
    state.step = "Done";
    updateRunCenter({ running: false, pauseReason: "" });
    setTimeout(function () {
      if (!state.running && !state.pauseReason) showRunCenter(false);
    }, 1800);
  }

  function pauseRun(reason) {
    state.running = false;
    state.pauseReason = reason || "Paused";
    state.step = state.pauseReason;
    updateRunCenter();
  }

  function setPhase(phase, text) {
    state.phase = phase || state.phase;
    if (text) state.step = text;
    updateRunCenter();
  }

  function setBudget(usage) {
    if (!usage) return;
    state.maxSteps =
      usage.maxSteps != null
        ? usage.maxSteps
        : (usage.steps || 0) + (usage.remainingSteps || 0);
    state.usedSteps = usage.steps || 0;
    state.remainingSteps = usage.remainingSteps;
    updateRunCenter();
  }

  function setBrowserAction(action, url) {
    state.lastBrowserAction = action || "";
    var meta = $("browser-pane-action");
    if (meta) {
      meta.textContent =
        (action || "") + (url ? " · " + url : "");
      meta.hidden = !action;
    }
    if (window.ChatreUIAdv && window.ChatreUIAdv.setBrowserPane) {
      window.ChatreUIAdv.setBrowserPane({
        note: action || "",
        url: url || "",
        open: true,
      });
    }
  }

  function initRunCenter() {
    var stop = $("run-center-stop");
    var resume = $("run-center-resume");
    if (stop) {
      stop.addEventListener("click", function () {
        if (window.ChatreUI && window.ChatreUI.stopGeneration) {
          window.ChatreUI.stopGeneration();
        } else {
          var btn = $("stop-button");
          if (btn) btn.click();
        }
      });
    }
    if (resume) {
      resume.addEventListener("click", function () {
        if (window.ChatreUI && window.ChatreUI.resumeAgent) {
          window.ChatreUI.resumeAgent();
        }
      });
    }
  }

  // ── Composer toggles + attach ───────────────────────────────────────
  function composerFlags() {
    return {
      useBrowser: !!( $("composer-use-browser") && $("composer-use-browser").checked ),
      useDesktop: !!( $("composer-use-desktop") && $("composer-use-desktop").checked ),
    };
  }

  function prefixFromFlags(message) {
    var f = composerFlags();
    var bits = [];
    if (f.useBrowser) bits.push("[Use the cloud browser tools for this task.]");
    if (f.useDesktop) bits.push("[Use desktop companion tools when helpful.]");
    if (!bits.length) return message;
    return bits.join(" ") + "\n\n" + message;
  }

  function initComposer() {
    var attach = $("composer-attach");
    var fileInput = $("composer-file-input");
    var chips = $("composer-attach-chips");
    if (attach && fileInput) {
      attach.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        var files = Array.from(fileInput.files || []);
        if (!files.length) return;
        if (window.ChatrePanels && window.ChatrePanels.uploadLocalFiles) {
          window.ChatrePanels.uploadLocalFiles(files).then(function () {
            if (kit()) kit().toast("Uploaded " + files.length + " file(s)", "success");
          });
        } else if (kit()) {
          kit().toast("Connect API key to upload files", "error");
        }
        if (chips) {
          chips.innerHTML = files
            .map(function (f) {
              return (
                '<span class="attach-chip">' +
                iconHtml("paperclip", 12) +
                " " +
                f.name +
                "</span>"
              );
            })
            .join("");
          if (kit()) kit().refreshIcons(chips);
        }
        fileInput.value = "";
      });
    }
  }

  // ── Onboarding wizard ───────────────────────────────────────────────
  function onboardingDone() {
    try {
      return localStorage.getItem("chatre.onboarded") === "1";
    } catch (e) {
      return false;
    }
  }

  function markOnboarded() {
    try {
      localStorage.setItem("chatre.onboarded", "1");
    } catch (e) {
      /* ignore */
    }
  }

  function showOnboarding(force) {
    if (!force && onboardingDone()) return;
    var host = $("onboarding-overlay");
    if (!host) return;
    host.hidden = false;
    host.classList.add("open");
    var step = 1;
    function paint() {
      host.querySelectorAll("[data-onboard-step]").forEach(function (el) {
        el.hidden = Number(el.getAttribute("data-onboard-step")) !== step;
      });
      var dots = host.querySelectorAll(".onboard-dot");
      dots.forEach(function (d, i) {
        d.classList.toggle("active", i + 1 === step);
      });
      if (kit()) kit().refreshIcons(host);
    }
    paint();
    host.onclick = function (e) {
      var t = e.target.closest("[data-onboard-action]");
      if (!t) {
        if (e.target === host) {
          markOnboarded();
          host.classList.remove("open");
          host.hidden = true;
        }
        return;
      }
      var act = t.getAttribute("data-onboard-action");
      if (act === "next") {
        step = Math.min(3, step + 1);
        paint();
      } else if (act === "back") {
        step = Math.max(1, step - 1);
        paint();
      } else if (act === "focus-key") {
        openSettings();
        var email = $("auth-email");
        if (email) email.focus();
      } else if (act === "copy-companion") {
        var cmd =
          "CHATRE_API_BASE=https://chatre-api.vercel.app CHATRE_API_TOKEN=YOUR_TOKEN npm run companion:start";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cmd);
          if (kit()) kit().toast("Companion command copied", "success");
        }
      } else if (act === "try" || act === "finish") {
        markOnboarded();
        host.classList.remove("open");
        host.hidden = true;
        if (act === "try" && window.ChatreUI && window.ChatreUI.composeAndSend) {
          if (window.ChatreUI.setAgentMode) window.ChatreUI.setAgentMode(true);
          window.ChatreUI.composeAndSend(
            "Open example.com and tell me the main heading",
          );
        }
      } else if (act === "skip") {
        markOnboarded();
        host.classList.remove("open");
        host.hidden = true;
      }
    };
  }

  // ── Keyboard map ────────────────────────────────────────────────────
  function initKeyboard() {
    document.addEventListener("keydown", function (e) {
      var meta = e.metaKey || e.ctrlKey;
      var tag = (e.target && e.target.tagName) || "";
      var typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable);

      if (e.key === "Escape") {
        var slash = $("slash-suggestions");
        if (slash && slash.style.display !== "none" && slash.innerHTML) {
          return;
        }
        if ($("settings-drawer") && $("settings-drawer").classList.contains("open")) {
          closeSettings();
          e.preventDefault();
          return;
        }
        if ($("plan-drawer") && $("plan-drawer").classList.contains("open")) {
          $("plan-drawer").classList.remove("open");
          e.preventDefault();
          return;
        }
        if (state.running || document.body.classList.contains("is-working")) {
          if (window.ChatreUI && window.ChatreUI.stopGeneration) {
            window.ChatreUI.stopGeneration();
          } else {
            var stop = $("stop-button");
            if (stop) stop.click();
          }
          e.preventDefault();
        }
        return;
      }

      if (meta && e.key === "Enter") {
        if (typing && e.target.id === "user-input") {
          e.preventDefault();
          if (window.ChatreUI && window.ChatreUI.sendMessage) {
            window.ChatreUI.sendMessage();
          } else {
            var send = $("send-button");
            if (send) send.click();
          }
        }
        return;
      }

      if (meta && !e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        if (window.ChatrePanels && window.ChatrePanels.togglePanel) {
          window.ChatrePanels.togglePanel("threads");
        }
        return;
      }

      if (meta && e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        if (window.ChatrePanels && window.ChatrePanels.togglePanel) {
          window.ChatrePanels.togglePanel("browser");
        }
        return;
      }

      if (meta && (e.key === "," || e.key === "/")) {
        if (!typing || e.key === ",") {
          e.preventDefault();
          openSettings();
        }
      }
    });
  }

  function init() {
    initDensity();
    initSettings();
    initRunCenter();
    initComposer();
    initKeyboard();
    var tour = $("settings-tour");
    if (tour) {
      tour.addEventListener("click", function () {
        closeSettings();
        showOnboarding(true);
      });
    }
    var replay = $("onboard-replay");
    if (replay) {
      replay.addEventListener("click", function () {
        showOnboarding(true);
      });
    }
    setTimeout(function () {
      showOnboarding(false);
    }, 400);
    if (kit()) kit().refreshIcons(document.body);
  }

  function pinShellResult(result) {
    if (!result) return;
    if (result.ok === false || (result.code != null && result.code !== 0)) {
      state.lastFailed = result.command || result.cmd || "command failed";
      state.lastShell = result;
      updateRunCenter({
        lastFailed: state.lastFailed,
        pauseReason: state.pauseReason || "",
      });
      showRunCenter(true);
    } else if (result.ok) {
      state.lastShell = result;
    }
  }

  window.ChatreUX = {
    init: init,
    startRun: startRun,
    endRun: endRun,
    pauseRun: pauseRun,
    setPhase: setPhase,
    setBudget: setBudget,
    setBrowserAction: setBrowserAction,
    updateRunCenter: updateRunCenter,
    showRunCenter: showRunCenter,
    pinShellResult: pinShellResult,
    openSettings: openSettings,
    closeSettings: closeSettings,
    applyDensity: applyDensity,
    showOnboarding: showOnboarding,
    composerFlags: composerFlags,
    prefixFromFlags: prefixFromFlags,
    state: state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
