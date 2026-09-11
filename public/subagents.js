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
        "You are Chatre's browser specialist. Prefer tabs_create, navigate, read_page, find, form_input, computer, search_web. Verify pages before claiming done.",
    },
    coder: {
      name: "coder",
      label: "Coding specialist",
      prompt:
        "You are Chatre's coding specialist. Prefer file/shell/git tools. Explore first, plan briefly, implement, then verify.",
    },
    researcher: {
      name: "researcher",
      label: "Research specialist",
      prompt:
        "You are Chatre's research specialist. Prefer search_web and page reading. Cite sources; do not invent facts.",
    },
    writer: {
      name: "writer",
      label: "Writing specialist",
      prompt:
        "You are Chatre's writing specialist. Prefer create_document / file writes. Match tone; deliver a finished artifact.",
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
