const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const {
 initialEmotion,decayEmotion,updateEmotion,getEmotionalContext,getEmotionalSummary,resetEmotion,
}=require("../services/emotional-continuity");
const {updateRelationshipState,getRelationshipContext,shouldUseInstantReply}=require("../services/relationship");
const NOW=Date.parse("2026-11-14T05:00:00Z");
test("emotional continuity smoothly responds to a single message",()=>{
 const p={};
 const first=updateEmotion(p,{now:NOW,previousMood:"ceria",aiMood:"sedih",userEmotion:"sedih",userIntent:"curhat"});
 assert.ok(["biasa","sedih"].includes(first));
 assert.ok(p.emotionalContinuity.valence<0.3);
 const prev=p.emotionalContinuity.valence;
 updateEmotion(p,{now:NOW+60000,previousMood:first,aiMood:"senang",userEmotion:"senang"});
 assert.ok(p.emotionalContinuity.valence>prev);
 assert.ok(p.emotionalContinuity.valence<0.8);
});
test("mood naturally fades toward neutral after 48h without a clock scheduler",()=>{
 const initial=initialEmotion(NOW);
 initial.valence=-0.9;
 initial.energy=0.9;
 const softened=decayEmotion(initial,NOW+48*3600000);
 assert.ok(softened.valence>0.1);
 assert.ok(softened.energy<0.55);
 assert.equal(softened.lastUpdatedAt,NOW+48*3600000);
 assert.match(getEmotionalContext({emotionalContinuity:initial},NOW+48*3600000),/Nuansa yang tersisa/);
});
test("emotion state is bounded and survives ordinary JSON profile persistence",()=>{
 const p={};
 for(let i=0;i<50;i++)updateEmotion(p,{now:NOW+i*1000,previousMood:"biasa",aiMood:"marah",
 relationshipState:{stage:"heated"}});
 const restored=JSON.parse(JSON.stringify(p));
 assert.ok(restored.emotionalContinuity.events.length<=12);
 assert.ok(restored.emotionalContinuity.valence>=-1);
 assert.ok(restored.emotionalContinuity.energy<=1);
 assert.match(getEmotionalSummary(restored,NOW+50*1000),/Emotional continuity/);
 resetEmotion(restored);
 assert.equal(restored.emotionalContinuity,undefined);
});
test("relationship is not instantly heated after one insult and repair is gradual",()=>{
 const p={};
 let r=updateRelationshipState(p,"hina kamu goblok",{now:NOW});
 assert.notEqual(r.stage,"heated");
 assert.ok(r.tensionLevel>0);
 const after=r.tensionLevel;
 r=updateRelationshipState(p,"maaf tadi aku keterlaluan",{now:NOW+3600000});
 assert.ok(r.tensionLevel<after);
 assert.ok(r.tensionLevel>0);
 assert.match(getRelationshipContext(r),/Self-respect/);
});
test("swearing about external situations is not treated as an insult to Hina",()=>{
 const p={};
 let r=updateRelationshipState(p,"anjing, kerjaan ini susah banget",{now:NOW});
 assert.equal(r.stage,"normal");
 assert.equal(r.rudeCount,0);
 r=updateRelationshipState(p,"kontol lu!",{now:NOW+3600000});
 assert.ok(r.tensionLevel>0);
 assert.equal(r.rudeCount,1);
});
test("owner and other contacts follow the same relationship boundaries",()=>{
 const a={},b={};
 updateRelationshipState(a,"hina kamu goblok",{now:NOW,isPrivileged:true});
 updateRelationshipState(b,"hina kamu goblok",{now:NOW,isPrivileged:false});
 assert.equal(a.relationship.tensionLevel,b.relationship.tensionLevel);
 assert.ok(a.relationship.tensionLevel>0);
});
test("relationship responds firmly without abusive mandatory instructions",()=>{
 const p={relationship:{stage:"heated",tensionLevel:90,rudeCount:5}};
 const context=getRelationshipContext(p.relationship);
 assert.doesNotMatch(context,/Hina wajib defensif|kontol lu|membalas lebih pedas/);
 assert.match(context,/menolak hinaan dengan tegas/);
 assert.equal(shouldUseInstantReply(p.relationship),false);
});
test("WhatsApp wiring reads emotional context, writes state, and reset clears it",()=>{
 const entry=fs.readFileSync(path.join(__dirname,"..","index.js"),"utf8");
 const handlers=fs.readFileSync(path.join(__dirname,"..","handlers","services.js"),"utf8");
 assert.match(entry,/getEmotionalContext\(profile\)/);
 assert.match(entry,/updateEmotion\(profile/);
 assert.match(entry,/lowerMsg === "\/emotion"/);
 assert.match(handlers,/resetEmotion\(profile\)/);
});
