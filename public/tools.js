/**
 * Chatre Agent Tools — tool definitions, JSON parsing, and execution.
 * Uses window.ChatreCore (bound by chat.js) for filesystem/history access.
 */
(function () {
  "use strict";

  const TOOL_DEFINITIONS = [
    { name: "plan", desc: "Create a step-by-step plan before executing", params: { steps: "string" } },
    { name: "list_skills", desc: "List available agent skills", params: {} },
    { name: "use_skill", desc: "Load a skill playbook (coding|documents|git|debugging|research|project)", params: { name: "string" } },
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
    { name: "export_document", desc: "Download an existing workspace file", params: { path: "string" } },
    { name: "verify_project", desc: "Sanity-check a project directory", params: { path: "string" } },
    { name: "view_tree", desc: "Show the workspace file tree", params: { path: "string" } },
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
    const blockRe = /```(?:tool|tool_call|agent)\s*\n?([\s\S]*?)```/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      const block = m[1].trim();
      parseBlock(block, results);
    }

    // Also catch bare {tool:...} JSON objects if no fenced blocks
    if (results.length === 0) {
      const bareRe = /\{\s*"tool"\s*:\s*"[^"]+"[\s\S]*?\}/g;
      let bm;
      while ((bm = bareRe.exec(text)) !== null) {
        parseBlock(bm[0], results);
      }
    }
    return results;
  }

  function parseBlock(jsonText, results) {
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && item.tool) results.push(normalize(item));
        });
      } else if (parsed && parsed.tool) {
        results.push(normalize(parsed));
      }
    } catch (e) {
      // Try line-by-line recovery for models that wrap JSON in extra text
      const innerRe = /\{\s*"tool"\s*:[\s\S]*?\}/g;
      let m;
      while ((m = innerRe.exec(jsonText)) !== null) {
        try {
          const obj = JSON.parse(m[0]);
          if (obj.tool) results.push(normalize(obj));
        } catch (e2) {
          /* ignore */
        }
      }
    }
  }

  function normalize(item) {
    return {
      tool: item.tool,
      params: item.params || {},
      id: item.id || "tc_" + Math.random().toString(36).slice(2, 8),
    };
  }

  /** Strip tool blocks from assistant text for clean display. */
  function cleanResponseText(text) {
    return String(text || "").replace(/```(?:tool|tool_call|agent)\s*\n?[\s\S]*?```/g, "");
  }

  // ─── Execution ────────────────────────────────────────────────────

  function executeTool(call, options) {
    const { tool, params } = call;
    const p = params || {};
    const common = {
      onWrite: options && options.onWrite,
      onCommand: options && options.onCommand,
    };

    switch (tool) {
      case "plan":
        return { ok: true, tool, type: "plan", text: "Plan recorded: " + String(p.steps || "") };

      case "list_skills":
        return listSkillsTool();

      case "use_skill":
        return useSkillTool(p.name);

      case "execute_command":
        return executeCommand(p.cmd, common);

      case "read_file":
        return readFileTool(p.path);

      case "write_file":
        return writeFileTool(p.path, p.content, common);

      case "append_file":
        return appendFileTool(p.path, p.content, common);

      case "list_directory":
        return listDirTool(p.path);

      case "create_directory":
        return mkdirTool(p.path, common);

      case "delete_file":
        return deleteFileTool(p.path, p.recursive);

      case "copy_file":
        return copyFileTool(p.src, p.dest);

      case "find_files":
        return findFilesTool(p.pattern);

      case "search_code":
        return searchCodeTool(p.pattern, p.path);

      case "run_javascript":
        return runJSTool(p.code);

      case "run_python":
        return runPyTool(p.code);

      case "create_document":
        return createDocTool(p.title, p.content, common);

      case "export_document":
        return exportDocTool(p.path, common);

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

  // ─── Shell command ────────────────────────────────────────────────

  function executeCommand(cmd, common) {
    const fileSys = fs();
    const curr = cwd();
    if (common && common.onCommand) common.onCommand(cmd);

    return shellCommand(cmd, fileSys, curr);
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
        const spec = args.split(/\s+/);
        const n = parseInt(spec[0].replace(/^-n\s*/i, ""), 10) || 10;
        const file = spec[1] || spec[0];
        const target = rp(file, fileSys, startCwd);
        const entry = fileSys[target];
        if (!entry) { out = "head: " + file + ": No such file"; }
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
        const target = resolve(params.path || ".");
        git.initialized = git.initialized || !!fs()[target];
        if (!fs()[target]) return { ok: false, tool: "git_add", error: "No such file: " + params.path };
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