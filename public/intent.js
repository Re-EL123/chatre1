/**
 * Chatre Intent — deterministic, zero-LLM classification of the user's
 * request BEFORE any tool runs. The raw prompt must not directly trigger
 * tools: we first decide WHAT the user wants (a question? a PDF? research?
 * code?) and expose only the tools that fit, so a "what is X" never spawns
 * file writes and a "make me a PDF of X" produces a real downloaded file.
 *
 * Design notes (from agent-routing research):
 *  - Tool EXPOSURE is not agentic intent: greetings/questions get few or no
 *    tools even though they are routed through the same loop.
 *  - Deterministic scoring keeps this fast, free and dependable; anything we
 *    cannot classify falls back to "full" so the model (which understands the
 *    user's language) still decides safely.
 */
(function () {
  "use strict";

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
    "web_extract",
    "session_search",
    "execute_code",
    "apply_patch",
    "delegate_task",
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

  const BROWSER_TOOLS = [
    "tabs_create",
    "navigate",
    "computer",
    "read_page",
    "find",
    "form_input",
    "get_page_text",
  ];

  const DESKTOP_TOOLS = [
    "desktop_status",
    "desktop_open",
    "desktop_screenshot",
    "desktop_clipboard_get",
    "desktop_clipboard_set",
    "desktop_notify",
  ];

  const INTENT_TOOLS = {
    chat: [
      "ask_user_input",
      "clarify",
      "list_skills",
      "use_skill",
      "search_web",
      "memory_get",
    ],
    question: [
      "ask_user_input",
      "search_mcp_registry",
      "suggest_connectors",
      "call_mcp",
      "list_mcp_tools",
      "search_web",
      "http_request",
      "read_file",
      "write_file",
      "list_directory",
      "find_files",
      "search_code",
      "view_tree",
      "get_page_text",
      "list_skills",
      "execute_command",
      "execute_code",
      "run_javascript",
      "run_python",
    ],
    research: [
      "ask_user_input",
      "search_mcp_registry",
      "suggest_connectors",
      "call_mcp",
      "list_mcp_tools",
      "search_web",
      "http_request",
      "get_page_text",
      "read_file",
      "list_directory",
      "find_files",
      "search_code",
      "view_tree",
      "list_skills",
    ],
    document: [
      "ask_user_input",
      "search_mcp_registry",
      "suggest_connectors",
      "call_mcp",
      "list_mcp_tools",
      "create_document",
      "create_pdf",
      "export_document",
      "write_file",
      "append_file",
      "patch_file",
      "apply_patch",
      "create_directory",
      "read_file",
      "list_directory",
      "find_files",
      "search_code",
      "view_tree",
      "search_web",
      "http_request",
      "list_skills",
      "todo",
      "todo_write",
      "execute_command",
      "run_javascript",
      "run_python",
    ],
    build: CORE_TOOLS.slice(),
    debug: CORE_TOOLS.slice(),
    git: [
      "ask_user_input",
      "search_mcp_registry",
      "suggest_connectors",
      "call_mcp",
      "list_mcp_tools",
      "git_status",
      "git_log",
      "git_init",
      "git_add",
      "git_commit",
      "git_push",
      "todo",
      "todo_write",
      "read_file",
      "write_file",
      "patch_file",
      "apply_patch",
      "list_directory",
      "view_tree",
      "execute_command",
    ],
    run: [
      "ask_user_input",
      "search_mcp_registry",
      "suggest_connectors",
      "call_mcp",
      "list_mcp_tools",
      "execute_command",
      "execute_code",
      "run_javascript",
      "run_python",
      "write_file",
      "patch_file",
      "apply_patch",
      "create_directory",
      "read_file",
      "list_directory",
      "find_files",
      "search_code",
      "view_tree",
      "todo",
      "todo_write",
      "git_status",
      "git_log",
      "verify_project",
      "process_manage",
    ],
    browser: CORE_TOOLS.slice().concat(BROWSER_TOOLS).concat(DESKTOP_TOOLS),
    full: CORE_TOOLS.slice(),
  };

  const LABELS = {
    chat: "a casual message — answer directly, no tools",
    question: "a question — answer clearly; research the web only if needed",
    research: "deep research — gather and synthesize from multiple sources",
    document: "a document/PDF request — produce a downloadable file",
    build: "a build/code task — plan, implement, verify",
    debug: "a debugging task — reproduce, fix, verify",
    git: "a git task — manage version control",
    run: "a run/execute request — run the code/command and report",
    browser: "a browsing task — use browser tools",
    full: "a complex or ambiguous request — use your best judgment",
  };

  // Intents that may change the workspace or run commands.
  const MUTATIVE = new Set([
    "build",
    "debug",
    "git",
    "run",
    "document",
    "browser",
    "full",
  ]);

  // Intents that should plan first and verify after writes.
  const PLANNING = new Set(["build", "debug", "git", "run", "full"]);

  const CHAT_FIRST_WORDS = new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "hiya",
    "howdy",
    "sup",
    "thanks",
    "thank",
    "thx",
    "ty",
    "bye",
    "goodbye",
    "ok",
    "okay",
    "sure",
    "alright",
    "cool",
    "nice",
    "wow",
    "haha",
    "lol",
    "great",
    "perfect",
  ]);

  const QUICK_CHAT_PATTERNS = [
    /^(?:hi|hello|hey|yo|hiya|howdy|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|thx|ty|bye|goodbye|see\s+you|ok|okay|sure|alright|cool|nice|wow|great|perfect|lol|haha)[.!?]*$/i,
    /^(?:how\s+are\s+you|what'?s?\s+up|how'?s\s+it\s+going)[.!?]*$/i,
  ];

  // Words that suggest the answer will need current/live information.
  const WEB_WORDS = [
    "latest",
    " news",
    "today",
    "yesterday",
    "this week",
    "this year",
    "announced",
    "released",
    "current",
    "official",
    "score",
    "weather",
    "price",
    "population",
    "results",
    "winner",
    "ranking",
    "stock",
    "election",
    "live",
    "2026",
    "2027",
  ];

  const Q_WORDS = [
    "what",
    "what's",
    "whats",
    "who",
    "whose",
    "when",
    "where",
    "why",
    "how does",
    "how do",
    "how to",
    "which",
    "can you",
    "could you",
    "meaning",
    "difference",
    "explain",
    "define",
    "definition",
    "tell me",
    "example",
    "examples",
    "about",
    "is it",
    "does it",
    "do you",
    "what is the",
    "explain the",
  ];

  const RESEARCH_WORDS = [
    "research",
    "investigate",
    "deep dive",
    "in-?depth",
    "comprehensive",
    "thorough",
    "compare",
    "comparison",
    "analy",
    "gather",
    "look up",
    "sources",
    "multiple sources",
    "state of the art",
    "trends",
    "overview",
    "study",
    "report on",
    "summarize",
    "analysis of",
    "explore",
  ];

  const BUILD_WORDS = [
    "build",
    "implement",
    "scaffold",
    "develop",
    "create an app",
    "create a web",
    "create the",
    "write code",
    "code this",
    "program",
    "function",
    "class ",
    "component",
    "api",
    "endpoint",
    "backend",
    "frontend",
    "server",
    "database",
    "schema",
    "migration",
    "script",
    "module",
    "feature",
    "fix this ",
    "can you write",
    "refactor",
    "app that",
    "website",
    "web app",
    "make an",
    "make a web",
    "project structure",
    "setup",
    "set up",
    "cli tool",
    "library",
    "npm package",
  ];

  const DEBUG_WORDS = [
    "debug",
    "error",
    "bug",
    "crashes",
    "crashing",
    "crash",
    "broken",
    "failing",
    "fails",
    "not working",
    "doesn't work",
    "doesnt work",
    "exception",
    "stack trace",
    "traceback",
    "issue",
    "fix the",
    "fix this bug",
    "why does",
    "reason it",
  ];

  const GIT_WORDS = [
    "git",
    "commit",
    "commit and push",
    "push",
    "branch",
    "merge",
    "repo",
    "repository",
    "clone",
    "rebase",
    "staging",
    "stage",
  ];

  const RUN_WORDS = [
    "run this",
    "run the code",
    "run it",
    "execute this",
    "executed",
    "eval",
    "try running",
    "test this",
    "test it",
    "what does this code do",
    "what does the code do",
    "take a look at this code",
    "here is the code",
    "here's the code",
    "run the script",
    "compile",
    "interpret",
  ];

  const DOC_WORDS = [
    "pdf",
    "docx",
    "pptx",
    "xlsx",
    "spreadsheet",
    "document",
    "readme",
    "markdown",
    "md file",
    "report",
    "guide",
    "handbook",
    "manual",
    "letter",
    "essay",
    "article",
    "cheat sheet",
    "slides",
    "slide deck",
    "powerpoint",
    "resume",
    "cv",
    "proposal",
    "contract",
    "notes",
    "write up",
    "writeup",
    "spec",
    "summary of",
    "outline",
  ];

  const BROWSER_WORDS = [
    "navigate to",
    "open the website",
    "open the page",
    "visit",
    "go to the website",
    "browse",
    "website at",
    "open this url",
    "open the link",
    "login page",
    "fill the form",
    "click on",
    "take a screenshot",
    "screenshot of",
  ];

  function contains(text, words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) {
      // Word-boundary matching: "repo" must NOT match inside "report",
      // "app" must not match inside "apple". The word lists keep a couple of
      // deliberate regex fragments ("in-?depth"), which stay valid here.
      var w = String(words[i]).trim();
      var re = new RegExp("(?:^|[^a-z0-9])" + w + "(?:$|[^a-z0-9])", "i");
      if (re.test(text)) n += 1;
    }
    return n;
  }

  function scoreCat(text, words, weight) {
    return contains(text, words) * (weight || 1);
  }

  function makeResult(name, opt) {
    opt = opt || {};
    var tools = INTENT_TOOLS[name] || INTENT_TOOLS.full;
    var wantsBrowserSkills =
      (opt.skills || []).indexOf("browser") !== -1 ||
      (opt.skills || []).indexOf("computer") !== -1 ||
      (opt.skills || []).indexOf("dogfood") !== -1 ||
      (opt.skills || []).indexOf("form_workflow") !== -1 ||
      (opt.skills || []).indexOf("ops_debug") !== -1;
    var list = (tools && tools.concat([])) || [];
    if (name === "full" && wantsBrowserSkills) {
      BROWSER_TOOLS.forEach(function (t) {
        if (list.indexOf(t) === -1) list.push(t);
      });
      DESKTOP_TOOLS.forEach(function (t) {
        if (list.indexOf(t) === -1) list.push(t);
      });
    }
    return {
      name: name,
      label: LABELS[name] || LABELS.full,
      needsTools: list.length > 0,
      mutative: MUTATIVE.has(name),
      planFirst: PLANNING.has(name),
      suggestsWeb: !!(opt.web || name === "research"),
      tools: list,
      rationale: opt.rationale || "",
    };
  }

  /**
   * Classify a user message into an intent bucket. Pure rule-based scoring:
   * the FIRST strong signal wins ties in priority order, and anything
   * ambiguous falls back to "full" (all core tools) so the model decides.
   *
   * @param {string} text
   * @param {string[]} [skills] detected skill names (for browser gating)
   */
  function classifyIntent(text, skills) {
    const raw = String(text || "").trim();
    const t = raw.toLowerCase();
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    if (!t) return makeResult("chat", { skills });
    // Non-Latin scripts (Arabic, Chinese, …): a very short string is likely a
    // greeting; anything longer goes to "full" so the model (multilingual)
    // decides safely instead of being miscounted as symbol-only noise.
    if (!/[a-zA-Z0-9]/.test(raw)) {
      return makeResult(wordCount <= 4 ? "chat" : "full", { skills });
    }
    const clean = t.replace(/[!?.,;:]+$/g, "").trim();
    if (QUICK_CHAT_PATTERNS.some(function (re) { return re.test(clean); })) {
      return makeResult("chat", { skills });
    }
    // "hello there", "hey guys", "hi everyone" — short casual openers.
    const firstWord = (clean.split(/\s+/)[0] || "").replace(/[^a-z]/gi, "");
    if (
      wordCount <= 4 &&
      ["hi", "hello", "hey", "yo", "hiya", "howdy", "sup", "thanks", "thx"].indexOf(firstWord) !== -1
    ) {
      return makeResult("chat", { skills });
    }

    let web = WEB_WORDS.some(function (w) { return t.indexOf(w) !== -1; });

    // Code fences are an overwhelming build signal.
    let scores = {
      build: 0,
      debug: 0,
      git: 0,
      run: 0,
      research: 0,
      document: 0,
      browser: 0,
      question: 0,
    };
    if (/```/.test(raw)) scores.build += 10;
    if (/https?:\/\//.test(t)) {
      scores.browser += 5;
      web = true;
    }
    // Bare domains ("open example.com and login") are a browser signal too.
    if (/\b[\w-]+\.(?:com|org|net|io|ai|dev|app|co|gov|edu)\b/.test(t)) {
      scores.browser += 3;
    }

    scores.question += scoreCat(t, Q_WORDS, 1);
    scores.research += scoreCat(t, RESEARCH_WORDS, 2);
    scores.build += scoreCat(t, BUILD_WORDS, 2);
    scores.debug += scoreCat(t, DEBUG_WORDS, 2);
    scores.git += scoreCat(t, GIT_WORDS, 2);
    scores.run += scoreCat(t, RUN_WORDS, 2);
    scores.document += scoreCat(t, DOC_WORDS, 2);
    scores.browser += scoreCat(t, BROWSER_WORDS, 2);

    // PDFs are a hard, unmistakable artifact signal.
    if (/\bpdf\b/.test(t)) scores.document += 4;

    // "report the results" is a run/answer request, not a document.
    if (/report\s+(?:the\s+)?(?:results|progress|output|findings|outcome)/.test(t)) {
      scores.document -= 3;
    }
    // "fix the X" style maps to debug even when build words appear.
    if (/\b(?:fix|repair|resolve)\b/.test(t)) {
      scores.debug += 3;
      scores.build -= 1;
    }
    // "debug the X error" — keep debug ahead of question.
    if (scores.debug >= scores.question && /(debug|error|bug|broken)/.test(t)) {
      scores.question = 0;
    }
    // A question LEAD ("explain ...", "what is ...", "how to ...") means the
    // user wants an explanation — even if build/code words follow
    // ("explain how to build an app" is a question, not a build task).
    const strongQuestionLead =
      /(^|[;,.!?\n])\s*(?:explain|describe|what(?:'?s| is| are| do| does)?|why|how\s*(?:does|do|to))\b/i.test(
        raw,
      ) &&
      !/^\s*(?:please\s+)?(?:build|create|make|write|implement|scaffold|code|set\s*up)\b/i.test(
        raw,
      );
    if (strongQuestionLead) {
      scores.question += 4;
      scores.build -= 2;
      scores.debug -= 1;
      scores.run -= 1;
    }
    // Short "what is X" → question unless something stronger matched.
    if (web) {
      scores.question += 2;
      scores.research += 2;
    }

    const maxScore = Object.keys(scores).reduce(function (m, k) {
      return Math.max(m, scores[k]);
    }, 0);

    if (maxScore >= 3) {
      // Priority order breaks ties: browser > document > debug > build > git
      // > run > research > question — a stronger artifact signal wins.
      const priority = [
        "browser",
        "document",
        "debug",
        "build",
        "git",
        "run",
        "research",
        "question",
      ];
      for (var i = 0; i < priority.length; i++) {
        if (scores[priority[i]] === maxScore) {
          return makeResult(priority[i], {
            skills,
            web,
            rationale:
              priority[i] + " scored " + maxScore + " (question " + scores.question + ")",
          });
        }
      }
    }

    if (maxScore >= 1 && wordCount <= 8) {
      // Use the same priority order so "write me an essay about friendship"
      // (document) beats "about" (question), and "build a todo app in react"
      // (build) isn't ignored by a short-question bias.
      const priority = [
        "browser",
        "document",
        "debug",
        "build",
        "git",
        "run",
        "research",
        "question",
      ];
      for (var j = 0; j < priority.length; j++) {
        if (scores[priority[j]] === maxScore) {
          return makeResult(priority[j], { skills, web });
        }
      }
    }

    if (web && maxScore >= 1) {
      return makeResult(maxScore >= 2 && scores.research > 0 ? "research" : "question", {
        skills,
        web,
      });
    }

    if (wordCount <= 8 && maxScore < 2) {
      return makeResult("question", { skills, web });
    }

    // Long, unmatched, or mixed-language → let the model decide safely.
    return makeResult("full", { skills, web });
  }

  window.ChatreIntent = {
    classifyIntent,
    INTENT_TOOLS,
    CORE_TOOLS,
    BROWSER_TOOLS,
  };
})();