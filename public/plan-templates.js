/**
 * Plan templates for common Chatre workflows.
 */
(function () {
  "use strict";

  const TEMPLATES = [
    {
      id: "research",
      label: "Research X",
      task_type: "research",
      understanding: "User wants a sourced research summary on a topic.",
      goal: "Produce a concise research brief with citations",
      success_criteria: [
        "Use search_web (not a search-engine site)",
        "Open 2–3 strong sources and extract facts",
        "Final answer cites [web:N] ids",
      ],
      approach: [
        "Clarify topic if vague",
        "search_web with 2–3 focused queries",
        "Navigate top results; get_page_text / read_page",
        "Synthesize short original summary with citations",
      ],
      tools_priority: ["search_web", "tabs_create", "navigate", "get_page_text"],
      max_steps: 10,
      executor_brief:
        "Research the user topic thoroughly. Prefer search_web, then read primary pages. Cite tool ids. Do not invent sources.",
    },
    {
      id: "fill-form",
      label: "Fill form Y",
      task_type: "browser",
      understanding: "User wants a web form filled and submitted carefully.",
      goal: "Complete the form accurately with confirmations for risky submits",
      success_criteria: [
        "Locate form fields via read_page/find",
        "Fill with provided values only",
        "Ask confirmation before irreversible submit",
      ],
      approach: [
        "Navigate to the form URL",
        "read_page interactive; map fields",
        "form_input / computer type for each field",
        "Pause for login/2FA if needed",
        "Confirm before submit",
      ],
      tools_priority: [
        "tabs_create",
        "navigate",
        "read_page",
        "find",
        "form_input",
        "computer",
        "await_login",
      ],
      max_steps: 14,
      executor_brief:
        "Fill the form using refs. Never invent personal data. Use await_login if auth walls appear. Confirm before submit/purchase.",
    },
    {
      id: "build",
      label: "Build Z",
      task_type: "build",
      understanding: "User wants a small software artifact built and verified.",
      goal: "Implement, verify, and report paths",
      success_criteria: [
        "Explore workspace first",
        "Implement requested files",
        "Run verify_project or equivalent checks",
      ],
      approach: [
        "view_tree / list_directory",
        "plan + todos",
        "write_file changes",
        "verify_project / execute_command",
        "Summarize how to run",
      ],
      tools_priority: [
        "view_tree",
        "read_file",
        "write_file",
        "todo_write",
        "verify_project",
        "execute_command",
      ],
      max_steps: 16,
      executor_brief:
        "Build exactly what was asked. Explore first, implement, verify, then finish with file paths and run instructions.",
    },
    {
      id: "document",
      label: "Write document",
      task_type: "document",
      understanding: "User wants a downloadable document or PDF.",
      goal: "Produce a real file under /home/user/documents",
      success_criteria: [
        "create_document or create_pdf succeeds",
        "File path reported to the user",
      ],
      approach: [
        "Decide markdown vs PDF from the request",
        "Draft structured content",
        "create_document or create_pdf",
        "Confirm path in Files panel",
      ],
      tools_priority: ["create_document", "create_pdf"],
      max_steps: 6,
      executor_brief:
        "Deliver one real downloadable file via create_document or create_pdf under /home/user/documents. Do not invent download links.",
    },
  ];

  function getTemplate(id) {
    return TEMPLATES.find(function (t) {
      return t.id === id;
    });
  }

  function listTemplates() {
    return TEMPLATES.map(function (t) {
      return { id: t.id, label: t.label, task_type: t.task_type };
    });
  }

  function briefingFromTemplate(id, userGoal) {
    const t = getTemplate(id);
    if (!t) return null;
    const goal = String(userGoal || t.goal || "").trim();
    return {
      understanding: t.understanding,
      goal: goal || t.goal,
      task_type: t.task_type,
      success_criteria: (t.success_criteria || []).slice(),
      approach: (t.approach || []).slice(),
      tools_priority: (t.tools_priority || []).slice(),
      do_not: [],
      constraints: [],
      needs_clarification: false,
      clarification_question: "",
      max_steps: t.max_steps,
      executor_brief:
        t.executor_brief +
        (goal ? "\n\nUser goal: " + goal : ""),
      todos: (t.approach || []).map(function (step, i) {
        return { id: "t" + (i + 1), content: step, status: "pending" };
      }),
      template_id: t.id,
    };
  }

  window.ChatrePlanTemplates = {
    TEMPLATES: TEMPLATES,
    listTemplates: listTemplates,
    getTemplate: getTemplate,
    briefingFromTemplate: briefingFromTemplate,
  };
})();
