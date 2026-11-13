// Hina Life Simulation Engine V1.
// Deterministic, bounded and persistent fictional continuity, no background LLM
// calls, no fake external browsing, no automatic WhatsApp messages.
const fs = require("node:fs");
const path = require("node:path");
const { DB_FILE } = require("../config");
const { getWibClock } = require("./temporal");
const { CHARACTER } = require("./character-core");
const { initialMotivation, normalizeMotivation, decideActivity, applyMotivation, getMotivationContext } = require("./motivation");
const { initialBeliefState, normalizeBeliefState, reflectOnExperience, getBeliefContext, getBeliefSummary } = require("./belief-value");
const { freshGoalState, normalizeGoalState, reflectGoal, getGoalContext, getGoalSummary } = require("./character-growth");
const { initialProjects, normalizeProjects, advanceProject, getCreativeContext, projectSummary, discoverWeekly } = require("./creative-projects");
const { researchContext } = require("./project-research");
const { getKnowledgeContext } = require("./knowledge-verification");
const { defaults: initialLearning, normalizeLearning } = require("./autonomous-learning");
const { inspectFoundation, consolidateMemory } = require("./foundation-health");

const LIFE_FILE = process.env.HINA_LIFE_FILE || DB_FILE + ".life.json";
const MAX_EVENTS = 90;
const MAX_CATCHUP_DAYS = 7;
const SLOTS_WIB = [9, 14, 20];
const INTEREST_KEYS = Object.keys(CHARACTER.interests);
const LOG_PREFIX = "[LIFE_SIM]";
let state = null;
let timer = null;

function seedState(now = Date.now()) {
  return {
    version: 1,
    createdAt: now,
    lastTickAt: now,
    paused: false,
    beliefs: CHARACTER.values.slice(),
    beliefState: initialBeliefState(),
    motivation: initialMotivation(),
    goalState: freshGoalState(now),
    creativeProjects: initialProjects(),
    autonomousLearning: initialLearning(),
    memoryIndex: [],
    interests: Object.fromEntries(INTEREST_KEYS.map((key) => [key, { affinity: 1, explored: 0, level: 0 }])),
    experiences: [],
    milestones: [],
  };
}

function loadLifeState(now = Date.now(), file = LIFE_FILE) {
  if (!Number.isFinite(now)) throw new Error("Invalid timestamp");
  if (fs.existsSync(file) || fs.existsSync(file+".bak")) {
    try {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file,"utf8"));
      } catch (problem) {
        if (!fs.existsSync(file+".bak")) throw problem;
        console.warn(LOG_PREFIX,"State utama rusak, memulihkan salinan terakhir yang valid.");
        parsed = JSON.parse(fs.readFileSync(file+".bak","utf8"));
        // Restore the good file before the next save rotates backups.
        fs.copyFileSync(file+".bak",file);
      }
      if (parsed && parsed.version === 1 && Number.isFinite(parsed.createdAt) &&
          Array.isArray(parsed.experiences) && parsed.interests && typeof parsed.interests === "object") {
        const fallback = seedState(now);
        state = {
          ...fallback,
          ...parsed,
          interests: { ...fallback.interests, ...parsed.interests },
          beliefs: fallback.beliefs,
          beliefState: normalizeBeliefState(parsed.beliefState),
          motivation: normalizeMotivation(parsed.motivation),
          goalState: normalizeGoalState(parsed.goalState,
            Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : now, parsed.interests),
          creativeProjects: normalizeProjects(parsed.creativeProjects),
          autonomousLearning: normalizeLearning(parsed.autonomousLearning),
          memoryIndex: Array.isArray(parsed.memoryIndex)?parsed.memoryIndex.filter(x=>
            x && INTEREST_KEYS.includes(x.interest) && Array.isArray(x.eventIds)
          ).slice(-16):[],
          experiences: parsed.experiences.filter((x) => x && typeof x === "object" && Number.isFinite(x.at)).slice(-MAX_EVENTS),
          milestones: Array.isArray(parsed.milestones) ? parsed.milestones.slice(-40) : [],
        };
        return state;
      }
      throw new Error("Skema state tidak valid. Dihentikan agar memori lama tidak tertimpa.");
    } catch (error) {
      console.error(LOG_PREFIX, "State tidak dapat dipulihkan:", error.message);
      throw error;
    }
  }
  state = seedState(now);
  saveLifeState(file);
  return state;
}

function getLifeState(now = Date.now(), file = LIFE_FILE) {
  return state || loadLifeState(now, file);
}

function saveLifeState(file = LIFE_FILE) {
  if (!state) return;
  const directory = path.dirname(file);
  const temp = file + ".tmp-" + process.pid;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    if (fs.existsSync(file)) fs.copyFileSync(file, file+".bak");
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    console.error(LOG_PREFIX, "Gagal simpan kehidupan:", error.message);
    throw error;
  }
}

// Convert YYYY-MM-DD as a *local* WIB calendar date into a scheduled UTC instant.
function slotTimestamp(dateKey, hour) {
  return Date.parse(dateKey + "T" + String(hour).padStart(2, "0") + ":00:00+07:00");
}

function hashKey(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Decision Engine V1: picks simulated activities using current interest affinity,
// not based on latest user message, and does not fabricate physical whereabouts.
function chooseActivity(current, dateKey, slotIndex) {
  return decideActivity(current, dateKey, slotIndex);
}

function applyExperience(current, scheduledAt, dateKey, slotIndex) {
  const decision = chooseActivity(current, dateKey, slotIndex);
  const { key, activity, reflection } = decision;
  const old = current.interests[key] || { affinity: 1, explored: 0, level: 0 };
  const explored = Math.max(0, Number(old.explored) || 0) + 1;
  const oldLevel = Math.max(0, Number(old.level) || 0);
  const level = Math.min(4, Math.floor(explored / 5));
  current.interests[key] = {
    affinity: Math.min(4, Math.round((Math.max(1, Number(old.affinity) || 1) + 0.035) * 1000) / 1000),
    explored,
    level,
  };
  const event = {
    id: dateKey + ":" + slotIndex,
    at: scheduledAt,
    kind: "simulated_reflection",
    source: "life_simulation",
    interest: key,
    activity,
    reflection,
    motive: decision.drive,
    reason: decision.reason,
  };
  applyMotivation(current, decision);
  current.experiences.push(event);
  current.experiences = current.experiences.slice(-MAX_EVENTS);
  reflectOnExperience(current, event);
  reflectGoal(current, event);
  advanceProject(current, event);
  if (level > oldLevel) {
    current.milestones.push({
      at: scheduledAt,
      interest: key,
      from: oldLevel,
      to: level,
      note: "Minat " + CHARACTER.interests[key].name + " makin mendalam dalam simulasi.",
    });
    current.milestones = current.milestones.slice(-40);
  }
  return event;
}

function tickLife(now = Date.now(), file = LIFE_FILE) {
  const current = getLifeState(now, file);
  if (!Number.isFinite(now) || now < current.createdAt) return [];
  if (current.paused) return [];

  const from = Math.max(current.createdAt, now - MAX_CATCHUP_DAYS * 86400000);
  const previous = Number.isFinite(current.lastTickAt) ? current.lastTickAt : current.createdAt;
  const cutoff = Math.max(from, previous);
  const candidates = [];
  for (let daysAgo = MAX_CATCHUP_DAYS; daysAgo >= 0; daysAgo--) {
    const dateKey = getWibClock(now - daysAgo * 86400000).dateKey;
    for (let slotIndex = 0; slotIndex < SLOTS_WIB.length; slotIndex++) {
      const at = slotTimestamp(dateKey, SLOTS_WIB[slotIndex]);
      if (at > cutoff && at <= now) candidates.push({ at, dateKey, slotIndex });
    }
  }

  const existing = new Set(current.experiences.map((x) => x.id));
  const created = [];
  for (const { at, dateKey, slotIndex } of candidates.slice(-SLOTS_WIB.length * MAX_CATCHUP_DAYS)) {
    const key = dateKey + ":" + slotIndex;
    if (existing.has(key)) continue;
    created.push(applyExperience(current, at, dateKey, slotIndex));
    existing.add(key);
  }
  current.lastTickAt = now;
  if (created.length) {
    discoverWeekly(current, now);
    consolidateMemory(current, now);
  }
  saveLifeState(file);
  if (created.length) console.info(LOG_PREFIX, created.length + " pengalaman simulasi tercatat.");
  return created;
}

function setLifePaused(paused, now = Date.now(), file = LIFE_FILE) {
  const current = getLifeState(now, file);
  current.paused = Boolean(paused);
  // Explicitly skip simulation time while paused, no later backfill.
  current.lastTickAt = now;
  saveLifeState(file);
  return current.paused;
}

function getLifeContext(now = Date.now(), file = LIFE_FILE, userText = "") {
  const current = getLifeState(now, file);
  const recent = current.experiences.slice(-3);
  const interests = INTEREST_KEYS
    .map((key) => ({ key, ...current.interests[key] }))
    .sort((a, b) => (b.explored || 0) - (a.explored || 0));
  return [
    "",
    "KEHIDUPAN KARAKTER HINA (simulasi fiksi, bukan kejadian fisik; jangan dibacakan):",
    "Identitas: Hina, gadis karakter 21 tahun, Sunda, dari Pameungpeuk Garut; ceria, penasaran, kadang pemalu, jahil, mandiri, dan manja.",
    "Nilai dasar: " + current.beliefs.join("; ") + ".",
    getMotivationContext(current),
    getBeliefContext(current, userText),
    getGoalContext(current),
    getCreativeContext(current),
    researchContext(current, now),
    getKnowledgeContext(current, now),
    "Ketertarikan: " + interests.map((i) => CHARACTER.interests[i.key].name +
      " (pengalaman " + i.explored + ", perkembangan " + i.level + "/4)").join("; ") + ".",
    "Catatan refleksi yang BENAR-BENAR dijalankan oleh sistem simulasi:",
    ...(recent.length ? recent.map((event) => {
      return "- " + getWibClock(event.at).formatted + ": " + event.reflection + ".";
    }) : ["- Belum ada pengalaman simulasi yang tercatat."]),
    "Hanya gunakan cerita/ingatan ini jika relevan atau ditanya soal aktivitas/minat Hina.",
    "Jangan pernah mengklaim pergi ke suatu tempat, bertemu orang, tidur, makan, atau belajar dari website jika tidak terjadi sungguhan.",
    "Boleh mengatakan 'aku lagi kepikiran soal ...' sebagai cerita karakter, tetapi bedakan cerita karakter dari aktivitas dunia nyata.",
    "Jangan mengumumkan level, skor, scheduler, source, atau catatan internal. Gaya chat tetap natural, informil, sedikit Sunda jika cocok.",
    "Ini bukan bukti kesadaran subjektif atau ingatan seseorang yang nyata.",
  ].join("\n");
}

function getLifeSummary(now = Date.now(), file = LIFE_FILE) {
  const current = getLifeState(now, file);
  const latest = current.experiences.at(-1);
  return [
    "Life Simulation: " + (current.paused ? "paused" : "aktif"),
    "Pengalaman: " + current.experiences.length,
    "Milestone: " + current.milestones.length,
    "Keputusan simulasi: " + normalizeMotivation(current.motivation).decisions,
    getBeliefSummary(current),
    getGoalSummary(current),
    projectSummary(current),
    "Indeks memori: " + (current.memoryIndex?.length || 0),
    "Terakhir: " + (latest ? getWibClock(latest.at).formatted +
      " | " + CHARACTER.interests[latest.interest].name + " | " + latest.activity : "belum ada"),
  ].join("\n");
}

function startLifeSimulation({ intervalMs = 30 * 60 * 1000, file = LIFE_FILE } = {}) {
  if (timer) return timer;
  tickLife(Date.now(), file);
  timer = setInterval(() => {
    try { tickLife(Date.now(), file); }
    catch (error) { console.error(LOG_PREFIX, "Tick gagal:", error.message); }
  }, Math.max(60000, intervalMs));
  timer.unref?.();
  return timer;
}

function stopLifeSimulation() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  LIFE_FILE, seedState, loadLifeState, getLifeState, saveLifeState, chooseActivity,
  tickLife, setLifePaused, getLifeContext, getLifeSummary,
  startLifeSimulation, stopLifeSimulation,
};
