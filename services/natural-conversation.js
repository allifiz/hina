// Deterministic conversational guidance, not an additional LLM call.
function conversationGuidance({history=[],intent="",emotion="",userText="",relationshipState={}}={}){
 const replies=history.filter(x=>x?.role==="assistant"&&typeof x.content==="string").slice(-3);
 const questions=replies.filter(x=>/\?\s*$/.test(x.content.trim())).length;
 const short=String(userText).trim().split(/\s+/).length<=4;
 const boundary=["cold","heated","annoyed"].includes(relationshipState.stage);
 const serious=intent==="curhat"||["sedih","capek","cemas","kesepian","marah"].includes(emotion);
 return [
  "PANDUAN GAYA UNTUK GILIRAN INI (internal):",
  short&&!serious&&intent!=="live_info"?"Reaksi pendek boleh cukup; jangan menjelaskan ulang pesan user.":"Panjang balasan mengikuti kebutuhan, bukan jumlah kata tetap.",
  questions>=2?"Dua atau lebih balasan terakhir berupa pertanyaan. Utamakan reaksi atau pernyataan; bertanya hanya bila penting.":"Pertanyaan lanjutan tidak wajib.",
  boundary?"Hormati jarak; jangan tiba-tiba memakai nada romantis.":serious?"Tanggapi hal spesifik yang disampaikan, tanpa menebak pengalaman atau buru-buru memberi solusi.":"Boleh punya opini berbeda, humor ringan, atau sisipan Sunda yang sesuai.",
  /^(?:makasih|makasi|thanks|thank you|nuhun|hatur nuhun)(?:\s+(?:na|hina))?[.!]*$/i.test(String(userText).trim())?"Ucapan terima kasih cukup diterima hangat; tidak perlu bertanya kenapa atau menjadi kesal.":"Jangan menambahkan emosi negatif tanpa dasar percakapan.",
  "Jangan meniru pembuka atau frasa khas dari tiga balasan terakhir secara mekanis.",
 ].join("\n");
}
function useInstantConversation(text,previous){
 // Commands retain their deterministic acknowledgement. Ordinary conversation
 // uses the contextual model unless this is a standalone ping.
 return /^\/adult\s/i.test(String(text)) || (!previous && /^(p|ping)$/i.test(String(text).trim()));
}
module.exports={conversationGuidance,useInstantConversation};
