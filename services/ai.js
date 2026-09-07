const {
  localClient,
  openRouterClient,
  qwenClient,
  LOCAL_AVAILABLE_MODELS,
  OPENROUTER_AVAILABLE_MODELS,
  QWEN_AVAILABLE_MODELS,
  QWEN_MODEL_SMART,
  QWEN_MODEL_FALLBACK,
} = require("../config");
const { extractTextContent, shouldSwitchModel, buildCompletionPayload } = require("../utils");

let providerState = {
  local: 0,
  openrouter: 0,
  qwen: 0,
};

function isTextChatModel(model) {
  return model && !/(^|[-_])vl([-_]|$)|vision/i.test(String(model || ""));
}

function getProviderCandidates() {
  const providers = [];

  // Local llama.cpp is the default route for normal text chat.
  if (localClient && LOCAL_AVAILABLE_MODELS.length > 0) {
    providers.push({
      name: "local",
      label: "Local Huihui",
      client: localClient,
      models: LOCAL_AVAILABLE_MODELS,
    });
  }

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

  // Live info still prefers a cloud model because the request may depend on fresh RAG context.
  // If cloud providers are unavailable, the normal fallback chain can still use local.
  if (userIntent === "live_info" && openRouterClient) return "openrouter";

  // Normal conversations are intentionally local-first.
  if (localClient) {
    if (userIntent === "short_reply") return "local";
    if (userIntent === "ngobrol") return "local";
    if (userIntent === "bertanya") return "local";
    if (userIntent === "minta_bantuan") return "local";
    if (userIntent === "set_reminder") return "local";
    if (userIntent === "curhat" && !longText && !emotionalHeavy && !asksDeepAdvice) return "local";
  }

  if (qwenClient && (longText || emotionalHeavy || asksDeepAdvice || userIntent === "curhat")) {
    return "qwen";
  }

  if (openRouterClient) return "openrouter";
  if (localClient) return "local";
  if (qwenClient) return "qwen";
  return null;
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

function prepareMessagesForProvider(messages, providerName) {
  if (providerName !== "local") return messages;

  let hasSystemMessage = false;
  const prepared = messages.map((message) => {
    if (message.role !== "system") return message;
    hasSystemMessage = true;
    const content = String(message.content || "");
    if (/\/no_think\b/i.test(content)) return message;
    return {
      ...message,
      content: `${content.trim()}\n\n/no_think`,
    };
  });

  if (!hasSystemMessage) {
    prepared.unshift({
      role: "system",
      content: "/no_think",
    });
  }

  return prepared;
}

function buildPayloadForProvider(provider, model, messages, userIntent) {
  const payload = buildCompletionPayload(model, prepareMessagesForProvider(messages, provider.name), userIntent);

  if (provider.name === "local") {
    // Qwen3/Huihui still responds best to /no_think. These hints are harmless on
    // llama.cpp versions that support them and the text marker remains the fallback.
    payload.chat_template_kwargs = {
      enable_thinking: false,
    };
    payload.reasoning_effort = "none";
  }

  return payload;
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
        const payload = buildPayloadForProvider(provider, currentModel, messages, userIntent);
        const response = await provider.client.chat.completions.create(payload);
        const rawReply = extractTextContent(response?.choices?.[0]?.message?.content);
        if (!rawReply) {
          console.warn(`[${provider.label}] Model '${currentModel}' mengembalikan balasan kosong. Coba sekali lagi di model yang sama...`);
          failures.push(`${provider.label}:${currentModel}:empty`);

          try {
            const retryResponse = await provider.client.chat.completions.create(payload);
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
