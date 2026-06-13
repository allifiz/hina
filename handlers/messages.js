const { sleep } = require("../utils");
const { synthesizeVoiceWithQwen, convertAudioBufferToOpus } = require("../services/media");
const { getReadableError } = require("../utils");

function humanTypingDelay(text) {
  return 0;
}

function startTyping(sock, chatId, mode = "composing") {
  let stopped = false;

  async function sendTyping() {
    if (stopped) return;

    try {
      await sock.sendPresenceUpdate(mode, chatId);
    } catch (error) {
      console.warn("[Typing] Gagal kirim presence:", error.message);
    }
  }

  sendTyping();

  const interval = setInterval(sendTyping, 4000);

  return async function stopTyping() {
    stopped = true;
    clearInterval(interval);

    try {
      await sock.sendPresenceUpdate("paused", chatId);
    } catch (error) {
      console.warn("[Typing] Gagal pause presence:", error.message);
    }
  };
}

async function replyText(sock, chatId, text) {
  await sleep(humanTypingDelay(text));
  await sock.sendMessage(chatId, {
    text,
  });
}

async function sendVoiceReply(sock, chatId, text) {
  const originalAudioAsset = await synthesizeVoiceWithQwen(text);
  let audioAsset = originalAudioAsset;
  if (audioAsset.mimetype !== "audio/ogg") {
    try {
      audioAsset = await convertAudioBufferToOpus(audioAsset);
    } catch (conversionError) {
      console.warn(`[Voice] Gagal convert ke opus, pakai format asli: ${getReadableError(conversionError)}`);
    }
  }
  const voiceCapable = audioAsset.mimetype === "audio/ogg";
  try {
    await sock.sendMessage(chatId, {
      audio: audioAsset.buffer,
      mimetype: voiceCapable ? "audio/ogg; codecs=opus" : audioAsset.mimetype,
      ptt: voiceCapable,
    });
    return voiceCapable ? "voice" : "audio";
  } catch (error) {
    console.warn(`[Voice] Gagal kirim audio utama, fallback berikutnya: ${getReadableError(error)}`);
    try {
      await sock.sendMessage(chatId, {
        document: audioAsset.buffer,
        fileName: audioAsset.filename,
        mimetype: audioAsset.mimetype,
      });
      return "document";
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
}

async function replyWithPreferredFormat(sock, chatId, text, options = {}) {
  if (!options.voiceReply) {
    await replyText(sock, chatId, text);
    return "text";
  }
  try {
    return await sendVoiceReply(sock, chatId, text);
  } catch (error) {
    console.error("[Voice] Gagal balas dengan suara, fallback ke teks:", getReadableError(error));
    await replyText(sock, chatId, text);
    return "text";
  }
}

module.exports = {
  startTyping,
  replyText,
  replyWithPreferredFormat,
  sendVoiceReply,
};
