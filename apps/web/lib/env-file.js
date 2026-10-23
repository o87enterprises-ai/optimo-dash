// Minimal .env reader shared by next.config.js (and its test). Handles the repo's .env.example style:
//   KEY=value
//   KEY=          # hint            -> empty (the comment is not the value)
//   KEY="quoted # kept"  # note     -> quoted # kept
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = /^(["'])(.*?)\1/.exec(v);
    if (q) v = q[2];
    else v = v.replace(/(^|\s)#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

module.exports = { parseEnv };
