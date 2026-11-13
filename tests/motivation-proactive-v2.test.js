const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const { initialMotivation,normalizeMotivation,decideActivity,applyMotivation,getMotivationContext }=require("../services/motivation");
const {loadLifeState,tickLife,getLifeState}=require("../services/life-simulation");
const {eligibleForProactive,chooseProactiveMessage,updateProactiveAfterSend,proactiveStatus}=require("../services/proactive-policy");
const {CHARACTER}=require("../services/character-core");
function fileFor(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hina-v2-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return path.join(dir,"life.json");
}
const day=Date.parse("2026-11-14T01:00:00Z");
test("motivation tracks distinct drives and remains bounded",()=>{
  const s={interests:Object.fromEntries(Object.keys(CHARACTER.interests).map(k=>[k,{affinity:1,explored:0}])),experiences:[],motivation:initialMotivation()};
  const seen=[];
  for(let i=0;i<90;i++){
    const decision=decideActivity(s,"2026-11-"+String(14+i%15).padStart(2,"0"),i%3);
    seen.push(decision.key);
    s.experiences.push({interest:decision.key});
    applyMotivation(s,decision);
  }
  assert.ok(new Set(seen).size>=3);
  assert.equal(s.motivation.decisions,90);
  assert.ok(Object.values(s.motivation.drives).every(v=>v>=0&&v<=1));
  assert.match(getMotivationContext(s),/Motivasi karakter/);
});
test("v1 life state migrates to v2 motivation without losing experiences",t=>{
 const file=fileFor(t);
 const original={version:1,createdAt:day,lastTickAt:day,paused:false,
  interests:Object.fromEntries(Object.keys(CHARACTER.interests).map(k=>[k,{affinity:1,explored:0,level:0}])),
  experiences:[{id:"old",at:day,kind:"simulated_reflection",interest:"moon",reflection:"legacy"}],
  milestones:[],beliefs:CHARACTER.values};
 fs.writeFileSync(file,JSON.stringify(original));
 const loaded=loadLifeState(day,file);
 assert.equal(loaded.experiences[0].id,"old");
 assert.deepEqual(loaded.motivation,initialMotivation());
 const events=tickLife(day+13*3600000,file);
 assert.ok(events.length>=2);
 assert.ok(events[0].motive);
 assert.ok(events[0].reason);
 assert.ok(getLifeState().motivation.decisions>=2);
 assert.equal(JSON.parse(fs.readFileSync(file)).experiences[0].id,"old");
});
test("proactive defaults OFF even when intimacy is high",()=>{
 const now=Date.parse("2026-11-14T05:00:00Z"); // 12:00 WIB
 const p={intimacy:10,lastInteractionAt:now-36*3600000};
 assert.equal(eligibleForProactive(p,now).reason,"not_opted_in");
 assert.match(proactiveStatus(p),/OFF/);
});
test("opt-in respects quiet hours, cooldown, weekly limits, and user silence",()=>{
 const now=Date.parse("2026-11-14T05:00:00Z");
 const p={proactiveOptIn:true,lastInteractionAt:now-36*3600000,relationship:{stage:"normal"}};
 assert.equal(eligibleForProactive(p,now).ok,true);
 assert.equal(eligibleForProactive(p,Date.parse("2026-11-14T16:00:00Z")).reason,"quiet_hours");
 updateProactiveAfterSend(p,now);
 assert.equal(p.lastInteractionAt,now-36*3600000);
 assert.equal(eligibleForProactive(p,now+3600000).reason,"cooldown");
 p.lastProactiveAt=now-80*3600000;
 p.proactiveLog=[now-6*86400000,now-80*3600000];
 assert.equal(eligibleForProactive(p,now).reason,"weekly_limit");
 p.proactiveLog=[];
 p.muted=true;
 assert.equal(eligibleForProactive(p,now).reason,"muted_or_banned");
 p.muted=false;p.relationship.stage="cold";
 assert.equal(eligibleForProactive(p,now).reason,"relationship_not_normal");
});
test("proactive requires a recent life event and never guilt-trips",()=>{
 const now=Date.parse("2026-11-14T05:00:00Z");
 assert.equal(chooseProactiveMessage({experiences:[]},now),null);
 const msg=chooseProactiveMessage({experiences:[{id:"one",interest:"music",at:now-3600000}]},now);
 assert.equal(msg.interest,"music");
 assert.doesNotMatch(msg.text,/ditinggalin|lupa.*aku|kok.*gak.*chat|kangen.*banget/i);
 assert.equal(chooseProactiveMessage({experiences:[{id:"old",interest:"music",at:now-4*86400000}]},now),null);
});
test("legacy guilt-trip texts removed and opt-in WhatsApp control exists",()=>{
 const handler=fs.readFileSync(path.join(__dirname,"../handlers/services.js"),"utf8");
 const entry=fs.readFileSync(path.join(__dirname,"../index.js"),"utf8");
 assert.doesNotMatch(handler,/Kok aku ditinggalin|Udah lupa ya sama akuu/);
 assert.match(handler,/eligibleForProactive/);
 assert.match(entry,/proactiveOptIn = true/);
 assert.match(entry,/proactiveOptIn = false/);
});
