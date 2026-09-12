/**
 * Chatre app toolbar — model, panels, status pills, account, run bar, mobile.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.ChatreKit;
  }

  function openSettingsFocus(sel) {
    if (
      sel === "#auth-email" ||
      sel === "#auth-signin-email" ||
      sel === "#auth-open-gate"
    ) {
      if (window.ChatreAuthGate && window.ChatreAuthGate.open) {
        window.ChatreAuthGate.open({ tab: "signin" });
        return;
      }
    }
    if (window.ChatreUX && window.ChatreUX.openSettings) {
      window.ChatreUX.openSettings();
    }
    if (sel) {
      setTimeout(function () {
        var el = document.querySelector(sel);
        if (el && el.focus) el.focus();
      }, 80);
    }
  }

  function companionStartCommand() {
    var os =
      (window.ChatrePwa &&
        window.ChatrePwa.detectPlatform &&
        window.ChatrePwa.detectPlatform().os) ||
      "linux";
    if (window.ChatrePwa && window.ChatrePwa.companionInstall) {
      var guide = window.ChatrePwa.companionInstall(os);
      if (guide && guide.command) return guide.command;
    }
    return (
      "CHATRE_API_BASE=https://chatre-api.vercel.app CHATRE_API_TOKEN=YOUR_TOKEN npm run companion:start"
    );
  }

  function copyCompanionCmd() {
    var cmd = companionStartCommand();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(
        function () {
          if (kit()) kit().toast("Companion start command copied", "success");
          else window.alert(cmd);
        },
        function () {
          window.alert(cmd);
        },
      );
    } else {
      window.alert(cmd);
    }
  }

  function paintAccount() {
    var summary = $("account-menu-summary");
    var emailEl = $("account-menu-email");
    var signedIn = $("account-menu-signed-in");
    var signedOut = $("account-menu-signed-out");
    var avatar = $("account-menu-avatar");
    var user =
      window.ChatreAuth && window.ChatreAuth.isSignedIn()
        ? window.ChatreAuth.currentUser()
        : null;
    var label = user ? user.email || user.uid || "Account" : "Sign in";
    if (summary) {
      var text = summary.querySelector(".account-label");
      if (text) text.textContent = user ? String(label).split("@")[0] : "Account";
      else summary.setAttribute("data-tip", label);
    }
    if (avatar) {
      var letter = user && label ? String(label).charAt(0).toUpperCase() : "?";
      avatar.textContent = letter;
      avatar.classList.toggle("signed-in", !!user);
    }
    if (emailEl) emailEl.textContent = user ? label : "";
    if (signedIn) signedIn.hidden = !user;
    if (signedOut) signedOut.hidden = !!user;
  }

  function paintModelNote() {
    var note = $("settings-model-current");
    var sel = $("model-select");
    if (!note || !sel) return;
    var opt = sel.options[sel.selectedIndex];
    note.textContent = "Current: " + (opt ? opt.textContent : sel.value);
  }

  function syncPanelButtons() {
    var shell = document.querySelector(".app-shell");
    if (!shell) return;
    var map = [
      ["toggle-threads", "hide-threads", "show-threads"],
      ["toggle-files", "hide-files", "show-files"],
      ["toggle-browser", "hide-browser", "show-browser"],
    ];
    map.forEach(function (row) {
      var btn = $(row[0]);
      var bar = $(row[0] + "-bar");
      var hidden = shell.classList.contains(row[1]);
      var shown = shell.classList.contains(row[2]);
      var active = shown || !hidden;
      // Desktop uses hide-*; mobile uses show-*
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        active = shown;
      } else {
        active = !hidden;
      }
      [btn, bar].forEach(function (b) {
        if (!b) return;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
    var term = $("terminal-toggle");
    var panel = $("terminal-panel");
    if (term && panel) {
      var on = panel.style.display !== "none" && panel.style.display !== "";
      // terminal panel uses display none when hidden
      var visible = panel.style.display && panel.style.display !== "none";
      term.classList.toggle("active", visible);
      term.setAttribute("aria-pressed", visible ? "true" : "false");
    }
  }

  function wireStatusPills() {
    var api = $("api-status");
    if (api) {
      api.setAttribute("type", "button");
      api.addEventListener("click", function () {
        var bad = /bad|Sign in|Offline|Unauthorized|Local/i.test(
          api.className + " " + api.textContent,
        );
        if (bad || !(window.ChatreAuth && window.ChatreAuth.isSignedIn())) {
          openSettingsFocus("#auth-signin-email");
        } else {
          openSettingsFocus(null);
        }
      });
    }
    var companion = $("companion-status");
    if (companion) {
      companion.setAttribute("type", "button");
      companion.addEventListener("click", function () {
        if (/off|error|bad/i.test(companion.className + companion.textContent)) {
          copyCompanionCmd();
          if (window.ChatreComposer && window.ChatreComposer.setMode) {
            window.ChatreComposer.setMode("desktop");
          }
        } else if (kit()) {
          kit().toast("Desktop companion is online", "success");
        }
      });
    }
    var usage = $("usage-meter");
    if (usage) {
      usage.addEventListener("click", function () {
        openSettingsFocus("#model-select");
      });
    }
  }

  function wireAccountMenu() {
    var settingsBtn = $("account-open-settings");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", function () {
        closeAccount();
        openSettingsFocus(null);
      });
    }
    var settingsGuest = $("account-open-settings-guest");
    if (settingsGuest) {
      settingsGuest.addEventListener("click", function () {
        closeAccount();
        openSettingsFocus(null);
      });
    }
    var byokBtn = $("account-open-byok");
    if (byokBtn) {
      byokBtn.addEventListener("click", function () {
        closeAccount();
        openSettingsFocus("#byok-key");
      });
    }
    var pwaBtn = $("account-open-pwa");
    if (pwaBtn) {
      pwaBtn.addEventListener("click", function () {
        closeAccount();
        if (window.ChatrePwa && window.ChatrePwa.openInstallPanel) {
          window.ChatrePwa.openInstallPanel(true);
        } else {
          openSettingsFocus("#settings-pwa-section");
        }
      });
    }
    var signInBtn = $("account-sign-in");
    if (signInBtn) {
      signInBtn.addEventListener("click", function () {
        closeAccount();
        if (window.ChatreAuthGate && window.ChatreAuthGate.open) {
          window.ChatreAuthGate.open({ tab: "signin" });
        } else {
          openSettingsFocus("#auth-signin-email");
        }
      });
    }
    var signOutBtn = $("account-sign-out");
    if (signOutBtn) {
      signOutBtn.addEventListener("click", async function () {
        closeAccount();
        if (window.ChatreAuth && window.ChatreAuth.signOut) {
          try {
            await window.ChatreAuth.signOut();
            if (kit()) kit().toast("Signed out", "success");
          } catch (e) {
            if (kit()) kit().toast(e.message || "Sign out failed", "error");
          }
        }
      });
    }
    document.addEventListener("click", function (e) {
      var menu = $("account-menu");
      if (!menu || !menu.open) return;
      if (!menu.contains(e.target)) menu.open = false;
    });
  }

  function closeAccount() {
    var menu = $("account-menu");
    if (menu) menu.open = false;
  }

  function wireOverflow() {
    var btn = $("toolbar-overflow");
    var more = document.querySelector("#app-toolbar .toolbar-more");
    if (btn && more) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        more.open = !more.open;
        more.classList.toggle("force-open", more.open);
      });
      more.addEventListener("toggle", function () {
        more.classList.toggle("force-open", more.open);
      });
    }
  }

  function observeShell() {
    var shell = document.querySelector(".app-shell");
    if (!shell || typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function () {
      syncPanelButtons();
    });
    mo.observe(shell, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    wireStatusPills();
    wireAccountMenu();
    wireOverflow();
    paintAccount();
    paintModelNote();
    syncPanelButtons();
    observeShell();

    var model = $("model-select");
    if (model) {
      model.addEventListener("change", paintModelNote);
    }

    if (window.ChatreAuth && window.ChatreAuth.onChange) {
      window.ChatreAuth.onChange(function () {
        paintAccount();
      });
    }

    var term = $("terminal-toggle");
    if (term) {
      term.addEventListener("click", function () {
        setTimeout(syncPanelButtons, 0);
      });
    }

    ["toggle-threads", "toggle-files", "toggle-browser"].forEach(function (id) {
      var b = $(id);
      if (b) {
        b.addEventListener("click", function () {
          setTimeout(syncPanelButtons, 0);
        });
      }
    });

    if (kit()) {
      kit().refreshIcons(document.getElementById("app-toolbar") || document.body);
    }
  }

  window.ChatreToolbar = {
    init: init,
    paintAccount: paintAccount,
    paintModelNote: paintModelNote,
    syncPanelButtons: syncPanelButtons,
    openSettingsFocus: openSettingsFocus,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
