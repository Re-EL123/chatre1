/**
 * Client-side tool allowlists by task_type (mirrors API).
 */
(function () {
  "use strict";

  const ALWAYS = [
    "todo",
    "todo_write",
    "plan",
    "list_skills",
    "use_skill",
    "ask_user_input",
    "desktop_status",
    "desktop_open",
    "desktop_screenshot",
    "desktop_clipboard_get",
    "desktop_clipboard_set",
    "desktop_notify",
  ];

  const BY_TYPE = {
    chat: ALWAYS.slice(),
    question: ALWAYS.concat([
      "search_web",
      "http_request",
      "read_file",
      "list_directory",
      "find_files",
      "search_code",
      "view_tree",
      "get_page_text",
      "navigate",
      "tabs_create",
      "read_page",
    ]),
    research: ALWAYS.concat([
      "search_web",
      "http_request",
      "tabs_create",
      "navigate",
      "computer",
      "read_page",
      "find",
      "get_page_text",
      "form_input",
      "read_file",
      "create_document",
      "view_tree",
    ]),
    browser: ALWAYS.concat([
      "search_web",
      "http_request",
      "tabs_create",
      "navigate",
      "computer",
      "read_page",
      "find",
      "form_input",
      "get_page_text",
    ]),
    document: ALWAYS.concat([
      "search_web",
      "read_file",
      "write_file",
      "create_document",
      "create_pdf",
      "view_tree",
      "execute_command",
    ]),
    git: ALWAYS.concat([
      "git_init",
      "git_add",
      "git_commit",
      "git_status",
      "git_log",
      "git_push",
      "execute_command",
      "read_file",
      "view_tree",
    ]),
    run: ALWAYS.concat([
      "execute_command",
      "run_javascript",
      "run_python",
      "verify_project",
      "read_file",
      "view_tree",
    ]),
    build: null,
    debug: null,
    mixed: null,
  };

  function assertToolAllowed(tool, taskType, toolsPriority) {
    const allowed = BY_TYPE[String(taskType || "mixed").toLowerCase()];
    if (!allowed) return { ok: true };
    if (Array.isArray(toolsPriority) && toolsPriority.indexOf(tool) !== -1) {
      return { ok: true };
    }
    if (allowed.indexOf(tool) !== -1) return { ok: true };
    return {
      ok: false,
      error: 'Tool "' + tool + '" disabled for task_type=' + taskType,
    };
  }

  window.ChatreAllowlists = { assertToolAllowed: assertToolAllowed, BY_TYPE: BY_TYPE };
})();
