const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"hina-polish-"));
process.env.DB_FILE=path.join(temp,"database.json");process.env.LOCAL_MODEL_ENABLED="false";process.env.NINEROUTER_API_KEY="test-only";
const {getHinaPersona}=require("../services/persona");
const {makeCase,CASES,inspect,runMultiTurn,MULTI_TURNS}=require("../services/cognitive-benchmark");
const {extractMoodAndCleanReply,cleanBotReply}=require("../utils");
const {updateEmotion,initialEmotion}=require("../services/emotional-continuity");
const {isUnreliableAssistantContext}=require("../services/output-guard");
const {conversationGuidance}=require("../services/natural-conversation");
const db=require("../services/database");
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
test("owner name is absent from other contacts' synthetic prompts",()=>{
 for(const c of CASES)assert.doesNotMatch(makeCase(c)[0].content,/\bAllif\b/i);
 const p=getHinaPersona({userName:"Rani",isCreator:false});
 assert.match(p,/Rani/);assert.doesNotMatch(p,/\bAllif\b/i);
});
test("curiosity aliases and missing tags are handled without leaking metadata",()=>{
 assert.equal(extractMoodAndCleanReply("Naon? [mood:penasaran]").mood,"penasaran");
 assert.equal(extractMoodAndCleanReply("Naon? [mood:curious]").mood,"penasaran");
 assert.equal(extractMoodAndCleanReply("halo").moodMissing,true);
 assert.equal(cleanBotReply("[penasaran] naon?"),"naon?");
 assert.equal(inspect("naon? [mood:penasaran]").moodTag,true);
 const now=Date.now(),p={emotionalContinuity:initialEmotion(now)};
 updateEmotion(p,{now,aiMood:"penasaran",userIntent:"bertanya"});
 assert.ok(p.emotionalContinuity.curiosity>0.5);
 p.emotionalContinuity=initialEmotion(now);
 updateEmotion(p,{now,aiMood:"kesal",userIntent:"short_reply",userEmotion:"netral"});
 assert.ok(p.emotionalContinuity.valence>=0);
});
test("capability grounding distinguishes missing recall from absent storage",()=>{
 const prompt=makeCase(CASES.find(c=>c.id==="uncertain"))[0].content;
 assert.match(prompt,/Riwayat chat terbatas disimpan per kontak/);
 assert.match(prompt,/jangan menyimpulkan user belum pernah bilang/);
 assert.equal(isUnreliableAssistantContext("Aku gak simpan obrolan lama."),true);
 assert.match(conversationGuidance({userText:"makasih na"}),/tidak perlu bertanya kenapa/);
});
test("persisted recall handles Indonesian suffix, correction and contact isolation after reload",()=>{
 const a="sample-a@lid",b="sample-b@lid";
 db.appendChatMessage(a,"user","warna favorit aku biru");
 db.appendChatMessage(a,"assistant","catatan palsu dari bot: merah");
 db.appendChatMessage(a,"user","warna favorit sekarang hijau");
 db.appendChatMessage(b,"user","warna favorit ungu rahasia");
 for(let i=0;i<6;i++)db.appendChatMessage(a,"user","pesan pengalih "+i);
 db.loadDatabase();
 const recall=db.getRelevantChatMemories(a,"ingat warna favoritku?",4);
 assert.match(recall,/biru/);assert.match(recall,/hijau/);
 assert.ok(recall.indexOf("biru")<recall.indexOf("hijau"));
 assert.doesNotMatch(recall,/ungu rahasia|catatan palsu/);
 assert.equal(db.getRelevantChatMemories(b,"warna favoritku?",1),"");
});
test("multi-turn runner uses generated replies and actual lexical retrieval",async()=>{
 const captured=[];
 const results=await runMultiTurn(async(messages,c,i)=>{
  captured.push(messages);
  return i===0?"sip, biru [mood:biasa]":i===5?"hijau [mood:ceria]":"oke [mood:biasa]";
 });
 assert.equal(results.length,MULTI_TURNS.length);
 assert.ok(captured[1].some(m=>m.role==="assistant"&&m.content==="sip, biru"));
 assert.match(captured[5][0].content,/warna favorit.*hijau/);
 assert.ok(results[5].recallChars>0);
 assert.doesNotMatch(captured[5][0].content,/\bAllif\b/i);
});
