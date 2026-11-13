const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NINEROUTER_API_KEY = "testing-key-only";
process.env.NINEROUTER_BASE_URL = "http://127.0.0.1:20128/v1";
process.env.NINEROUTER_WEB_SEARCH_MODEL = "tavily/search";
process.env.NINEROUTER_WEB_FETCH_MODEL = "jina-reader/fetch";
process.env.LOCAL_MODEL_ENABLED = "false";

const {
  validatePublicArticleUrl,
  normalizeSearchResults,
  search9Router,
  fetch9RouterArticle,
} = require("../services/9router-web");
const { getRagMode, getRagContext } = require("../services/web");

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

test("9Router search uses real documented /v1/search payload and includes source in RAG", async (t) => {
  const original = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:20128/v1/search");
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        provider: "tavily",
        results: [{ title: "Festival budaya", url: "https://example.com/festival", snippet: "Festival sedang ramai dibicarakan.", published_at: "2026-11-13" }],
      }),
    };
  };
  t.after(() => { global.fetch = original; });
  const direct = await search9Router("festival", { news: true, maxResults: 5 });
  assert.equal(direct[0].title, "Festival budaya");
  assert.deepEqual(Object.keys(payload).sort(), ["max_results", "model", "query", "search_type"]);
  assert.equal(payload.model, "tavily/search");
  assert.equal(payload.search_type, "news");

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

test("no web search is needed for ordinary roleplay", () => {
  assert.equal(getRagMode("kangen kamu, Hin"), "none");
});
