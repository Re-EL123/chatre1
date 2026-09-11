/**
 * Chatre Agent Tools — tool definitions, JSON parsing, and execution.
 * Uses window.ChatreCore (bound by chat.js) for filesystem/history access.
 */
(function () {
  "use strict";

  const TOOL_DEFINITIONS = [
    { name: "todo", desc: "Manage todos (set|add|done|list)", params: { action: "string", items: "array", id: "string", content: "string" } },
    { name: "todo_write", desc: "Write/update todo list with statuses", params: { todos: "array" } },
    { name: "plan", desc: "Create a step-by-step plan before executing", params: { steps: "string" } },
    { name: "list_skills", desc: "List available agent skills", params: {} },
    { name: "use_skill", desc: "Load a skill playbook", params: { name: "string" } },
    { name: "tabs_create", desc: "Create a browser tab", params: { url: "string" } },
    { name: "navigate", desc: "Navigate tab to url (or back/forward)", params: { tab_id: "string", url: "string" } },
    { name: "computer", desc: "Click/type/key/scroll/screenshot in browser", params: { tab_id: "string", action: "string", coordinate: "array", ref: "string", text: "string" } },
    { name: "read_page", desc: "Read page element refs", params: { tab_id: "string", depth: "string", filter: "string" } },
    { name: "find", desc: "Find elements by natural language", params: { tab_id: "string", query: "string" } },
    { name: "form_input", desc: "Set form field by ref", params: { tab_id: "string", ref: "string", value: "string" } },
    { name: "get_page_text", desc: "Extract page plain text", params: { tab_id: "string" } },
    { name: "search_web", desc: "Keyword web search (max 3 queries)", params: { queries: "array", query: "string" } },
    { name: "http_request", desc: "HTTP request to a public URL", params: { url: "string", method: "string", body: "string" } },
    { name: "execute_command", desc: "Run a shell command in the workspace", params: { cmd: "string", cwd: "string" } },
    { name: "read_file", desc: "Read a file's contents", params: { path: "string" } },
    { name: "write_file", desc: "Create or overwrite a file", params: { path: "string", content: "string" } },
    { name: "append_file", desc: "Append content to a file", params: { path: "string", content: "string" } },
    { name: "list_directory", desc: "List a directory's contents", params: { path: "string" } },
    { name: "create_directory", desc: "Create a directory", params: { path: "string" } },
    { name: "delete_file", desc: "Delete a file or directory", params: { path: "string", recursive: "boolean" } },
    { name: "copy_file", desc: "Copy a file or directory", params: { src: "string", dest: "string" } },
    { name: "find_files", desc: "Find files by name pattern", params: { pattern: "string" } },
    { name: "search_code", desc: "Search file contents for text", params: { pattern: "string", path: "string" } },
    { name: "run_javascript", desc: "Execute JavaScript code", params: { code: "string" } },
    { name: "run_python", desc: "Execute Python code", params: { code: "string" } },
    { name: "create_document", desc: "Create a markdown document (saved + downloadable)", params: { title: "string", content: "string" } },
    { name: "create_pdf", desc: "Create a downloadable PDF file (Latin script text; use create_document for other scripts)", params: { title: "string", content: "string" } },
    { name: "export_document", desc: "Download an existing workspace file", params: { path: "string" } },
    { name: "verify_project", desc: "Sanity-check a project directory", params: { path: "string" } },
    { name: "view_tree", desc: "Show the workspace file tree", params: { path: "string" } },
    { name: "ask_user_input", desc: "Ask the user a question with tappable option buttons (2-4 short, mutually exclusive choices)", params: { question: "string", options: "array" } },
    { name: "search_mcp_registry", desc: "Search available MCP connectors (Jira, Slack, Notion, GitHub, …) by product or task", params: { query: "string", queries: "array" } },
    { name: "suggest_connectors", desc: "Present connector options to the user with Connect/Use buttons (pass directory UUIDs from search_mcp_registry)", params: { uuids: "array", question: "string" } },
    { name: "call_mcp", desc: "Call a tool on a connected MCP server (pass server uuid, tool name, arguments)", params: { server: "string", tool: "string", arguments: "object" } },
    { name: "list_mcp_tools", desc: "List the tools exposed by a connected MCP server", params: { server: "string" } },
    { name: "git_init", desc: "Initialize a git repository", params: {} },
    { name: "git_add", desc: "Stage a file for commit", params: { path: "string" } },
    { name: "git_commit", desc: "Commit staged changes", params: { message: "string" } },
    { name: "git_status", desc: "Show git status", params: {} },
    { name: "git_log", desc: "Show commit history", params: {} },
    { name: "git_push", desc: "Push commits to the simulated remote", params: { remote: "string", branch: "string" } },
  ];

  function core() {
    return window.ChatreCore || {};
  }

  function fs() {
    return core().fs || {};
  }

  function resolve(path) {
    return typeof core().resolve === "function" ? core().resolve(path) : (path || "");
  }

  function cwd() {
    return typeof core().cwd === "function" ? core().cwd() : "/home/user";
  }

  // ─── Parsing ──────────────────────────────────────────────────────

  /**
   * Extract structured tool calls from an assistant response.
   * Format: fenced code block tagged `tool`/`tool_call`/`agent` containing JSON.
   */
  function parseToolCalls(text) {
    const results = [];
    const blockRe = /```(?:tool|tool_call|agent|json)\s*\n?([\s\S]*?)```/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      const block = m[1].trim();
      parseBlock(block, results);
    }

    // Brace-balanced recovery for bare { "tool": ... } objects
    if (results.length === 0) {
      extractBalancedToolJson(String(text || ""), results);
    }
    return results;
  }

  function extractBalancedToolJson(text, results) {
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf('{"tool"', i);
      const start2 = text.indexOf('{ "tool"', i);
      let at = -1;
      if (start >= 0 && (start2 < 0 || start < start2)) at = start;
      else if (start2 >= 0) at = start2;
      if (at < 0) break;
      let depth = 0;
      let inStr = false;
      let esc = false;
      let end = -1;
      for (let j = at; j < text.length; j++) {
        const ch = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end > at) {
        parseBlock(text.slice(at, end + 1), results);
        i = end + 1;
      } else {
        i = at + 1;
      }
    }
  }

  function parseBlock(jsonText, results) {
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const n = normalize(item);
          if (n) results.push(n);
        });
      } else if (parsed && parsed.tool_calls) {
        parsed.tool_calls.forEach((item) => {
          const n = normalize(item);
          if (n) results.push(n);
        });
      } else {
        const n = normalize(parsed);
        if (n) results.push(n);
      }
    } catch (e) {
      extractBalancedToolJson(jsonText, results);
    }
  }

  function normalize(item) {
    if (!item) return null;
    if (item.function && item.function.name) {
      let params = {};
      const raw = item.function.arguments;
      if (typeof raw === "string") {
        try {
          params = JSON.parse(raw || "{}");
        } catch {
          params = {};
        }
      } else if (raw && typeof raw === "object") {
        params = raw;
      }
      return {
        tool: item.function.name,
        params,
        id: item.id || "tc_" + Math.random().toString(36).slice(2, 8),
      };
    }
    if (!item.tool && item.name) {
      item = { tool: item.name, params: item.arguments || item.params || item };
    }
    if (!item.tool) return null;
    let params = item.params;
    if (!params && item.arguments != null) {
      params =
        typeof item.arguments === "string"
          ? (function () {
              try {
                return JSON.parse(item.arguments);
              } catch {
                return {};
              }
            })()
          : item.arguments;
    }
    if (!params || typeof params !== "object") {
      params = {};
      Object.keys(item).forEach((k) => {
        if (k !== "tool" && k !== "id" && k !== "type" && k !== "function") {
          params[k] = item[k];
        }
      });
    }
    return {
      tool: item.tool,
      params,
      id: item.id || "tc_" + Math.random().toString(36).slice(2, 8),
    };
  }

  /** Strip tool blocks from assistant text for clean display. */
  function cleanResponseText(text) {
    return String(text || "")
      .replace(/```(?:tool|tool_call|agent|json)\s*\n?[\s\S]*?```/g, "")
      .replace(/^\s*<answer>\s*/im, "")
      .replace(/<\/answer>/gi, "")
      .replace(/<confirmation\b[^>]*\/?>/gi, "")
      .trim();
  }

  // ─── Execution ────────────────────────────────────────────────────

  async function executeTool(call, options) {
    const { tool, params } = call;
    const p = params || {};
    if (window.ChatreAllowlists && options && options.taskType) {
      const gate = window.ChatreAllowlists.assertToolAllowed(
        tool,
        options.taskType,
        options.toolsPriority,
      );
      if (!gate.ok) {
        return { ok: false, tool: tool, error: gate.error };
      }
    }
    const common = {
      onWrite: options && options.onWrite,
      onCommand: options && options.onCommand,
      onDocument: options && options.onDocument,
    };

    switch (tool) {
      case "plan":
        return { ok: true, tool, type: "plan", text: "Plan recorded: " + String(p.steps || "") };

      case "todo":
        return todoTool(p);

      case "todo_write":
        return todoWriteTool(p);

      case "list_skills":
        return listSkillsTool();

      case "use_skill":
        return useSkillTool(p.name);

      case "ask_user_input":
        return askUserInputTool(p.question, p.options);

      case "search_mcp_registry":
        return searchMcpRegistryTool(p.query || p.queries);

      case "suggest_connectors":
        return suggestConnectorsTool(p.uuids, p.question);

      case "call_mcp":
        return await callMcpTool(p.server, p.tool, p.arguments);

      case "list_mcp_tools":
        return await listMcpToolsTool(p.server);

      case "tabs_create":
      case "navigate":
      case "computer":
      case "read_page":
      case "find":
      case "form_input":
      case "get_page_text":
      case "search_web":
      case "browser_navigate":
      case "browser_click":
      case "browser_type":
      case "browser_press":
      case "browser_screenshot":
      case "browser_read":
      case "browser_content":
      case "browser_evaluate":
      case "browser_wait":
      case "browser_scroll":
      case "browser":
        return await browserTool(tool, p);

      case "http_request":
        return await httpRequestTool(p);

      case "execute_command":
        return executeCommand(p.cmd || p.command, p.cwd, common);

      case "read_file":
        return readFileTool(p.path || p.file);

      case "write_file":
        return writeFileTool(p.path || p.file, p.content, common);

      case "append_file":
        return appendFileTool(p.path || p.file, p.content, common);

      case "list_directory":
        return listDirTool(p.path);

      case "create_directory":
        return mkdirTool(p.path, common);

      case "delete_file":
        return deleteFileTool(p.path || p.file, p.recursive);

      case "copy_file":
        return copyFileTool(p.src || p.source, p.dest || p.destination);

      case "find_files":
        return findFilesTool(p.pattern || p.query || p.needle);

      case "search_code":
        return searchCodeTool(p.pattern || p.query || p.needle, p.path);

      case "run_javascript":
        return runJSTool(p.code || p.source);

      case "run_python":
        return runPyTool(p.code || p.source);

      case "create_document":
        return createDocTool(p.title, p.content, common);

      case "create_pdf":
        return await createPdfTool(p.title, p.content);

      case "export_document":
        return exportDocTool(p.path || p.file, common);

      case "verify_project":
        return verifyProjectTool(p.path);

      case "view_tree":
        return viewTreeTool(p.path);

      case "git_init":
        return gitTool("init", p, common);

      case "git_add":
        return gitTool("add", p, common);

      case "git_commit":
        return gitTool("commit", p, common);

      case "git_status":
        return gitTool("status", p, common);

      case "git_log":
        return gitTool("log", p, common);

      case "git_push":
        return gitTool("push", p, common);

      default:
        return { ok: false, tool, error: "Unknown tool: " + tool };
    }
  }

  // ─── Browser / HTTP (Worker /api/browser) ─────────────────────────

  let browserSessionId = "";
  let lastTabId = null;

  function mapLegacyTool(tool, p) {
    if (tool === "browser_navigate") return { tool: "navigate", params: p };
    if (tool === "browser_read" || tool === "browser_content")
      return { tool: "get_page_text", params: p };
    if (tool === "browser_screenshot")
      return { tool: "computer", params: Object.assign({}, p, { action: "screenshot" }) };
    if (tool === "browser_click")
      return {
        tool: "computer",
        params: Object.assign({}, p, { action: "left_click", selector: p.selector }),
      };
    if (tool === "browser_type")
      return {
        tool: "computer",
        params: Object.assign({}, p, { action: "type", text: p.text }),
      };
    if (tool === "browser_press")
      return {
        tool: "computer",
        params: Object.assign({}, p, { action: "key", text: p.key || p.text }),
      };
    if (tool === "browser_scroll")
      return {
        tool: "computer",
        params: Object.assign({}, p, {
          action: "scroll",
          scroll_parameters: { scroll_direction: "down", scroll_amount: 3 },
        }),
      };
    if (tool === "browser_wait")
      return { tool: "computer", params: Object.assign({}, p, { action: "wait" }) };
    if (tool === "browser_evaluate")
      return {
        tool: "computer",
        params: Object.assign({}, p, { action: "evaluate", text: p.script }),
      };
    if (tool === "browser") return { tool: p.action || "navigate", params: p };
    return { tool: tool, params: p };
  }

  async function browserTool(rawTool, rawParams) {
    const mapped = mapLegacyTool(rawTool, rawParams || {});
    const tool = mapped.tool;
    const p = mapped.params || {};

    const body = {
      tool: tool,
      session_id: browserSessionId || undefined,
      tab_id: p.tab_id != null ? Number(p.tab_id) : lastTabId != null ? lastTabId : undefined,
      url: p.url,
      query: p.query,
      queries: p.queries,
      ref: p.ref,
      value: p.value,
      text: p.text != null ? p.text : p.value,
      action: p.action,
      coordinate: p.coordinate || (p.x != null && p.y != null ? [Number(p.x), Number(p.y)] : undefined),
      depth: p.depth != null ? Number(p.depth) : undefined,
      filter: p.filter,
      ref_id: p.ref_id,
      scroll_parameters: p.scroll_parameters,
      actions: p.actions,
      fullPage: p.fullPage,
      selector: p.selector,
      key: p.key,
      script: p.script || p.code,
      ms: p.ms != null ? Number(p.ms) : undefined,
    };

    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(function () {
        return null;
      });
      if (!res.ok) {
        return {
          ok: false,
          tool: rawTool,
          error: (data && data.error) || "Browser HTTP " + res.status,
        };
      }
      if (data && data.session_id) browserSessionId = data.session_id;
      if (data && data.tab_id != null) lastTabId = data.tab_id;

      const out = Object.assign({ tool: rawTool }, data || {});
      if (out.screenshot_base64) {
        out.screenshot = {
          mime: out.mime || "image/jpeg",
          note: "Screenshot captured (base64 omitted from chat context)",
          bytesApprox: Math.floor((String(out.screenshot_base64).length * 3) / 4),
          id: out.id || "screenshot:1",
        };
        out.hasScreenshot = true;
        delete out.screenshot_base64;
      }
      if (out.text) out.text = String(out.text).slice(0, 12000);
      if (Array.isArray(out.elements) && out.elements.length > 80) {
        out.elements = out.elements.slice(0, 80);
      }
      return out;
    } catch (err) {
      return {
        ok: false,
        tool: rawTool,
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  function todoWriteTool(p) {
    const items = Array.isArray(p.todos) ? p.todos : [];
    return todoTool({
      action: "set",
      items: items.map(function (t, i) {
        const status = String((t && t.status) || "pending").toLowerCase();
        return {
          id: String((t && t.id) || "t" + (i + 1)),
          content: String((t && (t.content || t.active_form)) || ""),
          status: status === "completed" || status === "done" ? "done" : "pending",
        };
      }),
    });
  }

  async function httpRequestTool(p) {
    const url = String(p.url || "").trim();
    if (!url) return { ok: false, tool: "http_request", error: "url required" };
    try {
      const method = String(p.method || "GET").toUpperCase();
      const init = { method: method, headers: {} };
      if (p.headers && typeof p.headers === "object") {
        Object.keys(p.headers).forEach(function (k) {
          init.headers[k] = String(p.headers[k]);
        });
      }
      if (p.body != null && method !== "GET" && method !== "HEAD") {
        init.body = typeof p.body === "string" ? p.body : JSON.stringify(p.body);
        if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
          init.headers["Content-Type"] = "application/json";
        }
      }
      const res = await fetch(url, init);
      const text = await res.text();
      return {
        ok: res.ok,
        tool: "http_request",
        status: res.status,
        url: res.url || url,
        body: text.slice(0, 40000) + (text.length > 40000 ? "\n…[truncated]" : ""),
      };
    } catch (err) {
      return {
        ok: false,
        tool: "http_request",
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  // ─── Shell command ────────────────────────────────────────────────

  function executeCommand(cmd, cwdOverride, common) {
    const fileSys = fs();
    let curr = cwd();
    if (cwdOverride) {
      curr = resolve(cwdOverride) || curr;
    }
    const command = String(cmd || "").trim();
    if (!command) {
      return { ok: false, tool: "execute_command", error: "cmd/command required", output: "" };
    }
    if (common && common.onCommand) common.onCommand(command);

    const raw = shellCommand(command, fileSys, curr);
    if (typeof raw === "string") {
      const isErr =
        /: cannot access |: No such file|command not found|error:/i.test(raw);
      return {
        ok: !isErr,
        tool: "execute_command",
        output: raw,
        text: raw.slice(0, 500),
        error: isErr ? raw : null,
      };
    }
    return raw;
  }

  function shellCommand(cmd, fileSys, startCwd) {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1).join(" ");
    let out = "";

    switch (command) {
      case "ls":
      case "dir": {
        const target = rp(args || startCwd, fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) out = "ls: cannot access '" + (args || ".") + "': No such file or directory";
        else if (entry.type !== "dir") out = target.split("/").pop();
        else if (args === "-la" || args === "-a" || args === "-l") {
          out = entry.children
            .map((n) => {
              const cp = target === "/" ? "/" + n : target + "/" + n;
              const e = fileSys[cp];
              return (e && e.type === "dir" ? "d" : "-") + "rw-r--r--  chatre chatre  " + (e && e.content ? e.content.length : 0) + "  " + n;
            })
            .join("\n");
        } else out = entry.children.join("\n");
        break;
      }
      case "pwd":
        out = startCwd;
        break;
      case "cd": {
        const target = rp(args || "~", fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) out = "cd: no such file or directory: " + args;
        else if (entry.type !== "dir") out = "cd: not a directory: " + args;
        else {
          const c = core();
          if (typeof c.setCwd === "function") c.setCwd(target);
          out = "";
        }
        break;
      }
      case "echo":
        out = args;
        break;
      case "whoami":
        out = "chatre";
        break;
      case "cat": {
        if (!args) { out = "cat: missing file operand"; break; }
        const target = rp(args, fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) out = "cat: " + args + ": No such file or directory";
        else if (entry.type === "dir") out = "cat: " + args + ": Is a directory";
        else out = entry.content || "";
        break;
      }
      case "tree":
        out = treeOf(args || ".", fileSys, startCwd);
        break;
      case "grep": {
        const needle = args.split(/\s+/)[0];
        const hay = args.split(/\s+/).slice(1).join(" ");
        if (!needle) { out = "grep: search string empty"; break; }
        out = grepFn(needle, hay || ".", fileSys, startCwd);
        break;
      }
      case "find": {
        if (!args) { out = "find: usage find <name>"; break; }
        out = findFn(args, fileSys, startCwd).join("\n");
        break;
      }
      case "head": {
        const spec = args.trim().split(/\s+/).filter(Boolean);
        let n = 10;
        let file = "";
        for (let i = 0; i < spec.length; i++) {
          if (spec[i] === "-n" && spec[i + 1]) {
            n = parseInt(spec[i + 1], 10) || 10;
            i += 1;
          } else if (/^-n\d+$/i.test(spec[i])) {
            n = parseInt(spec[i].slice(2), 10) || 10;
          } else if (!file) {
            file = spec[i];
          }
        }
        if (!file) {
          out = "head: missing file";
          break;
        }
        const target = rp(file, fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) out = "head: " + file + ": No such file";
        else {
          const lines = (entry.content || "").split("\n").slice(0, n);
          out = lines.join("\n");
        }
        break;
      }
      case "wc": {
        const target = rp(args, fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) { out = "wc: " + args + ": No such file"; }
        else out = String((entry.content || "").split("\n").length) + " lines, " + String(entry.content.length) + " chars";
        break;
      }
      case "sort": {
        const target = rp(args.replace(/^\s*-r\s*/, ""), fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) { out = "sort: " + args + ": No such file"; }
        else out = (entry.content || "").split("\n").sort().join("\n");
        break;
      }
      case "touch": {
        const target = rp(args, fileSys, startCwd);
        const parent = target.replace(/\/[^/]+$/, "") || "/";
        const name = target.split("/").pop();
        if (!fileSys[parent] || fileSys[parent].type !== "dir") out = "touch: parent does not exist";
        else if (!fileSys[target]) {
          fileSys[target] = { type: "file", content: "" };
          if (!fileSys[parent].children.includes(name)) fileSys[parent].children.push(name);
        }
        break;
      }
      case "mkdir": {
        if (!args) { out = "mkdir: missing operand"; break; }
        const target = rp(args, fileSys, startCwd);
        const parent = target.replace(/\/[^/]+$/, "") || "/";
        if (!fileSys[parent] || fileSys[parent].type !== "dir") out = "mkdir: parent does not exist";
        else if (fileSys[target]) out = "mkdir: File exists";
        else {
          fileSys[target] = { type: "dir", children: [] };
          fileSys[parent].children.push(target.split("/").pop());
        }
        break;
      }
      case "rm": {
        const rec = /^-r/.test(args);
        const target = rp(args.replace(/^-r\s*/, ""), fileSys, startCwd);
        if (!fileSys[target]) out = "rm: No such file";
        else {
          rmRecursive(fileSys, target, rec);
          const parent = target.replace(/\/[^/]+$/, "") || "/";
          if (fileSys[parent]) {
            fileSys[parent].children = fileSys[parent].children.filter((c) => c !== target.split("/").pop());
          }
        }
        break;
      }
      case "git":
      case "git2":
        out = gitShell(args, fileSys);
        break;
      default:
        out = "command not found: " + command + "\nTry: ls, pwd, cat, echo, mkdir, touch, rm, grep, find, tree, git";
        break;
    }
    return out;
  }

  function rp(path, fileSys, startCwd) {
    if (!path || path === "~") return "/home/user";
    if (path === ".") return startCwd;
    if (path === "..") return startCwd.replace(/\/[^/]+$/, "") || "/";
    if (path.startsWith("~/")) path = "/home/user/" + path.slice(2);
    if (!path.startsWith("/")) path = startCwd + "/" + path;
    const parts = path.split("/").filter(Boolean);
    const resolved = [];
    for (const p of parts) {
      if (p === ".") continue;
      if (p === "..") resolved.pop();
      else resolved.push(p);
    }
    return "/" + resolved.join("/");
  }

  function rmRecursive(fileSys, target, recursive) {
    const entry = fileSys[target];
    if (!entry) return;
    if (entry.type === "dir" && entry.children.length === 0) {
      delete fileSys[target];
      return;
    }
    if (entry.type === "file") {
      delete fileSys[target];
      return;
    }
    if (entry.type === "dir" && !recursive) return;
    for (const child of entry.children.slice()) {
      const childPath = target === "/" ? "/" + child : target + "/" + child;
      rmRecursive(fileSys, childPath, true);
    }
    delete fileSys[target];
  }

  function treeOf(path, fileSys, startCwd) {
    const target = rp(path, fileSys, startCwd);
    const entry = fileSys[target];
    if (!entry) return "(missing)";
    if (entry.type === "file") return " - " + target.split("/").pop();
    const lines = [];
    const walk = (dirPath, indent, isLast) => {
      const dir = fileSys[dirPath];
      if (!dir || dir.type !== "dir") return;
      dir.children.forEach((child, i) => {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        const childEntry = fileSys[childPath];
        const last = i === dir.children.length - 1;
        const prefix = indent + (last ? "└── " : "├── ");
        if (childEntry && childEntry.type === "dir") {
          lines.push(prefix + child + "/");
          walk(childPath, indent + (last ? "    " : "│   "), false);
        } else {
          lines.push(prefix + child);
        }
      });
    };
    walk(target, "", true);
    return lines.join("\n");
  }

  function grepFn(needle, hay, fileSys, startCwd) {
    const target = rp(hay, fileSys, startCwd);
    const entry = fileSys[target];
    if (!entry) return "grep: " + hay + ": No such file";
    if (entry.type === "file") {
      return (entry.content || "").split("\n").filter((l) => l.includes(needle))
        .map((l) => resolve(target).replace(/^\/+/, "") + ":" + l).join("\n");
    }
    const results = [];
    const walk = (dirPath) => {
      const dir = fileSys[dirPath];
      if (!dir) return;
      for (const child of dir.children) {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        const childEntry = fileSys[childPath];
        if (!childEntry) continue;
        if (childEntry.type === "dir") walk(childPath);
        else if ((childEntry.content || "").includes(needle)) {
          results.push(childPath.replace(/^\/+/, "") + ": " + childEntry.content.split("\n").filter((l) => l.includes(needle))[0]);
        }
      }
    };
    walk(target);
    return results.join("\n");
  }

  function findFn(needle, fileSys, startCwd) {
    const results = [];
    const walk = (dirPath) => {
      const dir = fileSys[dirPath];
      if (!dir) return;
      for (const child of dir.children) {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        const childEntry = fileSys[childPath];
        if (!childEntry) continue;
        if (child.includes(needle)) results.push(childPath);
        if (childEntry.type === "dir") walk(childPath);
      }
    };
    walk(rp(startCwd, fileSys, startCwd));
    return results;
  }

  // ─── File tools ───────────────────────────────────────────────────

  function readFileTool(path) {
    const target = resolve(path);
    const entry = fs()[target];
    if (!entry) return { ok: false, tool: "read_file", error: "No such file: " + path, path: target };
    if (entry.type === "dir") return { ok: false, tool: "read_file", error: "Is a directory: " + path };
    return { ok: true, tool: "read_file", path: target, content: entry.content || "" };
  }

  function writeFileTool(path, content, common) {
    const target = resolve(path);
    const parent = target.replace(/\/[^/]+$/, "") || "/";
    ensureDir(parent);
    const name = target.split("/").pop();
    if (fs()[parent] && fs()[parent].type === "dir" && !fs()[parent].children.includes(name)) {
      fs()[parent].children.push(name);
    }
    const existed = !!fs()[target];
    fs()[target] = { type: "file", content: String(content || "") };
    if (common && common.onWrite) common.onWrite(target, String(content || ""));
    return {
      ok: true,
      tool: "write_file",
      path: target,
      bytes: String(content || "").length,
      text: (existed ? "Overwrote" : "Created") + " " + target,
    };
  }

  function appendFileTool(path, content, common) {
    const target = resolve(path);
    if (!fs()[target]) return writeFileTool(path, content, common);
    if (fs()[target].type === "dir") return { ok: false, tool: "append_file", error: "Is a directory" };
    fs()[target].content += String(content || "");
    if (common && common.onWrite) common.onWrite(target, String(content || ""));
    return { ok: true, tool: "append_file", path: target, text: "Appended to " + target };
  }

  function listDirTool(path) {
    const target = resolve(path || cwd());
    const entry = fs()[target];
    if (!entry) return { ok: false, tool: "list_directory", error: "No such directory: " + (path || ".") };
    if (entry.type === "file") {
      return { ok: true, tool: "list_directory", path: target, entries: [target.split("/").pop()] };
    }
    return { ok: true, tool: "list_directory", path: target, entries: entry.children.slice() };
  }

  function mkdirTool(path, common) {
    const target = resolve(path);
    const parent = target.replace(/\/[^/]+$/, "") || "/";
    if (!fs()[parent] || fs()[parent].type !== "dir") {
      const nested = mkdirTool(parent.replace(/^\/+/, "") || "tmp", common);
      if (!nested.ok) {
        fs()[parent] = { type: "dir", children: [] };
        if (fs()[parent === "/" ? "/" : parent]) fs()[parent].children = fs()[parent].children || [];
        const parentName = parent.split("/").pop();
        if (parentName && fs()[parent.replace(/\/[^/]+$/, "")]) {
          const grandparent = parent.replace(/\/[^/]+$/, "");
          if (!fs()[grandparent].children.includes(parentName)) fs()[grandparent].children.push(parentName);
        }
      }
    }
    if (fs()[target]) return { ok: false, tool: "create_directory", error: "Directory exists: " + path };
    fs()[target] = { type: "dir", children: [] };
    const name = target.split("/").pop();
    if (fs()[parent] && !fs()[parent].children.includes(name)) fs()[parent].children.push(name);
    return { ok: true, tool: "create_directory", path: target, text: "Created directory " + target };
  }

  function deleteFileTool(path, recursive) {
    const target = resolve(path);
    if (!fs()[target]) return { ok: false, tool: "delete_file", error: "No such file: " + path };
    if (fs()[target].type === "dir" && fs()[target].children.length > 0 && !recursive) {
      return { ok: false, tool: "delete_file", error: "Directory not empty (use recursive: true)" };
    }
    rmRecursive(fs(), target, true);
    const parent = target.replace(/\/[^/]+$/, "") || "/";
    if (fs()[parent]) {
      fs()[parent].children = fs()[parent].children.filter((c) => c !== target.split("/").pop());
    }
    return { ok: true, tool: "delete_file", text: "Deleted " + target };
  }

  function copyFileTool(src, dest) {
    const s = resolve(src);
    const d = resolve(dest);
    if (!fs()[s]) return { ok: false, tool: "copy_file", error: "No such file: " + src };
    if (fs()[d]) return { ok: false, tool: "copy_file", error: "Destination exists: " + dest };
    const copyDir = (from, to) => {
      fs()[to] = { type: "dir", children: [] };
      fs()[from].children.forEach((child) => {
        const cp = from === "/" ? "/" + child : from + "/" + child;
        const cd = to === "/" ? "/" + child : to + "/" + child;
        if (fs()[cp].type === "dir") copyDir(cp, cd);
        else fs()[cd] = { type: "file", content: fs()[cp].content };
      });
    };
    if (fs()[s].type === "dir") copyDir(s, d);
    else fs()[d] = { type: "file", content: fs()[s].content };
    const parent = d.replace(/\/[^/]+$/, "") || "/";
    if (fs()[parent]) fs()[parent].children.push(d.split("/").pop());
    return { ok: true, tool: "copy_file", text: "Copied " + s + " to " + d };
  }

  function findFilesTool(pattern) {
    const results = [];
    const walk = (dirPath) => {
      const dir = fs()[dirPath];
      if (!dir) return;
      for (const child of dir.children) {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        const e = fs()[childPath];
        if (!e) continue;
        if (e.type === "file" && child.includes(String(pattern || ""))) results.push(childPath);
        if (e.type === "dir") walk(childPath);
      }
    };
    walk("/");
    return { ok: true, tool: "find_files", results: results.length ? results : ["(no matches)"] };
  }

  function searchCodeTool(pattern, path) {
    const results = [];
    const target = resolve(path || cwd());
    const walk = (dirPath) => {
      const dir = fs()[dirPath];
      if (!dir) return;
      for (const child of dir.children) {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        const e = fs()[childPath];
        if (!e) continue;
        if (e.type === "dir") walk(childPath);
        else if (e.content && e.content.includes(String(pattern || ""))) {
          results.push(childPath.replace(/^\/+/, "") + ":" + (e.content.match(new RegExp("^[^\\n]{0,80}" + pattern + "[^\\n]*", "m")) || [""])[0]);
        }
      }
    };
    walk(target);
    return { ok: true, tool: "search_code", results: results.length ? results : ["(no matches)"] };
  }

  function runJSTool(code) {
    if (typeof window.ChatreCore.runJS === "function") {
      return window.ChatreCore.runJS(code);
    }
    try {
      const result = new Function("return (" + code + ")")();
      return { ok: true, tool: "run_javascript", output: result === undefined ? "(undefined)" : String(result), text: "JS executed" };
    } catch (e) {
      return { ok: false, tool: "run_javascript", error: e.message || String(e) };
    }
  }

  async function runPyTool(code) {
    if (typeof window.ChatreCore.runPython === "function") {
      return await window.ChatreCore.runPython(code);
    }
    return { ok: false, tool: "run_python", error: "Python runtime not available" };
  }

  function createDocTool(title, content, common) {
    const safeTitle = String(title || "document").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
    ensureDir("/home/user/documents");
    const path = "/home/user/documents/" + safeTitle + ".md";
    const md = "# " + (title || "Document") + "\n\n" + String(content || "");
    const result = writeFileTool(path, md, common);
    triggerDownload(safeTitle + ".md", md, "text/markdown");
    if (common && common.onDocument) common.onDocument(path, md, title);
    return Object.assign({}, result, {
      tool: "create_document",
      downloaded: true,
      text: "Created and downloaded document: " + path,
    });
  }

  // ─── PDF creation (client-side, free, export-ready) ────────────────

  let pdfLibPromise = null;

  function loadPdfLib() {
    if (window.jspdf && window.jspdf.jsPDF) {
      return Promise.resolve(true);
    }
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise(function (resolve) {
      try {
        const s = document.createElement("script");
        s.src =
          "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
        s.onload = function () {
          resolve(!!(window.jspdf && window.jspdf.jsPDF));
        };
        s.onerror = function () {
          pdfLibPromise = null;
          resolve(false);
        };
        document.head.appendChild(s);
      } catch (e) {
        resolve(false);
      }
    });
    return pdfLibPromise;
  }

  function pdfSlug(title) {
    return (
      String(title || "document")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "document"
    );
  }

  /**
   * Render a small, clean PDF from markdown-ish content using jsPDF.
   * jsPDF's built-in fonts are Latin-only, so non-Latin text degrades to
   * create_document (a downloadable markdown file) instead of garbled glyphs.
   */
  async function createPdfTool(title, content) {
    const loaded = await loadPdfLib();
    if (!loaded) {
      return {
        ok: false,
        tool: "create_pdf",
        error:
          "PDF engine could not be loaded (offline?). Use create_document to produce a downloadable markdown document instead.",
      };
    }
    const fullText = String(title || "") + "\n" + String(content || "");
    if (/[^\x00-\x7F]/.test(fullText)) {
      return {
        ok: false,
        tool: "create_pdf",
        error:
          "The PDF builder currently supports Latin text only. Use create_document to create a downloadable markdown file that keeps all scripts intact.",
      };
    }
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 48;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const maxW = pageW - margin * 2;
      let y = margin;

      const spaceFor = function (h, size) {
        if (y + h > pageH - margin) {
          doc.addPage();
          y = margin;
          doc.setFontSize(size || 11);
        }
      };

      // Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text(String(title || "Document"), margin, y, { maxWidth: maxW });
      y += 30;
      doc.setDrawColor(200);
      doc.setLineWidth(1);
      doc.line(margin, y, pageW - margin, y);
      y += 20;

      // Parse content into light blocks.
      const blocks = [];
      let code = [];
      let inCode = false;
      String(content || "")
        .split("\n")
        .forEach(function (line) {
          const fence = line.trim().startsWith("```");
          if (fence) {
            if (inCode) {
              blocks.push({ t: "code", lines: code });
              code = [];
              inCode = false;
            } else {
              inCode = true;
              code = [];
            }
            return;
          }
          if (inCode) {
            code.push(line);
            return;
          }
          const h = line.match(/^(#{1,3})\s+(.*)/);
          if (h) {
            blocks.push({ t: "h" + h[1].length, text: h[2] });
            return;
          }
          const b = line.match(/^\s*[-*]\s+(.*)/);
          if (b) {
            blocks.push({ t: "bullet", text: b[1] });
            return;
          }
          const n = line.match(/^\s*(\d+)[.)]?\s+(.*)/);
          if (n) {
            blocks.push({ t: "num", prefix: n[1] + ".", text: n[2] });
            return;
          }
          if (line.trim()) blocks.push({ t: "p", text: line });
        });
      if (code.length) blocks.push({ t: "code", lines: code });
      if (!blocks.length) blocks.push({ t: "p", text: String(content || "") });

      blocks.forEach(function (b) {
        if (b.t === "code") {
          y += 6;
          doc.setFont("courier", "normal");
          doc.setFontSize(8);
          b.lines.forEach(function (ln) {
            const ls = doc.splitTextToSize(ln, maxW - 14);
            ls.forEach(function (l) {
              spaceFor(10, 8);
              doc.text(l, margin + 7, y);
              y += 10;
            });
          });
          y += 6;
        } else if (b.t === "h1" || b.t === "h2" || b.t === "h3") {
          const size = b.t === "h1" ? 16 : b.t === "h2" ? 14 : 12;
          y += 10;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(size);
          doc.splitTextToSize(b.text, maxW).forEach(function (l) {
            spaceFor(size + 6, size);
            doc.text(l, margin, y);
            y += size + 6;
          });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(11);
        } else {
          const prefix = b.t === "bullet" ? "•  " : b.t === "num" ? b.prefix + "  " : "";
          const size = 11;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(size);
          if (prefix) {
            doc.text(prefix, margin, y);
            doc.splitTextToSize(b.text, maxW - doc.getTextWidth(prefix) - 4).forEach(function (l) {
              spaceFor(size + 5, size);
              doc.text(l, margin + doc.getTextWidth(prefix) + 2, y);
              y += size + 5;
            });
          } else {
            doc.splitTextToSize(b.text, maxW).forEach(function (l) {
              spaceFor(size + 5, size);
              doc.text(l, margin, y);
              y += size + 5;
            });
          }
        }
      });

      const pages = doc.getNumberOfPages();
      const fname = pdfSlug(title) + ".pdf";
      doc.save(fname);
      return {
        ok: true,
        tool: "create_pdf",
        path: fname,
        pages,
        downloaded: true,
        text:
          "Created and downloaded PDF: " +
          fname +
          " (" +
          pages +
          " page" +
          (pages === 1 ? "" : "s") +
          ")",
      };
    } catch (e) {
      return {
        ok: false,
        tool: "create_pdf",
        error: "PDF generation failed: " + (e && e.message ? e.message : String(e)),
      };
    }
  }

  function exportDocTool(path, common) {
    const target = resolve(path);
    const entry = fs()[target];
    if (!entry || entry.type !== "file") {
      return { ok: false, tool: "export_document", error: "No such file: " + path };
    }
    const name = target.split("/").pop() || "export.txt";
    const content = entry.content || "";
    const mime = name.endsWith(".md")
      ? "text/markdown"
      : name.endsWith(".html")
        ? "text/html"
        : name.endsWith(".json")
          ? "application/json"
          : "text/plain";
    triggerDownload(name, content, mime);
    if (common && common.onDocument) common.onDocument(target, content, name);
    return { ok: true, tool: "export_document", path: target, downloaded: true, text: "Downloaded " + target };
  }

  function verifyProjectTool(path) {
    const target = resolve(path || cwd());
    const entry = fs()[target];
    if (!entry) return { ok: false, tool: "verify_project", error: "Path not found: " + (path || ".") };
    const files = [];
    const walk = (dirPath) => {
      const dir = fs()[dirPath];
      if (!dir) return;
      if (dir.type === "file") {
        files.push({ path: dirPath, bytes: (dir.content || "").length });
        return;
      }
      (dir.children || []).forEach((child) => {
        const childPath = dirPath === "/" ? "/" + child : dirPath + "/" + child;
        walk(childPath);
      });
    };
    walk(target);
    const empty = files.filter((f) => f.bytes === 0);
    const readme = files.find((f) => /readme/i.test(f.path));
    const issues = [];
    if (files.length === 0) issues.push("No files found under " + target);
    if (empty.length) issues.push(empty.length + " empty file(s): " + empty.map((f) => f.path).slice(0, 5).join(", "));
    if (!readme && files.length > 2) issues.push("No README found — consider adding one");
    return {
      ok: issues.length === 0,
      tool: "verify_project",
      path: target,
      fileCount: files.length,
      totalBytes: files.reduce((n, f) => n + f.bytes, 0),
      issues,
      text: issues.length
        ? "Verification warnings:\n- " + issues.join("\n- ")
        : "Project looks healthy (" + files.length + " files).",
    };
  }

  // ─── Todo ─────────────────────────────────────────────────────────

  const todoState = { items: [] };

  function formatTodos(items) {
    if (!items || !items.length) return "(no todos)";
    return items
      .map(function (t) {
        return (t.status === "done" ? "- [x] " : "- [ ] ") + t.id + ": " + t.content;
      })
      .join("\n");
  }

  function todoTool(p) {
    const action = String((p && p.action) || "list").toLowerCase();
    let items = todoState.items.slice();
    if (action === "set" || action === "replace") {
      const raw = p.items || p.todos || [];
      items = (Array.isArray(raw) ? raw : []).map(function (item, i) {
        if (typeof item === "string") {
          return { id: "t" + (i + 1), content: item, status: "pending" };
        }
        return {
          id: String((item && item.id) || "t" + (i + 1)),
          content: String((item && (item.content || item.text)) || ""),
          status: "pending",
        };
      }).filter(function (t) { return t.content; });
      todoState.items = items;
      return { ok: true, tool: "todo", action: action, todos: items, text: "Todos set:\n" + formatTodos(items), guide: formatTodos(items) };
    }
    if (action === "add") {
      const content = String((p && (p.content || p.text)) || "");
      if (!content) return { ok: false, tool: "todo", error: "content required" };
      const id = String((p && p.id) || "t" + (items.length + 1));
      items.push({ id: id, content: content, status: "pending" });
      todoState.items = items;
      return { ok: true, tool: "todo", action: action, todos: items, text: "Added " + id + "\n" + formatTodos(items) };
    }
    if (action === "done" || action === "complete") {
      const id = String((p && p.id) || "");
      const hit = items.find(function (t) { return t.id === id; });
      if (!hit) return { ok: false, tool: "todo", error: "Unknown todo id: " + id };
      hit.status = "done";
      todoState.items = items;
      return { ok: true, tool: "todo", action: action, todos: items, text: "Checked off " + id + "\n" + formatTodos(items) };
    }
    return { ok: true, tool: "todo", action: "list", todos: items, text: formatTodos(items), guide: formatTodos(items) };
  }

  function listSkillsTool() {
    const skills = window.ChatreSkills
      ? window.ChatreSkills.listSkills()
      : [];
    return {
      ok: true,
      tool: "list_skills",
      skills,
      text: skills.map((s) => s.name + ": " + s.summary).join("\n") || "(no skills loaded)",
    };
  }

  function useSkillTool(name) {
    if (!window.ChatreSkills) {
      return { ok: false, tool: "use_skill", error: "Skills module not loaded" };
    }
    const skill = window.ChatreSkills.getSkill(name);
    if (!skill) {
      return {
        ok: false,
        tool: "use_skill",
        error: "Unknown skill: " + name + ". Try list_skills.",
      };
    }
    const guide = window.ChatreSkills.formatSkill(skill);
    return { ok: true, tool: "use_skill", skill: skill.name, guide, text: guide };
  }

  // ─── Elicitation: tappable options ──────────────────────────────────────

  /**
   * Normalize options into [{ label, value }]. Accepts strings or objects
   * with label/value. Caps at 4 (per the elicitation guideline) and requires
   * at least 2 to render buttons; otherwise the caller asks in prose.
   */
  function normalizeOptions(options) {
    const list = Array.isArray(options) ? options : [];
    const out = [];
    for (const opt of list) {
      if (out.length >= 4) break;
      if (typeof opt === "string" && opt.trim()) {
        out.push({ label: opt.trim(), value: opt.trim() });
      } else if (opt && typeof opt === "object") {
        const label = opt.label || opt.value || opt.text;
        if (label) out.push({ label: String(label), value: String(opt.value || label) });
      }
    }
    return out;
  }

  function askUserInputTool(question, options) {
    const q = String(question || "").trim();
    const opts = normalizeOptions(options);
    if (!q) {
      return { ok: false, tool: "ask_user_input", error: "ask_user_input requires a question" };
    }
    if (opts.length < 2) {
      return {
        ok: false,
        tool: "ask_user_input",
        error:
          "ask_user_input needs 2-4 tappable options. Ask in prose instead if there is only one choice.",
      };
    }
    return {
      ok: true,
      tool: "ask_user_input",
      type: "user_input",
      question: q,
      options: opts,
      text: q,
    };
  }

  // ─── MCP connectors ─────────────────────────────────────────────────────

  function toQueryList(query) {
    if (Array.isArray(query)) return query.map(String).filter(Boolean);
    if (query == null) return [];
    return [String(query)];
  }

  function searchMcpRegistryTool(query) {
    if (!window.ChatreMCP) {
      return { ok: false, tool: "search_mcp_registry", error: "MCP module not loaded" };
    }
    const terms = toQueryList(query);
    const seen = {};
    const results = [];
    const searchTerms = terms.length ? terms : [""];
    searchTerms.forEach(function (t) {
      window.ChatreMCP.search(t).forEach(function (r) {
        if (!seen[r.uuid]) {
          seen[r.uuid] = true;
          results.push(r);
        }
      });
    });
    const connected = window.ChatreMCP.listConnected();
    const connectedIds = connected.map(function (c) { return c.uuid; });
    return {
      ok: true,
      tool: "search_mcp_registry",
      results: results.slice(0, 8),
      connected: connectedIds,
      text:
        results.length
          ? results
              .slice(0, 8)
              .map(function (r) {
                return r.name + " (" + r.uuid + ") — " + r.description + (r.connected ? " [connected]" : "");
              })
              .join("\n")
          : "No connectors matched. Answer directly if the task doesn't need one.",
    };
  }

  function suggestConnectorsTool(uuids, question) {
    if (!window.ChatreMCP) {
      return { ok: false, tool: "suggest_connectors", error: "MCP module not loaded" };
    }
    const ids = Array.isArray(uuids) ? uuids : uuids ? [uuids] : [];
    // Resolve each uuid to a registry entry (support name search as a fallback).
    const options = [];
    ids.forEach(function (id) {
      const found = window.ChatreMCP.search(id)[0];
      if (found && !options.some(function (o) { return o.uuid === found.uuid; })) {
        options.push(found);
      }
    });
    if (!options.length) {
      return {
        ok: false,
        tool: "suggest_connectors",
        error: "No matching connectors. Call search_mcp_registry first and pass those directory UUIDs.",
      };
    }
    return {
      ok: true,
      tool: "suggest_connectors",
      type: "connectors",
      question: String(question || "Which of these would you like to connect?"),
      connectors: options,
      text: options.map(function (o) { return o.name + " (" + o.uuid + ")"; }).join(", "),
    };
  }

  async function callMcpTool(server, tool, args) {
    if (!window.ChatreMCP) {
      return { ok: false, tool: "call_mcp", error: "MCP module not loaded" };
    }
    if (!server || !tool) {
      return { ok: false, tool: "call_mcp", error: "call_mcp requires server and tool" };
    }
    const result = await window.ChatreMCP.call(server, tool, args);
    if (!result.ok) {
      return { ok: false, tool: "call_mcp", error: result.error };
    }
    return {
      ok: true,
      tool: "call_mcp",
      server,
      called: tool,
      result: result.result,
      text: typeof result.result === "string" ? result.result : JSON.stringify(result.result).slice(0, 4000),
    };
  }

  async function listMcpToolsTool(server) {
    if (!window.ChatreMCP) {
      return { ok: false, tool: "list_mcp_tools", error: "MCP module not loaded" };
    }
    const result = await window.ChatreMCP.listTools(server);
    if (!result.ok) {
      return { ok: false, tool: "list_mcp_tools", error: result.error };
    }
    const tools = result.tools || [];
    return {
      ok: true,
      tool: "list_mcp_tools",
      server,
      tools,
      text:
        tools.length
          ? tools.map(function (t) { return (t.name || t) + (t.description ? " — " + t.description : ""); }).join("\n")
          : result.note || "(no tools discovered)",
    };
  }

  function ensureDir(path) {
    const target = resolve(path);
    if (fs()[target] && fs()[target].type === "dir") return;
    const parts = target.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      const parent = cur || "/";
      cur = cur + "/" + part;
      if (!fs()[cur]) {
        fs()[cur] = { type: "dir", children: [] };
        if (fs()[parent] && fs()[parent].type === "dir" && !fs()[parent].children.includes(part)) {
          fs()[parent].children.push(part);
        }
      }
    }
  }

  function triggerDownload(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
    } catch (e) {
      console.warn("Download failed", e);
    }
  }

  function viewTreeTool(path) {
    return { ok: true, tool: "view_tree", output: treeOf(path || ".", fs(), cwd()) };
  }

  // ─── Git tools ────────────────────────────────────────────────────

  function gitTool(op, params, common) {
    const git = core().git || {};
    git.initialized = git.initialized || false;
    git.branch = git.branch || "main";
    git.staged = git.staged || new Set();
    git.commits = git.commits || [];
    core().git = git;

    switch (op) {
      case "init":
        git.initialized = true;
        return { ok: true, tool: "git_init", text: "Initialized empty git repository at /" };
      case "add": {
        git.initialized = true;
        const raw = params.path || ".";
        if (raw === "." || raw === "./" || raw === "*") {
          const allFiles = [];
          const walk = (dp) => {
            const de = fs()[dp];
            if (!de) return;
            (de.children || []).forEach((c) => {
              const cpath = dp === "/" ? "/" + c : dp + "/" + c;
              const e = fs()[cpath];
              if (e && e.type === "file") allFiles.push(cpath);
              if (e && e.type === "dir") walk(cpath);
            });
          };
          walk("/");
          allFiles.forEach((f) => git.staged.add(f));
          return {
            ok: true,
            tool: "git_add",
            text: "Staged " + allFiles.length + " files",
          };
        }
        const target = resolve(raw);
        if (!fs()[target]) {
          return { ok: false, tool: "git_add", error: "No such file: " + raw };
        }
        git.staged.add(target);
        return { ok: true, tool: "git_add", text: "Staged " + target };
      }
      case "commit": {
        if (!git.initialized) return { ok: false, tool: "git_commit", error: "Not a git repository (run git_init first)" };
        if (git.staged.size === 0) return { ok: false, tool: "git_commit", error: "Nothing to commit (run git_add first)" };
        git.commits.push({
          hash: "c" + git.commits.length.toString(16).padStart(7, "0"),
          message: params.message || "(no message)",
          files: [...git.staged],
          date: new Date().toISOString(),
        });
        git.staged.clear();
        return { ok: true, tool: "git_commit", hash: git.commits[git.commits.length - 1].hash, text: "Committed: " + (params.message || "") };
      }
      case "status": {
        if (!git.initialized) return { ok: false, tool: "git_status", error: "Not a git repository" };
        const lines = ["On branch " + git.branch];
        const allFiles = [];
        const walk = (dp) => { const de = fs()[dp]; if (!de) return; de.children.forEach((c) => { const cpath = dp === "/" ? "/" + c : dp + "/" + c; const e = fs()[cpath]; if (e && e.type === "file") allFiles.push(cpath); if (e && e.type === "dir") walk(cpath); }); };
        walk("/");
        const untracked = allFiles.filter((f) => !git.staged.has(f) && !git.commits.some((cm) => cm.files.includes(f)));
        if (untracked.length) {
          lines.push("", "Untracked files:", untracked.map((f) => "  " + f).join("\n"));
        }
        if (git.staged.size) {
          lines.push("", "Changes to be committed:", [...git.staged].map((f) => "  new file: " + f).join("\n"));
        } else {
          lines.push("", "Changes to be committed: (none)");
        }
        return { ok: true, tool: "git_status", output: lines.join("\n"), text: "Git status" };
      }
      case "log": {
        if (!git.initialized) return { ok: false, tool: "git_log", error: "Not a git repository" };
        if (git.commits.length === 0) return { ok: true, tool: "git_log", output: "No commits yet", text: "No commits" };
        const lines = git.commits.map((cm) => {
          return "commit " + cm.hash + "\nAuthor: Chatre <chatre@localhost>\nDate: " + cm.date + "\n\n    " + cm.message + "\n";
        });
        return { ok: true, tool: "git_log", output: lines.join("\n"), text: "Commit history" };
      }
      case "push": {
        if (!git.initialized) return { ok: false, tool: "git_push", error: "Not a git repository" };
        if (git.commits.length === 0) return { ok: false, tool: "git_push", error: "Nothing to push" };
        const remote = params.remote || "origin";
        const branch = params.branch || git.branch || "main";
        git.remotes = git.remotes || {};
        git.remotes[remote] = {
          branch,
          tip: git.commits[git.commits.length - 1].hash,
          pushedAt: new Date().toISOString(),
          commitCount: git.commits.length,
        };
        return {
          ok: true,
          tool: "git_push",
          text: "Pushed " + git.commits.length + " commit(s) to " + remote + "/" + branch + " (" + git.remotes[remote].tip + ")",
          remote: git.remotes[remote],
        };
      }
      default:
        return { ok: false, tool: "git_" + op, error: "Unknown git op: " + op };
    }
  }

  function gitShell(args, fileSys) {
    const parts = args.trim().split(/\s+/);
    const sub = parts[0];
    const rest = parts.slice(1).join(" ");
    return (gitTool(sub, { path: rest, message: rest, recursive: true }, {})).text || "";
  }

  // ─── Exports ──────────────────────────────────────────────────────

  window.ChatreTools = {
    TOOL_DEFINITIONS,
    parseToolCalls,
    cleanResponseText,
    executeTool,
    asOpenAITools: function () {
      return TOOL_DEFINITIONS.map(function (t) {
        const props = {};
        const required = [];
        Object.keys(t.params || {}).forEach(function (k) {
          props[k] = { type: t.params[k] === "boolean" ? "boolean" : "string" };
          if (k === "cmd" || k === "path" || k === "content" || k === "code" || k === "message" || k === "steps" || k === "title" || k === "name" || k === "pattern") {
            // soft requireds — leave optional for model flexibility except critical ones
          }
        });
        if (t.name === "execute_command") required.push("cmd");
        if (t.name === "write_file") {
          required.push("path");
          required.push("content");
        }
        if (t.name === "read_file") required.push("path");
        if (t.name === "git_commit") required.push("message");
        if (t.name === "plan") required.push("steps");
        return {
          type: "function",
          function: {
            name: t.name,
            description: t.desc,
            parameters: {
              type: "object",
              properties: props,
              required: required,
            },
          },
        };
      });
    },
    executeBatch: async function (calls, options) {
      const results = [];
      for (const call of calls) {
        try {
          const r = await executeTool(call, options);
          results.push(r);
        } catch (e) {
          results.push({ ok: false, tool: call.tool, error: e.message || String(e) });
        }
      }
      return results;
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = window.ChatreTools;
  }
})();