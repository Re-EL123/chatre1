/**
 * Client project helpers — tree building + AGENTS.md awareness (mirrors API).
 */
(function () {
  "use strict";

  var PROJECTS_ROOT = "/home/user/projects";

  function slugFromPath(path) {
    var m = String(path || "").match(/^\/home\/user\/projects\/([^/]+)/);
    return m ? m[1] : null;
  }

  function detectProjects(files) {
    var map = files || {};
    var projects = {};
    Object.keys(map).forEach(function (p) {
      var slug = slugFromPath(p);
      if (!slug) return;
      if (!projects[slug]) {
        projects[slug] = {
          slug: slug,
          root: PROJECTS_ROOT + "/" + slug,
          agentsMd: PROJECTS_ROOT + "/" + slug + "/AGENTS.md",
          hasAgentsMd: false,
          fileCount: 0,
        };
      }
      if (map[p] && map[p].type === "file") {
        projects[slug].fileCount += 1;
        if (/\/AGENTS\.md$/i.test(p)) projects[slug].hasAgentsMd = true;
      }
    });
    return projects;
  }

  function buildTree(files, rootPath) {
    var map = files || {};
    var root = rootPath || "/home/user";
    var dirs = {};

    function ensure(path) {
      if (dirs[path]) return dirs[path];
      var parts = path.split("/").filter(Boolean);
      var name = parts.length ? parts[parts.length - 1] : "/";
      dirs[path] = { name: name || "/", path: path, type: "dir", children: [] };
      return dirs[path];
    }

    ensure(root);

    Object.keys(map)
      .sort()
      .forEach(function (p) {
        if (!p) return;
        if (root !== "/" && p !== root && p.indexOf(root + "/") !== 0) return;
        var entry = map[p];
        if (!entry) return;
        if (entry.type === "dir") {
          ensure(p);
          return;
        }
        if (entry.type !== "file") return;
        var parts = p.split("/").filter(Boolean);
        var cur = "";
        for (var i = 0; i < parts.length - 1; i++) {
          cur = cur + "/" + parts[i];
          ensure(cur);
        }
        dirs[p] = {
          name: parts[parts.length - 1],
          path: p,
          type: "file",
          children: null,
        };
      });

    Object.keys(dirs).forEach(function (p) {
      if (dirs[p].type === "dir") dirs[p].children = [];
    });
    Object.keys(dirs).forEach(function (p) {
      if (p === root || p === "/") return;
      var parent = p.replace(/\/[^/]+$/, "") || "/";
      if (!dirs[parent]) ensure(parent);
      if (dirs[parent] && dirs[parent].type === "dir") {
        dirs[parent].children.push(dirs[p]);
      }
    });
    Object.keys(dirs).forEach(function (p) {
      if (dirs[p].type === "dir") {
        dirs[p].children.sort(function (a, b) {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return String(a.name).localeCompare(String(b.name));
        });
      }
    });

    return dirs[root] || ensure(root);
  }

  function agentsTemplate(slug, goal) {
    var name = String(slug || "project");
    return (
      "# AGENTS.md — " +
      name +
      "\n\n> Persistent project brief for Chatre agents.\n\n## Project\n- **Root:** `" +
      PROJECTS_ROOT +
      "/" +
      name +
      "`\n- **Purpose:** " +
      (goal || "User project") +
      "\n\n## Conventions\n- Keep files under this root.\n- Prefer write_file / patch_file.\n- Update this file when the architecture changes.\n\n## Notes\n- Created by Chatre.\n"
    );
  }

  window.ChatreProjects = {
    PROJECTS_ROOT: PROJECTS_ROOT,
    slugFromPath: slugFromPath,
    detectProjects: detectProjects,
    buildTree: buildTree,
    agentsTemplate: agentsTemplate,
  };
})();
