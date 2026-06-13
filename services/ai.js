const {
  openRouterClient,
  qwenClient,
  OPENROUTER_AVAILABLE_MODELS,
  QWEN_AVAILABLE_MODELS,
  QWEN_MODEL_SMART,
  QWEN_MODEL_FALLBACK,
} = require("../config");
const { extractTextContent, shouldSwitchModel, buildCompletionPayload } = require("../utils");

let providerState = {
  openrouter: 0,
  qwen: 0,
};

function isTextChatModel(model) {
  return model && !/(^|[-_])vl([-_]|$)|vision/i.test(String(model || ""));
}

function getProviderCandidates() {
  const providers = [];

  if (openRouterClient && OPENROUTER_AVAILABLE_MODELS.length > 0) {
    providers.push({
      name: "openrouter",
      label: "OpenRouter",
      client: openRouterClient,
      models: OPENROUTER_AVAILABLE_MODELS,
    });
  }

  if (qwenClient && QWEN_AVAILABLE_MODELS.length > 0) {
    providers.push({
      name: "qwen",
      label: "Qwen",
      client: qwenClient,
      models: QWEN_AVAILABLE_MODELS,
    });
  }

  return providers;
}

function getPrimaryRouteLabel() {
  const providers = getProviderCandidates();
  if (providers.length === 0) return "tidak ada model aktif";
  const provider = providers[0];
  const currentIndex = providerState[provider.name] || 0;
  const model = provider.models[currentIndex] || provider.models[0];
  return `${provider.label} -> ${model}`;
}

function selectReasoningRoute(text, userIntent, userEmotion) {
  const msg = String(text || "")
    .toLowerCase()
    .trim();

  const longText = msg.length > 350;
  const emotionalHeavy = ["sedih", "capek", "cemas", "kesepian", "marah"].includes(userEmotion);
  const asksDeepAdvice = /aku harus gimana|baiknya gimana|pilih mana|saran serius|nasihat|langkah demi langkah/.test(msg);

  if (userIntent === "live_info") return "openrouter";
  if (userIntent === "short_reply") return "openrouter";
  if (userIntent === "ngobrol") return "openrouter";
  if (userIntent === "bertanya" && msg.length < 180) return "openrouter";

  if (qwenClient && (longText || emotionalHeavy || asksDeepAdvice || userIntent === "curhat")) {
    return "qwen";
  }

  return "openrouter";
}

function getQwenModelOrder(text, userIntent, userEmotion) {
  const msg = String(text || "")
    .toLowerCase()
    .trim();

  const isVeryHeavy =
    msg.length > 260 ||
    userIntent === "curhat" ||
    (userIntent === "minta_bantuan" && msg.length > 100) ||
    /menurut kamu|aku harus gimana|baiknya gimana|pilih mana|saran|nasihat|langkah demi langkah/.test(msg) ||
    ["sedih", "capek", "cemas", "kesepian"].includes(userEmotion);

  const orderedModels = isVeryHeavy ? [QWEN_MODEL_SMART, QWEN_MODEL_FALLBACK] : [QWEN_MODEL_FALLBACK, QWEN_MODEL_SMART];

  return orderedModels.filter(isTextChatModel).filter((model, index, models) => models.indexOf(model) === index);
}

function getProviderCandidatesForRoute(preferredProvider, text, userIntent, userEmotion) {
  const providers = getProviderCandidates().map((provider) =>
    provider.name !== "qwen"
      ? provider
      : {
          ...provider,
          models: getQwenModelOrder(text, userIntent, userEmotion),
        }
  );
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
          console.warn(`[${provider.label}] Model '${currentModel}' mengembalikan balasan kosong. Coba sekali lagi di model yang sama...`);
          failures.push(`${provider.label}:${currentModel}:empty`);

          try {
            const retryResponse = await provider.client.chat.completions.create(buildCompletionPayload(currentModel, messages, userIntent));
            const retryReply = extractTextContent(retryResponse?.choices?.[0]?.message?.content);

            if (retryReply) {
              providerState[provider.name] = index;
              return {
                rawReply: retryReply,
                providerLabel: provider.label,
                model: currentModel,
              };
            }
          } catch (retryError) {
            console.warn(`[${provider.label}] Retry model '${currentModel}' gagal: ${retryError.message || retryError}`);
          }

          continue;
        }
        providerState[provider.name] = index;
        return {
          rawReply,
          providerLabel: provider.label,
          model: currentModel,
        };
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
  return {
    rawReply: "",
    failures,
  };
}

module.exports = {
  getProviderCandidates,
  getPrimaryRouteLabel,
  selectReasoningRoute,
  getReplyFromProviders,
  getProviderState: () => providerState,
};
