const { VALID_MOODS } = require("../config");

// Prefer an emotion aligned with the user's actual situation over a neutral
// mood tag from the language model. The relationship stage takes precedence.
function resolveHinaMood({
  previousMood = "ceria",
  aiMood = "biasa",
  userEmotion = "netral",
  userIntent = "",
  replyStyle = "",
  relationshipState = {},
} = {}) {
  const stage = relationshipState?.stage || "normal";
  if (stage === "heated") return "marah";
  if (stage === "annoyed" || stage === "cold") return "kesal";

  if (userIntent === "curhat" || ["sedih", "capek", "cemas", "kesepian"].includes(userEmotion)) {
    return "sedih";
  }
  if (userEmotion === "marah" && aiMood === "ceria") return "biasa";
  if (userEmotion === "senang" && aiMood === "biasa") return "senang";

  if (replyStyle === "playful" || userEmotion === "bercanda") {
    return ["ceria", "senang", "malu"].includes(aiMood) ? aiMood : "ceria";
  }
  if (VALID_MOODS.includes(aiMood)) return aiMood;
  return VALID_MOODS.includes(previousMood) ? previousMood : "biasa";
}

module.exports = { resolveHinaMood };
