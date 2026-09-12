/**
 * Chatre client autonomy — Ask / Assist / Autopilot.
 */
(function () {
  "use strict";

  var KEY = "chatre_autonomy";
  var PREFER_BYOK_KEY = "chatre_prefer_byok";
  var LEVELS = ["ask", "assist", "autopilot"];

  function normalize(level) {
    var v = String(level || "assist").toLowerCase();
    return LEVELS.indexOf(v) >= 0 ? v : "assist";
  }

  function getAutonomy() {
    try {
      return normalize(localStorage.getItem(KEY) || "assist");
    } catch (e) {
      return "assist";
    }
  }

  function setAutonomy(level) {
    var v = normalize(level);
    try {
      localStorage.setItem(KEY, v);
    } catch (e) {
      /* ignore */
    }
    syncToServer({ autonomy: v });
    paintUi();
    return v;
  }

  function getPreferByok() {
    try {
      var raw = localStorage.getItem(PREFER_BYOK_KEY);
      if (raw == null) return true;
      return raw === "1" || raw === "true";
    } catch (e) {
      return true;
    }
  }

  function setPreferByok(on) {
    try {
      localStorage.setItem(PREFER_BYOK_KEY, on ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
    syncToServer({ preferByok: !!on });
    return !!on;
  }

  function syncToServer(partial) {
    if (!window.ChatreRemote || !window.ChatreRemote.enabled()) return;
    if (!window.ChatreRemote.hasAuth || !window.ChatreRemote.hasAuth()) return;
    if (!window.ChatreRemote.patchMe) return;
    var defaults = Object.assign({}, partial || {});
    window.ChatreRemote.patchMe({ defaults: defaults }).catch(function () {});
  }

  function applyFromProfile(user) {
    if (!user || !user.defaults) return;
    if (user.defaults.autonomy) {
      try {
        localStorage.setItem(KEY, normalize(user.defaults.autonomy));
      } catch (e) {
        /* ignore */
      }
    }
    if (user.defaults.preferByok != null) {
      try {
        localStorage.setItem(
          PREFER_BYOK_KEY,
          user.defaults.preferByok ? "1" : "0",
        );
      } catch (e) {
        /* ignore */
      }
    }
    paintUi();
  }

  function shouldSkipPlanApproval(taskType) {
    var level = getAutonomy();
    var t = String(taskType || "").toLowerCase();
    if (t === "chat") return true;
    if (level === "autopilot") return true;
    if (level === "assist") {
      return ["question", "document", "research", "browser"].indexOf(t) >= 0;
    }
    return false;
  }

  function shouldAutoResumeUi() {
    return getAutonomy() !== "ask";
  }

  function preferByokModel(model, byokFlags) {
    if (!getPreferByok()) return model;
    var raw = String(model || "");
    var isChatre =
      !raw ||
      raw.indexOf("@cf/") === 0 ||
      /^chatre:/i.test(raw) ||
      raw.indexOf(":") < 0;
    if (!isChatre) return raw;
    var flags = byokFlags || {};
    if (flags.openrouter) return "openrouter:openai/gpt-4o-mini";
    if (flags.openai) return "openai:gpt-4o-mini";
    if (flags.anthropic) return "anthropic:claude-3-5-haiku-latest";
    if (flags.google) return "google:gemini-2.0-flash";
    return raw;
  }

  function paintUi() {
    var sel = document.getElementById("autonomy-select");
    if (sel) sel.value = getAutonomy();
    var byok = document.getElementById("prefer-byok-toggle");
    if (byok) byok.checked = getPreferByok();
    var label = document.getElementById("autonomy-label");
    if (label) {
      var map = {
        ask: "Ask — approve plans & risky tools",
        assist: "Assist — plans for build/debug; auto elsewhere",
        autopilot: "Autopilot — skip plans, auto-resume, one critic repair",
      };
      label.textContent = map[getAutonomy()] || map.assist;
    }
  }

  function wireUi() {
    var sel = document.getElementById("autonomy-select");
    if (sel) {
      sel.value = getAutonomy();
      sel.addEventListener("change", function () {
        setAutonomy(sel.value);
        if (window.ChatreKit) {
          window.ChatreKit.toast("Autonomy: " + sel.value, "success");
        }
      });
    }
    var byok = document.getElementById("prefer-byok-toggle");
    if (byok) {
      byok.checked = getPreferByok();
      byok.addEventListener("change", function () {
        setPreferByok(byok.checked);
        if (window.ChatreAutonomy && window.ChatreAutonomy.applyByokPreference) {
          window.ChatreAutonomy.applyByokPreference();
        }
      });
    }
    paintUi();
  }

  function applyByokPreference() {
    var sel = document.getElementById("model-select");
    if (!sel || !getPreferByok()) return;
    var flags = (window.__chatreByokFlags) || {};
    var next = preferByokModel(sel.value, flags);
    if (next && next !== sel.value) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === next) {
          found = true;
          break;
        }
      }
      if (!found) {
        var opt = document.createElement("option");
        opt.value = next;
        opt.textContent = next;
        sel.appendChild(opt);
      }
      sel.value = next;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUi);
  } else {
    wireUi();
  }

  window.ChatreAutonomy = {
    LEVELS: LEVELS,
    get: getAutonomy,
    set: setAutonomy,
    getPreferByok: getPreferByok,
    setPreferByok: setPreferByok,
    applyFromProfile: applyFromProfile,
    shouldSkipPlanApproval: shouldSkipPlanApproval,
    shouldAutoResumeUi: shouldAutoResumeUi,
    preferByokModel: preferByokModel,
    applyByokPreference: applyByokPreference,
    paintUi: paintUi,
  };
})();
