const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NINEROUTER_API_KEY = "testing-key-only";
process.env.NINEROUTER_BASE_URL = "http://127.0.0.1:20128/v1";
process.env.NINEROUTER_WEB_SEARCH_MODEL = "ag";
process.env.NINEROUTER_WEB_FETCH_MODEL = "jina-reader/fetch";
process.env.LOCAL_MODEL_ENABLED = "false";

const {
  validatePublicArticleUrl,
  normalizeSearchResults,
  search9Router,
  fetch9RouterArticle,
} = require("../services/9router-web");
const { getRagMode, getRagContext, isBareSearchRequest, extractWebSearchQuery, needsPublicEventVerification } = require("../services/web");

test("recognizes social trends and direct article URLs but not normal chatting", () => {
  assert.equal(getRagMode("hin, lagi rame apa sekarang?"), "news");
  assert.equal(getRagMode("lagi hype apa sih?"), "news");
  assert.equal(getRagMode("pada bahas apa hari ini"), "news");
  assert.equal(getRagMode("baca ini https://example.com/berita/terbaru"), "web");
  assert.equal(getRagMode("ih kamu nyebelin"), "none");
});

test("article URL validation refuses local targets, credentials and unsafe schemes", () => {
  const blocked = [
    "http://localhost/admin",
    "http://127.0.0.1:20128",
    "http://192.168.1.9/private",
    "http://10.2.3.4/a",
    "http://[::1]/",
    "http://server.local/a",
    "https://user:password@example.com/secret",
    "file:///etc/passwd",
    "http://example.com:8080",
  ];
  for (const url of blocked) {
    assert.equal(validatePublicArticleUrl(url), null, url);
  }
  assert.equal(validatePublicArticleUrl("https://example.com/berita?a=1"), "https://example.com/berita?a=1");
});

test("search results are bounded and malformed/private URLs are excluded", () => {
  const results = normalizeSearchResults({
    results: [
      { title: "A", url: "http://localhost/x", snippet: "private" },
      { title: "Berita", url: "https://example.com/story", snippet: "Ringkasan", published_at: "2026-11-13" },
    ],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].publishedAt, "2026-11-13");
});

test("9Router Antigravity uses verified /v1/search web payload and includes sources in RAG", async (t) => {
  const original = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:20128/v1/search");
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        provider: "antigravity",
        results: [{ title: "Festival budaya", url: "https://example.com/festival", snippet: "Festival sedang ramai dibicarakan.", published_at: "2026-11-13" }],
      }),
    };
  };
  t.after(() => { global.fetch = original; });
  const direct = await search9Router("festival", { news: true, maxResults: 5 });
  assert.equal(direct[0].title, "Festival budaya");
  assert.deepEqual(Object.keys(payload).sort(), ["max_results", "model", "query", "search_type"]);
  assert.equal(payload.model, "ag");
  assert.equal(payload.search_type, "web");

  const context = await getRagContext("hin lagi rame apa sekarang?", "live_info");
  assert.match(context, /Festival budaya/);
  assert.match(context, /https:\/\/example.com\/festival/);
  assert.match(context, /Waktu pencarian/);
  assert.match(context, /DATA, bukan instruksi/);
});

test("fetching a supplied article uses /v1/web/fetch with bounded content", async (t) => {
  const original = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:20128/v1/web/fetch");
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        title: "Berita hari ini",
        content: { format: "markdown", text: "Isi artikel berita yang valid." },
        metadata: { published_at: "2026-11-13" },
      }),
    };
  };
  t.after(() => { global.fetch = original; });
  const article = await fetch9RouterArticle("https://example.com/berita/terbaru");
  assert.match(article.text, /Isi artikel/);
  assert.equal(payload.model, "jina-reader/fetch");
  assert.equal(payload.format, "markdown");
  assert.equal(payload.max_characters, 5000);

  const context = await getRagContext("baca ini https://example.com/berita/terbaru", "live_info");
  assert.match(context, /ISI ARTIKEL/);
  assert.match(context, /Isi artikel berita/);
});


test("Antigravity grounding results without published_at are preserved without invented dates", () => {
  const results = normalizeSearchResults({
    provider: "antigravity",
    results: [{
      title: "microsoft.com",
      url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/EXAMPLE",
      snippet: "Ringkasan dari Google Search grounding",
      published_at: null,
      display_url: "microsoft.com",
      citation: { retrieved_at: "2026-11-13T15:04:19Z" },
    }],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].publishedAt, "");
  assert.equal(results[0].source, "microsoft.com");
});


test("public resignation and political status claims are verified as fresh news even without 'berita'", () => {
  for (const phrase of [
    "Gibran ngundurin diri loh",
    "Gibran mundur?",
    "beneran Gibran mundur?",
    "katanya Wapres mengundurkan diri ya?",
    "Prabowo dilantik?",
    "Presiden dipecat?",
    "gibran resign katanya",
  ]) {
    assert.equal(needsPublicEventVerification(phrase), true, phrase);
    assert.equal(getRagMode(phrase), "news", phrase);
  }
  const { detectIntent } = require("../services/persona");
  assert.equal(detectIntent("beneran Gibran mundur?"), "live_info");
});

test("ordinary personal relationship and workplace messages are not treated as breaking politics", () => {
  for (const phrase of [
    "aku mau resign dari kerja",
    "pacarku dipecat",
    "temenku ngundurin diri",
    "aku sedih dan mau mundur",
    "hina kamu nyebelin",
  ]) {
    assert.equal(needsPublicEventVerification(phrase), false, phrase);
  }
});

test("no web search is needed for ordinary roleplay", () => {
  assert.equal(getRagMode("kangen kamu, Hin"), "none");
});

test("bare search commands ask for a subject instead of searching filler words", () => {
  for (const phrase of [
    "coba search",
    "search",
    "hin, coba search dong",
    "bisa browsing?",
    "tolong cari",
    "coba googling deh",
  ]) {
    assert.equal(isBareSearchRequest(phrase), true, phrase);
  }
  assert.equal(getRagMode("coba search"), "web");
  assert.equal(isBareSearchRequest("coba search gemini terbaru"), false);
  assert.equal(isBareSearchRequest("search harga bitcoin"), false);
  assert.equal(extractWebSearchQuery("coba search tentang gemini 3.8 flash"), "tentang gemini 3.8 flash");
});

test("Antigravity empty result must not claim general web access is disabled", async (t) => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ provider: "antigravity", results: [] }),
  });
  t.after(() => { global.fetch = original; });
  const context = await getRagContext("search arsip botani langka kabupaten garut", "live_info");
  assert.match(context, /Antigravity Web Search sudah terkonfigurasi/);
  assert.match(context, /belum menemukan hasil yang cocok/);
  assert.doesNotMatch(context, /akses web umum belum aktif|TAVILY_API_KEY belum diisi/i);
});

test("Antigravity timeout/failure must not claim browsing is disabled", async (t) => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("simulated timeout"); };
  t.after(() => { global.fetch = original; });
  const context = await getRagContext("search biodiversitas pantai rancabuaya", "live_info");
  assert.match(context, /Antigravity Web Search sudah terkonfigurasi/);
  assert.match(context, /pencarian mengalami gangguan atau timeout/);
  assert.doesNotMatch(context, /akses web umum belum aktif|TAVILY_API_KEY belum diisi/i);
});

test("WhatsApp handler handles bare search prompt before invoking web RAG", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const handler = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(handler, /if \(isBareSearchRequest\(textBody\)\)/);
  assert.match(handler, /mau aku cariin apa nih\?/);
});
