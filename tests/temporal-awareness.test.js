const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getWibClock,
  getGap,
  getTemporalContext,
  isDirectTimeQuestion,
  getDirectTimeAnswer,
} = require("../services/temporal");

test("WIB clock uses Jakarta even when machine clock is UTC", () => {
  const at = Date.parse("2026-11-13T23:00:05Z");
  const actual = getWibClock(at);
  assert.equal(actual.clock, "06:00:05");
  assert.equal(actual.dateKey, "2026-11-14");
  assert.equal(actual.period, "pagi");
  assert.match(actual.formatted, /14\s+November\s+2026/i);
  assert.match(actual.formatted, /WIB/);
});

test("recognizes six hour silence and a different part of the same day", () => {
  const first = Date.parse("2026-11-13T23:00:00Z"); // 06:00 WIB
  const next = Date.parse("2026-11-14T05:00:00Z"); // 12:00 WIB
  const gap = getGap(first, next);
  assert.equal(gap.duration, "6 jam");
  assert.equal(gap.dayChanged, false);
  assert.equal(gap.periodChanged, true);
  assert.equal(gap.previousPeriod, "pagi");
  assert.equal(gap.currentPeriod, "siang");
  assert.match(getTemporalContext(first, next), /Jeda sejak pesan user sebelumnya: 6 jam/);
  assert.match(getTemporalContext(first, next), /sudah berubah dari pagi ke siang/);
});

test("detects midnight crossing by WIB calendar date, not UTC date", () => {
  const before = Date.parse("2026-11-13T16:50:00Z"); // 23:50 WIB Nov 13
  const after = Date.parse("2026-11-13T17:10:00Z"); // 00:10 WIB Nov 14
  const gap = getGap(before, after);
  assert.equal(gap.duration, "20 menit");
  assert.equal(gap.calendarDays, 1);
  assert.equal(gap.dayChanged, true);
  assert.match(getTemporalContext(before, after), /Hari kalender WIB sudah berganti/);
});

test("clock answers are deterministic and do not require Gemini or web search", () => {
  const at = Date.parse("2026-11-14T05:34:12Z");
  for (const phrase of ["na, sekarang jam berapa?", "jam berapa sekarang?", "tanggal berapa sekarang?", "hari apa sekarang?"]) {
    assert.equal(isDirectTimeQuestion(phrase), true, phrase);
    assert.ok(getDirectTimeAnswer(phrase, at), phrase);
  }
  assert.match(getDirectTimeAnswer("na, sekarang jam berapa?", at), /12:34 WIB, siang/);
  assert.match(getDirectTimeAnswer("tanggal berapa sekarang?", at), /14 November 2026/i);
  for (const phrase of ["tadi jam 6 aku bangun", "kemarin jam berapa kamu tidur?", "cerita soal hari minggu", "sekarang berita apa?"]) {
    assert.equal(isDirectTimeQuestion(phrase), false, phrase);
  }
});

test("clock engine tolerates new users, restart and invalid future last-seen timestamp", () => {
  const now = Date.parse("2026-11-14T05:34:12Z");
  assert.equal(getGap(null, now), null);
  assert.equal(getGap(now + 1000, now), null);
  assert.match(getTemporalContext(null, now), /Belum ada waktu pesan sebelumnya/);
  assert.equal(getGap(now - 1000, now).duration, "1 detik");
});

test("WhatsApp handler captures prior user timestamp before updating profile", () => {
  const handler = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const before = handler.indexOf("const previousUserAt = ");
  const update = handler.indexOf("const profile = updateUserProfile(");
  assert.ok(before >= 0 && before < update);
  assert.match(handler, /getTemporalContext\(previousUserAt,\s*Date\.now\(\)\)/);
  assert.match(handler, /getDirectTimeAnswer\(textBody, Date\.now\(\)\)/);
});
