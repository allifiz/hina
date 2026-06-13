const { OWNER_NUMBER, PARTNER_NUMBER, OWNER_NAME, PARTNER_NAME, VALID_MOODS } = require("./config");

function extractNumberFromJid(jid) {
  if (!jid) return "";
  return String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isOwner(sender) {
  return extractNumberFromJid(sender) === OWNER_NUMBER;
}

function getDisplayName(sender, contactName) {
  if (isOwner(sender)) return OWNER_NAME;
  if (extractNumberFromJid(sender) === PARTNER_NUMBER) return PARTNER_NAME;
  return contactName || "kakak";
}

function getTimeContext() {
  const hour = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
    })
  ).getHours();
  if (hour >= 4 && hour < 10) return "pagi";
  if (hour >= 10 && hour < 15) return "siang";
  if (hour >= 15 && hour < 18) return "sore";
  if (hour >= 18 && hour < 23) return "malam";
  return "larut_malam";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTextContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && item.type === "text" && typeof item.text === "string") return item.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function shouldSwitchModel(error) {
  if (!error) return false;
  const status = error.status || error.statusCode || error.response?.status;
  const message = String(error.message || error.response?.data?.message || error.response?.data?.code || "").toLowerCase();
  const code = String(error.code || "").toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    status === 400 ||
    status === 404 ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("quota") ||
    message.includes("balance") ||
    message.includes("arrearage") ||
    message.includes("insufficient") ||
    message.includes("model not found") ||
    message.includes("invalid model") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    code.includes("quota") ||
    code.includes("arrearage") ||
    code.includes("timeout") ||
    code.includes("etimedout") ||
    code.includes("econnreset") ||
    code.includes("econnaborted")
  );
}

function buildCompletionPayload(model, messages, userIntent) {
  const isRag = userIntent === "live_info";
  const isShort = userIntent === "short_reply";

  return {
    model,
    messages,
    top_p: isRag ? 0.85 : 0.9,
    frequency_penalty: isRag ? 0.15 : 0.2,
    presence_penalty: isRag ? 0.1 : 0.2,
    max_tokens: isShort ? 32 : isRag ? 120 : 90,
    temperature: isRag ? 0.45 : isShort ? 0.8 : ["curhat", "ngobrol"].includes(userIntent) ? 0.85 : 0.7,
  };
}

function getReadableError(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  return error.message || error.name || JSON.stringify(error);
}

function extractMoodAndCleanReply(text) {
  const raw = String(text || "");
  let match = raw.match(/^\s*\[mood:\s*([a-z]+)\]\s*([\s\S]*)$/i);
  if (match && VALID_MOODS.includes(match[1].toLowerCase()))
    return {
      mood: match[1].toLowerCase(),
      reply: match[2].trim(),
    };
  match = raw.match(/^([\s\S]*?)\s*\[mood:\s*([a-z]+)\]\s*$/i);
  if (match && VALID_MOODS.includes(match[2].toLowerCase()))
    return {
      mood: match[2].toLowerCase(),
      reply: match[1].trim(),
    };
  match = raw.match(/^\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*([\s\S]*)$/i);
  if (match && VALID_MOODS.includes(match[1].toLowerCase()))
    return {
      mood: match[1].toLowerCase(),
      reply: match[2].trim(),
    };
  match = raw.match(/^([\s\S]*?)\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*$/i);
  if (match && VALID_MOODS.includes(match[2].toLowerCase()))
    return {
      mood: match[2].toLowerCase(),
      reply: match[1].trim(),
    };
  return {
    mood: "biasa",
    reply: raw.trim(),
  };
}

function stabilizeMood(previousMood, detectedEmotion, aiMood) {
  if (!VALID_MOODS.includes(aiMood)) return previousMood || "biasa";
  if (detectedEmotion === "bercanda" && ["sedih", "marah", "kesal"].includes(previousMood)) return "ceria";
  return aiMood;
}

function cleanBotReply(reply) {
  if (!reply) return "Aku bingung jawabnya, kak ;w;";
  return String(reply)
    .replace(/^\s*\[mood:\s*[a-z]+\]\s*/i, "")
    .replace(/\s*\[mood:\s*[a-z]+\]\s*$/i, "")
    .replace(/^\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*/i, "")
    .replace(/\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*$/i, "")
    .replace(/\[REMINDER:.*?\]/gi, "")
    .replace(/^\s*REMINDER:\s*hari\s*\|\s*jam\s*\|\s*pesan\s*$/gim, "")
    .replace(/^\s*(assistant|hina)\s*:\s*/gim, "")
    .replace(/\bASSISTANT\b\s*:?\s*$/gim, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/^"|"$/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseReminderTag(text) {
  const match = String(text || "").match(/\[REMINDER:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\]/i);
  if (!match) return null;
  const targetHari = match[1].toLowerCase().trim();
  const targetJam = match[2].trim();
  const targetPesan = match[3].trim();
  const targetDate = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
    })
  );
  if (targetHari.includes("besok")) targetDate.setDate(targetDate.getDate() + 1);
  const [hours, minutes] = targetJam.split(":");
  targetDate.setHours(parseInt(hours, 10) || 7, parseInt(minutes, 10) || 0, 0, 0);
  return {
    reminder: {
      time: targetDate.getTime(),
      message: targetPesan,
    },
  };
}

function extractImagePrompt(text) {
  return String(text || "")
    .replace(/^(buat(in)?|bikinin|generate|gambar(in)?|lukis(in)?|create)\s+/i, "")
    .replace(/\bgambar\b|\bfoto\b|\bilustrasi\b|\bwallpaper\b|\bposter\b/gi, "")
    .trim();
}

function isAudioMedia(media) {
  return Boolean(media?.mimetype && media.mimetype.startsWith("audio/"));
}

function getTextFromMessage(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    message?.ephemeralMessage?.message?.conversation ||
    message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    message?.ephemeralMessage?.message?.imageMessage?.caption ||
    message?.ephemeralMessage?.message?.videoMessage?.caption ||
    message?.viewOnceMessageV2?.message?.imageMessage?.caption ||
    message?.viewOnceMessageV2?.message?.videoMessage?.caption ||
    message?.viewOnceMessageV2Extension?.message?.imageMessage?.caption ||
    message?.viewOnceMessageV2Extension?.message?.videoMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    message?.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  );
}

function unwrapMessageContent(message) {
  if (!message) return message;
  if (message.ephemeralMessage?.message) return unwrapMessageContent(message.ephemeralMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessageContent(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) return unwrapMessageContent(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessageContent(message.documentWithCaptionMessage.message);
  return message;
}

function getMediaDescriptor(message) {
  const normalizedMessage = unwrapMessageContent(message);
  if (normalizedMessage?.imageMessage)
    return {
      kind: "image",
      node: normalizedMessage.imageMessage,
      mimetype: normalizedMessage.imageMessage.mimetype,
    };
  if (normalizedMessage?.audioMessage)
    return {
      kind: "audio",
      node: normalizedMessage.audioMessage,
      mimetype: normalizedMessage.audioMessage.mimetype,
    };
  if (normalizedMessage?.videoMessage)
    return {
      kind: "video",
      node: normalizedMessage.videoMessage,
      mimetype: normalizedMessage.videoMessage.mimetype,
    };
  if (normalizedMessage?.documentMessage)
    return {
      kind: "document",
      node: normalizedMessage.documentMessage,
      mimetype: normalizedMessage.documentMessage.mimetype,
    };
  return null;
}

module.exports = {
  extractNumberFromJid,
  isOwner,
  getDisplayName,
  getTimeContext,
  sleep,
  extractTextContent,
  shouldSwitchModel,
  buildCompletionPayload,
  getReadableError,
  extractMoodAndCleanReply,
  stabilizeMood,
  cleanBotReply,
  parseReminderTag,
  extractImagePrompt,
  isAudioMedia,
  getTextFromMessage,
  unwrapMessageContent,
  getMediaDescriptor,
};
