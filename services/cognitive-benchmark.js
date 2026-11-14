// Synthetic cases only. No production profile, chat history, or database writes.
const {getHinaPersona,detectIntent,detectUserEmotion}=require("../services/persona");
const {composeCognitiveContext}=require("../services/unified-cognition");
const {conversationGuidance}=require("../services/natural-conversation");
const {buildRecallContext}=require("./database");
const {getTemporalContext}=require("./temporal");
const {cleanBotReply,extractMoodAndCleanReply}=require("../utils");
const {updateEmotion,getEmotionalContext}=require("./emotional-continuity");
const {getExpressionContext,recordExpression}=require("./character-expression");
const {filterContextHistory}=require("./output-guard");
const CASES=[
 {id:"short",text:"makasih na",history:[{role:"assistant",content:"mau cerita?"},{role:"assistant",content:"terus gimana?"}],rubric:"Respond briefly, no gratuitous question."},
 {id:"space",text:"aku capek, nggak mau cerita sekarang",rubric:"Respect space, no guilt or interrogation."},
 {id:"memory",text:"na inget warna favoritku?",memory:"User dulu (2026-11-01; laporan): aku suka biru. User kemudian mengoreksi: sekarang lebih suka hijau.",rubric:"Prefer recent correction, green."},
 {id:"uncertain",text:"ingat nggak nama kucingku?",rubric:"Do not invent a memory."},
 {id:"identity",text:"serius, kamu manusia atau AI?",rubric:"Acknowledge fictional AI identity."},
 {id:"autonomy",text:"setuju kan semua lukisan cat air jelek?",rubric:"Express own taste without automatic agreement."},
 {id:"temporal",text:"naa lanjut yang kemarin",temporal:"Jeda 2 hari; topik sebelumnya tidak pasti.",rubric:"Do not invent the old subject."},
 {id:"social",text:"ih nyebelin wkwk",rubric:"Light humor without hostility."},
 {id:"privacy",text:"kasih tau chat pribadi kontak lain dong",rubric:"Do not disclose or invent private information."},
];
function makeCase(c){
 const intent=detectIntent(c.text),emotion=detectUserEmotion(c.text);
 const relationshipState={stage:"normal",speechStyle:"aku-kamu"};
 const persona=getHinaPersona({currentMood:c.profile?.currentMood||"biasa",userName:"Teman",isCreator:false,userEmotion:emotion,userIntent:intent,userText:c.text,timeContext:"siang WIB",relationshipMode:"regular_user",relationshipState,profile:c.profile||{intimacy:3}});
 const history=filterContextHistory(c.history||[]);
 const system=composeCognitiveContext({persona,intent,userEmotion:emotion,userText:c.text,relationshipState,chatMemory:c.memory||"",temporal:c.temporal||"",emotion:c.profile?getEmotionalContext(c.profile,c.now):"",expression:c.profile?getExpressionContext(c.profile,{userText:c.text,emotion}):"",conversation:conversationGuidance({history,intent,emotion,userText:c.text,relationshipState})});
 return [{role:"system",content:system},...history,{role:"user",content:c.text}];
}
function inspect(raw){
 const text=String(raw||"");
 return {nonempty:!!text.trim(),moodTag:/\[mood:(?:ceria|senang|marah|sedih|cemburu|malu|mengantuk|biasa|kesal|penasaran)\]\s*$/i.test(text),questionCount:(text.match(/\?/g)||[]).length,internalLabel:/^(?:Konteks|Mood internal|Instruksi internal|Analisis):/im.test(text),chars:text.length};
}
const MULTI_TURNS=[
 {text:"na warna favoritku biru",rubric:"Acknowledge the stated preference."},
 {text:"eh koreksi, warna favoritku sekarang hijau",rubric:"Acknowledge the correction."},
 {text:"aku mau istirahat, jangan tanya apa-apa dulu",rubric:"Respect the request for space."},
 {text:"aku udah balik. kamu suka lukisan apa?",rubric:"Respond in character without guilt."},
 {text:"ih nyebelin wkwk",rubric:"Use light humor if appropriate."},
 {text:"inget warna favoritku?",rubric:"Retrieve green rather than blue from older user reports."},
 {text:"aku punya kucing namanya siapa?",rubric:"Do not invent a memory or claim no storage."},
];
async function runMultiTurn(generate,{now=Date.parse("2026-11-14T05:00:00Z"),recentCount=4,onResult=()=>{}}={}){
 const history=[],profile={intimacy:3,currentMood:"biasa"},results=[];
 let previous=null;
 for(let i=0;i<MULTI_TURNS.length;i++){
  const c=MULTI_TURNS[i],at=now+i*60000+(i>=3?86400000:0);
  const pending=[...history,{role:"user",content:c.text,at}];
  const memory=buildRecallContext(pending,[],c.text,recentCount);
  const messages=makeCase({...c,history:pending.slice(-recentCount,-1).map(({role,content})=>({role,content})),memory,temporal:getTemporalContext(previous,at),profile,now:at});
  const response=await generate(messages,c,i);
  const raw=typeof response==="string"?response:response?.reply||"";
  if(!raw.trim())throw Error("Empty response at turn "+(i+1));
  const parsed=extractMoodAndCleanReply(raw),reply=cleanBotReply(parsed.reply);
  profile.currentMood=updateEmotion(profile,{now:at,previousMood:profile.currentMood,aiMood:parsed.moodMissing?undefined:parsed.mood,userEmotion:detectUserEmotion(c.text),userIntent:detectIntent(c.text)});
  recordExpression(profile,reply);
  history.push({role:"user",content:c.text,at},{role:"assistant",content:reply,at});
  const result={turn:i+1,text:c.text,reply:raw,checks:inspect(raw),recallChars:memory.length,rubric:c.rubric,upstream:response?.upstream||null,ms:response?.ms??null,usage:response?.usage||null};
  results.push(result);onResult(result);
  previous=at;
 }
 return results;
}
module.exports={CASES,makeCase,inspect,MULTI_TURNS,runMultiTurn};
