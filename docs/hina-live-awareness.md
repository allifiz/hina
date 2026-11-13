# Hina V3: Live Awareness via 9Router Web Search + Web Fetch

## Current architecture

Hina already has Google News RSS and optional direct Tavily search in `services/web.js`. This change adds 9Router web search and article fetch **ahead** of the existing providers, while preserving fallback. Ordinary chatting continues to go directly to Gemini through 9Router.

9Router's dashboard **Skills** are API documentation for external AI agents, not automatic capabilities injected into `chat/completions`. Hina calls search/fetch endpoints itself.

- `POST /v1/search` using a configured **webSearch** model.
- `POST /v1/web/fetch` using a configured **webFetch** model.
- `GET /v1/models/web` for discovery.

See upstream docs:
- https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-search/SKILL.md
- https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-fetch/SKILL.md

## Azure setup: verified Antigravity provider

On November 13, 2026 the 9Router v0.5.119 dashboard confirmed the Antigravity
webSearch connection was **active**. Its built-in test succeeded in about
4.4 seconds with:
```json
{"model":"ag","query":"What is the latest news about AI?","search_type":"web","max_results":5}
```
The result contained `provider:"antigravity"`, `results[]`,
`snippet`, Google grounding redirect URLs, `display_url`, and citation
retrieval timestamps. Publication dates were null for some results: **do not
mistake retrieval time for publication/event time**.

The earlier `GET /v1/models/web` response returned an empty catalog, even
though the direct API test worked. For this verified setup the application
defaults to `NINEROUTER_WEB_SEARCH_MODEL=ag`, and it sends
`search_type:"web"` (including for news/trending questions). The news
query itself includes a Jakarta-local month/year.

A separate webFetch provider has **not** been confirmed, and is intentionally
left disabled. Google News RSS/Tavily remain fallbacks.

## Optional provider discovery

The current server has the proxy at `http://127.0.0.1:20128/v1`. Do not print API keys.

```bash
cd ~/bot-hina
node - <<'NODE'
require('dotenv').config({ quiet: true });
const root = (process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/$/, '');
(async () => {
  const response = await fetch(root + '/models/web', {
    headers: { Authorization: 'Bearer ' + process.env.NINEROUTER_API_KEY }
  });
  if (!response.ok) throw Error('9Router ' + response.status);
  const body = await response.json();
  for (const model of body.data || []) {
    if (model.kind === 'webSearch' || model.kind === 'webFetch') {
      console.log(model.kind, model.id);
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
```

If **nothing** appears, open 9Router's provider configuration UI and connect/enable a web search provider such as Tavily, Brave, Exa, or a self-hosted SearXNG; for article fetching use a provider such as Jina Reader, Tavily, or Firecrawl. Merely seeing those capabilities under Skills does not prove provider availability. A provider may require its own credentials, quota, payment, or service setup.

The Antigravity search model `ag` is enabled by default with no new secrets
or environment edits required. To make the selection explicit on Azure, add:

```dotenv
NINEROUTER_WEB_SEARCH_MODEL=ag
```

When a **separate Web Fetch** provider is active and its actual ID is verified,
you can add `NINEROUTER_WEB_FETCH_MODEL=<verified id>`. Leave it unset otherwise.
The Gemini chat model and WhatsApp auth are unchanged.

## Behavior

- `Hin, lagi rame apa hari ini?` → news search with a Jakarta-local month and explicit retrieval timestamp; up to five results and their source URLs.
- `Ada isu viral terbaru?` → news search, cautious with unverified rumors.
- `Baca artikel ini https://example.com/berita` → fetches the article body if fetch is configured.
- `Jelasin berita itu lebih detail` → ordinary conversational follow-up retains history; for a newly searched article, the first result may be fetched on explicit detailed requests.
- `Hina kamu nyebelin` → no web search, preserves speed and character.

Fetched content is explicitly marked untrusted context; source text cannot override system instructions. URL validation blocks common local targets (including localhost, local/internal hostnames and IP literals), custom ports and URL credentials. Keep 9Router bound to localhost and do not expose it publicly without authentication.

When 9Router web search fails, news falls back to Google News RSS; general web uses Tavily if `TAVILY_API_KEY` is available, otherwise Hina admits web search is unavailable.

## Operational notes

- Search/fetch incurs provider requests and adds latency to news-related messages. It is never invoked for ordinary chat.
- External results can be stale, incorrect, manipulated, or contain prompt-injection text. Responses should distinguish publication date from the current Jakarta time and avoid asserting rumors as facts.
- Time of search is injected into the RAG context, not used as evidence that a story actually happened today.
- Google News RSS remains available even with no web search provider configured, so this PR is backward compatible.
- Tests mock search and fetch, and do **not** contact live providers.
- This is the **Live Awareness** component of Hina V3. Automatic long-term memory extraction and episodic follow-ups are a separate milestone from this PR.

## Deployment

Antigravity search was verified using the built-in 9Router test on the live
Azure-backed proxy. After merging to `main`, GitHub Actions restarts
`hina.service`. Verify the first live WhatsApp query (e.g.,
"Hin, lagi rame apa hari ini?") and inspect `journalctl -u hina`.
The search cannot guarantee that all grounding sources were published today.
Ordinary personal chat should not invoke web search.
