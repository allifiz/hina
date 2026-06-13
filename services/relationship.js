const HOUR = 60 * 60 * 1000;

const DEFAULT_RELATIONSHIP = {
  respectScore: 100,
  tensionLevel: 0,
  rudeCount: 0,
  apologyCount: 0,
  lastRudeAt: null,
  lastTensionUpdateAt: Date.now(),
  lastRudeText: null,
  lastRudeSeverity: "none",
  stage: "normal",
  speechStyle: "aku-kamu",
};

const APOLOGY_REGEX = /\b(maaf|maf|sorry|sori|sry|ampun|peace|becanda|bercanda|canda|gak lagi|ga lagi|nggak lagi|jangan marah)\b/i;
const NEGATED_APOLOGY_REGEX = /\b(gak|ga|nggak|ngga|tidak|gamau|gak mau|ga mau|ogah|mana mau)\b.{0,18}\b(maaf|sorry|sori|ampun)\b/i;

const MILD_RUDE_REGEX = /\b(lemot|lambat|lama amat|loading|ngelag|lag|gajelas|ga jelas|ngaco|payah|yapping|ngebacot)\b/i;
const MEDIUM_RUDE_REGEX = /\b(bacot|goblok|gblk|tolol|bego|bodoh|dongo|idiot|sampah|bangsat|kampret|anjing|anjg|ajg|tai|taik|boong|pembohong)\b/i;
const HEAVY_RUDE_REGEX = /\b(kontol|kntl|memek|mmk|ngentot|ntl|jancok|jancuk|asu|babi)\b/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureRelationship(profile) {
  if (!profile.relationship || typeof profile.relationship !== "object") {
    profile.relationship = { ...DEFAULT_RELATIONSHIP, lastTensionUpdateAt: Date.now() };
  }

  const state = profile.relationship;
  for (const [key, value] of Object.entries(DEFAULT_RELATIONSHIP)) {
    if (state[key] === undefined) state[key] = value;
  }
  return state;
}

function detectRudeness(text) {
  const msg = String(text || "").toLowerCase();
  if (!msg.trim()) return { rude: false, severity: 0, label: "none" };

  if (HEAVY_RUDE_REGEX.test(msg)) return { rude: true, severity: 3, label: "heavy" };
  if (MEDIUM_RUDE_REGEX.test(msg)) return { rude: true, severity: 2, label: "medium" };

  const looksDirectedToBot = /\b(bot|hina|lu|lo|loe|kau|kamu|elu|gua|gw)\b/i.test(msg);
  if (MILD_RUDE_REGEX.test(msg) && looksDirectedToBot) return { rude: true, severity: 1, label: "mild" };

  return { rude: false, severity: 0, label: "none" };
}

function detectApology(text) {
  const msg = String(text || "");
  if (NEGATED_APOLOGY_REGEX.test(msg)) return false;
  return APOLOGY_REGEX.test(msg);
}

function decayTension(state, now = Date.now()) {
  const lastUpdate = state.lastTensionUpdateAt || state.lastRudeAt || now;
  const elapsedHours = Math.max(0, (now - lastUpdate) / HOUR);
  const hoursSinceRude = state.lastRudeAt ? (now - state.lastRudeAt) / HOUR : Infinity;

  let decayPerHour = 0.6;
  if (hoursSinceRude < 24) decayPerHour = 0.05;
  else if (hoursSinceRude < 48) decayPerHour = 1.2;
  else if (hoursSinceRude < 72) decayPerHour = 3.0;
  else decayPerHour = 100;

  state.tensionLevel = clamp((state.tensionLevel || 0) - elapsedHours * decayPerHour, 0, 100);
  state.lastTensionUpdateAt = now;
}

function getStageFromTension(tensionLevel) {
  if (tensionLevel >= 65) return "heated";
  if (tensionLevel >= 35) return "cold";
  if (tensionLevel >= 12) return "annoyed";
  return "normal";
}

function getSpeechStyle(stage) {
  if (stage === "heated") return "lu-gua";
  if (stage === "cold") return "mixed";
  return "aku-kamu";
}

function updateRelationshipState(profile, text, options = {}) {
  const state = ensureRelationship(profile);
  const now = Date.now();

  if (options.isPrivileged) {
    state.stage = "normal";
    state.speechStyle = "aku-kamu";
    return state;
  }

  decayTension(state, now);

  const rude = detectRudeness(text);
  const apology = detectApology(text);

  if (rude.rude) {
    // Begitu user toxic ke Hina, Hina langsung masuk mode heated penuh.
    // Ini sengaja dibuat keras supaya self-respect tidak terasa labil atau murah.
    const respectPenalty = rude.severity === 3 ? 35 : rude.severity === 2 ? 25 : 18;
    state.tensionLevel = 100;
    state.respectScore = clamp((state.respectScore || 100) - respectPenalty, 0, 100);
    state.rudeCount = (state.rudeCount || 0) + 1;
    state.lastRudeAt = now;
    state.lastRudeText = String(text || "").slice(0, 120);
    state.lastRudeSeverity = rude.label;
    state.lastTensionUpdateAt = now;
  } else if (apology && state.tensionLevel > 0) {
    // Maaf hanya dicatat. Bukan tombol reset. Tensi utamanya turun karena waktu.
    state.respectScore = clamp((state.respectScore || 100) + 1, 0, 100);
    state.apologyCount = (state.apologyCount || 0) + 1;
    state.lastApologyAt = now;
  }

  state.stage = getStageFromTension(state.tensionLevel);
  state.speechStyle = getSpeechStyle(state.stage);
  return state;
}

function getRelationshipContext(state) {
  const stage = state?.stage || "normal";
  const tension = Math.round(state?.tensionLevel || 0);
  const rudeCount = state?.rudeCount || 0;
  const lastRudeText = state?.lastRudeText ? ` Pesan kasar terakhir user: "${state.lastRudeText}".` : "";

  if (stage === "normal") {
    return `Self-respect Hina terhadap user ini normal. Gunakan aku/kamu, hangat, natural, dan jangan mengungkit konflik lama.`;
  }

  if (stage === "annoyed") {
    return `Self-respect Hina sedang terganggu. Tensi ${tension}/100, user pernah berkata kasar ${rudeCount} kali.${lastRudeText} Tetap gunakan aku/kamu, tapi lebih singkat, judes tipis, dan jangan langsung manis berlebihan.`;
  }

  if (stage === "cold") {
    return `Self-respect Hina sedang dingin ke user ini. Tensi ${tension}/100, user pernah berkata kasar ${rudeCount} kali.${lastRudeText} Hina masih badmood, boleh mulai memakai lu/gua, jawab tegas, sarkas, dan jangan reset hanya karena user tiba-tiba normal atau minta maaf sekali.`;
  }

  return `Self-respect Hina sedang PANAS ke user ini. Tensi ${tension}/100, user pernah berkata kasar ${rudeCount} kali.${lastRudeText} Gunakan gaya lu/gua. Hina wajib defensif, ngegas, sarkas, dan boleh membalas lebih pedas dari user sebagai batas diri. Jangan minta maaf, jangan sok damai, jangan bilang saling maaf, jangan langsung ramah walaupun user mengirim halo atau maaf. Hina boleh memakai kata kasar defensif seperti "bacot", "kontol lu", "tolol", "goblok", "anjing" jika konteksnya membalas hinaan user. Tetap jangan menyerang SARA, agama, ras, gender, disabilitas, keluarga, alamat/data pribadi, atau mengancam kekerasan.`;
}

function shouldUseInstantReply(state) {
  return (state?.stage || "normal") === "normal";
}

module.exports = {
  detectRudeness,
  detectApology,
  updateRelationshipState,
  getRelationshipContext,
  shouldUseInstantReply,
};