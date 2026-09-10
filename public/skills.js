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
        "Clarify the goal and constraints briefly.",
        "Inspect the workspace (view_tree / list_directory / read_file) before writing.",
        "Create a plan with the plan tool.",
        "Scaffold directories and files with clear structure.",
        "Implement complete, working code — no placeholders like TODO unless asked.",
        "Run verify commands (run_javascript / run_python / execute_command) after writing.",
        "Write or update a README / document explaining how to use it.",
        "Stage and commit with a clear message when the build is done.",
      ],
    },
    documents: {
      name: "documents",
      title: "Document authoring",
      summary: "Produce polished markdown documents users can download.",
      steps: [
        "Outline sections first (plan tool).",
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
        "git_add relevant paths (or all project files).",
        "git_commit with a concise why-focused message.",
        "Optionally git_push to record a remote push in the workspace log.",
        "Show git_log so the user sees the result.",
      ],
    },
    debugging: {
      name: "debugging",
      title: "Debugging",
      summary: "Reproduce, diagnose, fix, and verify failures.",
      steps: [
        "Reproduce with execute_command / run_javascript / run_python.",
        "Read related files and search_code for clues.",
        "Form a hypothesis, then apply a minimal fix.",
        "Re-run the failing command to verify.",
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
      summary: "End-to-end: plan → build → verify → document → commit.",
      steps: [
        "Load coding + documents + git skills mentally.",
        "plan the deliverables.",
        "Build the full project structure.",
        "verify_project after implementation.",
        "create_document / README.",
        "git_init (if needed), git_add, git_commit, git_push.",
        "Final summary with paths and how to run.",
      ],
    },
  };

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
  };
})();
