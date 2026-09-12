/**
 * Chatre PWA — installable app, OS/device detection, permission prompts.
 */
(function () {
  "use strict";

  var deferredPrompt = null;
  var PERM_KEYS = [
    "microphone",
    "notifications",
    "clipboard-write",
    "clipboard-read",
    "persistent-storage",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    var platform = navigator.platform || "";
    var touch = navigator.maxTouchPoints > 1;
    var isIpadOs =
      /Macintosh/i.test(ua) && touch && !/Windows/i.test(ua);
    var os = "unknown";
    if (/Android/i.test(ua)) os = "android";
    else if (/iPhone|iPod/i.test(ua) || isIpadOs || /iPad/i.test(ua)) os = "ios";
    else if (/Windows/i.test(ua) || /Win/i.test(platform)) os = "windows";
    else if (/CrOS/i.test(ua)) os = "chromeos";
    else if (/Mac/i.test(platform) || /Mac OS/i.test(ua)) os = "macos";
    else if (/Linux/i.test(ua) || /Linux/i.test(platform)) os = "linux";

    var browser = "other";
    if (/Edg\//i.test(ua)) browser = "edge";
    else if (/SamsungBrowser/i.test(ua)) browser = "samsung";
    else if (/Firefox|FxiOS/i.test(ua)) browser = "firefox";
    else if (/CriOS/i.test(ua) || (/Chrome/i.test(ua) && !/Edg\//i.test(ua)))
      browser = "chrome";
    else if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua)) browser = "safari";

    var device = "desktop";
    if (os === "android" || os === "ios") {
      device = /iPad|Tablet|PlayBook/i.test(ua) || isIpadOs ? "tablet" : "mobile";
    } else if (touch && Math.min(screen.width, screen.height) < 900) {
      device = "tablet";
    }

    var standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      document.referrer.indexOf("android-app://") === 0;

    return {
      os: os,
      browser: browser,
      device: device,
      standalone: standalone,
      canInstallPrompt: false,
      ua: ua,
      label: deviceLabel(os, device, browser),
    };
  }

  function deviceLabel(os, device, browser) {
    var osName = {
      ios: "iOS / iPadOS",
      android: "Android",
      windows: "Windows",
      macos: "macOS",
      linux: "Linux",
      chromeos: "ChromeOS",
      unknown: "this device",
    }[os] || "this device";
    var browserName = {
      chrome: "Chrome",
      safari: "Safari",
      edge: "Edge",
      firefox: "Firefox",
      samsung: "Samsung Internet",
      other: "your browser",
    }[browser] || "your browser";
    return osName + " · " + device + " · " + browserName;
  }

  function installGuide(info) {
    if (info.standalone) {
      return {
        title: "Already installed",
        steps: [
          "Chatre is running as an installed app on this device.",
          "You can manage permissions below so agents can use mic, notifications, and clipboard.",
        ],
        canPrompt: false,
      };
    }
    if (info.os === "ios") {
      return {
        title: "Install on iPhone / iPad",
        steps: [
          "Open this site in Safari (required on iOS).",
          "Tap the Share button.",
          "Scroll and tap “Add to Home Screen”.",
          "Confirm “Add” — Chatre opens fullscreen like a native app.",
        ],
        canPrompt: false,
      };
    }
    if (info.os === "android") {
      if (info.browser === "chrome" || info.browser === "edge" || info.browser === "samsung") {
        return {
          title: "Install on Android",
          steps: [
            "Tap Install below when available, or open the browser menu (⋮).",
            "Choose “Install app” / “Add to Home screen”.",
            "Open Chatre from your home screen for the full app experience.",
          ],
          canPrompt: true,
        };
      }
      return {
        title: "Install on Android",
        steps: [
          "Open this page in Chrome or Edge for the best install flow.",
          "Use the browser menu → “Install app” or “Add to Home screen”.",
        ],
        canPrompt: false,
      };
    }
    if (info.browser === "chrome" || info.browser === "edge") {
      return {
        title: "Install on " + (info.os === "macos" ? "Mac" : info.os === "windows" ? "Windows" : "desktop"),
        steps: [
          "Click Install below (or the install icon in the address bar).",
          "Confirm to add Chatre as a desktop app.",
          "Launch from your dock / Start menu — it runs in its own window.",
        ],
        canPrompt: true,
      };
    }
    if (info.browser === "safari" && info.os === "macos") {
      return {
        title: "Install on Mac (Safari)",
        steps: [
          "In Safari, open File → Add to Dock (or Share → Add to Dock).",
          "Or switch to Chrome/Edge for a one-click Install button.",
        ],
        canPrompt: false,
      };
    }
    if (info.browser === "firefox") {
      return {
        title: "Firefox on " + info.os,
        steps: [
          "Firefox has limited PWA install support on this OS.",
          "Use Chrome or Edge for one-click install, or bookmark this page.",
          "Permissions (mic / notifications) still work here once granted.",
        ],
        canPrompt: false,
      };
    }
    return {
      title: "Install Chatre",
      steps: [
        "Use Chrome or Edge for the easiest install.",
        "Look for Install / Add to Home Screen in the browser menu.",
      ],
      canPrompt: !!deferredPrompt,
    };
  }

  function permissionState(name) {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve("unknown");
    }
    return navigator.permissions
      .query({ name: name })
      .then(function (r) {
        return r.state;
      })
      .catch(function () {
        return "unknown";
      });
  }

  async function snapshotPermissions() {
    var out = {};
    for (var i = 0; i < PERM_KEYS.length; i++) {
      out[PERM_KEYS[i]] = await permissionState(PERM_KEYS[i]);
    }
    if ("Notification" in window) {
      out.notifications = Notification.permission;
    }
    return out;
  }

  async function requestMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, error: "Microphone API not available in this browser." };
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      localStorage.setItem("chatre_perm_microphone", "granted");
      return { ok: true, state: "granted" };
    } catch (e) {
      localStorage.setItem("chatre_perm_microphone", "denied");
      return {
        ok: false,
        error: (e && e.message) || "Microphone permission denied",
        state: "denied",
      };
    }
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      return { ok: false, error: "Notifications not supported here." };
    }
    try {
      var perm = await Notification.requestPermission();
      localStorage.setItem("chatre_perm_notifications", perm);
      return { ok: perm === "granted", state: perm };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  async function requestClipboard() {
    // Clipboard write often needs a user gesture; read may require permission.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(
          (await navigator.clipboard.readText().catch(function () {
            return "";
          })) || " ",
        );
      }
      if (navigator.permissions) {
        try {
          await navigator.permissions.query({ name: "clipboard-write" });
        } catch (e) {
          /* ignore */
        }
      }
      localStorage.setItem("chatre_perm_clipboard", "granted");
      return { ok: true, state: "granted" };
    } catch (e) {
      return {
        ok: false,
        error:
          (e && e.message) ||
          "Clipboard blocked — try again from a button click, or allow clipboard in site settings.",
      };
    }
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) {
      return { ok: false, error: "Persistent storage not supported." };
    }
    try {
      var ok = await navigator.storage.persist();
      localStorage.setItem("chatre_perm_storage", ok ? "granted" : "prompt");
      return { ok: ok, state: ok ? "granted" : "prompt" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  /**
   * Ask for a bundle of permissions needed for full agent / voice / desktop flows.
   * Always call from a user gesture.
   */
  async function requestNeededPermissions(opts) {
    var o = opts || {};
    var results = {};
    var needMic = o.microphone !== false;
    var needNotify = o.notifications !== false;
    var needClip = o.clipboard !== false;
    var needStore = o.storage !== false;

    if (needMic) results.microphone = await requestMicrophone();
    if (needNotify) results.notifications = await requestNotifications();
    if (needClip) results.clipboard = await requestClipboard();
    if (needStore) results.storage = await requestPersistentStorage();

    localStorage.setItem("chatre_perms_asked", "1");
    renderPermissionUi();
    return results;
  }

  async function promptInstall() {
    var info = detectPlatform();
    if (info.standalone) {
      toast("Chatre is already installed on this device", "success");
      return { ok: true, already: true };
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      updateInstallButtons();
      if (choice && choice.outcome === "accepted") {
        toast("Installing Chatre…", "success");
        return { ok: true, outcome: "accepted" };
      }
      return { ok: false, outcome: (choice && choice.outcome) || "dismissed" };
    }
    openInstallPanel(true);
    toast("Follow the install steps for " + info.label, "info");
    return { ok: false, needManual: true, platform: info };
  }

  function toast(msg, kind) {
    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast(msg, kind || "info");
    }
  }

  function renderInstallGuide() {
    var box = $("pwa-install-guide");
    var title = $("pwa-install-title");
    var meta = $("pwa-device-meta");
    if (!box) return;
    var info = detectPlatform();
    info.canInstallPrompt = !!deferredPrompt;
    var guide = installGuide(info);
    if (meta) meta.textContent = info.label + (info.standalone ? " · installed" : "");
    if (title) title.textContent = guide.title;
    box.innerHTML = "";
    guide.steps.forEach(function (step, i) {
      var li = document.createElement("li");
      li.textContent = step;
      box.appendChild(li);
    });
    var installBtn = $("pwa-install-btn");
    if (installBtn) {
      installBtn.disabled = !!info.standalone;
      installBtn.hidden = !!info.standalone;
      installBtn.textContent = deferredPrompt
        ? "Install Chatre"
        : "Show install steps";
    }
  }

  function stateBadge(state) {
    var s = String(state || "unknown");
    var cls =
      s === "granted"
        ? "pwa-perm ok"
        : s === "denied"
          ? "pwa-perm bad"
          : "pwa-perm";
    return '<span class="' + cls + '">' + s + "</span>";
  }

  async function renderPermissionUi() {
    var list = $("pwa-perm-list");
    if (!list) return;
    var snap = await snapshotPermissions();
    var rows = [
      ["microphone", "Microphone", "Voice input in the composer"],
      ["notifications", "Notifications", "Agent / run alerts"],
      ["clipboard-write", "Clipboard", "Copy commands and results"],
      ["persistent-storage", "Local storage", "Keep drafts & offline shell"],
    ];
    list.innerHTML = rows
      .map(function (r) {
        return (
          '<div class="pwa-perm-row"><div><strong>' +
          r[1] +
          "</strong><span>" +
          r[2] +
          "</span></div>" +
          stateBadge(snap[r[0]]) +
          "</div>"
        );
      })
      .join("");
  }

  function updateInstallButtons() {
    var info = detectPlatform();
    ["pwa-install-toolbar", "pwa-install-btn"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (info.standalone) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
    });
    renderInstallGuide();
  }

  function openInstallPanel(focusPerms) {
    var drawer = $("settings-drawer");
    if (drawer) {
      drawer.classList.add("open");
      drawer.setAttribute("aria-hidden", "false");
    }
    var sec = $("settings-pwa-section");
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    renderInstallGuide();
    renderPermissionUi();
    if (focusPerms) {
      var btn = $("pwa-request-perms");
      if (btn) btn.focus();
    }
  }

  function maybeShowFirstRun() {
    if (localStorage.getItem("chatre_pwa_intro") === "1") return;
    if (detectPlatform().standalone) {
      localStorage.setItem("chatre_pwa_intro", "1");
      return;
    }
    setTimeout(function () {
      var banner = $("pwa-banner");
      if (banner) banner.hidden = false;
    }, 1800);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(function (reg) {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          }
          reg.addEventListener("updatefound", function () {
            var w = reg.installing;
            if (!w) return;
            w.addEventListener("statechange", function () {
              if (w.state === "installed" && navigator.serviceWorker.controller) {
                toast("Update ready — reload for the latest Chatre", "info");
              }
            });
          });
        })
        .catch(function () {
          /* ignore offline register failures */
        });
    });
  }

  function wireUi() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      updateInstallButtons();
      var banner = $("pwa-banner");
      if (banner && !detectPlatform().standalone) banner.hidden = false;
    });

    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      localStorage.setItem("chatre_pwa_intro", "1");
      var banner = $("pwa-banner");
      if (banner) banner.hidden = true;
      toast("Chatre installed", "success");
      updateInstallButtons();
      renderPermissionUi();
    });

    var toolbar = $("pwa-install-toolbar");
    if (toolbar) {
      toolbar.addEventListener("click", function () {
        promptInstall();
      });
    }
    var installBtn = $("pwa-install-btn");
    if (installBtn) {
      installBtn.addEventListener("click", function () {
        promptInstall();
      });
    }
    var req = $("pwa-request-perms");
    if (req) {
      req.addEventListener("click", async function () {
        req.disabled = true;
        try {
          var r = await requestNeededPermissions({});
          var denied = Object.keys(r).filter(function (k) {
            return r[k] && r[k].ok === false;
          });
          if (!denied.length) toast("Permissions ready for full tasks", "success");
          else toast("Some permissions were blocked — check site settings", "error");
        } finally {
          req.disabled = false;
        }
      });
    }
    var dismiss = $("pwa-banner-dismiss");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        localStorage.setItem("chatre_pwa_intro", "1");
        var banner = $("pwa-banner");
        if (banner) banner.hidden = true;
      });
    }
    var bannerInstall = $("pwa-banner-install");
    if (bannerInstall) {
      bannerInstall.addEventListener("click", function () {
        promptInstall();
      });
    }
    var bannerPerms = $("pwa-banner-perms");
    if (bannerPerms) {
      bannerPerms.addEventListener("click", function () {
        openInstallPanel(true);
      });
    }

    updateInstallButtons();
    renderPermissionUi();
    maybeShowFirstRun();
  }

  registerServiceWorker();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUi);
  } else {
    wireUi();
  }

  function companionInstall(os) {
    var api =
      "CHATRE_API_BASE=https://chatre-api.vercel.app CHATRE_API_TOKEN=YOUR_TOKEN";
    var o = String(os || (detectPlatform().os) || "linux").toLowerCase();
    if (o === "windows") {
      return {
        title: "Desktop companion on Windows",
        steps: [
          "Install Node.js 20+ from nodejs.org",
          "Open PowerShell in the chatre-api folder",
          "npm install",
          api + " npm run companion:start",
        ],
        command: api + " npm run companion:start",
      };
    }
    if (o === "macos") {
      return {
        title: "Desktop companion on macOS",
        steps: [
          "brew install node (if needed)",
          "cd chatre-api && npm install",
          api + " npm run companion:start",
        ],
        command: api + " npm run companion:start",
      };
    }
    return {
      title: "Desktop companion on Linux",
      steps: [
        "Install Node.js 20+",
        "cd chatre-api && npm install",
        api + " npm run companion:start",
      ],
      command: api + " npm run companion:start",
    };
  }

  window.ChatrePwa = {
    detectPlatform: detectPlatform,
    installGuide: installGuide,
    promptInstall: promptInstall,
    requestNeededPermissions: requestNeededPermissions,
    requestMicrophone: requestMicrophone,
    requestNotifications: requestNotifications,
    requestClipboard: requestClipboard,
    requestPersistentStorage: requestPersistentStorage,
    snapshotPermissions: snapshotPermissions,
    openInstallPanel: openInstallPanel,
    companionInstall: companionInstall,
  };
})();
