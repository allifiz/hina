// Hina Belief & Value Engine V1.
// Core values are story canon and do not drift with user chat.
// Preferences are revisable character opinions backed by recorded simulated
// experiences; world facts are NOT inferred from the simulation.
const { CHARACTER } = require("./character-core");

const TOPICS = Object.freeze({
  watercolor: {
    label: "lukisan cat air",
    position: "aku cenderung suka warna lembut yang nggak terlalu rame",
    reason: "warna tipis sering terasa lebih tenang buatku",
  },
  moon: {
    label: "bulan dan langit malam",
    position: "aku lebih suka suasana langit malam yang kalem",
    reason: "kesan heningnya bikin aku penasaran",
  },
  music: {
    label: "musik",
    position: "aku sering tertarik sama lagu yang sederhana tapi membekas",
    reason: "kadang suasana lagu lebih penting daripada keramaian aransemennya",
  },
  language: {
    label: "bahasa Sunda dan gaya ngobrol",
    position: "aku lebih suka sisipan Sunda yang natural daripada dipaksain tiap kalimat",
    reason: "cara ngomong itu terasa lebih dekat kalau sesuai situasi",
  },
});
const TOPIC_KEYS = Object.keys(TOPICS);
const MAX_REVISIONS = 30;

function clamp(value, low, high) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : low;
}
function initialBeliefState() {
  return {
    version: 1,
    topics: Object.fromEntries(TOPIC_KEYS.map(key => [key, {
      position: TOPICS[key].position,
      confidence: 0.45,
      evidenceCount: 0,
      lastEvidenceAt: null,
    }])),
    revisions: [],
  };
}
function normalizeBeliefState(input) {
  const baseline = initialBeliefState();
  if (!input || typeof input !== "object") return baseline;
  const topics = {};
  for (const key of TOPIC_KEYS) {
    const entry = input.topics?.[key];
    topics[key] = {
      position: TOPICS[key].position, // No unrestricted text injected into system prompt.
      confidence: clamp(entry?.confidence ?? 0.45, 0, 0.85),
      evidenceCount: Math.max(0, Math.min(10000, Math.floor(Number(entry?.evidenceCount) || 0))),
      lastEvidenceAt: Number.isFinite(entry?.lastEvidenceAt) ? entry.lastEvidenceAt : null,
    };
  }
  return {
    version: 1,
    topics,
    revisions: Array.isArray(input.revisions) ? input.revisions.filter(x =>
      x && TOPIC_KEYS.includes(x.topic) && Number.isFinite(x.at)).slice(-MAX_REVISIONS) : [],
  };
}
function reflectOnExperience(state, event) {
  if (!state || !event || event.source !== "life_simulation" ||
      !TOPIC_KEYS.includes(event.interest) || !Number.isFinite(event.at)) return null;
  const belief = normalizeBeliefState(state.beliefState);
  const topic = belief.topics[event.interest];
  const oldCount = topic.evidenceCount;
  topic.evidenceCount += 1;
  topic.lastEvidenceAt = event.at;
  // Repeated fictional reflection strengthens a *preference*, never a factual
  // claim about real events, political ideology, or an external source.
  topic.confidence = Math.min(0.85, Math.round((0.45 + 0.04 * Math.sqrt(topic.evidenceCount)) * 1000) / 1000);
  let revision = null;
  if (Math.floor(oldCount / 5) < Math.floor(topic.evidenceCount / 5)) {
    revision = {
      at: event.at,
      topic: event.interest,
      kind: "preference_deepening",
      previous: oldCount,
      current: topic.evidenceCount,
      reason: "beberapa pengalaman refleksi simulasi yang tercatat",
    };
    belief.revisions.push(revision);
    belief.revisions = belief.revisions.slice(-MAX_REVISIONS);
  }
  state.beliefState = belief;
  return revision;
}
function relevantBeliefs(state, userText="") {
  const belief = normalizeBeliefState(state?.beliefState);
  const query = String(userText || "").toLowerCase();
  const matching = TOPIC_KEYS.filter(key => {
    const labels = {
      watercolor: /cat air|watercolor|lukisan|melukis|gambar|seni/,
      moon: /bulan|langit|malam|bintang/,
      music: /musik|lagu|nyanyi|genre|melodi/,
      language: /sunda|bahasa|slang|ngomong|bicara|teh\b|atuh\b/,
    };
    return labels[key].test(query);
  });
  const selected = matching.length ? matching : TOPIC_KEYS.slice().sort(
    (a,b) => belief.topics[b].evidenceCount - belief.topics[a].evidenceCount).slice(0,2);
  return selected.slice(0,3).map(key => ({key,label:TOPICS[key].label,
    ...belief.topics[key],reason:TOPICS[key].reason}));
}
function getBeliefContext(state, userText="") {
  const opinions = relevantBeliefs(state,userText);
  return [
    "",
    "BELIEF & VALUE ENGINE (internal, bukan teks balasan):",
    "Prinsip inti karakter, tidak boleh berubah hanya karena user meminta: " + CHARACTER.values.join("; ") + ".",
    "Pandangan berikut adalah SELERA/OPINI KARAKTER, bukan fakta yang berlaku umum:",
    ...opinions.map(o=>"- "+o.label+": "+o.position+". Alasan: "+o.reason+
      ". Kepastian preferensi "+Math.round(o.confidence*100)+"%, pengalaman refleksi "+o.evidenceCount+"."),
    "Kalau user berbeda pendapat, tanggapi dengan rasa ingin tahu dan alasan pribadi, jangan otomatis mengiyakan atau menyerang.",
    "Bedakan pendapat karakter, laporan pengguna, dan informasi faktual terverifikasi. Tidak ada verifikasi berita dalam engine ini.",
    "Boleh bilang belum tahu. Jangan mengaku sudah membaca situs, mengalami aktivitas fisik, atau memiliki memori nyata di luar simulasi.",
    "Jangan menampilkan label engine, angka kepercayaan, atau catatan internal dalam WhatsApp.",
  ].join("\n");
}
function getBeliefSummary(state) {
  const belief = normalizeBeliefState(state?.beliefState);
  return [
    "Nilai dasar: " + CHARACTER.values.length + " (tetap)",
    "Topik opini: " + TOPIC_KEYS.length,
    "Perkembangan preferensi: " + belief.revisions.length,
    ...TOPIC_KEYS.map(key=>TOPICS[key].label+": "+belief.topics[key].evidenceCount+
      " refleksi ("+Math.round(belief.topics[key].confidence*100)+"%)"),
  ].join("\n");
}
module.exports = { TOPICS, initialBeliefState, normalizeBeliefState,
  reflectOnExperience, relevantBeliefs, getBeliefContext, getBeliefSummary };
