const test=require("node:test"),assert=require("node:assert/strict");
const {getTemporalContext}=require("../services/temporal");
const {normalizeEmotion,updateEmotion,decayEmotion}=require("../services/emotional-continuity");
const {socialDecision}=require("../services/social-intelligence");
const {cognitionDecision}=require("../services/unified-cognition");
const now=Date.parse("2026-11-14T05:00:00Z");
test("temporal guidance distinguishes a short continuation from old context",()=>{
 assert.match(getTemporalContext(now-10000,now),/Jeda pendek/);
 assert.match(getTemporalContext(now-86400000,now),/Jeda panjang/);
 assert.match(getTemporalContext(null,now),/Jangan menebak/);
});
test("emotion migration preserves old dimensions and adds bounded independent state",()=>{
 const initial=normalizeEmotion({version:2,lastUpdatedAt:now,valence:0.4,energy:0.2,openness:0.3,mood:"biasa"},now);
 assert.equal(initial.version,3); assert.equal(initial.valence,0.4);assert.equal(initial.curiosity,0.5);
 const p={emotionalContinuity:initial};
 updateEmotion(p,{now,userEmotion:"sedih",userIntent:"curhat"});
 assert.ok(p.emotionalContinuity.concern>initial.concern);
 assert.ok(decayEmotion(p.emotionalContinuity,now+48*3600000).concern<p.emotionalContinuity.concern);
});
test("space and serious context override joking cues; no forced advice",()=>{
 const d=socialDecision({userText:"aku sedih wkwk, jangan tanya",userEmotion:"sedih",intent:"curhat"});
 assert.equal(d.wantsSpace,true);assert.match(d.guidance,/Hormati permintaan ruang/);
 assert.doesNotMatch(d.guidance,/Humor mungkin sesuai/);
 assert.match(cognitionDecision({userText:"gimana"}).social.guidance,/Pendapat karakter boleh berbeda/);
});
