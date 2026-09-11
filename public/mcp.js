/**
 * Chatre MCP — Model Context Protocol connector registry, client, and
 * Worker-proxied calls. Everything runs in the browser; CORS-safe calls
 * go through the Chatre Worker at /api/mcp.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "chatre_mcp_connections";

  // ── Public connector registry ───────────────────────────────────────────
  const REGISTRY = [
    {
      uuid: "github",
      name: "GitHub",
      description: "Issues, pull requests, repos, search code",
      keywords: ["github", "repo", "pull request", "issue", "code"],
      endpoint: "https://api.github.com",
    },
    {
      uuid: "notion",
      name: "Notion",
      description: "Pages, databases, search, task lists",
      keywords: ["notion", "page", "database", "wiki", "task"],
      endpoint: "https://api.notion.com",
    },
    {
      uuid: "slack",
      name: "Slack",
      description: "Channels, messages, search, threads",
      keywords: ["slack", "channel", "message", "dm", "thread"],
      endpoint: "https://slack.com/api",
    },
    {
      uuid: "jira",
      name: "Jira",
      description: "Projects, issues, sprints, boards",
      keywords: ["jira", "issue", "sprint", "board", "ticket", "atlassian"],
      endpoint: "https://your-domain.atlassian.net/rest/api/3",
    },
    {
      uuid: "linear",
      name: "Linear",
      description: "Issues, projects, cycles, teams",
      keywords: ["linear", "issue", "project", "cycle", "team"],
      endpoint: "https://api.linear.app/graphql",
    },
    {
      uuid: "asana",
      name: "Asana",
      description: "Tasks, projects, workspaces, sections",
      keywords: ["asana", "task", "project", "workspace"],
      endpoint: "https://app.asana.com/api/1.0",
    },
    {
      uuid: "google_drive",
      name: "Google Drive",
      description: "Files, folders, search, documents",
      keywords: ["google drive", "drive", "file", "document", "gdrive"],
      endpoint: "https://www.googleapis.com/drive/v3",
    },
    {
      uuid: "trello",
      name: "Trello",
      description: "Boards, cards, lists, checklists",
      keywords: ["trello", "board", "card", "list"],
      endpoint: "https://api.trello.com/1",
    },
    {
      uuid: "gitlab",
      name: "GitLab",
      description: "Repos, issues, merge requests, pipelines",
      keywords: ["gitlab", "repo", "merge request", "pipeline", "ci"],
      endpoint: "https://gitlab.com/api/v4",
    },
    {
      uuid: "airtable",
      name: "Airtable",
      description: "Bases, tables, records, views",
      keywords: ["airtable", "base", "table", "record", "database"],
      endpoint: "https://api.airtable.com/v0",
    },
    {
      uuid: "figma",
      name: "Figma",
      description: "Files, components, comments, design tokens",
      keywords: ["figma", "design", "component", "file"],
      endpoint: "https://api.figma.com/v1",
    },
    {
      uuid: "calendly",
      name: "Calendly",
      description: "Events, scheduling, availability",
      keywords: ["calendly", "schedule", "event", "meeting", "calendar"],
      endpoint: "https://api.calendly.com",
    },
  ];

  // ── Persisted connections ───────────────────────────────────────────────
  function loadConnections() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveConnections(conn) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
    } catch { /* quota */ }
  }

  function connect(uuid) {
    const reg = REGISTRY.find(function (r) { return r.uuid === uuid; });
    if (!reg) return null;
    const conn = loadConnections();
    conn[uuid] = {
      name: reg.name,
      endpoint: reg.endpoint,
      connectedAt: new Date().toISOString(),
      tools: [],
    };
    saveConnections(conn);
    return conn[uuid];
  }

  function disconnect(uuid) {
    const conn = loadConnections();
    delete conn[uuid];
    saveConnections(conn);
  }

  function listConnected() {
    const conn = loadConnections();
    return Object.keys(conn).map(function (uuid) {
      return { uuid: uuid, name: conn[uuid].name, connectedAt: conn[uuid].connectedAt };
    });
  }

  // ── Search ──────────────────────────────────────────────────────────────
  function search(query) {
    var q = String(query || "").toLowerCase().trim();
    if (!q) return REGISTRY.map(toSummary);
    var terms = q.split(/[\s,]+/).filter(Boolean);
    var scored = REGISTRY.map(function (r) {
      var score = 0;
      var hay = (r.name + " " + r.description + " " + r.keywords.join(" ")).toLowerCase();
      terms.forEach(function (t) {
        if (hay.indexOf(t) !== -1) score += 1;
        if (r.name.toLowerCase().indexOf(t) !== -1) score += 2;
        if (r.keywords.indexOf(t) !== -1) score += 3;
      });
      return { reg: r, score: score };
    }).filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    var conn = loadConnections();
    return scored.map(function (s) {
      return {
        uuid: s.reg.uuid,
        name: s.reg.name,
        description: s.reg.description,
        connected: !!conn[s.reg.uuid],
      };
    });
  }

  function toSummary(r) {
    var conn = loadConnections();
    return {
      uuid: r.uuid,
      name: r.name,
      description: r.description,
      connected: !!conn[r.uuid],
    };
  }

  // ── Worker-proxied MCP call ─────────────────────────────────────────────
  async function callMCP(uuid, tool, args) {
    var conn = loadConnections();
    var entry = conn[uuid];
    if (!entry) return { ok: false, error: "Not connected to " + uuid + ". Call suggest_connectors first." };
    var headers = window.ChatreCore && window.ChatreCore.authHeaders
      ? window.ChatreCore.authHeaders()
      : {};
    try {
      var res = await fetch("/api/mcp", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        body: JSON.stringify({
          endpoint: entry.endpoint,
          tool: tool,
          arguments: args || {},
        }),
      });
      var data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || ("MCP call failed " + res.status) };
      return { ok: true, result: data.result || data };
    } catch (e) {
      return { ok: false, error: "MCP call failed: " + (e.message || String(e)) };
    }
  }

  // ── List tools from a connected server (cached or fetched) ──────────────
  async function listTools(uuid) {
    var conn = loadConnections();
    var entry = conn[uuid];
    if (!entry) return { ok: false, error: "Not connected to " + uuid };
    // Attempt to discover tools via the MCP tools/list method
    try {
      var res = await fetch("/api/mcp", {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json" },
          window.ChatreCore && window.ChatreCore.authHeaders ? window.ChatreCore.authHeaders() : {},
        ),
        body: JSON.stringify({ endpoint: entry.endpoint, method: "tools/list", arguments: {} }),
      });
      var data = await res.json();
      if (res.ok && data.result) {
        entry.tools = Array.isArray(data.result.tools) ? data.result.tools : [];
        saveConnections(conn);
        return { ok: true, tools: entry.tools };
      }
    } catch { /* ignore */ }
    // Fallback: no tools discovered
    return { ok: true, tools: [], note: "Could not discover tools from " + uuid + " server." };
  }

  // ── Public API ──────────────────────────────────────────────────────────
  window.ChatreMCP = {
    REGISTRY: REGISTRY,
    search: search,
    connect: connect,
    disconnect: disconnect,
    listConnected: listConnected,
    call: callMCP,
    listTools: listTools,
  };
})();
