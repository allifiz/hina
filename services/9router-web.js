const { NINEROUTER_API_KEY, NINEROUTER_BASE_URL, NINEROUTER_WEB_SEARCH_MODEL, NINEROUTER_WEB_FETCH_MODEL } = require("../config");

const WEB_BASE_URL = String(NINEROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
const DEFAULT_TIMEOUT_MS = 8500;

function is9RouterSearchConfigured() {
  return Boolean(NINEROUTER_API_KEY && NINEROUTER_WEB_SEARCH_MODEL);
}

function is9RouterFetchConfigured() {
  return Boolean(NINEROUTER_API_KEY && NINEROUTER_WEB_FETCH_MODEL);
}

function validatePublicArticleUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    // Prevent fetching internal endpoints via user-provided URLs.
    if (parsed.port && !["80", "443"].includes(parsed.port)) return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
        host.endsWith(".invalid") || !host.includes(".") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.includes("%")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function request9Router(path, payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!NINEROUTER_API_KEY) throw new Error("9Router API key belum dikonfigurasi");
  const response = await fetch(WEB_BASE_URL + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + NINEROUTER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error("9Router web request HTTP " + response.status);
  }

  return response.json();
}

function normalizeSearchResults(data) {
  if (!Array.isArray(data?.results)) return [];
  return data.results
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      title: String(item.title || "").slice(0, 180),
      url: validatePublicArticleUrl(item.url),
      snippet: String(item.snippet || item.content || "").slice(0, 650),
      publishedAt: String(item.published_at || item.publishedAt || "").slice(0, 40),
      source: String(item.display_url || "").slice(0, 100),
    }))
    .filter((item) => item.url)
    .slice(0, 5);
}

async function search9Router(query, { news = false, maxResults = 5 } = {}) {
  if (!is9RouterSearchConfigured()) return null;
  const data = await request9Router("/search", {
    model: NINEROUTER_WEB_SEARCH_MODEL,
    query: String(query || "").slice(0, 250),
    max_results: Math.max(1, Math.min(8, maxResults)),
    search_type: news ? "news" : "web",
  });
  return normalizeSearchResults(data);
}

async function fetch9RouterArticle(url) {
  if (!is9RouterFetchConfigured()) return null;
  const validUrl = validatePublicArticleUrl(url);
  if (!validUrl) throw new Error("URL artikel bukan URL publik yang valid");
  const data = await request9Router("/web/fetch", {
    model: NINEROUTER_WEB_FETCH_MODEL,
    url: validUrl,
    format: "markdown",
    max_characters: 5000,
  }, { timeoutMs: 10000 });
  const result = data?.data || data;
  const raw = result?.content;
  const text = typeof raw === "string" ? raw : typeof raw?.text === "string" ? raw.text : "";
  return {
    url: validUrl,
    title: String(result?.title || "Artikel").slice(0, 180),
    publishedAt: String(result?.metadata?.published_at || "").slice(0, 40),
    text: text.slice(0, 5000),
  };
}

module.exports = {
  is9RouterSearchConfigured,
  is9RouterFetchConfigured,
  validatePublicArticleUrl,
  normalizeSearchResults,
  search9Router,
  fetch9RouterArticle,
};
