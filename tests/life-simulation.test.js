const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

process.env.LOCAL_MODEL_ENABLED = "false";
process.env.NINEROUTER_API_KEY = "unit-test-only";

const {
  loadLifeState, getLifeState, tickLife, getLifeContext, getLifeSummary,
  setLifePaused, chooseActivity, stopLifeSimulation,
} = require("../services/life-simulation");
const { CHARACTER } = require("../services/character-core");
const { getInstantReply } = require("../services/persona");

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hina-life-sim-"));
  t.after(() => { stopLifeSimulation(); fs.rmSync(dir, { recursive: true, force: true }); });
  return path.join(dir, "database.json.life.json");
}

const WIB_0800 = Date.parse("2026-11-14T01:00:00Z");

test("character core is stable and anchored in Garut and Sunda identity", () => {
  assert.equal(CHARACTER.name, "Hina");
  assert.equal(CHARACTER.age, 21);
  assert.match(CHARACTER.origin, /Pameungpeuk, Garut/);
  assert.match(CHARACTER.language, /Sunda Garut/);
  assert.ok(CHARACTER.values.length >= 3);
});

test("simulates three bounded WIB reflection slots without any external model request", (t) => {
  const file = tempFile(t);
  const current = loadLifeState(WIB_0800, file);
  assert.equal(current.experiences.length, 0);
  assert.equal(tickLife(WIB_0800, file).length, 0);
  const end = Date.parse("2026-11-14T14:00:00Z"); // Nov 14 21:00 WIB
  const events = tickLife(end, file);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(x => x.id), [
    "2026-11-14:0", "2026-11-14:1", "2026-11-14:2",
  ]);
  assert.ok(events.every(x => x.kind === "simulated_reflection" && x.source === "life_simulation"));
  assert.equal(tickLife(end, file).length, 0); // restart/duplicate safe
  assert.equal(getLifeState(end, file).experiences.length, 3);
});

test("persists memories across simulated restarts, and can answer latest activity", (t) => {
  const file = tempFile(t);
  loadLifeState(WIB_0800, file);
  const end = Date.parse("2026-11-14T14:00:00Z");
  tickLife(end, file);
  const before = getLifeContext(end, file);
  const restored = loadLifeState(end, file);
  assert.equal(restored.experiences.length, 3);
  assert.match(before, /yang BENAR-BENAR dijalankan oleh sistem simulasi/);
  assert.match(before, /pukul|WIB/);
  assert.match(getLifeSummary(end, file), /Pengalaman: 3/);
  assert.equal(getInstantReply("lagi apa"), null); // Gemini sees relevant story instead of fixed fake song.
  assert.equal(getInstantReply("hina lagi apa"), null);
});

test("pause/resume skips paused intervals without replaying missed experiences", (t) => {
  const file = tempFile(t);
  loadLifeState(WIB_0800, file);
  assert.equal(setLifePaused(true, WIB_0800, file), true);
  assert.equal(tickLife(Date.parse("2026-11-14T14:00:00Z"), file).length, 0);
  const resume = Date.parse("2026-11-14T14:00:00Z");
  assert.equal(setLifePaused(false, resume, file), false);
  assert.equal(tickLife(resume, file).length, 0);
  const tomorrow = Date.parse("2026-11-15T14:00:00Z");
  assert.equal(tickLife(tomorrow, file).length, 3);
});

test("life events accumulate into growth milestones rather than instant personality rewrites", (t) => {
  const file = tempFile(t);
  loadLifeState(WIB_0800, file);
  for (let day = 0; day < 12; day++) {
    tickLife(Date.parse("2026-11-14T14:00:00Z") + day * 86400000, file);
  }
  const current = getLifeState();
  assert.equal(current.experiences.length, 36);
  assert.ok(current.milestones.length >= 1);
  assert.ok(Object.values(current.interests).some(x => x.level >= 1));
  assert.ok(Object.values(current.interests).every(x => x.affinity <= 4 && x.level <= 4));
  assert.deepEqual(current.beliefs, CHARACTER.values);
});

test("backfills at most a week after downtime and avoids message spam", (t) => {
  const file = tempFile(t);
  loadLifeState(WIB_0800, file);
  const now = WIB_0800 + 30 * 86400000;
  const events = tickLife(now, file);
  assert.ok(events.length <= 21);
  assert.ok(events.length >= 18);
  assert.equal(tickLife(now, file).length, 0);
});

test("decision engine selects a known interest and does not claim physical visits", (t) => {
  const file = tempFile(t);
  const state = loadLifeState(WIB_0800, file);
  const chosen = chooseActivity(state, "2026-11-14", 0);
  assert.ok(CHARACTER.interests[chosen.key]);
  assert.ok(chosen.reflection.length > 15);
  const context = getLifeContext(WIB_0800, file);
  assert.match(context, /bukan aktivitas fisik sungguhan|bukan kejadian fisik/);
  assert.match(context, /Jangan pernah mengklaim pergi/);
});

test("WhatsApp starts independent life scheduler and supplies life experience to Gemini", () => {
  const entry = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(entry, /startLifeSimulation\(\)/);
  assert.match(entry, /tickLife\(\)/);
  assert.match(entry, /getLifeContext\(Date\.now\(\), undefined, textBody\)/);
  assert.match(entry, /getLifeSummary\(\)/);
  assert.match(entry, /setLifePaused\(/);
});
