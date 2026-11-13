const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const {CHARACTER}=require("../services/character-core");
const {initialMotivation}=require("../services/motivation");
const {freshGoalState,normalizeGoalState,isoWeekKey,reflectGoal,evaluateWeek,getGoalSummary,getGoalContext,TARGET}=require("../services/character-growth");
const {loadLifeState,tickLife,getLifeState,chooseActivity}=require("../services/life-simulation");
const START=Date.parse("2026-11-14T01:00:00Z"); // Saturday 08 WIB
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hina-goals-v2-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return path.join(dir,"life.json");
}
test("character goals are anchored to real character interests, not fabricated offline events",()=>{
 const state=freshGoalState(START);
 assert.equal(Object.keys(state.goals).length,Object.keys(CHARACTER.interests).length);
 assert.equal(state.goals.watercolor.progress,0);
 assert.match(getGoalContext({goalState:state}),/simulasi fiksi/);
 assert.match(getGoalContext({goalState:state}),/Jangan membuat klaim/);
});
test("event evidence advances exactly one matching goal and milestone only at target",()=>{
 const state={interests:{},goalState:freshGoalState(START),motivation:initialMotivation()};
 for(let i=0;i<TARGET-1;i++){
   const m=reflectGoal(state,{id:"id-"+i,at:START+i*60000,source:"life_simulation",interest:"watercolor"});
   assert.equal(m,null);
 }
 assert.equal(state.goalState.goals.watercolor.phase,0);
 const final=reflectGoal(state,{id:"id-last",at:START+TARGET*60000,source:"life_simulation",interest:"watercolor"});
 assert.equal(final.phase,1);
 assert.equal(final.evidence,"id-last");
 assert.equal(state.goalState.goals.watercolor.progress,0);
 assert.equal(state.goalState.goals.music.progress,0);
 assert.equal(reflectGoal(state,{id:"bogus",at:START+600000,source:"user_chat",interest:"watercolor"}),null);
 assert.equal(state.goalState.milestones.length,1);
});
test("review runs once when WIB calendar week changes and never invents weekly activity",()=>{
 const state={interests:{},goalState:freshGoalState(START),motivation:initialMotivation()};
 const after=Date.parse("2026-11-15T17:01:00Z"); // Monday 00:01 WIB
 assert.equal(isoWeekKey(START),"2026-11-09");
 assert.equal(isoWeekKey(after),"2026-11-16");
 const review=evaluateWeek(state,after);
 assert.equal(review.week,"2026-11-09");
 assert.equal(review.result,"belum ada refleksi tercatat");
 assert.equal(evaluateWeek(state,after+60000),null);
 assert.equal(state.goalState.reviews.length,1);
 assert.equal(state.goalState.lastReviewWeek,"2026-11-16");
});
test("bounded goal progress, reviews and preservation of canon",()=>{
 const state={interests:{},goalState:freshGoalState(START),motivation:initialMotivation()};
 for(let i=0;i<100;i++){
   reflectGoal(state,{id:"event-"+i,at:START+i*86400000,source:"life_simulation",interest:"moon"});
 }
 assert.equal(state.goalState.goals.moon.completed,true);
 assert.equal(state.goalState.goals.moon.phase,3);
 assert.equal(state.goalState.goals.moon.progress,0);
 assert.ok(state.goalState.reviews.length<=24);
 assert.equal(state.goalState.milestones.length,3);
 assert.match(getGoalSummary(state),/Milestone tujuan: 3/);
});
test("legacy life state gets new goals without losing its original experiences",t=>{
 const file=setup(t);
 const old=loadLifeState(START,file);
 tickLife(START+13*3600000,file);
 const baseline=JSON.parse(fs.readFileSync(file,"utf8"));
 delete baseline.goalState;
 fs.writeFileSync(file,JSON.stringify(baseline));
 const restored=loadLifeState(START+13*3600000,file);
 assert.equal(restored.experiences.length,3);
 assert.equal(restored.goalState.version,2);
 assert.ok(Object.values(restored.goalState.goals).every(x=>x.progress===0));
 const next=tickLife(START+86400000+13*3600000,file);
 assert.equal(next.length,3);
 const total=Object.values(getLifeState().goalState.goals).reduce((n,g)=>n+g.progress,0);
 assert.equal(total,3);
 assert.equal(getLifeState().experiences.length,6);
});
test("reload idempotence does not award repeated progress for the same scheduled slot",t=>{
 const file=setup(t);
 loadLifeState(START,file);
 const at=START+13*3600000;
 tickLife(at,file);
 const before=JSON.stringify(getLifeState().goalState);
 loadLifeState(at,file);
 assert.equal(tickLife(at,file).length,0);
 assert.equal(JSON.stringify(getLifeState().goalState),before);
});
test("decision engine gets a modest priority for active goal without hardcoding choices",t=>{
 const file=setup(t);
 const state=loadLifeState(START,file);
 state.goalState.focus="language";
 const result=chooseActivity(state,"2026-11-14",0);
 assert.ok(CHARACTER.interests[result.key]);
 assert.match(getGoalSummary(state),/Fokus: mengembangkan ekspresi Sunda-Indonesia/);
});
test("WhatsApp exposes /goals and includes goal state in life context",()=>{
 const handler=fs.readFileSync(path.join(__dirname,"..","index.js"),"utf8");
 const life=fs.readFileSync(path.join(__dirname,"..","services","life-simulation.js"),"utf8");
 assert.match(handler,/lowerMsg === "\/goals"/);
 assert.match(handler,/getGoalSummary\(getLifeState\(\)\)/);
 assert.match(life,/getGoalContext\(current\)/);
 assert.match(life,/reflectGoal\(current, event\)/);
});
test("normalization rejects unknown untrusted goal keys, invalid progress and old schema",()=>{
 const clean=normalizeGoalState({version:2,focus:"politics",goals:{watercolor:{phase:99,progress:99999},politics:{completed:true}}},START);
 assert.equal(clean.focus,"watercolor");
 assert.equal(clean.goals.politics,undefined);
 assert.equal(clean.goals.watercolor.phase,3);
 assert.equal(clean.goals.watercolor.progress,TARGET-1);
 assert.equal(freshGoalState(START).version,2);
});
