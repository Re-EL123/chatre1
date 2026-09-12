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
        "Implement by calling write_file for EACH file under /home/user/projects/<slug>/ with FULL content — never Python open()/zipfile or chat-only dumps.",
        "For UI/HTML/CSS/frontends, follow the Design skill (composition, brand, type, avoid AI-slop themes).",
        "list_directory to confirm real paths; Files panel = downloadable — never invent Download links.",
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
        "Apply Design skill: clear hierarchy, scannable sections, whitespace — no wall-of-text.",
        "For a PDF/report/guide/book request, call create_pdf(title, content) with the FULL text — never invent Python/fpdf, /mnt/data paths, or fake download links.",
        "Use create_document to save markdown under /home/user/documents/.",
        "Only claim a file exists after the tool returns ok with a path; tell the user to open Files.",
      ],
    },
    design: {
      name: "design",
      title: "Design & visual craft",
      summary:
        "Process + taste for UI/HTML/docs: surface archetype first, then tokens, then craft.",
      steps: [
        "Name ONE surface before tokens: Monitor, Operate, Compare, Configure, Decide/Learn, Explore, or Command/Inspect. Hero+three-cards is Decide/Learn only.",
        "Gather context: brand docs, repo theme/tokens, screenshots — read real files, not just the tree.",
        "Choose one visual direction; define CSS variables early.",
        "Brand first: product name is hero-level on branded surfaces.",
        "One composition per first viewport; full-bleed heroes without overlay junk; default no cards.",
        "Purposeful fonts (avoid Inter/Roboto/Arial defaults unless matching web_designs); atmospheric backgrounds.",
        "Avoid AI-slop: purple-on-white, cream+terracotta serif, broadsheet, dark+glow+pill spam.",
        "Accessible contrast, focus states, solid mobile + desktop.",
        "For brand looks load web_designs; for DESIGN.md tokens use design_system.",
        "Docs/PDFs: H1→H2 hierarchy, scannable sections — no wall-of-text.",
      ],
    },
    web_designs: {
      name: "web_designs",
      title: "Popular web designs",
      summary:
        "Apply condensed Stripe/Linear/Vercel/… design tokens when matching a known look.",
      steps: [
        "Resolve style id (stripe, linear, vercel, notion, apple, framer, supabase, airbnb, spotify, resend, mintlify, raycast, figma, ibm, spacex).",
        "use_skill name=web_designs with style=<id> (or rely on auto-matched template).",
        "Paste fonts + CSS variables into the artifact; adapt layout to the brief.",
        "Pair with design skill (surface archetype first).",
        "write_file complete HTML under /home/user/projects/<slug>/.",
        "Match visual language only — do not invent trademarked logos.",
      ],
    },
    design_system: {
      name: "design_system",
      title: "DESIGN.md tokens",
      summary: "Author DESIGN.md token specs agents can reuse across a project.",
      steps: [
        "Infer brand tone, accent, and typography (ask if missing).",
        "write_file DESIGN.md with YAML tokens (name, colors, typography, components as sibling keys) + markdown rationale.",
        "Use {colors.primary} references in components; quote hex and negative dimensions.",
        "Optional theme.css :root export beside it.",
        "Call out WCAG ~4.5:1 contrast for body text.",
      ],
    },
    architecture_diagram: {
      name: "architecture_diagram",
      title: "Architecture diagrams",
      summary: "Dark-themed standalone HTML+SVG system diagrams.",
      steps: [
        "Clarify components, edges, and groups.",
        "write_file *-architecture.html under projects/ or documents/.",
        "Dark canvas, grid, labeled nodes/arrows, legend — no external libs.",
        "Confirm path; tell user to open from Files.",
      ],
    },
    dogfood: {
      name: "dogfood",
      title: "Exploratory QA",
      summary: "Browser dogfooding with evidence and a ranked bug report.",
      steps: [
        "Plan pages/flows with todos; create a dogfood output folder.",
        "tabs_create → navigate → read_page/screenshot → browser_console after key steps.",
        "Test forms (valid+invalid), nav, empty states, long content.",
        "Record URL, steps, expected vs actual, severity, category.",
        "create_document a severity-ranked report — only claim issues you observed.",
      ],
    },
    grounded_citations: {
      name: "grounded_citations",
      title: "Grounded citations",
      summary: "Cite only tool-backed sources with [web:N] / [screenshot:N].",
      steps: [
        "search_web / fetch_url before asserting outside facts.",
        "Cite inline with exact tool ids; max 3 per sentence.",
        "Append Sources from tool URLs only — never invent ids.",
        "Mark unsourced high-stakes claims [unverified].",
      ],
    },
    codebase_inspection: {
      name: "codebase_inspection",
      title: "Codebase inspection",
      summary: "Map workspace layout, languages, and entrypoints before big edits.",
      steps: [
        "view_tree / list_directory on the project root.",
        "find_files for manifests and entrypoints; read_file them.",
        "search_code for key symbols/routes.",
        "Summarize layout, languages, risks — read-only unless asked to edit.",
      ],
    },
    spike: {
      name: "spike",
      title: "Spike / throwaway experiment",
      summary: "Smallest disposable prototype to answer one unknown, then verdict.",
      steps: [
        "Decompose the unknown; research if knowable without building.",
        "Build a tiny SPIKE under /home/user/projects/<slug>-spike/.",
        "Write a verdict: works / doesn't / remaining unknowns.",
        "Do not polish or merge unless the user promotes it.",
      ],
    },
    simplify_code: {
      name: "simplify_code",
      title: "Simplify code",
      summary: "Cleanup pass: reuse, quality, efficiency, altitude — not bug hunting.",
      steps: [
        "Inspect recent changes (git_status / read_file).",
        "Review for duplication, clarity, waste, and wrong abstraction level.",
        "patch_file surgical cleanups only.",
        "verify_project / execute_command after edits.",
      ],
    },
    tdd: {
      name: "tdd",
      title: "Test-driven development",
      summary: "RED → GREEN → REFACTOR. Tests before production code.",
      steps: [
        "Write a failing test for the behavior first.",
        "Confirm RED (the right failure).",
        "Minimal implementation to pass; confirm GREEN.",
        "Refactor with tests still green.",
        "Bugs: failing repro test before the fix.",
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
      title: "Systematic debugging",
      summary: "Root cause before fixes: tight red loop, hypotheses, one change at a time.",
      steps: [
        "Read full errors/stack traces; do not skip warnings.",
        "Build a tight feedback loop (test/command) that is red on the bug.",
        "Trace data flow to the source; check recent git changes.",
        "Form ranked falsifiable hypotheses; change one variable.",
        "Prefer a failing test then one root-cause fix; re-verify.",
        "After 3 failed fixes: stop and question architecture with the user.",
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
      /\b(build|code|implement|scaffold|app|website|script|function|api|refactor|fix|game|html|css|javascript|\.js\b|\.html\b|\.css\b|canvas|react|vue|svelte|typescript|\.ts\b|frontend|webpage|web page)\b/.test(
        t,
      )
    ) {
      found.add("coding");
    }
    if (/\b(document|readme|markdown|docs|write.?up|spec|pdf|report|guide|manual|essay|proposal|slide|book)\b/.test(t)) {
      found.add("documents");
    }
    if (
      /\b(design|ui|ux|visual|layout|brand(ing)?|theme|aesthetic|typography|palette|style.?guide|mockup|wireframe|landing.?page|hero|look.?and.?feel|frontend|stylesheet|tailwind|css\b)\b/.test(
        t,
      )
    ) {
      found.add("design");
    }
    if (
      /\b(design\.md|designmd|design tokens|token spec|dtcg|wcag.*(palette|contrast)|tailwind theme)\b/.test(
        t,
      )
    ) {
      found.add("design_system");
    }
    if (
      (window.ChatreWebDesigns &&
        window.ChatreWebDesigns.resolveFromText &&
        window.ChatreWebDesigns.resolveFromText(t)) ||
      /\b(like (stripe|linear|vercel|notion|apple|framer|supabase|airbnb|spotify|resend|mintlify|raycast|figma|ibm|spacex)|popular web design|design system catalog)\b/.test(
        t,
      )
    ) {
      found.add("web_designs");
      found.add("design");
    }
    if (
      /\b(architecture diagram|system diagram|infra diagram|svg diagram|service map|cloud diagram)\b/.test(
        t,
      )
    ) {
      found.add("architecture_diagram");
    }
    if (
      /\b(dogfood|exploratory qa|qa (the |this )?site|bug report|find bugs|usability test)\b/.test(
        t,
      )
    ) {
      found.add("dogfood");
    }
    if (
      /\b(cite sources|grounded|with citations|fact.?check|verifiable sources|sources?:)\b/.test(
        t,
      )
    ) {
      found.add("grounded_citations");
    }
    if (
      /\b(inspect (the )?codebase|codebase size|lines of code|\bloc\b|language breakdown|map the (repo|codebase))\b/.test(
        t,
      )
    ) {
      found.add("codebase_inspection");
    }
    if (
      /\b(spike|throwaway|proof of concept|\bpoc\b|feasibility|quick prototype|see if .+ works)\b/.test(
        t,
      )
    ) {
      found.add("spike");
    }
    if (
      /\b(simplify|clean up (my |the )?code|reduce complexity|dedupe|dead code)\b/.test(
        t,
      )
    ) {
      found.add("simplify_code");
    }
    if (
      /\b(tdd|test.?driven|red.?green.?refactor|write (the )?tests? first)\b/.test(
        t,
      )
    ) {
      found.add("tdd");
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
    if (
      found.has("coding") &&
      /\b(website|web.?app|landing|homepage|html|css|react|vue|svelte|ui|interface|dashboard|page|component|frontend)\b/.test(
        t,
      )
    ) {
      found.add("design");
    }
    if (
      found.has("documents") &&
      /\b(slide|deck|presentation|brochure|poster|newsletter|polished|beautiful|pretty|styled|visual|layout)\b/.test(
        t,
      )
    ) {
      found.add("design");
    }
    if (
      (found.has("web_research") || found.has("research")) &&
      /\b(report|brief|comparison|news|current state)\b/.test(t)
    ) {
      found.add("grounded_citations");
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
    "skill_view",
    "skill_manage",
    "ask_user_input",
    "clarify",
    "search_mcp_registry",
    "suggest_connectors",
    "call_mcp",
    "list_mcp_tools",
    "search_web",
    "http_request",
    "fetch_url",
    "web_extract",
    "session_search",
    "download_file",
    "upload_artifact",
    "patch_file",
    "apply_patch",
    "execute_code",
    "process_manage",
    "vision_analyze",
    "video_analyze",
    "image_generate",
    "text_to_speech",
    "delegate_task",
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
      namesList.indexOf("web_research") !== -1 ||
      namesList.indexOf("dogfood") !== -1
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

  function formatSkill(skill, params) {
    if (!skill) return "(unknown skill)";
    var body =
      "# Skill: " +
      skill.title +
      "\n" +
      skill.summary +
      "\n\nFollow these steps:\n" +
      skill.steps.map((step, i) => i + 1 + ". " + step).join("\n");
    if (
      skill.name === "web_designs" &&
      window.ChatreWebDesigns &&
      window.ChatreWebDesigns.catalogBrief
    ) {
      body += "\n\n" + window.ChatreWebDesigns.catalogBrief();
      var style =
        params && (params.style || params.template || params.id);
      if (style && window.ChatreWebDesigns.getDesign) {
        var tpl = window.ChatreWebDesigns.getDesign(style);
        if (tpl)
          body += "\n\n" + window.ChatreWebDesigns.formatTemplate(tpl);
      }
    }
    return body;
  }

  function pickPrimarySkill(skills, taskType) {
    var list = Array.isArray(skills) ? skills.slice() : [];
    var t = String(taskType || "").toLowerCase();
    var prefer = {
      document: "documents",
      build: "coding",
      debug: "debugging",
      git: "git",
      research: "research",
      browser: "browser",
      run: "computer",
      mixed: null,
    }[t];
    if (prefer && list.indexOf(prefer) >= 0) return [prefer];
    if (prefer && !list.length) return [prefer];
    if (list.indexOf("coding") >= 0) return ["coding"];
    if (list.indexOf("documents") >= 0) return ["documents"];
    if (list.indexOf("debugging") >= 0) return ["debugging"];
    if (list.length) return [list[0]];
    if (prefer) return [prefer];
    return [];
  }

  function wantsDesign(text, taskType, detected) {
    var list = Array.isArray(detected) ? detected : [];
    if (
      list.indexOf("design") >= 0 ||
      list.indexOf("web_designs") >= 0 ||
      list.indexOf("design_system") >= 0
    )
      return true;
    var t = String(taskType || "").toLowerCase();
    if (t === "document") return true;
    var msg = String(text || "").toLowerCase();
    return /\b(html|css|scss|react|vue|svelte|tailwind|frontend|landing|website|ui|ux|layout|hero|component|stylesheet|theme|brand|visual|mockup|wireframe|dashboard|page|design)\b/.test(
      msg,
    );
  }

  /** Primary delivery skill + design / citations / brand companions. */
  function composeActiveSkills(detected, taskType, userMessage) {
    var all = Array.isArray(detected) ? detected.slice() : [];
    var msg = String(userMessage || "").toLowerCase();

    if (all.indexOf("dogfood") >= 0) return ["dogfood"];
    if (all.indexOf("architecture_diagram") >= 0) {
      return ["architecture_diagram", "design"];
    }
    if (
      all.indexOf("design_system") >= 0 &&
      all.indexOf("coding") < 0
    ) {
      return ["design_system", "design"];
    }

    var specialty = ["spike", "tdd", "simplify_code", "codebase_inspection"];
    for (var i = 0; i < specialty.length; i++) {
      var s = specialty[i];
      if (
        all.indexOf(s) >= 0 &&
        !all.some(function (x) {
          return /^(coding|documents|debugging)$/.test(x);
        })
      ) {
        return [s];
      }
    }
    if (all.indexOf("simplify_code") >= 0 && /\bsimplify\b/.test(msg)) {
      return ["simplify_code"];
    }
    if (
      all.indexOf("codebase_inspection") >= 0 &&
      /\b(inspect|loc|breakdown|map the)\b/.test(msg)
    ) {
      return ["codebase_inspection"];
    }

    var delivery = all.filter(function (x) {
      return (
        x !== "design" && x !== "web_designs" && x !== "grounded_citations"
      );
    });
    var designOnly =
      (all.indexOf("design") >= 0 || all.indexOf("web_designs") >= 0) &&
      !delivery.some(function (x) {
        return /^(coding|documents|project|code_pr|debugging|git|dogfood|spike|tdd)$/.test(
          x,
        );
      });
    if (designOnly) {
      return all.indexOf("web_designs") >= 0
        ? ["web_designs", "design"]
        : ["design"];
    }
    var primary = pickPrimarySkill(
      delivery.length ? delivery : all,
      taskType,
    );
    var active = primary.slice();
    if (wantsDesign(userMessage, taskType, all) && active.indexOf("design") < 0) {
      active.push("design");
    }
    if (all.indexOf("web_designs") >= 0 && active.indexOf("web_designs") < 0) {
      active.push("web_designs");
    }
    if (
      all.indexOf("design_system") >= 0 &&
      active.indexOf("design_system") < 0
    ) {
      active.push("design_system");
    }
    if (
      all.indexOf("grounded_citations") >= 0 &&
      active.indexOf("grounded_citations") < 0
    ) {
      active.push("grounded_citations");
    }
    if (all.indexOf("tdd") >= 0 && active.indexOf("tdd") < 0) {
      active.push("tdd");
    }
    return active;
  }

  function designTemplateBlock(userMessage) {
    if (
      !window.ChatreWebDesigns ||
      !window.ChatreWebDesigns.resolveFromText ||
      !window.ChatreWebDesigns.formatTemplate
    )
      return "";
    var tpl = window.ChatreWebDesigns.resolveFromText(userMessage);
    if (!tpl) return "";
    return (
      "\n\n# Matched web design system\n" +
      window.ChatreWebDesigns.formatTemplate(tpl)
    );
  }

  window.ChatreSkills = {
    SKILLS,
    listSkills,
    getSkill,
    formatSkill,
    detectSkills,
    pickPrimarySkill,
    wantsDesign,
    composeActiveSkills,
    designTemplateBlock,
    skillBrief,
    toolsForSkills,
  };
})();
