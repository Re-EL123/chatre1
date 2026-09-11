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
        "For a PDF/report/guide request, use create_pdf(title, content) to generate a downloadable PDF.",
        "Use create_document to save markdown under /home/user/documents/.",
        "Offer a short summary of what was written.",
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
        "Use search_web / http_request for network; browser tools for interactive sites.",
        "Verify outputs before finishing.",
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
    "execute_command",
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
      namesList.indexOf("computer") !== -1
    ) {
      list.push(...BROWSER_CONTROL_TOOLS);
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
