const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LOCAL_MODEL_ENABLED = "false";
process.env.NINEROUTER_API_KEY = "unit-test-only";

const { cleanBotReply, extractMoodAndCleanReply } = require("../utils");
const { stripInternalPreamble, isUnreliableAssistantContext, filterContextHistory } = require("../services/output-guard");
const { getHinaPersona } = require("../services/persona");

test("V4 output guard removes leaked internal plan from actual WhatsApp-like reply", () => {
  const generated = [
    "Konteks: User (Allif) minta dicarikan berita-berita terbaru di Indonesia.",
    "Mood: malu. Nuansa pesan: informative.",
    "Batasan: Hina tidak punya web search real-time aktif, jangan mengarang berita palsu. Ingat di arsip: akses web umum belum aktif.",
    "Tag mood di akhir.Lagi rame soal pemilihan kepala daerah nih, aku barusan cek beritanya. [mood:ceria]",
  ].join("\n");
  const { reply } = extractMoodAndCleanReply(generated);
  const cleaned = cleanBotReply(reply);
  assert.equal(cleaned, "Lagi rame soal pemilihan kepala daerah nih, aku barusan cek beritanya.");
  assert.doesNotMatch(cleaned, /Konteks|Mood|Batasan|Nuansa pesan|Tag mood/);
});

test("guard hides metadata-only replies rather than revealing system instructions", () => {
  const text = "Konteks: User menyapa.\nMood: ceria.\nBatasan: jawab ramah dan tidak mengarang.";
  assert.equal(stripInternalPreamble(text), "");
  const cleaned = cleanBotReply(text);
  assert.match(cleaned, /bentar|ulang|mikir/i);
  assert.doesNotMatch(cleaned, /Konteks|Mood|Batasan/);
});

test("guard supports clean answer after a separated internal note", () => {
  const text = "Konteks: User penasaran.\nMood: biasa.\n\nBuset, baru ngeh aku.";
  assert.equal(stripInternalPreamble(text), "Buset, baru ngeh aku.");
});

test("normal Hina responses are preserved and mood tags remain private", () => {
  assert.equal(cleanBotReply("lah, kamu duluan yang ngajak ribut wkwk [mood:ceria]"), "lah, kamu duluan yang ngajak ribut wkwk");
  assert.equal(cleanBotReply("Konteks cerita itu penting banget."), "Konteks cerita itu penting banget.");
  assert.equal(cleanBotReply("API itu jalur biar aplikasi saling minta data."), "API itu jalur biar aplikasi saling minta data.");
});

test("stale claims and leaked internal notes are excluded only from model context", () => {
  const history = [
    { role: "user", content: "na bisa browsing?" },
    { role: "assistant", content: "akses web umumku lagi belum aktif nih..." },
    { role: "user", content: "sekarang gimana?" },
    { role: "assistant", content: "Konteks: User menanyakan internet. Mood: malu. Batasan: ..." },
    { role: "user", content: "cerita kamu dong" },
    { role: "assistant", content: "aku tuh suka muter lagu yang sama terus wkwk" },
  ];
  assert.equal(isUnreliableAssistantContext(history[1].content), true);
  assert.equal(isUnreliableAssistantContext(history[3].content), true);
  const filtered = filterContextHistory(history);
  assert.equal(filtered.length, 4);
  assert.deepEqual(filtered.map(x => x.role), ["user", "user", "user", "assistant"]);
  assert.equal(history.length, 6);
});

const base = {
  currentMood: "ceria",
  userName: "Teman",
  isCreator: false,
  userEmotion: "netral",
  userIntent: "ngobrol",
  timeContext: "malam",
  relationshipMode: "regular_user",
  relationshipState: { stage: "normal", tensionLevel: 0, speechStyle: "aku-kamu" },
  relationshipContext: "Normal.",
  profile: { intimacy: 3, adultMode: false },
};

test("V4 persona has consistent fictional life and natural slang without robotic framing", () => {
  const persona = getHinaPersona({ ...base, userText: "kamu bot ya?" });
  assert.match(persona, /DUNIA & CARA HIDUP HINA/);
  assert.match(persona, /langit malam.*bulan/);
  assert.match(persona, /bantah atau elak/);
  assert.match(persona, /slang/);
  assert.match(persona, /Jangan memakai judul, bullet, tabel/);
  assert.match(persona, /jangan mengarang memori atau kejadian nyata user/i);
  assert.match(persona, /Di AKHIR balasan, tambahkan satu tag mood/);
});

test("news style stays grounded but uses ordinary WhatsApp conversation", () => {
  const persona = getHinaPersona({ ...base, userIntent: "live_info", userText: "berita apa hari ini?" });
  assert.match(persona, /Jangan berubah jadi pembaca berita/);
  assert.match(persona, /tanggal terbit, dan tanggal kejadian/);
  assert.match(persona, /jawaban lama Hina yang mengaku browsing belum aktif/);
});
