const { Boom } = require("@hapi/boom");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");

// Config & Services
const {
  MAX_HISTORY,
  QWEN_API_KEY,
} = require("./config");

// Utils
const {
  extractNumberFromJid,
  isOwner,
  getDisplayName,
  getTimeContext,
  extractTextContent,
  extractMoodAndCleanReply,
  stabilizeMood,
  cleanBotReply,
  parseReminderTag,
  extractImagePrompt,
  getTextFromMessage,
  getMediaDescriptor,
} = require("./utils");

// Database
const {
  userProfiles,
  getUserProfile,
  updateUserProfile,
  loadDatabase,
  saveDatabase,
} = require("./services/database");

// AI Services
const {
  getProviderCandidates,
  getPrimaryRouteLabel,
  selectReasoningRoute,
  getReplyFromProviders,
} = require("./services/ai");

// Web Services
const { getRagMode, getRagContext } = require("./services/web");

// Media Services
const {
  downloadBaileysMedia,
  transcribeAudioWithQwen,
  analyzeIncomingImage,
  generateImageWithQwen,
} = require("./services/media");

// Persona & Intent
const {
  detectUserEmotion,
  detectIntent,
  getInstantReply,
  getRelationshipMode,
  getHinaPersona,
} = require("./services/persona");

// Handlers
const {
  startReminderService,
  startProactiveMessaging,
  handleOwnerCommands,
} = require("./handlers/services");

const {
  startTyping,
  replyText,
  replyWithPreferredFormat,
} = require("./handlers/messages");

// Global state
const chatMemory = new Map();
const userMoods = new Map();
const reminders = [];
let isServicesStarted = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Hina Bot", "Ubuntu", "1.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    fireInitQueries: false,
    defaultQueryTimeoutMs: 120000,
    shouldSyncHistoryMessage: () => false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr)
      qrcode.generate(qr, {
        small: true,
      });
    if (connection === "close") {
      const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : null;
      if (statusCode !== DisconnectReason.loggedOut) connectToWhatsApp();
      else console.log("[Connection] Logged out.");
    } else if (connection === "open") {
      console.log(`Mantap! Bot WhatsApp (Hina Baileys) sudah aktif. Rute utama: ${getPrimaryRouteLabel()}`);
      if (!isServicesStarted) {
        startReminderService(sock, reminders, saveDatabase);
        startProactiveMessaging(sock, userProfiles, saveDatabase);
        isServicesStarted = true;
        console.log("[System] Reminder dan proactive messaging aktif.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe || msg.key.remoteJid?.endsWith("@g.us")) return;

    const sender = msg.key.remoteJid;
    const textFromMessage = getTextFromMessage(msg.message);
    const mediaDescriptor = getMediaDescriptor(msg.message);

    if (!textFromMessage && !mediaDescriptor) {
      console.log(`[Skip] Pesan non-chat dari ${sender}, diabaikan.`);
      return;
    }

    const mediaIsAudio = mediaDescriptor?.kind === "audio";
    const shouldReplyAsVoice = mediaIsAudio;
    console.log(`Pesan dari ${sender}: ${textFromMessage || (mediaDescriptor ? `[${mediaDescriptor.kind}]` : "[unknown-message-type]")}`);

    let stopTyping = null;

    try {
      stopTyping = startTyping(sock, sender, "composing");

      let textBody = String(textFromMessage || "").trim();
      let downloadedMedia = null;

      if (mediaDescriptor) {
        if (mediaDescriptor.kind === "audio") {
          const buffer = await downloadBaileysMedia(mediaDescriptor.node, "audio");
          downloadedMedia = {
            data: buffer,
            mimetype: mediaDescriptor.mimetype,
          };
        } else if (mediaDescriptor.kind === "image") {
          const buffer = await downloadBaileysMedia(mediaDescriptor.node, "image");
          downloadedMedia = {
            data: buffer,
            mimetype: mediaDescriptor.mimetype,
          };
        }
      }

      if (!textBody && mediaIsAudio) {
        const transcript = await transcribeAudioWithQwen(downloadedMedia);
        textBody = String(transcript || "").trim();
        console.log(`Transkrip audio dari ${sender}: ${textBody || "[kosong]"}`);
      }

      const lowerMsg = textBody.toLowerCase();
      if (textBody && (await handleOwnerCommands(sock, sender, lowerMsg, textBody, userMoods, userProfiles, reminders, require("./config").PARTNER_NAME, require("./config").OWNER_NAME))) return;

      const currentMood = userMoods.get(sender) || (isOwner(sender) ? "senang" : "ceria");
      const userEmotion = detectUserEmotion(textBody || "gambar");
      const userIntent = mediaDescriptor?.kind === "image" ? "analisis_gambar" : detectIntent(textBody || "");
      const preferredProvider = selectReasoningRoute(textBody || "gambar", userIntent, userEmotion);
      const userName = getDisplayName(sender, userProfiles.get(sender)?.name);
      const profile = updateUserProfile(sender, userEmotion, userIntent, textBody || `[${mediaDescriptor?.kind || "media"}]`, userName, extractNumberFromJid, isOwner);
      const relationshipMode = getRelationshipMode(sender, profile, isOwner, extractNumberFromJid);

      if (mediaIsAudio && !textBody) {
        await replyWithPreferredFormat(sock, sender, "aku dengerin tadi, tapi belum nangkep isinya jelas ;w; coba VN yang lebih jelas yaa", {
          voiceReply: true,
        });
        return;
      }

      if (mediaDescriptor?.kind === "image") {
        const visualReply = await analyzeIncomingImage(downloadedMedia, currentMood, userName, sender, profile, textBody, getHinaPersona);
        const { mood: aiMood, reply } = extractMoodAndCleanReply(visualReply);
        userMoods.set(sender, stabilizeMood(currentMood, userEmotion, aiMood));
        await replyWithPreferredFormat(sock, sender, cleanBotReply(reply), {
          voiceReply: false,
        });
        return;
      }

      if (!textBody) return;

      const instantReply = getInstantReply(textBody, userName);
      if (instantReply && userIntent === "short_reply") {
        await replyWithPreferredFormat(sock, sender, instantReply, {
          voiceReply: shouldReplyAsVoice,
        });
        return;
      }

      if (userIntent === "generate_gambar") {
        const prompt = extractImagePrompt(textBody) || "anime girl, cute expression, soft lighting, detailed illustration";
        await replyText(sock, sender, "bentar yaa, aku bikinin gambarnya dulu... jangan kabur :3");
        const imageBuffer = await generateImageWithQwen(prompt);
        await sock.sendMessage(sender, {
          image: imageBuffer,
          caption: "nihh, udah jadi gambarnya :3",
        });
        return;
      }

      if (!chatMemory.has(sender)) chatMemory.set(sender, []);
      const history = chatMemory.get(sender);
      history.push({
        role: "user",
        content: textBody,
      });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

      let liveContext = "";

      if (userIntent === "live_info") {
        liveContext = await getRagContext(textBody, userIntent);
      }

      const messages = [
        {
          role: "system",
          content:
            getHinaPersona({
              currentMood,
              userName,
              isCreator: isOwner(sender),
              userEmotion,
              userIntent,
              timeContext: getTimeContext(),
              relationshipMode,
              profile,
              isOwner,
              OWNER_NAME: require("./config").OWNER_NAME,
              PARTNER_NAME: require("./config").PARTNER_NAME,
            }) + liveContext,
        },
        ...history,
      ];

      const generationResult = await getReplyFromProviders(messages, userIntent, preferredProvider, textBody, userEmotion);
      const rawReply = generationResult.rawReply;
      if (!rawReply) {
        console.error("Semua provider/model gagal dipakai.", generationResult.failures || []);
        await replyWithPreferredFormat(sock, sender, "huee... maaf banget kak, OpenRouter sama cadangan modelku lagi gagal semua >w< coba lagi bentar yaa...", {
          voiceReply: shouldReplyAsVoice,
        });
        return;
      }

      const reminderData = parseReminderTag(rawReply);
      if (reminderData) {
        reminders.push({
          jid: sender,
          ...reminderData.reminder,
        });
        saveDatabase();
      }

      const { mood: aiMood, reply } = extractMoodAndCleanReply(rawReply);
      const finalMood = stabilizeMood(currentMood, userEmotion, aiMood);
      const cleanReply = cleanBotReply(reply);
      userMoods.set(sender, finalMood);
      console.log(`Mood ${sender} berubah menjadi: ${finalMood}`);
      console.log(`Balasan dibuat via ${generationResult.providerLabel} (${generationResult.model})`);
      history.push({
        role: "assistant",
        content: cleanReply,
      });
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      await replyWithPreferredFormat(sock, sender, cleanReply, {
        voiceReply: shouldReplyAsVoice,
      });
    } catch (error) {
      console.error("Terjadi kesalahan API:", error.message || error);
      await replyText(sock, sender, "ih, kok tiba-tiba lemot ya... aku lagi error nih kak >w< bentar lagi coba lagi ya...");
    } finally {
      if (stopTyping) await stopTyping();
    }
  });
}

loadDatabase();
connectToWhatsApp();
