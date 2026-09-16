/**
 * Chatre Secret Stack — client mirror of the Cursor-class 3-layer architecture.
 * Layer 1: this IDE (panels / ide-context / diffs)
 * Layer 2: workspace?action=index|context (hybrid + priompt)
 * Layer 3: /api/agent (plan, critic, verify, worktrees)
 * Never adds API routes — headroom stays ≤12.
 */
(function () {
  "use strict";

  var LAYERS = [
    {
      id: 1,
      name: "Client IDE",
      role: "Tabs, diffs, diagnostics, selection",
    },
    {
      id: 2,
      name: "Context Engine",
      role: "Merkle index, hybrid search, Priompt pack",
    },
    {
      id: 3,
      name: "Cognitive & Execution",
      role: "Plan → execute → critic → verify",
    },
  ];

  var state = {
    lastIndex: null,
    lastPack: null,
  };

  function remote() {
    return window.ChatreRemote;
  }

  async function refreshIndex() {
    var r = remote();
    if (!r || !r.indexWorkspace || !r.enabled || !r.enabled()) return null;
    var wid =
      (window.ChatreIdeContext &&
        window.ChatreIdeContext.workspaceId &&
        window.ChatreIdeContext.workspaceId()) ||
      (window.__chatreRemote && window.__chatreRemote.workspaceId);
    if (!wid) return null;
    try {
      var res = await r.indexWorkspace(wid);
      state.lastIndex = res;
      paint();
      return res;
    } catch (e) {
      return null;
    }
  }

  async function fetchStack() {
    var r = remote();
    if (!r || !r.fetch || !r.enabled || !r.enabled()) return null;
    var wid =
      (window.__chatreRemote && window.__chatreRemote.workspaceId) || "";
    try {
      var path =
        "/api/workspace?action=stack" +
        (wid ? "&id=" + encodeURIComponent(wid) : "");
      var res = await r.fetch(path, { method: "GET" });
      return res;
    } catch (e) {
      return describeLocal();
    }
  }

  function describeLocal() {
    return {
      name: "Chatre Secret Stack",
      maxApiFunctions: 12,
      routesUsed: 10,
      headroom: 2,
      layers: LAYERS,
      index: state.lastIndex,
      protections: [
        "Plan + intent contract",
        "Strict diffs",
        "Worktrees",
        "Verify loop",
        "consistent_delivery skill",
      ],
    };
  }

  function paint() {
    var el = document.getElementById("stack-status");
    if (!el) return;
    var idx = state.lastIndex;
    if (idx && idx.ok) {
      el.hidden = false;
      el.setAttribute("data-idle", "0");
      el.textContent =
        "Stack · " +
        (idx.chunkCount || "?") +
        " chunks" +
        (idx.merkleRoot ? " · " + String(idx.merkleRoot).slice(0, 8) : "");
      el.className = "status-chip stack-status toolbar-pill ok";
      el.title =
        "Layer 2 index · engine " +
        (idx.engine || "v2") +
        (idx.merkleRoot ? " · merkle " + idx.merkleRoot : "");
    } else {
      el.textContent = "Stack · idle";
      el.className = "status-chip stack-status toolbar-pill";
      el.title = "Chatre Secret Stack — click to refresh index";
      el.hidden = true;
      el.setAttribute("data-idle", "1");
    }
    if (window.ChatreToolbar && window.ChatreToolbar.paintSystemChip) {
      window.ChatreToolbar.paintSystemChip();
    }
  }

  function init() {
    var el = document.getElementById("stack-status");
    if (el && !el.__stackBound) {
      el.__stackBound = true;
      el.addEventListener("click", function () {
        refreshIndex().then(function (res) {
          if (window.ChatreKit && window.ChatreKit.toast) {
            window.ChatreKit.toast(
              res && res.ok
                ? "Context index refreshed (" + (res.chunkCount || 0) + " chunks)"
                : "Index unavailable — sign in / open a workspace",
              res && res.ok ? "success" : "warn",
            );
          }
        });
      });
    }
    paint();
  }

  window.ChatreSecretStack = {
    LAYERS: LAYERS,
    describeLocal: describeLocal,
    fetchStack: fetchStack,
    refreshIndex: refreshIndex,
    paint: paint,
    init: init,
    state: state,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
