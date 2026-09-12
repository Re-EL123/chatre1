/**
 * Client agent registry — mirrors API named agents + custom list.
 */
(function () {
  "use strict";

  var KEY = "chatre.activeAgent";
  var KEY_THOROUGH = "chatre.exploreThoroughness";
  var cache = { agents: [], loadedAt: 0 };

  function getActive() {
    try {
      return localStorage.getItem(KEY) || "build";
    } catch (e) {
      return "build";
    }
  }

  function setActive(name) {
    var n = String(name || "build");
    try {
      localStorage.setItem(KEY, n);
    } catch (e) {
      /* ignore */
    }
    syncUi();
    return n;
  }

  function getThoroughness() {
    try {
      return localStorage.getItem(KEY_THOROUGH) || "medium";
    } catch (e) {
      return "medium";
    }
  }

  function setThoroughness(v) {
    var n = String(v || "medium");
    try {
      localStorage.setItem(KEY_THOROUGH, n);
    } catch (e) {
      /* ignore */
    }
    return n;
  }

  function composerModeToAgent(mode) {
    var m = String(mode || "").toLowerCase();
    if (m === "plan") return "plan";
    if (m === "explore") return "explore";
    return getActive();
  }

  async function refresh() {
    if (!window.ChatreRemote || !window.ChatreRemote.enabled || !window.ChatreRemote.enabled()) {
      cache.agents = [
        { name: "build", description: "Orchestrator — explore/build/verify", native: true },
        { name: "plan", description: "Plan only — no edits", native: true },
        { name: "explore", description: "Read-only search", native: true },
        { name: "general", description: "General subagent slice", native: true },
        { name: "verify", description: "Preview/debug ownership", native: true },
      ];
      syncUi();
      return cache.agents;
    }
    try {
      var data = await window.ChatreRemote.listAgents();
      cache.agents = (data && data.agents) || [];
      cache.loadedAt = Date.now();
      syncUi();
      return cache.agents;
    } catch (e) {
      return cache.agents;
    }
  }

  function syncUi() {
    var sel = document.getElementById("agent-select");
    if (!sel) return;
    var active = getActive();
    var agents = cache.agents.length
      ? cache.agents
      : [
          { name: "build", native: true },
          { name: "plan", native: true },
          { name: "explore", native: true },
        ];
    sel.innerHTML = agents
      .filter(function (a) {
        return a && !a.hidden;
      })
      .map(function (a) {
        return (
          '<option value="' +
          a.name +
          '"' +
          (a.name === active ? " selected" : "") +
          ">" +
          a.name +
          (a.native ? "" : " ★") +
          "</option>"
        );
      })
      .join("");
    sel.value = active;
    var th = document.getElementById("explore-thoroughness");
    if (th) {
      th.hidden = active !== "explore";
      th.value = getThoroughness();
    }
  }

  function bind() {
    var sel = document.getElementById("agent-select");
    if (sel && !sel._bound) {
      sel._bound = true;
      sel.addEventListener("change", function () {
        setActive(sel.value);
      });
    }
    var th = document.getElementById("explore-thoroughness");
    if (th && !th._bound) {
      th._bound = true;
      th.addEventListener("change", function () {
        setThoroughness(th.value);
      });
    }
    var genBtn = document.getElementById("agent-generate-btn");
    var genInput = document.getElementById("agent-generate-input");
    if (genBtn && !genBtn._bound) {
      genBtn._bound = true;
      genBtn.addEventListener("click", async function () {
        var desc = (genInput && genInput.value) || "";
        if (!desc.trim()) {
          if (window.ChatreKit && window.ChatreKit.toast) {
            window.ChatreKit.toast("Describe the agent first", "warn");
          }
          return;
        }
        genBtn.disabled = true;
        try {
          var res = await window.ChatreRemote.generateAgent(desc);
          await refresh();
          if (res && res.agent && res.agent.name) setActive(res.agent.name);
          if (window.ChatreKit && window.ChatreKit.toast) {
            window.ChatreKit.toast(
              "Created agent " + ((res.agent && res.agent.name) || ""),
              "success",
            );
          }
          if (genInput) genInput.value = "";
        } catch (e) {
          if (window.ChatreKit && window.ChatreKit.toast) {
            window.ChatreKit.toast(e.message || String(e), "error");
          } else {
            alert(e.message || e);
          }
        } finally {
          genBtn.disabled = false;
        }
      });
    }
    syncUi();
    refresh();
  }

  window.ChatreAgents = {
    getActive: getActive,
    setActive: setActive,
    getThoroughness: getThoroughness,
    setThoroughness: setThoroughness,
    composerModeToAgent: composerModeToAgent,
    refresh: refresh,
    bind: bind,
    list: function () {
      return cache.agents.slice();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
