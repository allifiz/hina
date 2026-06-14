require("dotenv").config();
const OpenAI = require("openai");

function getEnvValue(name) {
  return String(process.env[name] || "").trim();
}

function normalizeNumber(number) {
  if (!number) return "";
  return String(number).trim().replace(/\D/g, "").replace(/^0/, "62");
}

// API Keys & URLs
const OPENROUTER_API_KEY = getEnvValue("OPENROUTER_API_KEY");
const OPENROUTER_SITE_URL = getEnvValue("OPENROUTER_SITE_URL") || "https://github.com/allif";
const OPENROUTER_APP_NAME = getEnvValue("OPENROUTER_APP_NAME") || "WhatsApp Bot Hina";
const OPENROUTER_MODEL = getEnvValue("OPENROUTER_MODEL");
const OPENROUTER_MODELS = getEnvValue("OPENROUTER_MODELS");
const QWEN_API_KEY = getEnvValue("QWEN_API_KEY");
const TAVILY_API_KEY = getEnvValue("TAVILY_API_KEY");

// Models
const QWEN_MODEL_SMART = getEnvValue("QWEN_MODEL_SMART") || "qwen3.7-plus";
const QWEN_MODEL_FALLBACK = getEnvValue("QWEN_MODEL_FALLBACK") || "qwen3.6-flash";
const QWEN_MODEL_VISION = getEnvValue("QWEN_MODEL_VISION") || "qwen3.5-plus-2026-02-15";
const QWEN_MODEL_IMAGE = getEnvValue("QWEN_MODEL_IMAGE") || "qwen-image";
const QWEN_MODEL_ASR = getEnvValue("QWEN_MODEL_ASR") || "qwen3-asr-flash-2025-09-08";
const QWEN_MODEL_TTS = getEnvValue("QWEN_MODEL_TTS") || "qwen3-tts-flash-2025-09-18";
const QWEN_TTS_VOICE = getEnvValue("QWEN_TTS_VOICE") || "Cherry";

// Owner & Partner
const OWNER_NUMBER = normalizeNumber(getEnvValue("OWNER_NUMBER") || "6285894138868");
const OWNER_NAME = getEnvValue("OWNER_NAME") || "Allif";
const PARTNER_NUMBER = normalizeNumber(getEnvValue("PARTNER_NUMBER") || "628515901030");
const PARTNER_NAME = getEnvValue("PARTNER_NAME") || "Sinta";
const OWNER_LID = getEnvValue("OWNER_LID") || "124197653196846@lid";
const PARTNER_LID = getEnvValue("PARTNER_LID") || "236549719511070@lid";

// System settings
const DB_FILE = "./database.json";
const FFMPEG_PATH = getEnvValue("FFMPEG_PATH");
const MAX_IMAGE_SIZE_BYTES = 7 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_HISTORY = 10;
const VALID_MOODS = ["ceria", "senang", "marah", "sedih", "cemburu", "malu", "mengantuk", "biasa", "kesal"];

if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY belum ada di .env");
  process.exit(1);
}

// Initialize OpenAI clients
const openRouterClient = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": OPENROUTER_SITE_URL,
    "X-Title": OPENROUTER_APP_NAME,
  },
});

const qwenClient = QWEN_API_KEY
  ? new OpenAI({
      apiKey: QWEN_API_KEY,
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    })
  : null;

// Available models
function isTextChatModel(model) {
  return model && !/(^|[-_])vl([-_]|$)|vision/i.test(String(model || ""));
}

const OPENROUTER_AVAILABLE_MODELS = [
  ...OPENROUTER_MODELS.split(",")
    .map((model) => model.trim())
    .filter(Boolean),
  OPENROUTER_MODEL,
  "openrouter/owl-alpha",
].filter((model, index, models) => model && models.indexOf(model) === index);

const QWEN_AVAILABLE_MODELS = [QWEN_MODEL_SMART, QWEN_MODEL_FALLBACK].filter(isTextChatModel).filter((model, index, models) => models.indexOf(model) === index);

module.exports = {
  getEnvValue,
  normalizeNumber,
  // API Keys
  OPENROUTER_API_KEY,
  OPENROUTER_SITE_URL,
  OPENROUTER_APP_NAME,
  OPENROUTER_MODEL,
  OPENROUTER_MODELS,
  QWEN_API_KEY,
  TAVILY_API_KEY,
  // Models
  QWEN_MODEL_SMART,
  QWEN_MODEL_FALLBACK,
  QWEN_MODEL_VISION,
  QWEN_MODEL_IMAGE,
  QWEN_MODEL_ASR,
  QWEN_MODEL_TTS,
  QWEN_TTS_VOICE,
  // Owner & Partner
  OWNER_NUMBER,
  OWNER_NAME,
  PARTNER_NUMBER,
  PARTNER_NAME,
  OWNER_LID,
  PARTNER_LID,
  // System settings
  DB_FILE,
  FFMPEG_PATH,
  MAX_IMAGE_SIZE_BYTES,
  MAX_AUDIO_SIZE_BYTES,
  MAX_HISTORY,
  VALID_MOODS,
  // Clients
  openRouterClient,
  qwenClient,
  OPENROUTER_AVAILABLE_MODELS,
  QWEN_AVAILABLE_MODELS,
};
