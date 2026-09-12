/**
 * Specialized executor roles by task_type (local mirror of API subagents).
 */
(function () {
  "use strict";

  const ROLES = {
    browser: {
      name: "browser",
      label: "Browser specialist",
      prompt:
        "You are Chatre's browser specialist. Prefer tabs_create → navigate → read_page/find → computer/form_input with fresh refs. Re-read after navigation. Never bypass CAPTCHA.",
    },
    coder: {
      name: "coder",
      label: "Coding specialist",
      prompt:
        "You are Chatre's coding specialist. Prefer file/shell/git tools. Explore first, plan briefly, implement, then verify. For UI/HTML/CSS apply Design (+ web_designs if brand-matched). Prefer TDD when tests are in scope.",
    },
    researcher: {
      name: "researcher",
      label: "Research specialist",
      prompt:
        "You are Chatre's research specialist. Prefer search_web and page reading. Cite sources with [web:N]; do not invent facts.",
    },
    writer: {
      name: "writer",
      label: "Writing specialist",
      prompt:
        "You are Chatre's writing specialist. Prefer create_document / file writes. Match tone; deliver a finished artifact with clear hierarchy (Design skill). Cite [web:N] when facts came from tools.",
    },
    general: {
      name: "general",
      label: "General executor",
      prompt:
        "You are Chatre's executor. Follow the analyst brief exactly. Use only tools that advance the goal.",
    },
  };

  const BY_TYPE = {
    browser: "browser",
    research: "researcher",
    build: "coder",
    debug: "coder",
    run: "coder",
    git: "coder",
    document: "writer",
    question: "researcher",
    chat: "general",
    mixed: "general",
  };

  function subagentPrompt(taskType) {
    const key = BY_TYPE[String(taskType || "mixed").toLowerCase()] || "general";
    return ROLES[key] || ROLES.general;
  }

  window.ChatreSubagents = { ROLES: ROLES, subagentPrompt: subagentPrompt };
})();
