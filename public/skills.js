/**
 * Chatre Skills — reusable playbooks the agent can load and follow.
 */
(function () {
  "use strict";

  const SKILLS = {
    coding: {
      name: "coding",
      title: "Software engineering",
      summary: "Plan, scaffold, implement, test, and document code thoroughly.",
      steps: [
        "Explore the workspace (view_tree / list_directory / read_file) before writing.",
        "Create a plan and a todo list (todo set) with atomic tasks.",
        "Implement one todo at a time with complete files — no placeholders.",
        "Mark each todo done as you finish it.",
        "Verify with verify_project / execute_command / run_javascript / run_python.",
        "Write or update a README / document.",
        "Stage and commit when the build is done.",
      ],
    },
    documents: {
      name: "documents",
      title: "Document authoring",
      summary: "Produce polished markdown or PDF documents users can download.",
      steps: [
        "Outline sections and set todos.",
        "Write complete content with headings, lists, and examples.",
        "For a PDF/report/guide/book request, call create_pdf(title, content) with the FULL text — never invent Python/fpdf, /mnt/data paths, or fake download links.",
        "Use create_document to save markdown under /home/user/documents/.",
        "Only claim a file exists after the tool returns ok with a path; tell the user to open Files.",
      ],
    },
    git: {
      name: "git",
      title: "Version control",
      summary: "Initialize repos, stage, commit, and report status/history.",
      steps: [
        "git_status or git_init as needed.",
        "git_add relevant paths (or .).",
        "git_commit with a concise why-focused message.",
        "Optionally git_push; show git_log.",
      ],
    },
    debugging: {
      name: "debugging",
      title: "Debugging",
      summary: "Reproduce, diagnose, fix, and verify failures.",
      steps: [
        "Reproduce with execute_command / run_javascript / run_python.",
        "Read related files and search_code for clues.",
        "Apply a minimal fix, then re-verify.",
        "Summarize root cause and fix.",
      ],
    },
    research: {
      name: "research",
      title: "Workspace research",
      summary: "Explore the virtual workspace thoroughly before changing anything.",
      steps: [
        "view_tree from the project root.",
        "list_directory and find_files for candidates.",
        "search_code for symbols or error strings.",
        "read_file on the most relevant files.",
        "Only then plan edits.",
      ],
    },
    project: {
      name: "project",
      title: "Full project delivery",
      summary: "Plan, build, verify, document, and commit.",
      steps: [
        "Explore, then plan + todo set.",
        "Build the full project structure with complete files.",
        "verify_project after implementation.",
        "create_document / README.",
        "git_init (if needed), git_add, git_commit, git_push.",
        "Final summary with paths and how to run.",
      ],
    },
    browser: {
      name: "browser",
      title: "Browser automation",
      summary: "Navigate, click, type, and read real web pages like a human.",
      steps: [
        "tabs_create then navigate to the target URL.",
        "Understand the page with read_page / get_page_text / screenshot before acting.",
        "Use computer (coords or refs) and form_input for interaction.",
        "Use search_web for research instead of a search-engine site.",
        "Confirm results; cite [web:N] / [screenshot:N] when sourcing facts.",
      ],
    },
    computer: {
      name: "computer",
      title: "Computer use",
      summary: "Operate shell, files, network, and browser as one workstation.",
      steps: [
        "Track work with todo_write.",
        "Use execute_command and file tools for the workspace.",
        "Use search_web / http_request / fetch_url for network; browser tools for interactive sites.",
        "For real OS actions use desktop_* (open, screenshot, clipboard, type, hotkey, click) when companion is running.",
        "Verify outputs before finishing.",
      ],
    },
    byok_setup: {
      name: "byok_setup",
      title: "BYOK setup",
      summary: "Connect a provider key and verify it safely.",
      steps: [
        "Confirm the user is signed in.",
        "Save the provider key in Settings → BYOK (never echo it back).",
        "Call test_connection(provider).",
        "Select a provider:model and run a tiny task.",
      ],
    },
    web_research: {
      name: "web_research",
      title: "Web research",
      summary: "Search, fetch readable pages, and cite sources.",
      steps: [
        "search_web with focused queries (max 3).",
        "fetch_url top sources for clean text.",
        "Synthesize with [web:N] citations.",
        "Use the browser only if login or JS is required.",
      ],
    },
    form_workflow: {
      name: "form_workflow",
      title: "Form / login workflow",
      summary: "Fill forms and pause for login walls safely.",
      steps: [
        "navigate then list_frames/switch_frame if needed.",
        "read_page before acting.",
        "form_input / computer for fields.",
        "await_login on CAPTCHA/2FA; never invent credentials.",
        "Screenshot to verify.",
      ],
    },
    code_pr: {
      name: "code_pr",
      title: "Code change / PR",
      summary: "Surgical edits, verify, and commit.",
      steps: [
        "Explore with view_tree / search_code / read_file.",
        "patch_file for minimal diffs (prefer over full rewrite).",
        "verify_project / execute_command.",
        "git_add + git_commit with a why-focused message.",
        "git_push only if the user asked.",
      ],
    },
    data_cleanup: {
      name: "data_cleanup",
      title: "Data cleanup",
      summary: "Clean CSV/tabular data with csv tools.",
      steps: [
        "csv_read the source file.",
        "csv_query to filter or inspect.",
        "csv_write the cleaned result.",
        "upload_artifact for the UI rail.",
      ],
    },
    ops_debug: {
      name: "ops_debug",
      title: "Ops / site debug",
      summary: "Diagnose failing pages with network and console.",
      steps: [
        "Reproduce the issue in the browser.",
        "browser_network(failed_only) and browser_console.",
        "ocr_image if text is only in screenshots.",
        "Report or apply a minimal fix.",
      ],
    },
    account_safe: {
      name: "account_safe",
      title: "Account safety",
      summary: "Handle secrets and logins without leaking data.",
      steps: [
        "Never invent or echo passwords or API keys.",
        "Use await_login / ask_user_input for credentials.",
        "memory_set only for non-secret preferences.",
        "Prefer test_connection over printing keys.",
      ],
    },
    memory_schedule: {
      name: "memory_schedule",
      title: "Memory & reminders",
      summary: "Durable notes and timed reminders.",
      steps: [
        "memory_set / memory_get for cross-thread notes.",
        "remind / schedule_create for timed messages.",
        "schedule_due to deliver; schedule_list / schedule_cancel to manage.",
      ],
    },
    shell_debug: {
      name: "shell_debug",
      title: "Shell / build debug",
      summary: "Reproduce failures in the shell, fix, and re-run.",
      steps: [
        "Reproduce with execute_command (note exit code + duration).",
        "Read logs and related files; prefer patch_file for minimal fixes.",
        "Re-run the failing command; use execute_command_cancel if hung.",
        "Use shell_open/write/read only for interactive installers.",
        "local/desktop_exec only with approved=true.",
      ],
    },
  };

  /**
   * Auto-pick skills from the user prompt (no explicit use_skill needed).
   */
  function detectSkills(text) {
    const t = String(text || "").toLowerCase();
    const found = new Set();
    if (
      /\b(build|code|implement|scaffold|app|website|script|function|api|refactor|fix)\b/.test(
        t,
      )
    ) {
      found.add("coding");
    }
    if (/\b(document|readme|markdown|docs|write.?up|spec|pdf|report|guide|manual|essay|proposal|slide)\b/.test(t)) {
      found.add("documents");
    }
    if (/\b(git|commit|push|repo|repository|version control)\b/.test(t)) {
      found.add("git");
    }
    if (/\b(debug|error|bug|failing|stack.?trace)\b/.test(t)) {
      found.add("debugging");
    }
    if (
      /\b(explore|inspect|search|find files|research)\b/.test(t)
    ) {
      found.add("research");
    }
    if (
      /\b(browser|navigate|click|website|web page|url|screenshot|fill form|login page)\b/.test(
        t,
      ) ||
      /https?:\/\//.test(t)
    ) {
      found.add("browser");
    }
    if (
      /\b(computer|desktop|shell|terminal|http request|curl|download|os|system)\b/.test(
        t,
      )
    ) {
      found.add("computer");
    }
    if (
      /\b(byok|api key|openrouter|anthropic|openai|gemini|bring your own)\b/.test(
        t,
      )
    ) {
      found.add("byok_setup");
    }
    if (
      /\b(web research|research the web|cite sources|summarize articles|fetch.?url)\b/.test(
        t,
      )
    ) {
      found.add("web_research");
    }
    if (
      /\b(login|sign in|2fa|captcha|fill (the )?form|checkout|submit form)\b/.test(
        t,
      )
    ) {
      found.add("form_workflow");
    }
    if (/\b(pull request|pr\b|code review|patch|commit message)\b/.test(t)) {
      found.add("code_pr");
    }
    if (/\b(csv|spreadsheet|table data|cleanup data|data clean)\b/.test(t)) {
      found.add("data_cleanup");
    }
    if (
      /\b(network error|console error|ops debug|site broken|har\b|failed request)\b/.test(
        t,
      )
    ) {
      found.add("ops_debug");
    }
    if (
      /\b(password|secret|credential|api token|never share|account safe)\b/.test(
        t,
      )
    ) {
      found.add("account_safe");
    }
    if (/\b(remember|memory|note that|remind me|schedule)\b/.test(t)) {
      found.add("memory_schedule");
    }
    if (
      /\b(shell|terminal|npm (test|run|install)|pytest|make |cargo |go test|debug (the )?build|exit code)\b/.test(
        t,
      )
    ) {
      found.add("shell_debug");
    }
    if (found.has("coding") && (found.has("documents") || found.has("git"))) {
      found.add("project");
    }
    if (!found.size && /\b(create|make|write|plan)\b/.test(t)) {
      found.add("coding");
    }
    return [...found];
  }

  // ─── Skill-scoped tool availability ─────────────────────────────

  // Browser control tools are only enabled for browse/computer-driven skills;
  // they tempt the model off-track during coding/git tasks and cost tokens.
  const BROWSER_CONTROL_TOOLS = [
    "tabs_create",
    "navigate",
    "computer",
    "read_page",
    "find",
    "form_input",
    "get_page_text",
  ];

  const CORE_TOOLS = [
    "todo",
    "todo_write",
    "plan",
    "list_skills",
    "use_skill",
    "ask_user_input",
    "search_mcp_registry",
    "suggest_connectors",
    "call_mcp",
    "list_mcp_tools",
    "search_web",
    "http_request",
    "fetch_url",
    "download_file",
    "upload_artifact",
    "patch_file",
    "csv_read",
    "csv_write",
    "csv_query",
    "memory_get",
    "memory_set",
    "memory_delete",
    "schedule_create",
    "remind",
    "schedule_list",
    "schedule_cancel",
    "schedule_due",
    "test_connection",
    "execute_command",
    "execute_command_cancel",
    "shell_open",
    "shell_write",
    "shell_read",
    "shell_close",
    "desktop_exec",
    "desktop_pty",
    "read_file",
    "write_file",
    "append_file",
    "list_directory",
    "create_directory",
    "delete_file",
    "copy_file",
    "find_files",
    "search_code",
    "run_javascript",
    "run_python",
    "create_document",
    "create_pdf",
    "export_document",
    "verify_project",
    "view_tree",
    "git_init",
    "git_add",
    "git_commit",
    "git_status",
    "git_log",
    "git_push",
    "desktop_status",
    "desktop_open",
    "desktop_screenshot",
    "desktop_clipboard_get",
    "desktop_clipboard_set",
    "desktop_notify",
    "desktop_type",
    "desktop_hotkey",
    "desktop_click",
  ];

  /**
   * Return the tool names the model may use for the detected skills.
   * Browser control tools require the "browser" or "computer" skill.
   */
  function toolsForSkills(names) {
    const list = CORE_TOOLS.slice();
    const namesList = names || [];
    if (
      namesList.indexOf("browser") !== -1 ||
      namesList.indexOf("computer") !== -1 ||
      namesList.indexOf("form_workflow") !== -1 ||
      namesList.indexOf("ops_debug") !== -1 ||
      namesList.indexOf("web_research") !== -1
    ) {
      list.push(...BROWSER_CONTROL_TOOLS);
      list.push(
        "browser_network",
        "browser_console",
        "ocr_image",
        "list_frames",
        "switch_frame",
        "await_login",
      );
    }
    return list;
  }

  function skillBrief(names) {
    return (names || [])
      .map((n) => {
        const s = getSkill(n);
        return s
          ? "Skill " + s.name + ": " + s.summary + " → " + s.steps.slice(0, 3).join("; ")
          : n;
      })
      .join("\n");
  }

  function listSkills() {
    return Object.values(SKILLS).map((s) => ({
      name: s.name,
      title: s.title,
      summary: s.summary,
    }));
  }

  function getSkill(name) {
    const key = String(name || "")
      .toLowerCase()
      .trim();
    return SKILLS[key] || null;
  }

  function formatSkill(skill) {
    if (!skill) return "(unknown skill)";
    return (
      "# Skill: " +
      skill.title +
      "\n" +
      skill.summary +
      "\n\nFollow these steps:\n" +
      skill.steps.map((step, i) => i + 1 + ". " + step).join("\n")
    );
  }

  window.ChatreSkills = {
    SKILLS,
    listSkills,
    getSkill,
    formatSkill,
    detectSkills,
    skillBrief,
    toolsForSkills,
  };
})();
