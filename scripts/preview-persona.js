// Manual preview of Hina persona using the already configured local 9Router.
// No WhatsApp socket, no database writes, and no chat messages sent.
const { nineRouterClient, NINEROUTER_MODEL } = require("../config");
const { getHinaPersona, detectIntent, detectUserEmotion } = require("../services/persona");
const { extractMoodAndCleanReply, cleanBotReply } = require("../utils");

async function main() {
  if (!nineRouterClient) {
    throw new Error("NINEROUTER_API_KEY is missing from this environment");
  }

  const prompt = process.argv.slice(2).join(" ").trim() || "helo cantik";
  const emotion = detectUserEmotion(prompt);
  const intent = detectIntent(prompt);
  const persona = getHinaPersona({
    currentMood: "ceria",
    userName: "Allif",
    isCreator: true,
    userEmotion: emotion,
    userIntent: intent,
    timeContext: "malam",
    relationshipMode: "owner",
    relationshipState: { stage: "normal", tensionLevel: 0, speechStyle: "aku-kamu" },
    relationshipContext: "Normal.",
    profile: { intimacy: 8, adultMode: false, ageVerified18Plus: false },
    userText: prompt,
  });

  const result = await nineRouterClient.chat.completions.create({
    model: NINEROUTER_MODEL,
    messages: [
      { role: "system", content: persona },
      { role: "user", content: prompt },
    ],
    stream: false,
  });

  const raw = result?.choices?.[0]?.message?.content || "";
  const parsed = extractMoodAndCleanReply(raw);
  process.stdout.write(
    [
      "Model: " + NINEROUTER_MODEL,
      "Pertanyaan: " + prompt,
      "Mood: " + parsed.mood,
      "Balasan Hina: " + cleanBotReply(parsed.reply),
      "",
    ].join("\n")
  );
}

main().catch((error) => {
  console.error("Preview gagal:", error?.status || error?.code || error?.message || String(error));
  process.exitCode = 1;
});
