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
      summary: "Produce polished markdown documents users can download.",
      steps: [
        "Outline sections and set todos.",
        "Write complete content with headings, lists, and examples.",
        "Use create_document so the file is saved under /home/user/documents/.",
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
      summary: "OpenCode Build: plan → build → verify → document → commit.",
      steps: [
        "Explore, then plan + todo set.",
        "Build the full project structure with complete files.",
        "verify_project after implementation.",
        "create_document / README.",
        "git_init (if needed), git_add, git_commit, git_push.",
        "Final summary with paths and how to run.",
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
    if (/\b(document|readme|markdown|docs|write.?up|spec)\b/.test(t)) {
      found.add("documents");
    }
    if (/\b(git|commit|push|repo|repository|version control)\b/.test(t)) {
      found.add("git");
    }
    if (/\b(debug|error|bug|failing|stack.?trace)\b/.test(t)) {
      found.add("debugging");
    }
    if (/\b(explore|inspect|search|find files|research)\b/.test(t)) {
      found.add("research");
    }
    if (found.has("coding") && (found.has("documents") || found.has("git"))) {
      found.add("project");
    }
    if (!found.size && /\b(create|make|write|plan)\b/.test(t)) {
      found.add("coding");
    }
    return [...found];
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
  };
})();
