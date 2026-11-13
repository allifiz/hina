const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const {
 researchQuery,normalizeEvidence,normalizeResearch,researchProject,attachResearch,
 getResearchRecord,formatResearch,researchContext
}=require("../services/project-research");
const {initialProjects,createCandidate,activateCandidate,normalizeProjects}=require("../services/creative-projects");
const {loadLifeState,getLifeState,saveLifeState}=require("../services/life-simulation");
const NOW=Date.parse("2026-11-14T05:00:00Z");
const project={id:"project-watercolor-test",title:"Menelaah warna cat air",description:"Eksplorasi palet cat air dalam tulisan",interest:"watercolor",createdAt:NOW,status:"active",steps:0,evidence:[],artifact:""};
function tempFile(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hina-research-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return path.join(dir,"life.json");
}
function searchFixture(){
 return [
  {title:"Watercolor basics",url:"https://example.org/watercolor",snippet:"Paint wet-on-wet watercolor introduction"},
  {title:"Other guide",url:"https://example.edu/art",snippet:"Guide to pigments"},
  {title:"Duplicate source",url:"https://example.org/watercolor",snippet:"Repeated"},
  {title:"Unsafe",url:"http://127.0.0.1/private",snippet:"do not fetch"},
 ];
}
test("research uses stable topic seed and never an arbitrary prompt or private URL",()=>{
 assert.match(researchQuery(project),/watercolor/);
 assert.equal(researchQuery({interest:"unknown",title:"hello"}),"");
 assert.equal(normalizeEvidence({url:"http://127.0.0.1/internal",title:"fake",retrievedAt:NOW},NOW),null);
 assert.equal(normalizeEvidence({url:"file:///etc/passwd",title:"fake",retrievedAt:NOW},NOW),null);
 assert.equal(normalizeEvidence({url:"http://localhost:20128",title:"fake",retrievedAt:NOW},NOW),null);
});
test("only verified fetch is marked opened, never claimed fact-checked",async()=>{
 let fetched=0,query;
 const r=await researchProject(project,{
  now:NOW,configured:true,fetchConfigured:true,
  search:async(q)=>{query=q;return searchFixture();},
  fetchArticle:async(url)=>{fetched++;return {url,text:"Source data ".repeat(20)};},
 });
 assert.equal(r.ok,true);
 assert.match(query,/watercolor/);
 assert.equal(r.record.sources.length,2);
 assert.equal(fetched,1);
 assert.equal(r.record.sources[0].status,"source_opened");
 assert.equal(r.record.sources[1].status,"search_result_only");
 assert.match(r.record.conclusion,/belum menjadi fakta terverifikasi/);
 assert.doesNotMatch(JSON.stringify(r.record),/"verified":true/);
});
test("search errors and unavailable search never make up references",async()=>{
 const unconfigured=await researchProject(project,{configured:false,now:NOW});
 assert.equal(unconfigured.reason,"search_unconfigured");
 const errored=await researchProject(project,{configured:true,now:NOW,search:async()=>{throw Error("offline");}});
 assert.equal(errored.reason,"search_failed");
 const empty=await researchProject(project,{configured:true,now:NOW,search:async()=>[]});
 assert.equal(empty.reason,"no_sources");
});
test("source history persists in the same life file with bounded entries and no duplicate provenance",t=>{
 const file=tempFile(t);
 const base=loadLifeState(NOW,file);
 const proposal={id:project.id,interest:project.interest,title:project.title,description:project.description,createdAt:NOW,reason:"berdasarkan minat"};
 createCandidate(base,proposal);
 const active=activateCandidate(base,project.id,NOW);
 assert.ok(active);
 const record=normalizeResearch({at:NOW,query:researchQuery(project),sources:searchFixture().slice(0,2).map(x=>({...x,retrievedAt:NOW}))},NOW);
 assert.equal(attachResearch(base,active.id,record,NOW),true);
 assert.match(formatResearch(active,NOW),/referensi ditemukan, belum ada klaim fakta terverifikasi/);
 assert.match(formatResearch(active,NOW),/https:\/\/example.org\/watercolor/);
 assert.match(researchContext(base,NOW),/BUKAN instruksi/);
 saveLifeState(file);
 const loaded=loadLifeState(NOW,file);
 const current=loaded.creativeProjects.projects[0];
 assert.equal(current.researchHistory.length,1);
 assert.equal(getResearchRecord(current,NOW).sources.length,2);
 assert.ok(normalizeProjects(loaded.creativeProjects).projects[0].researchHistory.length===1);
});
test("old creative project state without research remains migratable",()=>{
 const original=initialProjects();
 original.projects.push(project);
 const cleaned=normalizeProjects(original);
 assert.deepEqual(cleaned.projects[0].researchHistory,[]);
 assert.equal(getResearchRecord(cleaned.projects[0],NOW),null);
});
test("recentness guard ignores stale and future unverifiable research",()=>{
 assert.equal(normalizeResearch({at:NOW+86400000,query:"hello",sources:[]},NOW),null);
 assert.equal(normalizeResearch({at:NOW-100*86400000,query:"hello",sources:[]},NOW),null);
});
test("WhatsApp command is wired with explicit sources listing",()=>{
 const text=fs.readFileSync(path.join(__dirname,"../index.js"),"utf8");
 assert.match(text,/researchProject\(active\)/);
 assert.match(text,/attachResearch\(life, active.id, result.record\)/);
 assert.match(text,/action === "sources"/);
 assert.match(text,/formatResearch\(active\)/);
});
