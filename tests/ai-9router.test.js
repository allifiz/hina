const test = require("node:test");
const assert = require("node:assert/strict");

// Routing tests must never contact 9Router or use a real API key.
process.env.NINEROUTER_API_KEY = "test-local-key";
process.env.NINEROUTER_BASE_URL = "http://127.0.0.1:20128/v1";
process.env.NINEROUTER_MODEL = "ag/gpt-oss-120b-medium";
process.env.LOCAL_MODEL_ENABLED = "false";

const { getProviderCandidates, getPrimaryRouteLabel, selectReasoningRoute } = require("../services/ai");

test("9Router is the first provider when configured", () => {
  const providers = getProviderCandidates();
  assert.equal(providers[0].name, "ninerouter");
  assert.deepEqual(providers[0].models, ["ag/gpt-oss-120b-medium"]);
  assert.match(getPrimaryRouteLabel(), /^9Router -> ag\/gpt-oss-120b-medium$/);
});

test("9Router is preferred for chat and live-news intents", () => {
  assert.equal(selectReasoningRoute("halo", "short_reply", "netral"), "ninerouter");
  assert.equal(selectReasoningRoute("berita teknologi hari ini", "live_info", "netral"), "ninerouter");
  assert.equal(selectReasoningRoute("aku sedang sedih", "curhat", "sedih"), "ninerouter");
});
