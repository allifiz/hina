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

async function handleOwnerCommands(sock, sender, lowerMsg, textBody, userMoods, userProfiles, reminders, chatMemory, PARTNER_NAME, OWNER_NAME) {
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
    await replyText(sock, sender, "Command Hina: /help, /owner, /resetme, /mood, /stats, /status, /model, /ragcache, /clearcache, /vn teks");
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
    const { isPrivilegedUser } = require("../services/database");
    if (!isPrivilegedUser(sender, require("../utils").extractNumberFromJid)) {
      await replyText(sock, sender, "ih, command ini khusus owner ya >:/");
      return true;
    }

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
    const { isPrivilegedUser } = require("../services/database");
    if (!isPrivilegedUser(sender, require("../utils").extractNumberFromJid)) {
      await replyText(sock, sender, "ih, command ini khusus owner ya >:/");
      return true;
    }

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
    const { isPrivilegedUser } = require("../services/database");
    if (!isPrivilegedUser(sender, require("../utils").extractNumberFromJid)) {
      await replyText(sock, sender, "ih, command ini khusus owner ya >:/");
      return true;
    }

    await replyText(sock, sender, `Cache RAG sekarang: news ${getLiveInfoCache().size}, web ${getWebInfoCache().size} :3`);
    return true;
  }
  if (lowerMsg === "/clearcache") {
    const { isPrivilegedUser } = require("../services/database");
    if (!isPrivilegedUser(sender, require("../utils").extractNumberFromJid)) {
      await replyText(sock, sender, "ih, command ini khusus owner ya >:/");
      return true;
    }

    clearCaches();
    await replyText(sock, sender, "Cache RAG udah aku bersihin yaa :3");
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
