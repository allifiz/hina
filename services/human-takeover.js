const fs = require("node:fs");
const path = require("node:path");

function normalizeJid(value) {
  const m = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(String(value || ""));
  return m ? m[1] + "@" + m[2] : null;
}

function createTakeover(file) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  if (!state || typeof state !== "object" || Array.isArray(state)) throw Error("Invalid takeover state");
  const ids = () => new Set(Object.values(state).flat());
  const status = phone => Object.hasOwn(state, phone);
  function set(phone, enabled, aliases = []) {
    if (!/^628\d{7,12}$/.test(phone)) throw Error("Invalid mobile number");
    const next = {...state};
    if (enabled) next[phone] = [...new Set([phone+"@s.whatsapp.net", ...aliases.map(normalizeJid).filter(Boolean), ...(state[phone] || [])])];
    else delete next[phone];
    fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(next), {mode:0o600});
    fs.renameSync(temp, file);
    state = next;
    return status(phone);
  }
  async function blocked(sock, ...values) {
    const known = ids();
    if (!known.size) return false;
    const aliases = values.map(normalizeJid).filter(Boolean);
    if (aliases.some(j => known.has(j))) return true;
    if (aliases.some(j => j.endsWith("@s.whatsapp.net"))) return false;
    for (const lid of aliases.filter(j => j.endsWith("@lid"))) {
      try {
        const pn = normalizeJid(await sock.signalRepository?.lidMapping?.getPNForLID(lid));
        if (pn) return ids().has(pn) || ids().has(lid);
      } catch {}
      // Never let an unresolved LID bypass a takeover. Other known PN contacts work normally.
      return true;
    }
    return false;
  }
  return {set, status, blocked};
}
module.exports = {createTakeover, normalizeJid};
