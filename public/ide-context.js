/**
 * Client Layer (Secret Stack Layer 1) — editor context for Chatre IDE.
 * Feeds active file / tabs / selection into Layer 2 RAG pack + agent/complete.
 * API surface stays ≤12: workspace?action=context|index and chat mode=complete|edit.
 */
(function () {
  "use strict";

  var state = {
    selection: "",
    cursor: null,
    language: "",
  };

  function panels() {
    return window.ChatrePanels && window.ChatrePanels.state
      ? window.ChatrePanels.state
      : null;
  }

  function workspaceId() {
    var ps = panels();
    if (ps && ps.workspaceId) return ps.workspaceId;
    try {
      if (window.__chatreRemoteState && window.__chatreRemoteState.workspaceId) {
        return window.__chatreRemoteState.workspaceId;
      }
    } catch (e) {}
    try {
      return localStorage.getItem("chatre_workspace_id") || "";
    } catch (e2) {
      return "";
    }
  }

  function activeContent() {
    var ps = panels();
    var path = ps && ps.selectedPath;
    if (
      path &&
      window.ChatreMonaco &&
      window.ChatreMonaco.getValue &&
      window.ChatreMonaco.currentPath === path
    ) {
      try {
        return window.ChatreMonaco.getValue(path) || "";
      } catch (e) {}
    }
    if (!path || !ps.files || !ps.files[path]) return "";
    var f = ps.files[path];
    return f && f.content != null ? String(f.content) : "";
  }

  function snapshot() {
    var ps = panels();
    return {
      workspaceId: workspaceId(),
      activeFile: (ps && ps.selectedPath) || "",
      openFiles: (ps && ps.openTabs && ps.openTabs.slice(0, 16)) || [],
      selection: state.selection || "",
      cursor: state.cursor,
      language: state.language || guessLang((ps && ps.selectedPath) || ""),
      content: activeContent(),
    };
  }

  function guessLang(path) {
    var m = String(path || "").match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : "";
  }

  function setSelection(text, cursor, language) {
    state.selection = String(text || "").slice(0, 8000);
    if (cursor) state.cursor = cursor;
    if (language) state.language = language;
  }

  function wireViewer() {
    var viewer = document.getElementById("file-viewer");
    if (!viewer || viewer.__chatreContextWired) return;
    viewer.__chatreContextWired = true;
    function sync() {
      try {
        if (window.ChatreMonaco && window.ChatreMonaco.getSelection) {
          var msel = window.ChatreMonaco.getSelection();
          if (msel) {
            setSelection(
              msel,
              null,
              guessLang((panels() && panels().selectedPath) || ""),
            );
            return;
          }
        }
        var sel = window.getSelection && window.getSelection();
        if (!sel || sel.isCollapsed || !viewer.contains(sel.anchorNode)) {
          return;
        }
        setSelection(sel.toString(), null, guessLang(
          (panels() && panels().selectedPath) || "",
        ));
      } catch (e) {}
    }
    document.addEventListener("selectionchange", sync);
    viewer.addEventListener("mouseup", sync);
  }

  async function ensureIndex(id) {
    if (!window.ChatreRemote || !window.ChatreRemote.indexWorkspace) return null;
    var wid = id || workspaceId();
    if (!wid) return null;
    return window.ChatreRemote.indexWorkspace(wid);
  }

  async function fetchPack(query) {
    if (!window.ChatreRemote || !window.ChatreRemote.getContextPack) return null;
    var snap = snapshot();
    if (!snap.workspaceId) return null;
    return window.ChatreRemote.getContextPack(snap.workspaceId, {
      query: query || snap.activeFile || "",
      activeFile: snap.activeFile,
      openFiles: snap.openFiles,
      selection: snap.selection,
      cursor: snap.cursor,
    });
  }

  async function completeAtEnd(opts) {
    if (!window.ChatreRemote || !window.ChatreRemote.chatComplete) {
      throw new Error("Remote complete unavailable");
    }
    var snap = snapshot();
    var content = snap.content || "";
    var prefix =
      (opts && opts.prefix) ||
      (snap.selection ? snap.selection : content.slice(-4000));
    return window.ChatreRemote.chatComplete({
      prefix: prefix,
      suffix: (opts && opts.suffix) || "",
      language: (opts && opts.language) || snap.language,
      workspaceId: snap.workspaceId,
      activeFile: snap.activeFile,
      openFiles: snap.openFiles,
      selection: snap.selection,
      cursor: snap.cursor,
      model: opts && opts.model,
    });
  }

  function toast(msg, kind) {
    if (window.ChatreKit && window.ChatreKit.toast) {
      window.ChatreKit.toast(msg, kind || "success");
    }
  }

  function wireButtons() {
    var idxBtn = document.getElementById("ide-context-index");
    if (idxBtn && !idxBtn.__wired) {
      idxBtn.__wired = true;
      idxBtn.addEventListener("click", function () {
        ensureIndex()
          .then(function (data) {
            toast(
              "Indexed " +
                ((data && data.chunkCount) || 0) +
                " chunks / " +
                ((data && data.fileCount) || 0) +
                " files",
              "success",
            );
          })
          .catch(function (e) {
            toast(String((e && e.message) || e), "error");
          });
      });
    }
    var cBtn = document.getElementById("ide-context-complete");
    if (cBtn && !cBtn.__wired) {
      cBtn.__wired = true;
      cBtn.addEventListener("click", function () {
        completeAtEnd()
          .then(function (data) {
            var text = (data && (data.response || data.text)) || "";
            if (!text) {
              toast("Empty completion", "error");
              return;
            }
            console.log("Chatre complete:", text);
            toast("Completion ready — see console / apply manually for now", "success");
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
              }
            } catch (e) {}
          })
          .catch(function (e) {
            toast(String((e && e.message) || e), "error");
          });
      });
    }
  }

  function init() {
    wireViewer();
    wireButtons();
  }

  window.ChatreIdeContext = {
    init: init,
    snapshot: snapshot,
    setSelection: setSelection,
    ensureIndex: ensureIndex,
    fetchPack: fetchPack,
    complete: completeAtEnd,
    wireViewer: wireViewer,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
