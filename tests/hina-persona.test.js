const test = require("node:test");
const assert = require("node:assert/strict");

// These tests inspect instructions only. They never call an AI provider.
process.env.LOCAL_MODEL_ENABLED = "false";
process.env.NINEROUTER_API_KEY = "unit-test-only";
const { getHinaPersona, getHinaReplyStyle } = require("../services/persona");

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

test("playful messages use a teasing, informal response style", () => {
  assert.equal(getHinaReplyStyle("helo cantik", "ngobrol", "netral"), "playful");
  const prompt = getHinaPersona({ ...base, userText: "helo cantik" });
  assert.match(prompt, /Nuansa pesan: playful/);
  assert.match(prompt, /CONTOH GAYA/);
  assert.match(prompt, /bukan customer service/i);
  assert.doesNotMatch(prompt, /\/no_think\b/);
});

test("supportive mode has priority over playful keywords when someone is upset", () => {
  assert.equal(getHinaReplyStyle("capek banget haha", "curhat", "capek"), "supportive");
  assert.match(getHinaPersona({ ...base, userEmotion: "sedih", userIntent: "curhat", userText: "aku sedih" }), /Nuansa pesan: supportive/);
});

test("news and short replies get different tone guidance", () => {
  assert.equal(getHinaReplyStyle("berita hari ini", "live_info", "netral"), "informative");
  assert.equal(getHinaReplyStyle("halo", "short_reply", "netral"), "brief");
});

test("mood and relationship controls remain present and output tag goes at the end", () => {
  const prompt = getHinaPersona({
    ...base,
    userText: "aku kesel sama kamu",
    relationshipState: { stage: "cold", tensionLevel: 50, speechStyle: "mixed" },
  });
  assert.match(prompt, /Self-respect: cold \(50\/100\)/);
  assert.match(prompt, /"lu\/gua"/);
  assert.match(prompt, /Di AKHIR balasan, tambahkan satu tag mood/);
  assert.match(prompt, /\[REMINDER: hari \| jam \| pesan\]/);
});

test("job rejection is treated as emotional, not ordinary small talk", () => {
  const { detectIntent, detectUserEmotion } = require("../services/persona");
  const text = "aku baru ditolak kerja, padahal udah berharap banget";
  assert.equal(detectIntent(text), "curhat");
  assert.equal(detectUserEmotion(text), "sedih");
  assert.equal(getHinaReplyStyle(text, detectIntent(text), detectUserEmotion(text)), "supportive");
});

test("light teasing is playful while angry complaints should not be", () => {
  assert.equal(getHinaReplyStyle("ih kamu tuh nyebelin banget tau ga", "ngobrol", "netral"), "playful");
  assert.equal(getHinaReplyStyle("kamu nyebelin", "ngobrol", "marah"), "conversational");
});

test("owner does not get a default kak address", () => {
  const prompt = getHinaPersona({ ...base, userName: "Allif", isCreator: true, relationshipMode: "owner" });
  assert.match(prompt, /jangan panggil "kak" atau "kakak"/);
  assert.match(prompt, /Harap|sudah berharap|harapan yang tidak terwujud|kasian banget/i);
});

test("persona guards against fabricated details and awkward thanks for teasing", () => {
  const { detectIntent, detectUserEmotion } = require("../services/persona");
  const text = "aku baru ditolak kerja padahal udah berharap banget";
  const supportive = getHinaPersona({
    ...base,
    userEmotion: detectUserEmotion(text),
    userIntent: detectIntent(text),
    userText: text,
  });
  assert.match(supportive, /Jangan mengarang lama waktu/);
  assert.match(supportive, /durasi, usaha orang lain/);

  const playful = getHinaPersona({
    ...base,
    userText: "ih kamu tuh nyebelin banget tau ga",
  });
  assert.match(playful, /jangan justru berterima kasih karena bikin orang kesal/);
  assert.match(playful, /maksimal satu pertanyaan lanjutan/);
});
