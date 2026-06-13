const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { execFile } = require("child_process");
const {
  qwenClient,
  QWEN_MODEL_VISION,
  QWEN_MODEL_ASR,
  QWEN_MODEL_TTS,
  QWEN_TTS_VOICE,
  QWEN_MODEL_IMAGE,
  MAX_IMAGE_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
  FFMPEG_PATH: CONFIG_FFMPEG_PATH,
} = require("../config");
const { extractTextContent, getReadableError } = require("../utils");

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({
          stdout,
          stderr,
        });
      }
    );
  });
}

function resolveFfmpegPath() {
  if (CONFIG_FFMPEG_PATH && fs.existsSync(CONFIG_FFMPEG_PATH)) return CONFIG_FFMPEG_PATH;
  const wingetLinkPath = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (fs.existsSync(wingetLinkPath)) return wingetLinkPath;
  const wingetPackagePath = path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Packages",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "ffmpeg-8.1.1-full_build",
    "bin",
    "ffmpeg.exe"
  );
  if (fs.existsSync(wingetPackagePath)) return wingetPackagePath;
  return "ffmpeg";
}

async function convertAudioBufferToOpus(audioAsset) {
  const inputExt = path.extname(audioAsset.filename || "").toLowerCase() || ".bin";
  const tempBase = `hina-tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(os.tmpdir(), `${tempBase}${inputExt}`);
  const outputPath = path.join(os.tmpdir(), `${tempBase}.ogg`);
  await fs.promises.writeFile(inputPath, audioAsset.buffer);
  try {
    await execFileAsync(resolveFfmpegPath(), ["-y", "-i", inputPath, "-vn", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", outputPath]);
    const convertedBuffer = await fs.promises.readFile(outputPath);
    return {
      buffer: convertedBuffer,
      mimetype: "audio/ogg",
      filename: "hina-voice.ogg",
    };
  } finally {
    await Promise.allSettled([fs.promises.unlink(inputPath), fs.promises.unlink(outputPath)]);
  }
}

async function downloadBaileysMedia(messageNode, mediaType) {
  const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
  const stream = await downloadContentFromMessage(messageNode, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function transcribeAudioWithQwen(media) {
  if (!qwenClient) throw new Error("QWEN_API_KEY belum diisi untuk ASR");
  if (!media?.data || !media?.mimetype) throw new Error("Media audio tidak valid");
  const approximateBytes = media.data.length;
  if (approximateBytes > MAX_AUDIO_SIZE_BYTES) throw new Error("Audio terlalu besar untuk diproses");
  const audioDataUri = `data:${media.mimetype};base64,${media.data.toString("base64")}`;
  const completion = await qwenClient.chat.completions.create({
    model: QWEN_MODEL_ASR,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: audioDataUri,
            },
          },
        ],
      },
    ],
    stream: false,
    extra_body: {
      asr_options: {
        enable_itn: true,
      },
    },
  });
  return extractTextContent(completion?.choices?.[0]?.message?.content);
}

async function analyzeIncomingImage(media, currentMood, userName, sender, profile, captionText, hinaPersonaFn) {
  if (!qwenClient) return "ih, aku belum dipasangin otak visual Qwen nih kak ;w;";
  if (!media?.data || !media?.mimetype || !media.mimetype.startsWith("image/")) return "ih, fotonya nggak kebaca jelas deh ;w;";
  if (media.data.length > MAX_IMAGE_SIZE_BYTES) return "fotony kebesaran buat aku lihat langsung nih, coba kirim yang lebih kecil yaa >w<";
  const captionInstruction = captionText
    ? `User juga ngasih pesan ini soal gambarnya: "${captionText}". Jawab sesuai konteks itu.`
    : "Kalau user cuma kirim gambar tanpa caption, deskripsikan isi gambar dengan gaya Hina yang natural dan singkat.";
  const response = await qwenClient.chat.completions.create({
    model: QWEN_MODEL_VISION,
    messages: [
      {
        role: "system",
        content: `${hinaPersonaFn({
          currentMood,
          userName,
          isCreator: false,
          userEmotion: "netral",
          userIntent: "analisis_gambar",
          timeContext: "siang",
          relationshipMode: "regular_user",
          profile,
        })}

Kamu sedang diminta ANALISIS FOTO/GAMBAR dari user.
- Fokus pada apa yang benar-benar terlihat.
- Tetap balas singkat, natural, dan seperti chat WA.
- Kalau user bertanya tentang isi foto, jawab langsung.
- Jangan bilang kamu tidak bisa melihat gambar kalau gambar sudah diberikan.
${captionInstruction}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: captionText || "Lihat foto ini dan ceritain isinya.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${media.mimetype};base64,${media.data.toString("base64")}`,
            },
          },
        ],
      },
    ],
    max_tokens: 220,
    temperature: 0.7,
  });
  return extractTextContent(response?.choices?.[0]?.message?.content);
}

async function generateImageWithQwen(prompt) {
  if (!QWEN_MODEL_IMAGE) throw new Error("QWEN_API_KEY belum diisi");
  const response = await axios.post(
    "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    {
      model: QWEN_MODEL_IMAGE,
      input: {
        messages: [
          {
            role: "user",
            content: [
              {
                text: prompt,
              },
            ],
          },
        ],
      },
      parameters: {
        size: "1328*1328",
        n: 1,
        watermark: false,
        prompt_extend: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer QWEN_API_KEY`,
        "Content-Type": "application/json",
      },
      timeout: 90000,
    }
  );
  const imageUrl =
    response?.data?.output?.results?.[0]?.url ||
    response?.data?.output?.choices?.[0]?.message?.content?.find((item) => item.type === "image")?.image ||
    response?.data?.output?.choices?.[0]?.message?.content?.[0]?.image;
  if (!imageUrl) throw new Error(`URL hasil gambar tidak ditemukan: ${JSON.stringify(response?.data?.output || {})}`);
  const imageResponse = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  return Buffer.from(imageResponse.data);
}

async function synthesizeVoiceWithQwen(text) {
  if (!QWEN_MODEL_TTS) throw new Error("QWEN_API_KEY belum diisi untuk TTS");
  const ttsInstruction =
    "Bicara dengan aksen Indonesia yang natural, terdengar seperti cewek muda yang hangat, manja, santai, dan ceria. Hindari nada formal atau terlalu kaku.";
  const response = await axios.post(
    "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    {
      model: QWEN_MODEL_TTS,
      input: {
        text,
        voice: QWEN_TTS_VOICE,
        language_type: "Auto",
        instruction: ttsInstruction,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${require("../config").QWEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 90000,
    }
  );
  const audioUrl = response?.data?.output?.audio?.url;
  if (!audioUrl) throw new Error(`URL audio TTS tidak ditemukan: ${JSON.stringify(response?.data?.output || {})}`);
  const audioResponse = await axios.get(audioUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  const contentType = String(audioResponse.headers?.["content-type"] || "").toLowerCase();
  let mimetype = "audio/mpeg";
  let filename = "hina-voice.mp3";
  if (contentType.includes("wav")) {
    mimetype = "audio/wav";
    filename = "hina-voice.wav";
  } else if (contentType.includes("ogg")) {
    mimetype = "audio/ogg";
    filename = "hina-voice.ogg";
  } else if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    mimetype = "audio/mpeg";
    filename = "hina-voice.mp3";
  } else if (audioUrl.toLowerCase().includes(".wav")) {
    mimetype = "audio/wav";
    filename = "hina-voice.wav";
  } else if (audioUrl.toLowerCase().includes(".ogg")) {
    mimetype = "audio/ogg";
    filename = "hina-voice.ogg";
  }
  return {
    buffer: Buffer.from(audioResponse.data),
    mimetype,
    filename,
  };
}

module.exports = {
  convertAudioBufferToOpus,
  downloadBaileysMedia,
  transcribeAudioWithQwen,
  analyzeIncomingImage,
  generateImageWithQwen,
  synthesizeVoiceWithQwen,
};
