const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// All file operations use an isolated temporary database, never real user data.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hina-memory-test-"));
const file = path.join(temp, "database.json");
process.env.DB_FILE = file;
process.env.MEMORY_MAX_MESSAGES = "20";
process.env.NINEROUTER_API_KEY = "test-only";
process.env.LOCAL_MODEL_ENABLED = "false";
const db = require("../services/database");

test("old profiles/reminders migrate safely; chat history survives reload and stays private", (t) => {
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const jid = "sample-owner@lid";
  const other = "someone-else@lid";
  fs.writeFileSync(file, JSON.stringify({
    userProfiles: { [jid]: { name: "Tester", messageCount: 11, intimacy: 8 } },
    reminders: [{ jid, time: 1770000000000, message: "test reminder" }],
  }), { mode: 0o600 });

  db.loadDatabase();
  assert.equal(db.userProfiles.get(jid).name, "Tester");
  assert.equal(db.getReminders().length, 1);
  assert.equal(db.getRecentChatMessages(jid).length, 0);

  assert.equal(db.rememberUserNote(jid, "aku suka melukis bulan"), true);
  assert.equal(db.rememberUserNote(jid, "aku suka melukis bulan"), false);
  assert.deepEqual(db.getMemoryNotes(jid), ["aku suka melukis bulan"]);
  assert.deepEqual(db.getMemoryNotes(other), []);
  assert.match(db.getRelevantChatMemories(jid, "apa yang aku suka?", 8), /FAKTA YANG DIMINTA USER/);

  db.appendChatMessage(jid, "user", "aku suka melukis bulan");
  db.appendChatMessage(jid, "assistant", "ih bulan cantik banget ya");
  for (let index = 0; index < 7; index++) {
    db.appendChatMessage(jid, "user", "hari ini ada cerita lain " + index);
    db.appendChatMessage(jid, "assistant", "cerita lain diterima " + index);
  }
  const retrieved = db.getRelevantChatMemories(jid, "masih ingat aku suka melukis bulan?", 8);
  assert.match(retrieved, /aku suka melukis bulan/);
  assert.equal(db.getRelevantChatMemories(other, "melukis bulan", 8), "");

  const reloadedPath = require.resolve("../services/database");
  delete require.cache[reloadedPath];
  const reloaded = require("../services/database");
  reloaded.loadDatabase();
  assert.equal(reloaded.getRecentChatMessages(jid, 20).length, 16);
  assert.equal(reloaded.userProfiles.get(jid).messageCount, 11);
  assert.equal(reloaded.getReminders()[0].message, "test reminder");
  assert.deepEqual(reloaded.getMemoryNotes(jid), ["aku suka melukis bulan"]);
  assert.equal(reloaded.forgetUserNotes(other, "suka"), 0);

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  for (let index = 0; index < 30; index++) {
    reloaded.appendChatMessage(jid, "user", "tambahan percakapan " + index);
  }
  assert.equal(reloaded.getChatHistory(jid).length, 20);
  assert.deepEqual(Object.keys(reloaded.getRecentChatMessages(jid, 2)[0]).sort(), ["content", "role"]);

  assert.equal(reloaded.forgetUserNotes(jid, "bulan"), 1);
  assert.deepEqual(reloaded.getMemoryNotes(jid), []);
  assert.equal(reloaded.rememberUserNote(jid, "aku suka astronomi"), true);

  // /resetme uses the same per-user map deletion + saveDatabase behavior.
  reloaded.chatHistories.delete(jid);
  reloaded.memoryNotes.delete(jid);
  reloaded.saveDatabase();
  delete require.cache[reloadedPath];
  const cleared = require("../services/database");
  cleared.loadDatabase();
  assert.equal(cleared.getRecentChatMessages(jid).length, 0);
  assert.deepEqual(cleared.getMemoryNotes(jid), []);
  assert.equal(cleared.userProfiles.get(jid).name, "Tester");
  assert.equal(cleared.getReminders().length, 1);
});

test("mood follows context rather than default neutral tags", () => {
  const { resolveHinaMood } = require("../services/mood");
  assert.equal(resolveHinaMood({
    previousMood: "ceria", aiMood: "biasa", userEmotion: "sedih", userIntent: "curhat",
  }), "sedih");
  assert.equal(resolveHinaMood({
    previousMood: "ceria", aiMood: "biasa", userEmotion: "netral", replyStyle: "playful",
  }), "ceria");
  assert.equal(resolveHinaMood({
    previousMood: "ceria", aiMood: "malu", userEmotion: "netral", replyStyle: "playful",
  }), "malu");
  assert.equal(resolveHinaMood({
    previousMood: "ceria", aiMood: "senang", userEmotion: "netral", relationshipState: { stage: "heated" },
  }), "marah");
  assert.equal(resolveHinaMood({
    previousMood: "ceria", aiMood: "biasa", userEmotion: "senang",
  }), "senang");
});
