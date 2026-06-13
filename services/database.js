const fs = require("fs");
const { DB_FILE, OWNER_NUMBER, OWNER_NAME, PARTNER_NUMBER, PARTNER_NAME } = require("../config");

let userProfiles = new Map();
let reminders = [];

function isPrivilegedUser(sender, extractNumberFromJid) {
  const number = extractNumberFromJid(sender);
  return number === OWNER_NUMBER || number === PARTNER_NUMBER;
}

function getUserProfile(sender, fallbackName, extractNumberFromJid, isOwner) {
  if (!userProfiles.has(sender)) {
    userProfiles.set(sender, {
      name: isOwner(sender) ? OWNER_NAME : extractNumberFromJid(sender) === PARTNER_NUMBER ? PARTNER_NAME : fallbackName || null,
      messageCount: 0,
      intimacy: isPrivilegedUser(sender, extractNumberFromJid) ? 8 : 1,
      lastEmotion: "netral",
      lastIntent: "ngobrol",
      lastTopic: null,
      lastInteractionAt: Date.now(),
      createdAt: Date.now(),
    });
  }
  return userProfiles.get(sender);
}

function updateUserProfile(sender, emotion, intent, text, fallbackName, extractNumberFromJid, isOwner) {
  const profile = getUserProfile(sender, fallbackName, extractNumberFromJid, isOwner);
  profile.messageCount += 1;
  profile.lastEmotion = emotion;
  profile.lastIntent = intent;
  profile.lastInteractionAt = Date.now();
  if (!profile.name && fallbackName) profile.name = fallbackName;
  if (text.length > 10) profile.lastTopic = text.slice(0, 80);
  if (profile.intimacy < 10) profile.intimacy += isPrivilegedUser(sender, extractNumberFromJid) ? 0.08 : 0.04;
  if (profile.intimacy > 10) profile.intimacy = 10;
  userProfiles.set(sender, profile);
  saveDatabase();
  return profile;
}

function loadDatabase() {
  if (!fs.existsSync(DB_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    for (const [jid, profile] of Object.entries(parsed.userProfiles || {})) {
      userProfiles.set(jid, profile);
    }
    reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
    console.log(`[DB] Memuat ${userProfiles.size} profil dan ${reminders.length} reminder.`);
  } catch (error) {
    console.error("[DB] Gagal membaca database:", error.message);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          userProfiles: Object.fromEntries(userProfiles),
          reminders,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("[DB] Gagal menyimpan database:", error.message);
  }
}

module.exports = {
  userProfiles,
  reminders,
  isPrivilegedUser,
  getUserProfile,
  updateUserProfile,
  loadDatabase,
  saveDatabase,
  setReminders: (arr) => {
    reminders = arr;
  },
  getReminders: () => reminders,
};
