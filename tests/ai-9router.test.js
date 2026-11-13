const test = require("node:test");
const assert = require("node:assert/strict");

// Routing and failover tests must never call the network.
process.env.NINEROUTER_API_KEY = "test-local-key";
process.env.NINEROUTER_BASE_URL = "http://127.0.0.1:20128/v1";
process.env.NINEROUTER_MODEL = "ag/gpt-oss-120b-medium"; // legacy env in production
process.env.NINEROUTER_PRIMARY_MODEL = "openrouter/baidu/ernie-5.5-flash-preview:free";
process.env.NINEROUTER_FALLBACK_MODELS = "ag/gpt-oss-120b-medium";
process.env.LOCAL_MODEL_ENABLED = "false";
process.env.OPENROUTER_API_KEY = "";
process.env.QWEN_API_KEY = "";

const {
  getProviderCandidates,
  getPrimaryRouteLabel,
  selectReasoningRoute,
  getReplyFromProviders,
  getModelCooldowns,
} = require("../services/ai");

const ERNIE = "openrouter/baidu/ernie-5.5-flash-preview:free";
const GPTOSS = "ag/gpt-oss-120b-medium";

test("ERNIE is first, legacy GPT-OSS becomes fallback without duplicate models", () => {
  const providers = getProviderCandidates();
  assert.equal(providers[0].name, "ninerouter");
  assert.deepEqual(providers[0].models, [ERNIE, GPTOSS]);
  assert.equal(getPrimaryRouteLabel(), "9Router -> " + ERNIE);
});

test("9Router remains the preferred provider for ordinary and live-info chat", () => {
  assert.equal(selectReasoningRoute("halo", "short_reply", "netral"), "ninerouter");
  assert.equal(selectReasoningRoute("berita teknologi hari ini", "live_info", "netral"), "ninerouter");
  assert.equal(selectReasoningRoute("aku sedang sedih", "curhat", "sedih"), "ninerouter");
});

test("429 on ERNIE falls back to GPT-OSS and avoids repeatedly hitting the limited model", async (t) => {
  const client = getProviderCandidates()[0].client;
  const original = client.chat.completions.create;
  const called = [];
  client.chat.completions.create = async (payload) => {
    called.push(payload.model);
    if (payload.model === ERNIE) {
      const error = new Error("rate limit");
      error.status = 429;
      throw error;
    }
    return { choices: [{ message: { content: "[mood:ceria] yoi" } }] };
  };
  t.after(() => { client.chat.completions.create = original; });

  const input = [{ role: "user", content: "helo" }];
  const first = await getReplyFromProviders(input, "ngobrol", "ninerouter", "helo", "netral");
  assert.equal(first.model, GPTOSS);
  assert.deepEqual(called, [ERNIE, GPTOSS]);
  assert.ok(getModelCooldowns().get("ninerouter:" + ERNIE) > Date.now());

  const second = await getReplyFromProviders(input, "ngobrol", "ninerouter", "helo", "netral");
  assert.equal(second.model, GPTOSS);
  assert.deepEqual(called, [ERNIE, GPTOSS, GPTOSS]);
  assert.equal(getPrimaryRouteLabel(), "9Router -> " + ERNIE);
});
