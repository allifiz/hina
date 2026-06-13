const axios = require("axios");
const Parser = require("rss-parser");
const { TAVILY_API_KEY } = require("../config");

const rssParser = new Parser();
const liveInfoCache = new Map();
const webInfoCache = new Map();

function needsLiveInfo(text) {
  const msg = String(text || "").toLowerCase();

  return /berita|news|terbaru|terkini|hari ini|sekarang|viral|trending|hangat|update|isu|gempa|politik|bola|bitcoin|crypto|saham|harga emas|ai terbaru|teknologi terbaru/.test(
    msg
  );
}

function isHealthTopic(text) {
  const msg = String(text || "").toLowerCase();

  return /sakit|gejala|obat|dosis|demam|batuk|pilek|mimisan|pusing|mual|diare|sesak|nyeri|darah|luka|infeksi|alergi|maag|asam lambung|jantung|mental|cemas|depresi|panik/.test(
    msg
  );
}

function needsGeneralWebInfo(text) {
  const msg = String(text || "").toLowerCase();

  if (needsLiveInfo(msg)) return false;

  return (
    /\b(cari|carikan|cariin|search|googling|web|internet|sumber|referensi)\b/.test(msg) ||
    /\b(versi terbaru|rilis terbaru|update terbaru|harga sekarang|jadwal terbaru|aturan terbaru|apakah masih|masih berlaku)\b/.test(msg) ||
    (/\b(error|bug|issue|library|framework|package|npm|node|baileys|openrouter|qwen|api)\b/.test(msg) && /\b(terbaru|sekarang|cara|fix|solusi)\b/.test(msg)) ||
    isHealthTopic(msg)
  );
}

function getRagMode(text) {
  if (needsLiveInfo(text)) return "news";
  if (needsGeneralWebInfo(text)) return "web";
  return "none";
}

function extractLiveSearchQuery(text) {
  const raw = String(text || "").toLowerCase();

  let cleaned = raw
    .replace(/\bhina\b/g, "")
    .replace(/\b(cariin|carikan|cari|kasih|beritain|jelasin|info|update|tentang|dong|ya|nih)\b/g, "")
    .replace(/\b(berita|news|terbaru|terkini|hari ini|sekarang|viral|trending|hangat|isu)\b/g, "")
    .replace(/[?!.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    if (/bola/.test(raw)) return "sepak bola Indonesia";
    if (/bitcoin|crypto/.test(raw)) return "bitcoin crypto";
    if (/gempa/.test(raw)) return "gempa Indonesia";
    if (/politik/.test(raw)) return "politik Indonesia";
    if (/ai|teknologi/.test(raw)) return "artificial intelligence technology";
    return "Indonesia";
  }

  return cleaned;
}

function extractWebSearchQuery(text) {
  const raw = String(text || "").trim();

  return (
    raw
      .replace(/\bhina\b/gi, "")
      .replace(/\b(cariin|carikan|cari|search|googling|di web|di internet|dong|ya|nih)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || raw
  );
}

async function getLatestNewsContext(text) {
  const query = extractLiveSearchQuery(text);
  const cacheKey = query.toLowerCase();
  const cached = liveInfoCache.get(cacheKey);

  if (cached && Date.now() - cached.time < 10 * 60 * 1000) {
    return cached.context;
  }

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=id&gl=ID&ceid=ID:id`;

    const feed = await rssParser.parseURL(url);

    const items = (feed.items || []).slice(0, 5).map((item, index) => {
      return `${index + 1}. ${item.title}
Sumber: ${item.source?.name || item.creator || "Google News"}
Waktu: ${item.pubDate || "-"}
Link: ${item.link || "-"}`;
    });

    if (!items.length) return "";

    const context = `
KONTEKS LIVE / RAG BERITA TERBARU:
Query: ${query}
Diambil dari Google News RSS.

${items.join("\n\n")}

ATURAN JAWAB:
- Jawab berdasarkan konteks live di atas.
- Jangan mengarang detail yang tidak ada di konteks.
- Kalau user minta berita hangat, rangkum 3-5 poin.
- Kalau sumbernya kurang jelas, bilang "aku baru nemu dari rangkuman berita ini".
- Tetap jadi Hina, tapi untuk berita serius jangan terlalu manja.
- Jangan tampilkan link terlalu banyak kecuali user minta sumber.
`;

    liveInfoCache.set(cacheKey, {
      time: Date.now(),
      context,
    });

    return context;
  } catch (error) {
    console.error("[RAG_NEWS] Gagal ambil berita:", error.message);

    return `
KONTEKS LIVE / RAG:
Hina mencoba mengambil info terbaru dari web, tapi gagal.

ATURAN JAWAB:
- Jangan mengarang berita terbaru.
- Bilang jujur kalau pencarian live sedang gagal.
- Boleh jawab pengetahuan umum kalau aman, tapi jelaskan bahwa itu bukan update terbaru.
`;
  }
}

async function getWebSearchContext(text) {
  const query = extractWebSearchQuery(text);
  const cacheKey = query.toLowerCase();
  const cached = webInfoCache.get(cacheKey);

  if (cached && Date.now() - cached.time < 15 * 60 * 1000) {
    return cached.context;
  }

  if (!TAVILY_API_KEY) {
    return `
KONTEKS WEB UMUM:
RAG web umum belum aktif karena TAVILY_API_KEY belum diisi.

ATURAN JAWAB:
- Jangan pura-pura sudah mencari di web.
- Jawab dari pengetahuan umum kalau aman.
- Kalau butuh info terbaru, bilang bahwa akses web umum belum aktif.
`;
  }

  try {
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        max_results: 5,
      },
      {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const results = Array.isArray(response.data?.results) ? response.data.results : [];

    if (!results.length) {
      return `
KONTEKS WEB UMUM:
Pencarian web untuk "${query}" tidak menemukan hasil yang cukup.

ATURAN JAWAB:
- Jangan mengarang sumber.
- Jawab singkat berdasarkan pengetahuan umum kalau aman.
- Kalau user butuh data terbaru/pasti, bilang belum nemu sumber yang cukup.
`;
    }

    const items = results.slice(0, 5).map((item, index) => {
      return `${index + 1}. ${item.title || "Tanpa judul"}
URL: ${item.url || "-"}
Ringkasan: ${item.content || item.snippet || "-"}`;
    });

    const healthRules = isHealthTopic(text)
      ? `
ATURAN KHUSUS KESEHATAN:
- Jangan memberi diagnosis pasti.
- Jangan menyuruh minum obat keras/resep tanpa dokter.
- Jelaskan kemungkinan umum saja.
- Sebutkan tanda bahaya yang perlu dokter/IGD jika relevan.
- Untuk gejala berat, sarankan periksa ke tenaga medis.
`
      : "";

    const context = `
KONTEKS WEB UMUM / RAG:
Query: ${query}
Diambil dari pencarian web umum.

${items.join("\n\n")}

ATURAN JAWAB:
- Jawab berdasarkan konteks web di atas.
- Jangan mengarang detail yang tidak ada di konteks.
- Kalau konteks kurang, bilang "aku nemu gambaran umumnya begini".
- Jangan tampilkan banyak URL kecuali user minta sumber.
- Tetap jadi Hina, tapi untuk topik serius jawab lebih rapi dan hati-hati.
${healthRules}
`;

    webInfoCache.set(cacheKey, {
      time: Date.now(),
      context,
    });

    return context;
  } catch (error) {
    console.error("[RAG_WEB] Gagal ambil web umum:", error.message);

    return `
KONTEKS WEB UMUM:
Hina mencoba mengambil info dari web umum, tapi gagal.

ATURAN JAWAB:
- Jangan mengarang hasil pencarian.
- Jawab dari pengetahuan umum kalau aman.
- Kalau user butuh info terbaru/pasti, bilang pencarian web sedang gagal.
`;
  }
}

async function getRagContext(text, userIntent) {
  const mode = getRagMode(text);

  if (mode === "news") {
    return await getLatestNewsContext(text);
  }

  if (mode === "web") {
    return await getWebSearchContext(text);
  }

  return "";
}

module.exports = {
  getRagMode,
  getRagContext,
  getLiveInfoCache: () => liveInfoCache,
  getWebInfoCache: () => webInfoCache,
  clearCaches: () => {
    liveInfoCache.clear();
    webInfoCache.clear();
  },
};
