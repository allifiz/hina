// Emotional Continuity Engine V2.
// A *simulated* emotional state per contact, not subjective consciousness.
// Time-decay is based on real elapsed milliseconds; no periodic LLM call.
const HOUR=3600000;
const DECAY_HOURS=8;
const MAX_EVENTS=12;
const TARGETS={
  ceria:{valence:0.55,energy:0.62,openness:0.65},
  senang:{valence:0.78,energy:0.70,openness:0.70},
  malu:{valence:0.40,energy:0.35,openness:0.45},
  mengantuk:{valence:0.12,energy:0.18,openness:0.48},
  penasaran:{valence:0.28,energy:0.52,openness:0.64},
  cemburu:{valence:-0.18,energy:0.40,openness:0.37},
  biasa:{valence:0.14,energy:0.43,openness:0.52},
  sedih:{valence:-0.44,energy:0.25,openness:0.50},
  kesal:{valence:-0.55,energy:0.64,openness:0.30},
  marah:{valence:-0.78,energy:0.83,openness:0.22},
};
const VALID=new Set(Object.keys(TARGETS));
function clamp(value,lo,hi){
  const n=Number(value);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):lo;
}
function initialEmotion(now=Date.now()) {
  return {
    version:3,
    lastUpdatedAt:now,
    valence:0.18,
    energy:0.49,
    openness:0.57,
    curiosity:0.50,
    concern:0.15,
    mood:"biasa",
    events:[],
  };
}
function normalizeEmotion(input,now=Date.now()) {
  const fallback=initialEmotion(now);
  if(!input||typeof input!=="object")return fallback;
  const mood=VALID.has(input.mood)?input.mood:"biasa";
  return {
    version:3,
    lastUpdatedAt:Number.isFinite(input.lastUpdatedAt)&&input.lastUpdatedAt<=now?input.lastUpdatedAt:now,
    valence:clamp(input.valence,-1,1),
    energy:clamp(input.energy,0,1),
    openness:clamp(input.openness ?? fallback.openness,0,1),
    curiosity:clamp(input.curiosity ?? fallback.curiosity,0,1),
    concern:clamp(input.concern ?? fallback.concern,0,1),
    mood,
    events:Array.isArray(input.events)?input.events.filter(x=>x&&Number.isFinite(x.at)&&typeof x.type==="string")
      .slice(-MAX_EVENTS).map(x=>({at:x.at,type:String(x.type).slice(0,30)})):[],
  };
}
function decayEmotion(state,now=Date.now()) {
  const input=normalizeEmotion(state,now);
  const hours=Math.max(0,(now-input.lastUpdatedAt)/HOUR);
  const retention=Math.exp(-hours/DECAY_HOURS);
  return {
    ...input,
    valence:clamp(0.18+(input.valence-0.18)*retention,-1,1),
    energy:clamp(0.49+(input.energy-0.49)*retention,0,1),
    openness:clamp(0.57+(input.openness-0.57)*retention,0,1),
    curiosity:clamp(0.50+(input.curiosity-0.50)*retention,0,1),
    concern:clamp(0.15+(input.concern-0.15)*retention,0,1),
    lastUpdatedAt:now,
  };
}
function classifyMood(state){
  if(state.valence < -0.58 && state.energy > 0.56)return "marah";
  if(state.valence < -0.28)return state.energy>0.50?"kesal":"sedih";
  if(state.valence>0.52)return state.energy>0.44?"senang":"malu";
  if(state.valence>0.24 && state.energy>0.54)return "ceria";
  if(state.curiosity>0.67 && state.valence>=0)return "penasaran";
  return "biasa";
}
function updateEmotion(profile,{previousMood,aiMood,userEmotion="netral",userIntent="",replyStyle="",relationshipState={},now=Date.now()}={}) {
  const old=profile?.emotionalContinuity;
  let state=decayEmotion(old||initialEmotion(now),now);
  // Softly migrate old persisted currentMood on first use.
  if(!old && VALID.has(previousMood)){
    const prior=TARGETS[previousMood];
    state.valence=prior.valence*0.50;
    state.energy=(state.energy+prior.energy)/2;
    state.openness=(state.openness+prior.openness)/2;
  }
  let targetMood=VALID.has(aiMood)?aiMood:classifyMood(state);
  const stage=relationshipState?.stage||"normal";
  if(stage==="heated")targetMood="marah";
  else if(stage==="cold"||stage==="annoyed")targetMood="kesal";
  else if(userIntent==="curhat"||["sedih","capek","cemas","kesepian"].includes(userEmotion))
    targetMood="sedih";
  else if(userEmotion==="senang" && targetMood==="biasa")targetMood="senang";
  else if(replyStyle==="playful" && (targetMood==="biasa"||!VALID.has(aiMood)))targetMood="ceria";
  else if(["kesal","marah","cemburu"].includes(targetMood)&&userEmotion==="netral"&&userIntent==="short_reply")targetMood="biasa";

  const target=TARGETS[targetMood];
  const weight=stage==="heated"?0.56:targetMood==="sedih"?0.38:0.34;
  state.valence=clamp(state.valence*(1-weight)+target.valence*weight,-1,1);
  state.energy=clamp(state.energy*(1-weight)+target.energy*weight,0,1);
  state.openness=clamp(state.openness*(1-weight)+target.openness*weight,0,1);
  const concernTarget = userIntent==="curhat"||["sedih","capek","cemas","kesepian"].includes(userEmotion) ? 0.85 : 0.15;
  const curiosityTarget = targetMood==="penasaran" ? 0.9 : ["bertanya","minta_bantuan","live_info"].includes(userIntent) ? 0.75 : 0.5;
  state.concern=clamp(state.concern*0.7+concernTarget*0.3,0,1);
  state.curiosity=clamp(state.curiosity*0.7+curiosityTarget*0.3,0,1);
  const next=classifyMood(state);
  state.mood=next;
  if(targetMood!=="biasa"){
    state.events.push({at:now,type:stage!=="normal"?"boundary":"conversation"});
    state.events=state.events.slice(-MAX_EVENTS);
  }
  if(profile)profile.emotionalContinuity=state;
  return next;
}
function getEmotionalContext(profile,now=Date.now()) {
  const state=decayEmotion(profile?.emotionalContinuity||initialEmotion(now),now);
  // Mood is a narrative tone, not an instruction to mirror user's distress.
  const stable=classifyMood(state);
  return [
    "",
    "EMOTIONAL CONTINUITY ENGINE (kondisi simulasi karakter; jangan dibacakan):",
    "Nuansa yang tersisa dari percakapan sebelumnya: "+stable+".",
    "Energi percakapan: "+(state.energy>0.65?"cukup ekspresif":state.energy<0.35?"tenang":"sedang")+".",
    "Keterbukaan: "+(state.openness<0.38?"lebih menjaga jarak":"wajar dan tidak posesif")+".",
    "Perhatian: "+(state.concern>0.45?"lebih peka terhadap situasi user":"wajar")+". Rasa ingin tahu: "+(state.curiosity>0.6?"tinggi":"sedang")+".",
    "Nada dan respons boleh berubah perlahan seiring waktu, tanpa memaksa setiap pesan menjadi suasana hati yang sama.",
    "Perasaan pengguna adalah milik pengguna, bukan bukti Hina mengalami kesedihan yang sama. Jangan mengaku memiliki perasaan biologis.",
    "Jangan pakai angka, label engine, atau catatan internal pada balasan.",
  ].join("\n");
}
function getEmotionalSummary(profile,now=Date.now()) {
  const state=decayEmotion(profile?.emotionalContinuity||initialEmotion(now),now);
  return "Emotional continuity: "+classifyMood(state)+
    "\nEnergi: "+Math.round(state.energy*100)+"%"+
    "\nKeterbukaan: "+Math.round(state.openness*100)+"%"+
    "\nRasa ingin tahu: "+Math.round(state.curiosity*100)+"%"+
    "\nPerhatian: "+Math.round(state.concern*100)+"%"+
    "\nPeristiwa simulasi tercatat: "+state.events.length;
}
function resetEmotion(profile){if(profile)delete profile.emotionalContinuity;}
module.exports={initialEmotion,normalizeEmotion,decayEmotion,updateEmotion,getEmotionalContext,getEmotionalSummary,resetEmotion,classifyMood};
