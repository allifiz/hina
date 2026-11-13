// Review multi-turn Hina dialog using 9Router without starting WhatsApp.
// Turns are independent CLI arguments. Never persists messages to disk.
const { nineRouterClient, NINEROUTER_MODEL } = require("../config");
const { getHinaPersona, detectIntent, detectUserEmotion } = require("../services/persona");
const { extractTextContent, extractMoodAndCleanReply, cleanBotReply } = require("../utils");

const defaults = [
  "helo cantik",
  "ih kamu tuh nyebelin banget tau ga",
  "ahahah jangan ngambek dong",
  "hina, kalo kita jalan bareng kamu pengen kemana?",
];

async function main() {
  if (!nineRouterClient) throw new Error("NINEROUTER_API_KEY belum dikonfigurasi");

  const prompts = process.argv.slice(2).filter((item) => item.trim());
  const turns = prompts.length ? prompts : defaults;
  const history = [];
  let currentMood = "ceria";

  for (const [index, userText] of turns.entries()) {
    const userEmotion = detectUserEmotion(userText);
    const userIntent = detectIntent(userText);
    const persona = getHinaPersona({
      currentMood,
      userName: "Allif",
      isCreator: true,
      userEmotion,
      userIntent,
      timeContext: "malam",
      relationshipMode: "owner",
      relationshipState: { stage: "normal", tensionLevel: 0, speechStyle: "aku-kamu" },
      relationshipContext: "Normal.",
      profile: { intimacy: 8, adultMode: false, ageVerified18Plus: false },
      userText,
    });

    const messages = [
      { role: "system", content: persona },
      ...history.slice(-10),
      { role: "user", content: userText },
    ];

    const response = await nineRouterClient.chat.completions.create({
      model: NINEROUTER_MODEL,
      messages,
      stream: false,
    });

    const rawReply = extractTextContent(response?.choices?.[0]?.message?.content);
    if (!rawReply) throw new Error("Balasan model kosong pada pesan " + (index + 1));
    const { mood, reply } = extractMoodAndCleanReply(rawReply);
    const cleanReply = cleanBotReply(reply);
    currentMood = mood;

    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: cleanReply });

    console.log("[" + (index + 1) + "] Kamu: " + userText);
    console.log("    Hina (" + mood + "): " + cleanReply);
    console.log("");
  }
}

main().catch((error) => {
  console.error("Preview percakapan gagal:", error?.status || error?.code || error?.message || String(error));
  process.exitCode = 1;
});
