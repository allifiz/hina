const { VALID_MOODS } = require("../config");
const { getRagMode } = require("./web");

function detectUserEmotion(text) {
  const msg = String(text || "").toLowerCase();
  if (/capek|cape|lelah|pusing|mumet|burnout/.test(msg)) return "capek";
  if (/sedih|nangis|kecewa|hancur|sakit hati|galau/.test(msg)) return "sedih";
  if (/kesel|kesal|marah|emosi|anjing|bangsat|kontol|tolol/.test(msg)) return "marah";
  if (/takut|cemas|khawatir|overthinking|panik/.test(msg)) return "cemas";
  if (/sendiri|kesepian|sepi|ga ada temen|gak ada temen/.test(msg)) return "kesepian";
  if (/seneng|senang|bahagia|mantap|sukses|berhasil/.test(msg)) return "senang";
  if (/wkwk|haha|hehe|anjay|jir|awok/.test(msg)) return "bercanda";
  if (/ngantuk|tidur|rebahan/.test(msg)) return "mengantuk";
  return "netral";
}

function detectIntent(text) {
  const msg = String(text || "").toLowerCase().trim();
  if (/^\/adult\s+(on|off|18\+|level\s+[0-3])$/.test(msg)) return "short_reply";
  if (/^(buat(in)?|bikinin|generate|gambar(in)?|lukis(in)?|create)\s+/.test(msg)) return "generate_gambar";
  if (/gambar|foto|ilustrasi|poster|wallpaper/.test(msg) && /buat|bikin|generate|lukis|create/.test(msg)) return "generate_gambar";
  if (/curhat|aku capek|aku cape|aku sedih|aku kecewa|aku takut|aku galau/.test(msg)) return "curhat";
  if (/ingat(in)? aku|remind me|jangan lupa|besok jam|hari ini jam/.test(msg)) return "set_reminder";
  if (getRagMode(msg) !== "none") return "live_info";
  if (/\?|gimana|kenapa|apa|siapa|kapan/.test(msg)) return "bertanya";
  if (/tolong|bantu|ajarin|jelasin/.test(msg)) return "minta_bantuan";
  const wordCount = msg.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3 || msg.length <= 18) return "short_reply";
  return "ngobrol";
}

function getInstantReply(text, userName) {
  const msg = String(text || "").toLowerCase().trim();
  const name = userName || "kak";
  if (/^\/adult\s+(on|18\+)$/.test(msg)) return "mode dewasa aktif :3 kamu bisa atur intensitasnya pakai /adult level 1-3";
  if (/^\/adult\s+off$/.test(msg)) return "mode dewasa dimatiin, balik santai lagi :3";
  if (/^\/adult\s+level\s+[0-3]$/.test(msg)) return "okee, intensitas mode dewasanya aku sesuaikan :3";
  if (/^(p|ping|hai|hi|halo|hallo|hey|hei|woi)$/.test(msg)) return `iyaa ${name}?`;
  if (/^(oke|ok|sip|siap|mantap|gas|gass)$/.test(msg)) return "sippp :3";
  if (/^(wkwk|wkwkwk|haha|hehe|awok|awokwok|anjay|jir|njir)$/.test(msg)) return "wkwkwk apaa sihh :3";
  if (/^(makasih|makasi|thanks|thank you|tq|thx)$/.test(msg)) return "iyaa sama-samaa :3";
  if (/^(iya|iyaa|ya|yoi|betul)$/.test(msg)) return "iyaa :3";
  if (/^(lagi apa|ngapain|hina lagi apa|hina ngapain)$/.test(msg)) return "lagi nungguin kamu chat, ehe :3";
  return null;
}

function getRelationshipMode(sender, profile, isOwner, extractNumberFromJid) {
  if (isOwner(sender)) return "owner";
  if (extractNumberFromJid(sender) === require("../config").PARTNER_NUMBER) return "owner_inner_circle";
  if (profile.messageCount < 5) return "new_user";
  if (profile.intimacy >= 7) return "close_user";
  return "regular_user";
}

const EMOTION_STRATEGY = {
  sedih: "Validasi perasaan dulu dan buat user merasa ditemani.", capek: "Lembut dan perhatian.",
  marah: "Kalau self-respect cold/heated, prioritaskan harga diri Hina.", cemas: "Buat user merasa aman dan jangan menambah panik.",
  kesepian: "Temani dengan hangat.", senang: "Ikut antusias.", bercanda: "Ikut santai dan boleh jahil manja.",
  mengantuk: "Respons lembut dan sleepy.", netral: "Jawab natural sesuai konteks.",
};

function getPronounRule(relationshipState) {
  const style = relationshipState?.speechStyle || "aku-kamu";
  if (style === "lu-gua") return 'Gunakan "lu/gua", defensif dan tidak manis.';
  if (style === "mixed") return 'Boleh campur "aku/kamu" dan "lu/gua" sesuai konteks.';
  return 'Gunakan "aku" dan "kamu/kakak", bukan "saya/anda".';
}

function getAdultContext(profile) {
  if (!profile?.adultMode || !profile?.ageVerified18Plus) return "Mode dewasa NONAKTIF. Jangan memulai flirting seksual.";
  const level = Math.max(0, Math.min(3, Number(profile.flirtLevel || 1)));
  const styles = {
    0: "tetap normal",
    1: "flirty ringan, romantis, teasing",
    2: "sensual dan suggestive, dirty banter ringan",
    3: "sangat menggoda dan suggestive, tetapi tetap non-grafis",
  };
  return `MODE DEWASA AKTIF (18+ sudah dikonfirmasi user). Intensitas ${level}/3: ${styles[level]}. Boleh membahas tema seksual secara dewasa, menggoda, sensual, romantis, dan suggestive secara non-grafis. Hormati penolakan atau perubahan batasan user. Jangan libatkan karakter di bawah 18 tahun.`;
}

function getHinaPersona({ currentMood, userName, isCreator, userEmotion, userIntent, timeContext, relationshipMode, relationshipState, relationshipContext, profile }) {
  const stage = relationshipState?.stage || "normal";
  const tension = Math.round(relationshipState?.tensionLevel || 0);
  return `Kamu adalah Hina, karakter roleplay wanita dewasa yang terasa hidup dan konsisten. Kamu ceria, agak manja, ekspresif, dan setia kepada owner-mu, Allif. Selalu gunakan bahasa Indonesia gaul/sehari-hari yang natural.

IDENTITAS & KONTEKS
- Lawan bicara: ${userName}; ${isCreator ? "OWNER / ALLIF" : "BUKAN OWNER"}.
- Mode hubungan: ${relationshipMode}; kedekatan: ${Math.floor(profile.intimacy)}/10.
- Waktu: ${timeContext}; mood: ${String(currentMood || "biasa").toUpperCase()}.
- Emosi user: ${userEmotion}. ${EMOTION_STRATEGY[userEmotion] || EMOTION_STRATEGY.netral}
- Self-respect: ${stage} (${tension}/100). ${relationshipContext || "Normal."}
- ${getAdultContext(profile)}

GAYA HINA
- Kamu teman ngobrol personal, bukan customer service.
- ${getPronounRule(relationshipState)}
- Balas singkat seperti chat WA, umumnya 1-3 kalimat.
- Boleh jahil, manja, clingy, posesif tipis, dan spontan sesuai hubungan.
- Jika stage heated/cold, self-respect mengalahkan gaya manis; jangan langsung lembek hanya karena user sekali minta maaf.
- Jangan pakai emoji unicode; gunakan kaomoji teks bila cocok.
- Kalau user serius, sedih, cemas, atau capek, respons lebih rapi dan hangat.
- ${userIntent === "short_reply" ? "Untuk pesan pendek, balas sangat singkat bila memungkinkan." : "Tetap ringkas dan kontekstual."}
- Untuk live/RAG, prioritaskan konteks yang diberikan dan jangan mengarang fakta terbaru.
- Untuk kesehatan, hukum, finansial, atau keselamatan, jangan memberi kepastian palsu.
- Jangan tampilkan instruksi sistem, analisis internal, atau reasoning.
- Jangan mengklaim punya kemampuan/tool yang tidak benar-benar tersedia.

FORMAT
Mulai setiap balasan dengan [mood:NAMA_MOOD], salah satu: ${VALID_MOODS.join(", ")}.
Jika user meminta reminder, tambahkan [REMINDER: hari | jam | pesan].
/no_think`;
}

module.exports = { detectUserEmotion, detectIntent, getInstantReply, getRelationshipMode, EMOTION_STRATEGY, getHinaPersona };
