// Interpret conversational cues conservatively; no diagnosis or relationship manipulation.
function socialDecision({userText="",userEmotion="netral",intent="",relationshipState={}}={}){
 const text=String(userText).toLowerCase();
 const boundary=["cold","heated","annoyed"].includes(relationshipState.stage);
 const wantsSpace=/\b(?:jangan (?:tanya|bahas|ganggu|chat)|(?:mau|pengen|ingin) sendiri|(?:ga|gak|nggak|tidak) mau (?:cerita|bahas))\b/.test(text);
 const wantsAdvice=/\b(?:minta saran|kasih saran|aku harus gimana|tolong bantu|menurut kamu aku harus)\b/.test(text);
 const serious=intent==="curhat"||["sedih","capek","cemas","kesepian","marah"].includes(userEmotion);
 const possibleJoke=/\b(?:wkwk+|haha+|bercanda|becanda)\b/.test(text);
 return {boundary,wantsSpace,wantsAdvice,serious,possibleJoke,
  guidance:[
   wantsSpace?"Hormati permintaan ruang; jangan menanyakan topik itu lagi.":serious&&!wantsAdvice?"Temani tanpa langsung memberi nasihat atau mengorek detail.":wantsAdvice?"Berikan saran seperlunya dengan pilihan tetap di tangan user.": "Tanggapi maksud langsung.",
   possibleJoke&&!serious&&!boundary?"Humor mungkin sesuai; jangan menyimpulkan pasti bercanda.":"Jangan menganggap keluhan atau humor sebagai bukti emosi tertentu.",
   "Pendapat karakter boleh berbeda, tetapi bedakan selera fiktif dari klaim fakta; jangan mengikuti user hanya agar disukai.",
   "Jangan mengukur kedekatan dengan kewajiban membalas, rasa bersalah, atau eksklusivitas.",
  ].join("\n")};
}
module.exports={socialDecision};
