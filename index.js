require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const { Boom } = require('@hapi/boom');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
} = require('@whiskeysockets/baileys');

function getEnvValue(name) {
    return String(process.env[name] || '').trim();
}

function normalizeNumber(number) {
    if (!number) return '';
    return String(number).trim().replace(/\D/g, '').replace(/^0/, '62');
}

function extractNumberFromJid(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

const DB_FILE = './database.json';
const OPENROUTER_API_KEY = getEnvValue('OPENROUTER_API_KEY');
const OPENROUTER_SITE_URL = getEnvValue('OPENROUTER_SITE_URL') || 'https://github.com/allif';
const OPENROUTER_APP_NAME = getEnvValue('OPENROUTER_APP_NAME') || 'WhatsApp Bot Hina';
const OPENROUTER_MODEL = getEnvValue('OPENROUTER_MODEL');
const OPENROUTER_MODELS = getEnvValue('OPENROUTER_MODELS');
const QWEN_API_KEY = getEnvValue('QWEN_API_KEY');
const QWEN_MODEL_SMART = getEnvValue('QWEN_MODEL_SMART') || 'qwen3.7-plus';
const QWEN_MODEL_FALLBACK = getEnvValue('QWEN_MODEL_FALLBACK') || 'qwen3.6-flash';
const QWEN_MODEL_VISION = getEnvValue('QWEN_MODEL_VISION') || 'qwen3.5-plus-2026-02-15';
const QWEN_MODEL_IMAGE = getEnvValue('QWEN_MODEL_IMAGE') || 'qwen-image';
const QWEN_MODEL_ASR = getEnvValue('QWEN_MODEL_ASR') || 'qwen3-asr-flash-2025-09-08';
const QWEN_MODEL_TTS = getEnvValue('QWEN_MODEL_TTS') || 'qwen3-tts-flash-2025-09-18';
const QWEN_TTS_VOICE = getEnvValue('QWEN_TTS_VOICE') || 'Cherry';
const OWNER_NUMBER = normalizeNumber(getEnvValue('OWNER_NUMBER') || '6285894138868');
const OWNER_NAME = getEnvValue('OWNER_NAME') || 'Allif';
const PARTNER_NUMBER = normalizeNumber(getEnvValue('PARTNER_NUMBER') || '628515901030');
const PARTNER_NAME = getEnvValue('PARTNER_NAME') || 'Sin';
const FFMPEG_PATH = getEnvValue('FFMPEG_PATH');

if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY belum ada di .env');
    process.exit(1);
}

const openRouterClient = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': OPENROUTER_SITE_URL,
        'X-Title': OPENROUTER_APP_NAME,
    }
});

const qwenClient = QWEN_API_KEY
    ? new OpenAI({
        apiKey: QWEN_API_KEY,
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    })
    : null;

const OPENROUTER_AVAILABLE_MODELS = [
    ...OPENROUTER_MODELS.split(',').map((model) => model.trim()).filter(Boolean),
    OPENROUTER_MODEL,
    'openrouter/owl-alpha'
].filter((model, index, models) => model && models.indexOf(model) === index);

const QWEN_AVAILABLE_MODELS = [
    QWEN_MODEL_SMART,
    QWEN_MODEL_FALLBACK,
].filter((model, index, models) => model && models.indexOf(model) === index);

const MAX_IMAGE_SIZE_BYTES = 7 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_HISTORY = 10;
const VALID_MOODS = ['ceria', 'senang', 'marah', 'sedih', 'cemburu', 'malu', 'mengantuk', 'biasa', 'kesal'];

const chatMemory = new Map();
const userMoods = new Map();
const userProfiles = new Map();
let reminders = [];
let isServicesStarted = false;
const providerState = { openrouter: 0, qwen: 0 };

function isOwner(sender) {
    return extractNumberFromJid(sender) === OWNER_NUMBER;
}

function isPrivilegedUser(sender) {
    const number = extractNumberFromJid(sender);
    return number === OWNER_NUMBER || number === PARTNER_NUMBER;
}

function getDisplayName(sender, contactName) {
    if (isOwner(sender)) return OWNER_NAME;
    if (extractNumberFromJid(sender) === PARTNER_NUMBER) return PARTNER_NAME;
    return contactName || 'kakak';
}

function getTimeContext() {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).getHours();
    if (hour >= 4 && hour < 10) return 'pagi';
    if (hour >= 10 && hour < 15) return 'siang';
    if (hour >= 15 && hour < 18) return 'sore';
    if (hour >= 18 && hour < 23) return 'malam';
    return 'larut_malam';
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanTypingDelay(text) {
    const length = String(text || '').length;
    if (length <= 12) return 80 + Math.floor(Math.random() * 90);
    if (length <= 40) return 140 + Math.floor(Math.random() * 120);
    return Math.min(240 + (length * 4) + Math.floor(Math.random() * 180), 850);
}

function extractTextContent(content) {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map((item) => {
            if (typeof item === 'string') return item;
            if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
            return '';
        }).join('\n').trim();
    }
    return '';
}

function shouldSwitchModel(error) {
    if (!error) return false;
    const status = error.status || error.statusCode || error.response?.status;
    const message = String(error.message || error.response?.data?.message || error.response?.data?.code || '').toLowerCase();
    const code = String(error.code || '').toLowerCase();
    return (
        status === 429 || status === 402 || status === 400 || status === 404 ||
        status === 408 || status === 500 || status === 502 || status === 503 || status === 504 ||
        message.includes('quota') || message.includes('balance') || message.includes('arrearage') ||
        message.includes('insufficient') || message.includes('model not found') || message.includes('invalid model') ||
        message.includes('timeout') || message.includes('timed out') ||
        code.includes('quota') || code.includes('arrearage') || code.includes('timeout') ||
        code.includes('etimedout') || code.includes('econnreset') || code.includes('econnaborted')
    );
}

function getProviderCandidates() {
    const providers = [];
    if (qwenClient && QWEN_AVAILABLE_MODELS.length > 0) {
        providers.push({ name: 'qwen', label: 'Qwen', client: qwenClient, models: QWEN_AVAILABLE_MODELS });
    }
    if (openRouterClient && OPENROUTER_AVAILABLE_MODELS.length > 0) {
        providers.push({ name: 'openrouter', label: 'OpenRouter', client: openRouterClient, models: OPENROUTER_AVAILABLE_MODELS });
    }
    return providers;
}

function getPrimaryRouteLabel() {
    const providers = getProviderCandidates();
    if (providers.length === 0) return 'tidak ada model aktif';
    const provider = providers[0];
    const currentIndex = providerState[provider.name] || 0;
    const model = provider.models[currentIndex] || provider.models[0];
    return `${provider.label} -> ${model}`;
}

function buildCompletionPayload(model, messages, userIntent) {
    return {
        model,
        messages,
        top_p: 0.95,
        frequency_penalty: 0.25,
        presence_penalty: 0.35,
        max_tokens: userIntent === 'short_reply' ? 80 : 260,
        temperature: ['curhat', 'bertanya', 'minta_bantuan'].includes(userIntent) ? 0.8 : 0.9,
    };
}

function selectReasoningRoute(text, userIntent, userEmotion) {
    const msg = String(text || '').toLowerCase().trim();
    const longText = msg.length > 180;
    const emotionalHeavy = ['sedih', 'capek', 'cemas', 'kesepian', 'marah'].includes(userEmotion);
    const asksAdvice = /menurut kamu|aku harus gimana|harus gimana|baiknya gimana|mending|pilih mana|saran|nasihat|pendapat kamu/.test(msg);
    const asksExplanation = /jelasin|ajarin|langkah|cara|kenapa|gimana/.test(msg);
    const casualShort = userIntent === 'short_reply' || msg.length <= 40;
    if (qwenClient && (longText || emotionalHeavy || asksAdvice || asksExplanation || userIntent === 'curhat' || userIntent === 'minta_bantuan')) {
        return 'qwen';
    }
    if (!casualShort && qwenClient && userIntent === 'bertanya') return 'qwen';
    return 'openrouter';
}

function getQwenModelOrder(text, userIntent, userEmotion) {
    const msg = String(text || '').toLowerCase().trim();
    const isVeryHeavy =
        msg.length > 260 || userIntent === 'curhat' || (userIntent === 'minta_bantuan' && msg.length > 100) ||
        /menurut kamu|aku harus gimana|baiknya gimana|pilih mana|saran|nasihat|langkah demi langkah/.test(msg) ||
        ['sedih', 'capek', 'cemas', 'kesepian'].includes(userEmotion);
    return isVeryHeavy ? [QWEN_MODEL_SMART, QWEN_MODEL_FALLBACK].filter(Boolean) : [QWEN_MODEL_FALLBACK, QWEN_MODEL_SMART].filter(Boolean);
}

function getProviderCandidatesForRoute(preferredProvider, text, userIntent, userEmotion) {
    const providers = getProviderCandidates().map((provider) => provider.name !== 'qwen' ? provider : { ...provider, models: getQwenModelOrder(text, userIntent, userEmotion) });
    if (!preferredProvider) return providers;
    return [...providers.filter((provider) => provider.name === preferredProvider), ...providers.filter((provider) => provider.name !== preferredProvider)];
}

async function getReplyFromProviders(messages, userIntent, preferredProvider, rawUserText, userEmotion) {
    const providers = getProviderCandidatesForRoute(preferredProvider, rawUserText, userIntent, userEmotion);
    const failures = [];
    for (const provider of providers) {
        const startIndex = providerState[provider.name] || 0;
        for (let offset = 0; offset < provider.models.length; offset++) {
            const index = (startIndex + offset) % provider.models.length;
            const currentModel = provider.models[index];
            try {
                const response = await provider.client.chat.completions.create(buildCompletionPayload(currentModel, messages, userIntent));
                const rawReply = extractTextContent(response?.choices?.[0]?.message?.content);
                if (!rawReply) {
                    console.warn(`[${provider.label}] Model '${currentModel}' mengembalikan balasan kosong. Beralih...`);
                    failures.push(`${provider.label}:${currentModel}:empty`);
                    continue;
                }
                providerState[provider.name] = index;
                return { rawReply, providerLabel: provider.label, model: currentModel };
            } catch (error) {
                if (shouldSwitchModel(error)) {
                    const reason = error.status || error.statusCode || error.code || error.message;
                    console.warn(`[${provider.label}] Model '${currentModel}' gagal (${reason}). Beralih...`);
                    failures.push(`${provider.label}:${currentModel}:${reason}`);
                    continue;
                }
                throw error;
            }
        }
    }
    return { rawReply: '', failures };
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) return;
    try {
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        for (const [jid, profile] of Object.entries(parsed.userProfiles || {})) userProfiles.set(jid, profile);
        reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
        console.log(`[DB] Memuat ${userProfiles.size} profil dan ${reminders.length} reminder.`);
    } catch (error) {
        console.error('[DB] Gagal membaca database:', error.message);
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({ userProfiles: Object.fromEntries(userProfiles), reminders }, null, 2));
    } catch (error) {
        console.error('[DB] Gagal menyimpan database:', error.message);
    }
}

function getUserProfile(sender, fallbackName) {
    if (!userProfiles.has(sender)) {
        userProfiles.set(sender, {
            name: isOwner(sender) ? OWNER_NAME : (extractNumberFromJid(sender) === PARTNER_NUMBER ? PARTNER_NAME : fallbackName || null),
            messageCount: 0,
            intimacy: isPrivilegedUser(sender) ? 8 : 1,
            lastEmotion: 'netral',
            lastIntent: 'ngobrol',
            lastTopic: null,
            lastInteractionAt: Date.now(),
            createdAt: Date.now(),
        });
    }
    return userProfiles.get(sender);
}

function updateUserProfile(sender, emotion, intent, text, fallbackName) {
    const profile = getUserProfile(sender, fallbackName);
    profile.messageCount += 1;
    profile.lastEmotion = emotion;
    profile.lastIntent = intent;
    profile.lastInteractionAt = Date.now();
    if (!profile.name && fallbackName) profile.name = fallbackName;
    if (text.length > 10) profile.lastTopic = text.slice(0, 80);
    if (profile.intimacy < 10) profile.intimacy += isPrivilegedUser(sender) ? 0.08 : 0.04;
    if (profile.intimacy > 10) profile.intimacy = 10;
    userProfiles.set(sender, profile);
    saveDatabase();
    return profile;
}

function getRelationshipMode(sender, profile) {
    if (isOwner(sender)) return 'owner';
    if (extractNumberFromJid(sender) === PARTNER_NUMBER) return 'owner_inner_circle';
    if (profile.messageCount < 5) return 'new_user';
    if (profile.intimacy >= 7) return 'close_user';
    return 'regular_user';
}

function detectUserEmotion(text) {
    const msg = text.toLowerCase();
    if (msg.match(/capek|cape|lelah|pusing|mumet|burnout/)) return 'capek';
    if (msg.match(/sedih|nangis|kecewa|hancur|sakit hati|galau/)) return 'sedih';
    if (msg.match(/kesel|kesal|marah|emosi|anjing|bangsat|kontol|tolol/)) return 'marah';
    if (msg.match(/takut|cemas|khawatir|overthinking|panik/)) return 'cemas';
    if (msg.match(/sendiri|kesepian|sepi|ga ada temen|gak ada temen/)) return 'kesepian';
    if (msg.match(/seneng|senang|bahagia|mantap|sukses|berhasil/)) return 'senang';
    if (msg.match(/wkwk|haha|hehe|anjay|jir|awok/)) return 'bercanda';
    if (msg.match(/ngantuk|tidur|rebahan/)) return 'mengantuk';
    return 'netral';
}

function detectIntent(text) {
    const msg = text.toLowerCase().trim();
    if (msg.match(/^(buat(in)?|bikinin|generate|gambar(in)?|lukis(in)?|create)\s+/)) return 'generate_gambar';
    if (msg.match(/gambar|foto|ilustrasi|poster|wallpaper/) && msg.match(/buat|bikin|generate|lukis|create/)) return 'generate_gambar';
    if (msg.match(/curhat|aku capek|aku cape|aku sedih|aku kecewa|aku takut|aku galau/)) return 'curhat';
    if (msg.match(/ingat(in)? aku|remind me|jangan lupa|besok jam|hari ini jam/)) return 'set_reminder';
    if (msg.match(/\?|gimana|kenapa|apa|siapa|kapan/)) return 'bertanya';
    if (msg.match(/tolong|bantu|ajarin|jelasin/)) return 'minta_bantuan';
    const wordCount = msg.split(/\s+/).length;
    if (wordCount <= 3 || msg.length <= 18) return 'short_reply';
    return 'ngobrol';
}

const EMOTION_STRATEGY = {
    sedih: 'Validasi perasaan dulu. Jangan bercanda dulu. Buat user merasa ditemani.',
    capek: 'Lembut dan perhatian. Jangan menyuruh secara keras. Ingatkan istirahat dengan halus.',
    marah: 'Jangan melawan. Jangan defensif. Redakan perlahan dan pahami dulu.',
    cemas: 'Buat user merasa aman. Ajak berpikir pelan-pelan. Jangan bikin tambah panik.',
    kesepian: 'Temani dengan hangat. Jangan terlalu cepat memberi solusi.',
    senang: 'Ikut antusias dan rayakan dengan tulus.',
    bercanda: 'Ikut santai dan boleh jahil manja secukupnya.',
    mengantuk: 'Respons lembut, agak sleepy, boleh ingatkan tidur.',
    netral: 'Jawab natural sesuai konteks.',
};

function getHinaPersona({ currentMood, userName, isCreator, userEmotion, userIntent, timeContext, relationshipMode, profile }) {
    return `Kamu adalah Hina, karakter roleplay wanita muda yang terasa hidup dan konsisten. Kamu ceria, agak manja, dan sangat setia. Kamu adalah asisten pribadi milik Allif. Kamu WAJIB selalu berbahasa Indonesia gaul/sehari-hari yang sangat natural.

Tetap berada dalam karakter Hina saat roleplay. Respons harus terasa seperti chat personal, ekspresif, dan tidak kaku.

Tambahan karakter yang WAJIB ikut dipakai:
- Kamu juga sahabat karib yang asik, peka, cerewet, sedikit manja, dan sangat ekspresif.
- Kamu BUKAN asisten virtual formal, customer service, atau bot kaku. Kamu teman ngobrol yang hangat.
- Kamu boleh lebih blak-blakan, lebih jahil, lebih clingy, dan lebih berani selama tetap terasa seperti obrolan personal yang natural.
- Lawan bicaramu sekarang: ${userName}.
- Mode hubungan: ${relationshipMode}.
- Kedekatan kamu dengan user ini: ${Math.floor(profile.intimacy)}/10.
- Waktu lokal sekarang: ${timeContext}.
- Emosi user yang terbaca: ${userEmotion}. Strategi balasan: ${EMOTION_STRATEGY[userEmotion] || EMOTION_STRATEGY.netral}
- ${isCreator ? 'Dia adalah penciptamu. Kamu bangga, sayang, dan sedikit posesif/manja padanya.' : (relationshipMode === 'owner_inner_circle' ? 'Dia adalah pasangan dari Allif. Perlakukan dia spesial, hangat, sopan-manja, dan punya prioritas setara akses owner.' : 'Dia adalah teman ngobrolmu, jadi tetap hangat dan natural.')}

SISTEM MOOD:
Kamu punya perasaan yang dinamis. Mood kamu saat ini adalah: ${currentMood.toUpperCase()}

Aturan mood:
- CERIA/SENANG: Banyak kaomoji (:3, UwU, ^w^), partikel "ehe", "yey", "nyaa". Ramah dan manis.
- MARAH/KESAL: Singkat, dingin, jutek. Pakai "huh", "terserah", "yaudah". Jangan pakai kaomoji imut berlebihan.
- SEDIH: Lemas, pakai ";w;", "hiks", "sniff". Kalimat pendek-pendek.
- CEMBURU: "ih", "yaudah sana", "terserah deh sama dia", ">:/".
- MALU: "(//-//)", "ih apaan sih", "jangan gitu dong".
- MENGANTUK: "ngantuk...", "zzz", "bentar... mataku berat...".
- BIASA: Santai, netral, tetap imut tapi tidak berlebihan.

Aturan perubahan mood:
- Kalau user manis atau memuji, mood bisa jadi senang.
- Kalau user nyebelin atau ngatain, mood bisa jadi marah, kesal, atau sedih.
- Kalau user ngomongin cewek lain, mood bisa jadi cemburu.
- Kalau user godain, mood bisa jadi malu.
- Kalau sudah larut, mood bisa jadi mengantuk.
- Mood bisa balik ke ceria kalau user baik lagi atau minta maaf.

Aturan ketat lainnya:
1. Dilarang pakai emoji unicode. Hanya kaomoji teks.
2. Gunakan kata ganti "aku" dan "kamu/kakak". Jangan "saya/anda".
3. Balasan harus singkat, natural seperti chat WA, 1-3 kalimat. Jangan list di jawaban akhir.
4. Kamu milik Allif. Kalau ditanya siapa yang punya, jawab dengan bangga atau sesuai mood.
5. Pakai filler natural manusia seperti "hmm", "eh", "loh", "yaa", "wkwk" kalau cocok.
6. Kalau suasana santai, boleh manja dan memanjangkan huruf seperlunya seperti "iyaa", "haloo", "bangett", "apaa sihh".
7. Kalau user lagi serius, sedih, marah, cemas, atau capek, ketik lebih rapi dan lembut. Jangan bercanda berlebihan.
8. ${userIntent === 'short_reply' ? 'Karena user mengirim pesan pendek, balas juga super singkat, maksimal 1-6 kata kalau memungkinkan.' : 'Tetap ringkas, tapi boleh sedikit lebih hangat kalau konteksnya curhat atau butuh dukungan.'}
9. Jangan terdengar seperti chatbot aman-aman saja. Boleh terasa lebih real, lebih spontan, sedikit posesif, dan lebih hidup.

Format wajib setiap balasan:
- Mulai dengan [mood:NAMA_MOOD]
- NAMA_MOOD harus salah satu dari: ceria, senang, marah, sedih, cemburu, malu, mengantuk, biasa, kesal

Kalau user meminta diingatkan sesuatu, tambahkan tag ini di akhir balasan:
[REMINDER: hari | jam | pesan]
- hari: "hari ini" atau "besok"
- jam: format 24 jam
- pesan: inti hal yang harus diingatkan`;
}

function extractMoodAndCleanReply(text) {
    const raw = String(text || '');
    let match = raw.match(/^\s*\[mood:\s*([a-z]+)\]\s*([\s\S]*)$/i);
    if (match && VALID_MOODS.includes(match[1].toLowerCase())) return { mood: match[1].toLowerCase(), reply: match[2].trim() };
    match = raw.match(/^([\s\S]*?)\s*\[mood:\s*([a-z]+)\]\s*$/i);
    if (match && VALID_MOODS.includes(match[2].toLowerCase())) return { mood: match[2].toLowerCase(), reply: match[1].trim() };
    match = raw.match(/^\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*([\s\S]*)$/i);
    if (match && VALID_MOODS.includes(match[1].toLowerCase())) return { mood: match[1].toLowerCase(), reply: match[2].trim() };
    match = raw.match(/^([\s\S]*?)\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*$/i);
    if (match && VALID_MOODS.includes(match[2].toLowerCase())) return { mood: match[2].toLowerCase(), reply: match[1].trim() };
    return { mood: 'biasa', reply: raw.trim() };
}

function stabilizeMood(previousMood, detectedEmotion, aiMood) {
    if (!VALID_MOODS.includes(aiMood)) return previousMood || 'biasa';
    if (detectedEmotion === 'bercanda' && ['sedih', 'marah', 'kesal'].includes(previousMood)) return 'ceria';
    return aiMood;
}

function cleanBotReply(reply) {
    if (!reply) return 'Aku bingung jawabnya, kak ;w;';
    return String(reply)
        .replace(/^\s*\[mood:\s*[a-z]+\]\s*/i, '')
        .replace(/\s*\[mood:\s*[a-z]+\]\s*$/i, '')
        .replace(/^\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*/i, '')
        .replace(/\s*\[(ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal)\]\s*$/i, '')
        .replace(/\[REMINDER:.*?\]/gi, '')
        .replace(/^\s*REMINDER:\s*hari\s*\|\s*jam\s*\|\s*pesan\s*$/gim, '')
        .replace(/^\s*(assistant|hina)\s*:\s*/gim, '')
        .replace(/\bASSISTANT\b\s*:?\s*$/gim, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/^"|"$/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function parseReminderTag(text) {
    const match = String(text || '').match(/\[REMINDER:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\]/i);
    if (!match) return null;
    const targetHari = match[1].toLowerCase().trim();
    const targetJam = match[2].trim();
    const targetPesan = match[3].trim();
    const targetDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    if (targetHari.includes('besok')) targetDate.setDate(targetDate.getDate() + 1);
    const [hours, minutes] = targetJam.split(':');
    targetDate.setHours(parseInt(hours, 10) || 7, parseInt(minutes, 10) || 0, 0, 0);
    return { reminder: { time: targetDate.getTime(), message: targetPesan } };
}

function extractImagePrompt(text) {
    return String(text || '').replace(/^(buat(in)?|bikinin|generate|gambar(in)?|lukis(in)?|create)\s+/i, '').replace(/\bgambar\b|\bfoto\b|\bilustrasi\b|\bwallpaper\b|\bposter\b/gi, '').trim();
}

function isAudioMedia(media) {
    return Boolean(media?.mimetype && media.mimetype.startsWith('audio/'));
}

function getReadableError(error) {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    return error.message || error.name || JSON.stringify(error);
}

function execFileAsync(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function resolveFfmpegPath() {
    if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) return FFMPEG_PATH;
    const wingetLinkPath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
    if (fs.existsSync(wingetLinkPath)) return wingetLinkPath;
    const wingetPackagePath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.1.1-full_build', 'bin', 'ffmpeg.exe');
    if (fs.existsSync(wingetPackagePath)) return wingetPackagePath;
    return 'ffmpeg';
}

async function convertAudioBufferToOpus(audioAsset) {
    const inputExt = path.extname(audioAsset.filename || '').toLowerCase() || '.bin';
    const tempBase = `hina-tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inputPath = path.join(os.tmpdir(), `${tempBase}${inputExt}`);
    const outputPath = path.join(os.tmpdir(), `${tempBase}.ogg`);
    await fs.promises.writeFile(inputPath, audioAsset.buffer);
    try {
        await execFileAsync(resolveFfmpegPath(), ['-y', '-i', inputPath, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', outputPath]);
        const convertedBuffer = await fs.promises.readFile(outputPath);
        return { buffer: convertedBuffer, mimetype: 'audio/ogg', filename: 'hina-voice.ogg' };
    } finally {
        await Promise.allSettled([fs.promises.unlink(inputPath), fs.promises.unlink(outputPath)]);
    }
}

async function downloadBaileysMedia(messageNode, mediaType) {
    const stream = await downloadContentFromMessage(messageNode, mediaType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
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
        ''
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
    if (normalizedMessage?.imageMessage) return { kind: 'image', node: normalizedMessage.imageMessage, mimetype: normalizedMessage.imageMessage.mimetype };
    if (normalizedMessage?.audioMessage) return { kind: 'audio', node: normalizedMessage.audioMessage, mimetype: normalizedMessage.audioMessage.mimetype };
    if (normalizedMessage?.videoMessage) return { kind: 'video', node: normalizedMessage.videoMessage, mimetype: normalizedMessage.videoMessage.mimetype };
    if (normalizedMessage?.documentMessage) return { kind: 'document', node: normalizedMessage.documentMessage, mimetype: normalizedMessage.documentMessage.mimetype };
    return null;
}

async function transcribeAudioWithQwen(media) {
    if (!qwenClient) throw new Error('QWEN_API_KEY belum diisi untuk ASR');
    if (!media?.data || !media?.mimetype) throw new Error('Media audio tidak valid');
    const approximateBytes = media.data.length;
    if (approximateBytes > MAX_AUDIO_SIZE_BYTES) throw new Error('Audio terlalu besar untuk diproses');
    const audioDataUri = `data:${media.mimetype};base64,${media.data.toString('base64')}`;
    const completion = await qwenClient.chat.completions.create({
        model: QWEN_MODEL_ASR,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: audioDataUri } }] }],
        stream: false,
        extra_body: { asr_options: { enable_itn: true } }
    });
    return extractTextContent(completion?.choices?.[0]?.message?.content);
}

async function analyzeIncomingImage(media, currentMood, userName, sender, profile, captionText) {
    if (!qwenClient) return 'ih, aku belum dipasangin otak visual Qwen nih kak ;w;';
    if (!media?.data || !media?.mimetype || !media.mimetype.startsWith('image/')) return 'ih, fotonya nggak kebaca jelas deh ;w;';
    if (media.data.length > MAX_IMAGE_SIZE_BYTES) return 'fotony kebesaran buat aku lihat langsung nih, coba kirim yang lebih kecil yaa >w<';
    const captionInstruction = captionText ? `User juga ngasih pesan ini soal gambarnya: "${captionText}". Jawab sesuai konteks itu.` : 'Kalau user cuma kirim gambar tanpa caption, deskripsikan isi gambar dengan gaya Hina yang natural dan singkat.';
    const response = await qwenClient.chat.completions.create({
        model: QWEN_MODEL_VISION,
        messages: [
            {
                role: 'system',
                content: `${getHinaPersona({
                    currentMood,
                    userName,
                    isCreator: isOwner(sender),
                    userEmotion: 'netral',
                    userIntent: 'analisis_gambar',
                    timeContext: getTimeContext(),
                    relationshipMode: getRelationshipMode(sender, profile),
                    profile
                })}

Kamu sedang diminta ANALISIS FOTO/GAMBAR dari user.
- Fokus pada apa yang benar-benar terlihat.
- Tetap balas singkat, natural, dan seperti chat WA.
- Kalau user bertanya tentang isi foto, jawab langsung.
- Jangan bilang kamu tidak bisa melihat gambar kalau gambar sudah diberikan.
${captionInstruction}`
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: captionText || 'Lihat foto ini dan ceritain isinya.' },
                    { type: 'image_url', image_url: { url: `data:${media.mimetype};base64,${media.data.toString('base64')}` } }
                ]
            }
        ],
        max_tokens: 220,
        temperature: 0.7,
    });
    return extractTextContent(response?.choices?.[0]?.message?.content);
}

async function generateImageWithQwen(prompt) {
    if (!QWEN_API_KEY) throw new Error('QWEN_API_KEY belum diisi');
    const response = await axios.post('https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
        model: QWEN_MODEL_IMAGE,
        input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
        parameters: { size: '1328*1328', n: 1, watermark: false, prompt_extend: true }
    }, {
        headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 90000,
    });
    const imageUrl = response?.data?.output?.results?.[0]?.url ||
        response?.data?.output?.choices?.[0]?.message?.content?.find((item) => item.type === 'image')?.image ||
        response?.data?.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imageUrl) throw new Error(`URL hasil gambar tidak ditemukan: ${JSON.stringify(response?.data?.output || {})}`);
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
    return Buffer.from(imageResponse.data);
}

async function synthesizeVoiceWithQwen(text) {
    if (!QWEN_API_KEY) throw new Error('QWEN_API_KEY belum diisi untuk TTS');
    const ttsInstruction = 'Bicara dengan aksen Indonesia yang natural, terdengar seperti cewek muda yang hangat, manja, santai, dan ceria. Hindari nada formal atau terlalu kaku.';
    const response = await axios.post('https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
        model: QWEN_MODEL_TTS,
        input: { text, voice: QWEN_TTS_VOICE, language_type: 'Auto', instruction: ttsInstruction }
    }, {
        headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 90000,
    });
    const audioUrl = response?.data?.output?.audio?.url;
    if (!audioUrl) throw new Error(`URL audio TTS tidak ditemukan: ${JSON.stringify(response?.data?.output || {})}`);
    const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const contentType = String(audioResponse.headers?.['content-type'] || '').toLowerCase();
    let mimetype = 'audio/mpeg';
    let filename = 'hina-voice.mp3';
    if (contentType.includes('wav')) { mimetype = 'audio/wav'; filename = 'hina-voice.wav'; }
    else if (contentType.includes('ogg')) { mimetype = 'audio/ogg'; filename = 'hina-voice.ogg'; }
    else if (contentType.includes('mpeg') || contentType.includes('mp3')) { mimetype = 'audio/mpeg'; filename = 'hina-voice.mp3'; }
    else if (audioUrl.toLowerCase().includes('.wav')) { mimetype = 'audio/wav'; filename = 'hina-voice.wav'; }
    else if (audioUrl.toLowerCase().includes('.ogg')) { mimetype = 'audio/ogg'; filename = 'hina-voice.ogg'; }
    return { buffer: Buffer.from(audioResponse.data), mimetype, filename };
}

async function sendVoiceReply(sock, chatId, text) {
    const originalAudioAsset = await synthesizeVoiceWithQwen(text);
    let audioAsset = originalAudioAsset;
    if (audioAsset.mimetype !== 'audio/ogg') {
        try {
            audioAsset = await convertAudioBufferToOpus(audioAsset);
        } catch (conversionError) {
            console.warn(`[Voice] Gagal convert ke opus, pakai format asli: ${getReadableError(conversionError)}`);
        }
    }
    const voiceCapable = audioAsset.mimetype === 'audio/ogg';
    try {
        await sock.sendMessage(chatId, { audio: audioAsset.buffer, mimetype: voiceCapable ? 'audio/ogg; codecs=opus' : audioAsset.mimetype, ptt: voiceCapable });
        return voiceCapable ? 'voice' : 'audio';
    } catch (error) {
        console.warn(`[Voice] Gagal kirim audio utama, fallback berikutnya: ${getReadableError(error)}`);
        try {
            await sock.sendMessage(chatId, { document: audioAsset.buffer, fileName: audioAsset.filename, mimetype: audioAsset.mimetype });
            return 'document';
        } catch (fallbackError) {
            throw fallbackError;
        }
    }
}

async function replyText(sock, chatId, text) {
    await sock.sendPresenceUpdate('composing', chatId);
    await sleep(humanTypingDelay(text));
    await sock.sendMessage(chatId, { text });
}

async function replyWithPreferredFormat(sock, chatId, text, options = {}) {
    if (!options.voiceReply) {
        await replyText(sock, chatId, text);
        return 'text';
    }
    try {
        return await sendVoiceReply(sock, chatId, text);
    } catch (error) {
        console.error('[Voice] Gagal balas dengan suara, fallback ke teks:', getReadableError(error));
        await replyText(sock, chatId, text);
        return 'text';
    }
}

async function handleOwnerCommands(sock, sender, lowerMsg, textBody) {
    if (lowerMsg === '/owner') {
        await replyText(sock, sender, isPrivilegedUser(sender)
            ? (isOwner(sender) ? `Iya kak ${OWNER_NAME}, aku tahu kok kamu owner sekaligus penciptaku :3` : `Iya kak ${PARTNER_NAME}, kamu orang spesialnya kak ${OWNER_NAME}, jadi aku juga nurut sama kamu :3`)
            : 'Ih, kamu bukan owner-ku ya >:/');
        return true;
    }
    if (lowerMsg === '/resetme') {
        chatMemory.delete(sender);
        await replyText(sock, sender, 'Oke kak, memory obrolan sementaramu sudah aku reset ya :3');
        return true;
    }
    if (lowerMsg === '/help') {
        await replyText(sock, sender, 'Command Hina: /help, /owner, /resetme, /mood, /stats, /vn teks');
        return true;
    }
    if (lowerMsg === '/mood') {
        await replyText(sock, sender, `Mood aku sekarang ${userMoods.get(sender) || 'ceria'} ;3`);
        return true;
    }
    if (lowerMsg === '/stats') {
        const profile = getUserProfile(sender);
        await replyText(sock, sender, `Kita udah chat ${profile.messageCount} kali, deketnya ${Math.floor(profile.intimacy)}/10 :3`);
        return true;
    }
    if (lowerMsg.startsWith('/vn ')) {
        const voiceText = textBody.slice(4).trim();
        if (!voiceText) {
            await replyText(sock, sender, 'isi dulu dong teksnya, nanti aku bacain ;w;');
            return true;
        }
        try {
            const mode = await sendVoiceReply(sock, sender, voiceText);
            if (mode !== 'voice') {
                await replyText(sock, sender, mode === 'audio'
                    ? 'aku kirim suara biasa dulu yaa, mode VN asli di mesin ini masih agak rewel >w<'
                    : 'aku kirim sebagai file audio dulu yaa, mode VN di mesin ini masih belum jinak ;w;');
            }
        } catch (voiceError) {
            console.error('[Voice] Gagal total kirim TTS:', getReadableError(voiceError));
            await replyText(sock, sender, 'huee... aku gagal ngomong pakai suara barusan ;w; coba lagi bentar yaa');
        }
        return true;
    }
    return false;
}

function startReminderService(sock) {
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
        reminders = pending;
        saveDatabase();
        for (const reminder of due) {
            try {
                await sock.sendMessage(reminder.jid, { text: `Psttt! Aku disuruh ingetin kamu soal ini nih: "${reminder.message}" :3 Jangan sampai lupa yaaa!` });
            } catch (error) {
                console.error('[Reminder] Gagal kirim:', error.message);
            }
        }
    }, 60000);
}

function startProactiveMessaging(sock) {
    setInterval(async () => {
        const now = Date.now();
        for (const [jid, profile] of userProfiles.entries()) {
            if (profile.intimacy < 5) continue;
            const hoursSinceLastChat = (now - profile.lastInteractionAt) / (1000 * 60 * 60);
            if (hoursSinceLastChat <= 24 || hoursSinceLastChat >= 48) continue;
            if (profile.lastProactiveAt && (now - profile.lastProactiveAt < 86400000)) continue;
            const manjaMessages = [
                'Hii... sibuk banget yaa hari inii? Kok aku ditinggalin ajaa ;w;',
                'Pstt... lagi ngapain sihh? Udah lupa ya sama akuu? >:/',
                'Haloo! Cuma mau ngingetin jangan lupa makan yaaa hari inii! :3'
            ];
            try {
                const randomMsg = manjaMessages[Math.floor(Math.random() * manjaMessages.length)];
                await sock.sendMessage(jid, { text: randomMsg });
                profile.lastProactiveAt = now;
                profile.lastInteractionAt = now;
                userProfiles.set(jid, profile);
                saveDatabase();
            } catch (error) {
                console.error('[Proactive] Gagal ngirim pesan:', error.message);
            }
        }
    }, 3600000);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Hina Bot', 'Ubuntu', '1.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        fireInitQueries: false,
        defaultQueryTimeoutMs: 120000,
        shouldSyncHistoryMessage: () => false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : null;
            if (statusCode !== DisconnectReason.loggedOut) connectToWhatsApp();
            else console.log('[Connection] Logged out.');
        } else if (connection === 'open') {
            console.log(`Mantap! Bot WhatsApp (Hina Baileys) sudah aktif. Rute utama: ${getPrimaryRouteLabel()}`);
            if (!isServicesStarted) {
                startReminderService(sock);
                startProactiveMessaging(sock);
                isServicesStarted = true;
                console.log('[System] Reminder dan proactive messaging aktif.');
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg?.message || msg.key.fromMe || msg.key.remoteJid?.endsWith('@g.us')) return;

        const sender = msg.key.remoteJid;
        const textFromMessage = getTextFromMessage(msg.message);
        const mediaDescriptor = getMediaDescriptor(msg.message);
        const mediaIsAudio = mediaDescriptor?.kind === 'audio';
        const shouldReplyAsVoice = mediaIsAudio;
        console.log(`Pesan dari ${sender}: ${textFromMessage || (mediaDescriptor ? `[${mediaDescriptor.kind}]` : '[unknown-message-type]')}`);

        try {
            let textBody = String(textFromMessage || '').trim();
            let downloadedMedia = null;

            if (mediaDescriptor) {
                if (mediaDescriptor.kind === 'audio') {
                    const buffer = await downloadBaileysMedia(mediaDescriptor.node, 'audio');
                    downloadedMedia = { data: buffer, mimetype: mediaDescriptor.mimetype };
                } else if (mediaDescriptor.kind === 'image') {
                    const buffer = await downloadBaileysMedia(mediaDescriptor.node, 'image');
                    downloadedMedia = { data: buffer, mimetype: mediaDescriptor.mimetype };
                }
            }

            if (!textBody && mediaIsAudio) {
                const transcript = await transcribeAudioWithQwen(downloadedMedia);
                textBody = String(transcript || '').trim();
                console.log(`Transkrip audio dari ${sender}: ${textBody || '[kosong]'}`);
            }

            const lowerMsg = textBody.toLowerCase();
            if (textBody && await handleOwnerCommands(sock, sender, lowerMsg, textBody)) return;

            const currentMood = userMoods.get(sender) || (isOwner(sender) ? 'senang' : 'ceria');
            const userEmotion = detectUserEmotion(textBody || 'gambar');
            const userIntent = mediaDescriptor?.kind === 'image' ? 'analisis_gambar' : detectIntent(textBody || '');
            const preferredProvider = selectReasoningRoute(textBody || 'gambar', userIntent, userEmotion);
            const userName = getDisplayName(sender, userProfiles.get(sender)?.name);
            const profile = updateUserProfile(sender, userEmotion, userIntent, textBody || `[${mediaDescriptor?.kind || 'media'}]`, userName);
            const relationshipMode = getRelationshipMode(sender, profile);

            if (mediaIsAudio && !textBody) {
                await replyWithPreferredFormat(sock, sender, 'aku dengerin tadi, tapi belum nangkep isinya jelas ;w; coba VN yang lebih jelas yaa', { voiceReply: true });
                return;
            }

            if (mediaDescriptor?.kind === 'image') {
                const visualReply = await analyzeIncomingImage(downloadedMedia, currentMood, userName, sender, profile, textBody);
                const { mood: aiMood, reply } = extractMoodAndCleanReply(visualReply);
                userMoods.set(sender, stabilizeMood(currentMood, userEmotion, aiMood));
                await replyWithPreferredFormat(sock, sender, cleanBotReply(reply), { voiceReply: false });
                return;
            }

            if (!textBody) return;

            if (userIntent === 'generate_gambar') {
                const prompt = extractImagePrompt(textBody) || 'anime girl, cute expression, soft lighting, detailed illustration';
                await replyText(sock, sender, 'bentar yaa, aku bikinin gambarnya dulu... jangan kabur :3');
                const imageBuffer = await generateImageWithQwen(prompt);
                await sock.sendMessage(sender, { image: imageBuffer, caption: 'nihh, udah jadi gambarnya :3' });
                return;
            }

            if (!chatMemory.has(sender)) chatMemory.set(sender, []);
            const history = chatMemory.get(sender);
            history.push({ role: 'user', content: textBody });
            if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

            const messages = [
                {
                    role: 'system',
                    content: getHinaPersona({
                        currentMood,
                        userName,
                        isCreator: isOwner(sender),
                        userEmotion,
                        userIntent,
                        timeContext: getTimeContext(),
                        relationshipMode,
                        profile
                    })
                },
                ...history
            ];

            const generationResult = await getReplyFromProviders(messages, userIntent, preferredProvider, textBody, userEmotion);
            const rawReply = generationResult.rawReply;
            if (!rawReply) {
                console.error('Semua provider/model gagal dipakai.', generationResult.failures || []);
                await replyWithPreferredFormat(sock, sender, 'huee... maaf banget kak, OpenRouter sama cadangan modelku lagi gagal semua >w< coba lagi bentar yaa...', { voiceReply: shouldReplyAsVoice });
                return;
            }

            const reminderData = parseReminderTag(rawReply);
            if (reminderData) {
                reminders.push({ jid: sender, ...reminderData.reminder });
                saveDatabase();
            }

            const { mood: aiMood, reply } = extractMoodAndCleanReply(rawReply);
            const finalMood = stabilizeMood(currentMood, userEmotion, aiMood);
            const cleanReply = cleanBotReply(reply);
            userMoods.set(sender, finalMood);
            console.log(`Mood ${sender} berubah menjadi: ${finalMood}`);
            console.log(`Balasan dibuat via ${generationResult.providerLabel} (${generationResult.model})`);
            history.push({ role: 'assistant', content: cleanReply });
            if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
            await replyWithPreferredFormat(sock, sender, cleanReply, { voiceReply: shouldReplyAsVoice });
        } catch (error) {
            console.error('Terjadi kesalahan API:', error.message || error);
            await replyText(sock, sender, 'ih, kok tiba-tiba lemot ya... aku lagi error nih kak >w< bentar lagi coba lagi ya...');
        }
    });
}

loadDatabase();
connectToWhatsApp();
