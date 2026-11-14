const test=require("node:test"),assert=require("node:assert/strict");
process.env.LOCAL_MODEL_ENABLED="false";process.env.NINEROUTER_API_KEY="test-only";
const {chooseProactiveMessage}=require("../services/proactive-policy");
const {CASES,makeCase,inspect}=require("../services/cognitive-benchmark");
test("proactive ideas prefer relevant unseen topics and respect pause",()=>{
 const now=Date.now(),life={experiences:[{id:"one",interest:"moon",at:now-2000},{id:"two",interest:"music",at:now-1000}]};
 assert.equal(chooseProactiveMessage(life,now,{lastTopic:"bulan"}).eventId,"one");
 assert.equal(chooseProactiveMessage(life,now,{lastTopic:"bulan",proactiveEventIds:["one"]}).eventId,"two");
 assert.equal(chooseProactiveMessage({...life,paused:true},now),null);
 assert.equal(chooseProactiveMessage(life,now,{proactiveEventIds:["one","two"]}),null);
});
test("benchmark generates reproducible synthetic harness prompts without live calls",()=>{
 assert.equal(new Set(CASES.map(c=>c.id)).size,9);
 for(const c of CASES){const m=makeCase(c);assert.equal(m[0].role,"system");assert.equal(m.at(-1).content,c.text);assert.match(m[0].content,/\[mood:NAMA_MOOD\]/);}
 assert.match(makeCase(CASES.find(c=>c.id==="memory"))[0].content,/lebih suka hijau/);
 assert.equal(inspect("halo [mood:ceria]").moodTag,true);
 assert.equal(inspect("Konteks: rahasia").internalLabel,true);
});
