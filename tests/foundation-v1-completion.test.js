const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const {buildClaimEvidence,normalizeReview,verifyProjectKnowledge,attachReview,getReview,getKnowledgeContext}=require("../services/knowledge-verification");
const {defaults,normalizeLearning,learningEligibility,toggleLearning,runLearningCycle}=require("../services/autonomous-learning");
const {composeCognitiveContext,cognitionDecision,MAX_CONTEXT}=require("../services/unified-cognition");
const {inspectFoundation,consolidateMemory,foundationSummary}=require("../services/foundation-health");
const {loadLifeState,getLifeState,saveLifeState,tickLife}=require("../services/life-simulation");
const {createCandidate,activateCandidate}=require("../services/creative-projects");
const NOW=Date.parse("2026-11-14T05:00:00Z");
const sentence="Watercolor pigments blend across wet paper and produce softened edges during painting sessions.";
const articleText=Array(5).fill(sentence).join(" ");
const project={id:"project-watercolor-test",interest:"watercolor",title:"Eksplorasi teknik cat air",description:"Mencari tahu prinsip teknik cat air",createdAt:NOW,status:"active",steps:0};
function source(url,text=articleText){return {url,title:"Intro watercolor",text,publishedAt:"2026-10-15"};}
function temp(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hina-foundation-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return path.join(dir,"life.json");
}
test("cross-source similarity is not a declaration of verified truth",()=>{
 const report=buildClaimEvidence([
  source("https://watercolors.example.org/one"),
  source("https://gallery.example.edu/two"),
 ],NOW);
 assert.equal(report.sources.length,2);
 assert.ok(report.claims.length>0);
 assert.ok(report.claims.some(c=>c.status==="corroborated_text"));
 assert.ok(report.claims.every(c=>c.certainty==="unverified_semantics"));
 assert.match(report.warnings.join(" "),/bukan bukti kebenaran/);
 const normalized=normalizeReview(report,NOW);
 assert.equal(normalized.sources.length,2);
 assert.ok(normalized.claims.every(c=>c.certainty==="unverified_semantics"));
});
test("knowledge review is visible as cautious sourced context, not promoted to fact",()=>{
 const review=buildClaimEvidence([source("https://alpha.example.org/one"),source("https://beta.example.edu/two")],NOW);
 const projectCopy={...project,knowledgeReviews:[review]};
 const state={creativeProjects:{projects:[projectCopy]}};
 const result=getKnowledgeContext(state,NOW);
 assert.match(result,/Calon klaim/);
 assert.match(result,/TIDAK membuktikan kebenaran/);
 assert.match(result,/https:\/\/alpha\.example\.org/);
});
test("independent URLs must use different domains and public addresses",()=>{
 const report=buildClaimEvidence([
  source("https://example.org/one"),
  source("https://www.example.org/two"),
  source("http://127.0.0.1/internal"),
 ],NOW);
 assert.equal(report.sources.length,1);
 assert.equal(report.status,"insufficient_sources");
});
test("verification fails closed without search or fetch; actual readable source counts",async()=>{
 assert.equal((await verifyProjectKnowledge(project,{searchConfigured:false,now:NOW})).reason,"search_or_fetch_unconfigured");
 const result=await verifyProjectKnowledge(project,{now:NOW,searchConfigured:true,fetchConfigured:true,
  search:async()=>[{url:"https://example.org/one"},{url:"https://example.edu/two"}],
  fetchArticle:async url=>source(url)});
 assert.equal(result.ok,true);
 assert.equal(result.review.sources.length,2);
 const failed=await verifyProjectKnowledge(project,{now:NOW,searchConfigured:true,fetchConfigured:true,
  search:async()=>[{url:"https://example.org/one"}],fetchArticle:async()=>{throw Error("offline")}});
 assert.equal(failed.reason,"no_readable_sources");
});
test("learning starts disabled, respects calendar cooldown, and reserves before awaiting",async()=>{
 const state={paused:false,autonomousLearning:defaults(),creativeProjects:{projects:[{...project,knowledgeReviews:[]}]}};
 assert.equal(learningEligibility(state,NOW).reason,"disabled");
 toggleLearning(state,true,NOW);
 assert.equal(learningEligibility(state,NOW).reason,"weekly_cooldown");
 let saves=0,verifyCalls=0,release;
 const waiting=new Promise(resolve=>{release=resolve});
 const verification={ok:true,review:buildClaimEvidence([source("https://a.example.org/a"),source("https://b.example.edu/b")],NOW)};
 const first=runLearningCycle(state,{now:NOW+7*86400000+1,persist:()=>saves++,
  verify:async()=>{verifyCalls++;await waiting;return verification;}});
 assert.equal(learningEligibility(state,NOW+7*86400000+2).reason,"weekly_cooldown");
 release();
 const result=await first;
 assert.equal(result.ok,true);
 assert.equal(verifyCalls,1);
 assert.equal(saves,2);
 assert.equal(state.autonomousLearning.cycles,1);
 assert.equal(state.creativeProjects.projects[0].knowledgeReviews.length,1);
});
test("manual forced request and failed lookup never create imaginary evidence",async()=>{
 const state={paused:false,creativeProjects:{projects:[{...project,knowledgeReviews:[]}]}};
 toggleLearning(state,true,NOW);
 const result=await runLearningCycle(state,{now:NOW+1000,force:true,
  verify:async()=>({ok:false,reason:"search_failed"})});
 assert.equal(result.ok,false);
 assert.equal(state.autonomousLearning.failed,1);
 assert.equal(state.creativeProjects.projects[0].knowledgeReviews.length,0);
 assert.equal(normalizeLearning(state.autonomousLearning).enabled,true);
});
test("cognitive engine maintains provenance and bounded prompt",()=>{
 const state=cognitionDecision({userEmotion:"sedih",intent:"curhat",relationshipState:{stage:"normal"},hasResearch:true});
 assert.equal(state.tone,"warm_and_attentive");
 assert.equal(state.factualCaution,true);
 const prompt=composeCognitiveContext({persona:"aku Hina",life:"x".repeat(100000),
  temporal:"hari ini",emotion:"sedih",userEmotion:"sedih",research:"https://example.org/source"});
 assert.ok(prompt.length<=MAX_CONTEXT);
 assert.match(prompt,/User-chat adalah laporan pengguna/);
 assert.match(prompt,/life simulation adalah fiksi/);
 assert.match(prompt,/aku Hina/);
});
test("foundation audit and consolidation only index actual simulation events",()=>{
 const s={version:1,paused:false,experiences:[{id:"one",at:NOW,interest:"moon",source:"life_simulation"},
 {id:"two",at:NOW+1,interest:"watercolor",source:"life_simulation"}],
 goalState:{version:2,goals:{}},creativeProjects:{version:1,projects:[],candidates:[]},autonomousLearning:defaults()};
 assert.equal(inspectFoundation(s,NOW).ok,true);
 assert.equal(consolidateMemory(s,NOW).updated,true);
 assert.equal(s.memoryIndex.length,2);
 assert.deepEqual(s.memoryIndex.flatMap(x=>x.eventIds).sort(),["one","two"]);
 assert.match(foundationSummary(s,NOW),/HEALTHY/);
 s.experiences.push({...s.experiences[0]});
 assert.equal(inspectFoundation(s,NOW).ok,false);
 assert.ok(inspectFoundation(s,NOW).problems.includes("duplicate_experience_ids"));
});
test("state backup preserves existing user data after corruption and restart",t=>{
 const file=temp(t);
 loadLifeState(NOW,file);
 tickLife(NOW+13*3600000,file);
 const before=getLifeState().experiences.length;
 saveLifeState(file);
 assert.ok(fs.existsSync(file+".bak"));
 fs.writeFileSync(file,"{not-json");
 const restored=loadLifeState(NOW+13*3600000,file);
 assert.equal(restored.experiences.length,before);
 assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(file,"utf8")));
});
test("old state migrates new learning fields while preserving experience history",t=>{
 const file=temp(t);
 loadLifeState(NOW,file);
 tickLife(NOW+13*3600000,file);
 const json=JSON.parse(fs.readFileSync(file,"utf8"));
 delete json.autonomousLearning;delete json.memoryIndex;
 fs.writeFileSync(file,JSON.stringify(json));
 const loaded=loadLifeState(NOW+13*3600000,file);
 assert.equal(loaded.experiences.length,2);
 assert.equal(loaded.autonomousLearning.enabled,false);
 assert.deepEqual(loaded.memoryIndex,[]);
});
test("WhatsApp commands and startup are wired safely",()=>{
 const app=fs.readFileSync(path.join(__dirname,"..","index.js"),"utf8");
 assert.match(app,/startLearningScheduler\(\{getState:getLifeState,save:saveLifeState\}\)/);
 assert.match(app,/action === "verify"/);
 assert.match(app,/action==="on"\|\|action==="off"/);
 assert.match(app,/composeCognitiveContext\(\{/);
 assert.match(app,/lowerMsg==="\/foundation"/);
});
