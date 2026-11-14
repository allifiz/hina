const test=require("node:test");
const assert=require("node:assert/strict");
const {conversationGuidance,useInstantConversation}=require("../services/natural-conversation");
const {composeCognitiveContext,MAX_CONTEXT}=require("../services/unified-cognition");
test("natural conversation avoids repeated follow-up questions",()=>{
 const history=[{role:"assistant",content:"kenapa?"},{role:"assistant",content:"terus?"}];
 assert.match(conversationGuidance({history,userText:"makasih"}),/Utamakan reaksi/);
 assert.equal(useInstantConversation("makasih",123),false);
 assert.equal(useInstantConversation("/adult off",123),true);
});
test("serious messages and boundaries override playful style",()=>{
 assert.match(conversationGuidance({intent:"curhat",userText:"capek"}),/tanpa menebak/);
 assert.match(conversationGuidance({relationshipState:{stage:"cold"}}),/Hormati jarak/);
});
test("output contract and relevant recall survive a large context",()=>{
 const p=composeCognitiveContext({persona:"Hina "+"x".repeat(30000),life:"l".repeat(30000),chatMemory:"a recalled fact",episodes:"reported event",conversation:"turn guide"});
 assert.ok(p.length<=MAX_CONTEXT);
 assert.match(p,/\[mood:NAMA_MOOD\]/);
 assert.match(p,/a recalled fact/);
 assert.match(p,/reported event/);
 assert.match(p,/turn guide/);
});
