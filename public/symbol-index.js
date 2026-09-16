/* chatre symbol index — blueprint Pillar 3 (AST/accuracy), browser-portable.
 *
 * A coding agent that patches "for accuracy" must resolve a symbol to its
 * EXACT owning file+line before editing — not float a string and hope it
 * hits one seam. This indexer builds a lightweight symbol→file:line map
 * from the agent's OWN workspace reads (the same file contents the
 * list_directory / read_file tools already carry), indexed in-page so the
 * analyze/plan phase can inject "symbol X resolves to src/a.js:42" and the
 * patch seam targets bytes instead of loose matches.
 *
 * It is deliberately dependency-free: no native tree-sitter WASM (unavailable
 * in the worker sandbox), just a deterministic regex seam over the source —
 * which is exactly what a self-hosted agent that can't ship a parser does.
 */
(function (root) {
  function scanSymbols(filePath, text) {
    var out = [];
    var lines = String(text || "").split("\n");
    var re =
      /(?:^|\b)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:^|\b)const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\(|[\w$]+\s*=>)|(?:^|\b)class\s+([A-Za-z_$][\w$]*)|(?:^|\b)([A-Za-z_$][\w$]*)\s*[:=]\s*function\b/g;
    for (var i = 0; i < lines.length; i++) {
      var m;
      var line = lines[i];
      var re2 = new RegExp(re.source, "g");
      while ((m = re2.exec(line)) !== null) {
        var name = m[1] || m[2] || m[3] || m[4];
        if (!name) continue;
        out.push({ symbol: name, kind: m[1] ? "function" : m[3] ? "class" : "const", file: filePath, line: i + 1 });
      }
      // method seam on an object/class line:  `name: function(` or `name(...) {`
      var m2 = /\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function\b|\b([A-Za-z_$][\w$]*)\s*\(\s*[^)]*\)\s*\{\s*$/.exec(line);
      if (m2) out.push({ symbol: m2[1] || m2[2], kind: "method", file: filePath, line: i + 1 });
    }
    return out;
  }

  function buildIndex(files) {
    // Object.create(null) so symbol names that collide with Object.prototype
    // (constructor/toString/hasOwnProperty) index as arrays, never as the
    // inherited function — exactly the accuracy bug the smoke gate caught.
    var index = Object.create(null);
    (files || []).forEach(function (f) {
      (scanSymbols(f.path, f.content) || []).forEach(function (s) {
        if (!Object.prototype.hasOwnProperty.call(index, s.symbol)) {
          index[s.symbol] = [];
        }
        index[s.symbol].push({ file: s.file, line: s.line, kind: s.kind });
      });
    });
    // dedupe adjacent duplicates from the two regex passes.
    Object.keys(index).forEach(function (k) {
      var seen = {};
      index[k] = index[k].filter(function (e) {
        var key = e.file + ":" + e.line;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    });
    return index;
  }

  function resolve(symbol, index) {
    var list = (index && index[symbol]) || [];
    return list.length
      ? { symbol: symbol, matches: list }
      : { symbol: symbol, matches: [] };
  }

  root.ChatreSymbolIndex = {
    scanSymbols: scanSymbols,
    buildIndex: buildIndex,
    resolve: resolve,
    version: "1.0.0",
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.ChatreSymbolIndex;
  }
})(typeof window !== "undefined" ? window : globalThis);
