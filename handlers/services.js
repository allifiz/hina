const { replyText, replyWithPreferredFormat } = require("./messages");
const { sendVoiceReply } = require("../services/media");
const { getPrimaryRouteLabel } = require("../services/ai");
const { getLiveInfoCache, getWebInfoCache, clearCaches } = require("../services/web");
const { isOwner } = require("../utils");

function startReminderService(sock, reminders, saveDatabase) {
  setInterval(async () => {
    if (reminders.length === 0) return;
    const now = Date.now();
    const pending = [];
    const due = [];
    for (const reminder of reminders) {
      if (now >= reminder.time) due.push(reminder);
      else pending.push(reminder);
    }
    if (due.length === 0) return;
    reminders.splice(0, reminders.length, ...pending);
    saveDatabase();
    for (const reminder of due) {
      try {
        await sock.sendMessage(reminder.jid, {
          text: `Psttt! Aku disuruh ingetin kamu soal ini nih: "${reminder.message}" :3 Jangan sampai lupa yaaa!`,
        });
      } catch (error) {
        console.error("[Reminder] Gagal kirim:", error.message);
      }
    }
  }, 60000);
}

function startProactiveMessaging(sock, userProfiles, saveDatabase) {
  setInterval(async () => {
    const now = Date.now();
    for (const [jid, profile] of userProfiles.entries()) {
      if (profile.banned || profile.muted) continue;
      if (profile.intimacy < 5) continue;
      const hoursSinceLastChat = (now - profile.lastInteractionAt) / (1000 * 60 * 60);
      if (hoursSinceLastChat <= 24 || hoursSinceLastChat >= 48) continue;
      if (profile.lastProactiveAt && now - profile.lastProactiveAt < 86400000) continue;
      const manjaMessages = [
        "Hii... sibuk banget yaa hari inii? Kok aku ditinggalin ajaa ;w;",
        "Pstt... lagi ngapain sihh? Udah lupa ya sama akuu? >:/",
        "Haloo! Cuma mau ngingetin jangan lupa makan yaaa hari inii! :3",
      ];
      try {
        const randomMsg = manjaMessages[Math.floor(Math.random() * manjaMessages.length)];
        await sock.sendMessage(jid, {
          text: randomMsg,
        });
        profile.lastProactiveAt = now;
        profile.lastInteractionAt = now;
        userProfiles.set(jid, profile);
        saveDatabase();
      } catch (error) {
        console.error("[Proactive] Gagal ngirim pesan:", error.message);
      }
    }
  }, 3600000);
}

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function formatUserLine(index, jid, profile) {
  const name = profile?.name || "kakak";
  const chat = profile?.messageCount || 0;
  const stage = profile?.relationship?.stage || "normal";
  const flags = [profile?.banned ? "banned" : null, profile?.muted ? "muted" : null].filter(Boolean).join(", ");
  return `${index}. ${name} - ${jid} - ${chat} chat - ${stage}${flags ? ` - ${flags}` : ""}`;
}

function getTargetJidFromRaw(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return null;

  const cleaned = value.replace(/^@/, "").trim();
  if (cleaned.includes("@")) return cleaned.toLowerCase();
  if (/^\d+$/.test(cleaned)) return `${cleaned}@lid`;
  return null;
}

function findUsersByName(userProfiles, nameInput = "") {
  const query = normalizeText(nameInput);
  if (!query) return [];

  const exact = [];
  const partial = [];

  for (const [jid, profile] of userProfiles.entries()) {
    const name = normalizeText(profile?.name || "");
    if (!name) continue;
    if (name === query) exact.push({ jid, profile });
    else if (name.includes(query) || query.includes(name)) partial.push({ jid, profile });
  }

  return exact.length ? exact : partial;
}

function resolveTarget(userProfiles, targetInput = "") {
  const raw = String(targetInput || "").trim();
  if (!raw) {
    return { error: "Target kosong." };
  }

  const jid = getTargetJidFromRaw(raw);
  if (jid) {
    return { jid, profile: userProfiles.get(jid) || null };
  }

  const matches = findUsersByName(userProfiles, raw);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return {
      error: `Nama \"${raw}\" ambigu. Pakai LID atau pilih salah satu:\n${matches
        .slice(0, 8)
        .map((item, index) => formatUserLine(index + 1, item.jid, item.profile))
        .join("\n")}`,
    };
  }

  return { error: `User \"${raw}\" nggak ketemu di database. Pakai LID kalau belum ada namanya.` };
}

function ensureProfile(userProfiles, jid) {
  if (!userProfiles.has(jid)) {
    userProfiles.set(jid, {
      name: "kakak",
      messageCount: 0,
      intimacy: 1,
      lastEmotion: "netral",
      lastIntent: "ngobrol",
      lastTopic: "",
      lastInteractionAt: Date.now(),
      createdAt: Date.now(),
    });
  }

  const profile = userProfiles.get(jid);
  if (!profile.relationship) resetRelationship(profile);
  return profile;
}

function clampScore(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function applyRelationshipStage(profile) {
  const relationship = profile.relationship || {};
  const tension = Number(relationship.tensionLevel || 0);

  if (tension >= 80) {
    relationship.stage = "heated";
    relationship.speechStyle = "lu-gua";
  } else if (tension >= 50) {
    relationship.stage = "cold";
    relationship.speechStyle = "mixed";
  } else if (tension >= 20) {
    relationship.stage = "annoyed";
    relationship.speechStyle = "aku-kamu";
  } else {
    relationship.stage = "normal";
    relationship.speechStyle = "aku-kamu";
  }

  relationship.lastTensionUpdateAt = Date.now();
  profile.relationship = relationship;
}

function setRelationshipStage(profile, stage) {
  const relationship = profile.relationship || {};
  relationship.stage = stage;

  if (stage === "heated") {
    relationship.tensionLevel = 100;
    relationship.speechStyle = "lu-gua";
  } else if (stage === "cold") {
    relationship.tensionLevel = Math.max(Number(relationship.tensionLevel || 0), 50);
    relationship.speechStyle = "mixed";
  } else if (stage === "annoyed") {
    relationship.tensionLevel = Math.max(Number(relationship.tensionLevel || 0), 20);
    relationship.speechStyle = "aku-kamu";
  } else {
    relationship.tensionLevel = 0;
    relationship.speechStyle = "aku-kamu";
  }

  relationship.lastTensionUpdateAt = Date.now();
  profile.relationship = relationship;
}

function resetRelationship(profile) {
  profile.relationship = {
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
    lastApologyAt: null,
  };
}

function resetUserProfile(profile) {
  profile.messageCount = 0;
  profile.intimacy = 1;
  profile.lastEmotion = "netral";
  profile.lastIntent = "ngobrol";
  profile.lastTopic = "";
  profile.lastInteractionAt = Date.now();
  profile.lastProactiveAt = null;
  profile.banned = false;
  profile.muted = false;
  resetRelationship(profile);
}

function getSortedUsers(userProfiles) {
  return [...userProfiles.entries()].sort((a, b) => Number(b[1]?.lastInteractionAt || 0) - Number(a[1]?.lastInteractionAt || 0));
}

function formatUserInfo(jid, profile) {
  const rel = profile.relationship || {};
  return `User: ${profile.name || "kakak"}
JID: ${jid}
Chat: ${profile.messageCount || 0}
Intimacy: ${Number(profile.intimacy || 0).toFixed(2)}/10
Mood: ${profile.lastEmotion || "netral"}
Intent: ${profile.lastIntent || "-"}
Topic: ${profile.lastTopic || "-"}
Respect: ${rel.respectScore ?? 100}
Tension: ${Math.round(rel.tensionLevel || 0)}
Stage: ${rel.stage || "normal"}
Speech: ${rel.speechStyle || "aku-kamu"}
Banned: ${profile.banned ? "ya" : "tidak"}
Muted: ${profile.muted ? "ya" : "tidak"}`;
}

function splitTargetAndValue(input = "") {
  const parts = String(input || "")
    .trim()
    .split(/\s+/);
  if (parts.length < 2) return { target: "", value: "" };
  const value = parts.pop();
  return { target: parts.join(" "), value };
}

function splitSetNameInput(input = "") {
  const raw = String(input || "").trim();
  const pipeIndex = raw.indexOf("|");
  if (pipeIndex !== -1) {
    return {
      target: raw.slice(0, pipeIndex).trim(),
      newName: raw.slice(pipeIndex + 1).trim(),
    };
  }

  const [target, ...nameParts] = raw.split(/\s+/);
  return {
    target: target || "",
    newName: nameParts.join(" ").trim(),
  };
}

function ownerOnly(sender) {
  return isOwner(sender);
}

async function denyIfNotOwner(sock, sender) {
  if (ownerOnly(sender)) return false;
  await replyText(sock, sender, "ih, command ini khusus owner ya >:/");
  return true;
}

async function handleOwnerCommands(sock, sender, lowerMsg, textBody, userMoods, userProfiles, reminders, chatMemory, PARTNER_NAME, OWNER_NAME, saveDatabase) {
  if (lowerMsg === "/owner") {
    await replyText(
      sock,
      sender,
      isOwner(sender)
        ? `Iya kak ${OWNER_NAME}, aku tahu kok kamu owner sekaligus penciptaku :3`
        : `Iya kak ${PARTNER_NAME}, kamu orang spesialnya kak ${OWNER_NAME}, jadi aku juga nurut sama kamu :3`
    );
    return true;
  }
  if (lowerMsg === "/resetme") {
    chatMemory.delete(sender);
    await replyText(sock, sender, "Oke kak, memory obrolan sementaramu sudah aku reset ya :3");
    return true;
  }
  if (lowerMsg === "/help") {
    await replyText(
      sock,
      sender,
      `Command Hina:
Public: /help, /owner, /resetme, /mood, /stats, /vn teks
Owner: /status, /model, /ragcache, /clearcache, /userinfo, /users, /resetrel, /setrespect, /settension, /setstage, /setname, /ban, /unban, /reminders, /clearreminders`
    );
    return true;
  }
  if (lowerMsg === "/mood") {
    await replyText(sock, sender, `Mood aku sekarang ${userMoods.get(sender) || "ceria"} ;3`);
    return true;
  }
  if (lowerMsg === "/stats") {
    const profile = userProfiles.get(sender);
    if (profile) {
      await replyText(sock, sender, `Kita udah chat ${profile.messageCount} kali, deketnya ${Math.floor(profile.intimacy)}/10 :3`);
    }
    return true;
  }
  if (lowerMsg === "/status") {
    if (await denyIfNotOwner(sock, sender)) return true;

    await replyText(
      sock,
      sender,
      `Hina aktif :3
Route utama: ${getPrimaryRouteLabel()}
User profile: ${userProfiles.size}
Cache news: ${getLiveInfoCache().size}
Cache web: ${getWebInfoCache().size}
Reminder: ${reminders.length}`
    );
    return true;
  }
  if (lowerMsg === "/model") {
    if (await denyIfNotOwner(sock, sender)) return true;

    const { OPENROUTER_AVAILABLE_MODELS, QWEN_AVAILABLE_MODELS, QWEN_MODEL_VISION } = require("../config");
    await replyText(
      sock,
      sender,
      `Model aktif:
OpenRouter: ${OPENROUTER_AVAILABLE_MODELS.join(", ") || "-"}
Qwen text: ${QWEN_AVAILABLE_MODELS.join(", ") || "-"}
Qwen vision: ${QWEN_MODEL_VISION || "-"}`
    );
    return true;
  }
  if (lowerMsg === "/ragcache") {
    if (await denyIfNotOwner(sock, sender)) return true;

    await replyText(sock, sender, `Cache RAG sekarang: news ${getLiveInfoCache().size}, web ${getWebInfoCache().size} :3`);
    return true;
  }
  if (lowerMsg === "/clearcache") {
    if (await denyIfNotOwner(sock, sender)) return true;

    clearCaches();
    await replyText(sock, sender, "Cache RAG udah aku bersihin yaa :3");
    return true;
  }

  if (lowerMsg === "/users" || lowerMsg.startsWith("/users ")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const limit = Math.max(1, Math.min(50, Number(textBody.trim().split(/\s+/)[1]) || 15));
    const list = getSortedUsers(userProfiles)
      .slice(0, limit)
      .map(([jid, profile], index) => formatUserLine(index + 1, jid, profile))
      .join("\n");
    await replyText(sock, sender, list || "Belum ada user di database.");
    return true;
  }

  if (lowerMsg.startsWith("/userinfo")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const targetInput = textBody.slice("/userinfo".length).trim();
    const target = resolveTarget(userProfiles, targetInput || sender);
    if (target.error) {
      await replyText(sock, sender, target.error);
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    await replyText(sock, sender, formatUserInfo(target.jid, profile));
    return true;
  }

  if (lowerMsg.startsWith("/resetrel")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const targetInput = textBody.slice("/resetrel".length).trim();
    const target = resolveTarget(userProfiles, targetInput || sender);
    if (target.error) {
      await replyText(sock, sender, target.error);
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    resetRelationship(profile);
    saveDatabase();
    await replyText(sock, sender, `Relationship ${profile.name || target.jid} sudah direset ke normal.`);
    return true;
  }

  if (lowerMsg.startsWith("/setrespect")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const input = textBody.slice("/setrespect".length).trim();
    const { target: targetInput, value } = splitTargetAndValue(input);
    const score = clampScore(value);
    const target = resolveTarget(userProfiles, targetInput);
    if (score === null || target.error) {
      await replyText(sock, sender, target.error || "Format: /setrespect nama|jid 0-100\nContoh: /setrespect sinta 100");
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    profile.relationship.respectScore = score;
    saveDatabase();
    await replyText(sock, sender, `Respect ${profile.name || target.jid} di-set ke ${score}/100.`);
    return true;
  }

  if (lowerMsg.startsWith("/settension")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const input = textBody.slice("/settension".length).trim();
    const { target: targetInput, value } = splitTargetAndValue(input);
    const score = clampScore(value);
    const target = resolveTarget(userProfiles, targetInput);
    if (score === null || target.error) {
      await replyText(sock, sender, target.error || "Format: /settension nama|jid 0-100\nContoh: /settension sinta 0");
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    profile.relationship.tensionLevel = score;
    applyRelationshipStage(profile);
    saveDatabase();
    await replyText(sock, sender, `Tension ${profile.name || target.jid} di-set ke ${score}/100. Stage: ${profile.relationship.stage}.`);
    return true;
  }

  if (lowerMsg.startsWith("/setstage")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const input = textBody.slice("/setstage".length).trim();
    const { target: targetInput, value } = splitTargetAndValue(input);
    const stage = normalizeText(value);
    const validStages = ["normal", "annoyed", "cold", "heated"];
    const target = resolveTarget(userProfiles, targetInput);
    if (!validStages.includes(stage) || target.error) {
      await replyText(sock, sender, target.error || "Format: /setstage nama|jid normal|annoyed|cold|heated\nContoh: /setstage sinta normal");
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    setRelationshipStage(profile, stage);
    saveDatabase();
    await replyText(sock, sender, `Stage ${profile.name || target.jid} di-set ke ${stage}.`);
    return true;
  }

  if (lowerMsg.startsWith("/setname")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const input = textBody.slice("/setname".length).trim();
    const { target: targetInput, newName } = splitSetNameInput(input);
    const target = resolveTarget(userProfiles, targetInput);
    if (!newName || target.error) {
      await replyText(sock, sender, target.error || "Format: /setname target | nama baru\nContoh: /setname 236549719511070@lid | Sinta");
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    const oldName = profile.name || "kakak";
    profile.name = newName;
    saveDatabase();
    await replyText(sock, sender, `Nama ${oldName} (${target.jid}) diubah jadi ${newName}.`);
    return true;
  }

  if (lowerMsg.startsWith("/ban")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const targetInput = textBody.slice("/ban".length).trim();
    const target = resolveTarget(userProfiles, targetInput);
    if (target.error) {
      await replyText(sock, sender, target.error);
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    profile.banned = true;
    saveDatabase();
    await replyText(sock, sender, `${profile.name || target.jid} sudah diban. Hina bakal ignore dia.`);
    return true;
  }

  if (lowerMsg.startsWith("/unban")) {
    if (await denyIfNotOwner(sock, sender)) return true;
    const targetInput = textBody.slice("/unban".length).trim();
    const target = resolveTarget(userProfiles, targetInput);
    if (target.error) {
      await replyText(sock, sender, target.error);
      return true;
    }
    const profile = ensureProfile(userProfiles, target.jid);
    profile.banned = false;
    saveDatabase();
    await replyText(sock, sender, `${profile.name || target.jid} sudah di-unban.`);
    return true;
  }

  if (lowerMsg === "/reminders") {
    if (await denyIfNotOwner(sock, sender)) return true;
    if (!reminders.length) {
      await replyText(sock, sender, "Belum ada reminder aktif.");
      return true;
    }
    const lines = reminders.map((reminder, index) => {
      const profile = userProfiles.get(reminder.jid);
      const name = profile?.name || reminder.jid;
      const time = new Date(reminder.time).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      return `${index + 1}. ${name} - ${time} - ${reminder.message}`;
    });
    await replyText(sock, sender, lines.join("\n"));
    return true;
  }

  if (lowerMsg === "/clearreminders") {
    if (await denyIfNotOwner(sock, sender)) return true;
    const count = reminders.length;
    reminders.splice(0, reminders.length);
    saveDatabase();
    await replyText(sock, sender, `${count} reminder aktif sudah dihapus.`);
    return true;
  }

  if (lowerMsg.startsWith("/vn ")) {
    const voiceText = textBody.slice(4).trim();
    if (!voiceText) {
      await replyText(sock, sender, "isi dulu dong teksnya, nanti aku bacain ;w;");
      return true;
    }
    try {
      const mode = await sendVoiceReply(sock, sender, voiceText);
      if (mode !== "voice") {
        await replyText(
          sock,
          sender,
          mode === "audio"
            ? "aku kirim suara biasa dulu yaa, mode VN asli di mesin ini masih agak rewel >w<"
            : "aku kirim sebagai file audio dulu yaa, mode VN di mesin ini masih belum jinak ;w;"
        );
      }
    } catch (voiceError) {
      console.error("[Voice] Gagal total kirim TTS:", voiceError.message);
      await replyText(sock, sender, "huee... aku gagal ngomong pakai suara barusan ;w; coba lagi bentar yaa");
    }
    return true;
  }
  return false;
}

module.exports = {
  startReminderService,
  startProactiveMessaging,
  handleOwnerCommands,
};
