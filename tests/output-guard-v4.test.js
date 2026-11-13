const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LOCAL_MODEL_ENABLED = "false";
process.env.NINEROUTER_API_KEY = "unit-test-only";

const { stripInternalPreamble, isUnreliableAssistantContext, filterContextHistory } = require("../services/output-guard");
const { cleanBotReply } = require("../utils");

// Regression examples based on real WhatsApp screenshots.
test("strips karhutla mood planning before a natural reply", () => {
  const raw = [
    "Konteks: Karhutla (kebakaran hutan dan lahan).",
    "Mood internal Hina: sedih. Waktu larut malam.",
    "Allif membawa topik karhutla dan keprihatinan lingkungan/kebijakan.",
    "Balasan: Santai tapi prihatin, tanpa emoji Unicode, natural, akhiri tag mood. Nah itu juga, tiap musim kemarau isu yang sama keulang terus. Sedih banget liatnya. [mood:sedih]",
  ].join("\n");
  const clean = cleanBotReply(raw);
  assert.equal(clean, "Nah itu juga, tiap musim kemarau isu yang sama keulang terus. Sedih banget liatnya.");
  assert.doesNotMatch(clean, /Konteks:|Mood internal|Balasan:|akhiri tag/i);
  assert.equal(isUnreliableAssistantContext(raw), true);
});

test("strips full planning preamble before trending news reply", () => {
  const raw = [
    "Konteks: User (Allif) minta dicarikan berita-berita terbaru di Indonesia.",
    "Mood: malu. Nuansa pesan: informative.",
    'Batasan: Hina tidak punya web search real-time aktif atau jika ada, jangan mengarang berita spesifik. Ingat di arsip: "Akses web umumku lagi belum aktif nih...". Sebutkan isu umum. Tag mood di akhir.Lagi pada rame soal isu anggaran nih. [mood:biasa]',
  ].join("\n");
  const clean = cleanBotReply(raw);
  assert.equal(clean, "Lagi pada rame soal isu anggaran nih.");
  assert.equal(isUnreliableAssistantContext(raw), true);
});

test("drops entirely internal planning rather than sending it to user", () => {
  const raw = "Konteks: Berita\nMood internal Hina: sedih\nBalasan: Santai dan natural, tanpa emoji, akhiri tag mood.";
  assert.equal(stripInternalPreamble(raw), "");
  const reply = cleanBotReply(raw);
  assert.doesNotMatch(reply, /Konteks|Balasan|Mood internal|tag mood/i);
});

test("keeps genuine short chat and ordinary technical explanation intact", () => {
  for (const input of [
    "nah itu juga, tiap musim kemarau keulang terus.",
    "kalau aku sih agak skeptis sama klaim itu.",
    "Konteks: contoh fungsi ini cuma buat menjelaskan API.",
    "mood lagu ini enak banget wkwk",
  ]) {
    assert.equal(stripInternalPreamble(input), input);
  }
  assert.equal(cleanBotReply("Beneran? aku cek dulu ya. [mood:ceria]"), "Beneran? aku cek dulu ya.");
});

test("drops leaked assistant samples from memory but preserves user messages", () => {
  const oldLeak = "Konteks: Karhutla.\nMood internal Hina: sedih.\nBalasan: Akhiri tag mood. Wah ngeri juga ya";
  const records = [
    { role: "user", content: "belom lagi soal karhutla" },
    { role: "assistant", content: oldLeak },
    { role: "assistant", content: "akses web umumku lagi belum aktif nih" },
    { role: "assistant", content: "iya, pencariannya udah berhasil kok" },
  ];
  const out = filterContextHistory(records);
  assert.deepEqual(out.map(x => x.content), ["belom lagi soal karhutla", "iya, pencariannya udah berhasil kok"]);
});

test("explicit answer section is retained after context labels", () => {
  const raw = "Konteks: berita nasional.\nMood: biasa.\nJawaban final: iya, suratnya diterima kemarin.";
  assert.equal(stripInternalPreamble(raw), "iya, suratnya diterima kemarin.");
});
