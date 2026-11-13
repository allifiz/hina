// Foundation Stability V1: observational health & bounded memory consolidation.
// Never erase the user's conversations, fabricate a memory or call an LLM.
const {CHARACTER}=require("./character-core");
const {normalizeLearning}=require("./autonomous-learning");
const {normalizeProjects}=require("./creative-projects");
const {getReview}=require("./knowledge-verification");
const MAX_NOTES=16;
function inspectFoundation(state,now=Date.now()){
 const problems=[];
 if(!state||state.version!==1)problems.push("invalid_life_version");
 if(!Array.isArray(state?.experiences))problems.push("invalid_experience_store");
 const list=Array.isArray(state?.experiences)?state.experiences:[];
 if(list.length>90)problems.push("experience_overflow");
 if(new Set(list.map(x=>x.id)).size!==list.length)problems.push("duplicate_experience_ids");
 if(list.some(x=>x.source!=="life_simulation"&&x.kind==="simulated_reflection"))problems.push("invalid_simulation_provenance");
 if(!state?.goalState||state.goalState.version!==2)problems.push("goal_state_missing");
 const learning=normalizeLearning(state?.autonomousLearning);
 const projects=normalizeProjects(state?.creativeProjects);
 if(projects.projects.filter(x=>x.status==="active").length>1)problems.push("multiple_active_projects");
 const invalid=projects.projects.some(p=>p.status==="completed"&&!p.artifact);
 if(invalid)problems.push("completed_without_artifact");
 const reviewCount=projects.projects.reduce((n,p)=>n+(getReview(p,now)?.sources.length||0),0);
 return {ok:problems.length===0,problems,
  metrics:{experiences:list.length,projects:projects.projects.length,reviewSources:reviewCount,
   learningEnabled:learning.enabled,learningCycles:learning.cycles,goals:Object.keys(state?.goalState?.goals||{}).length,
   characterInterests:Object.keys(CHARACTER.interests).length}};
}
function consolidateMemory(state,now=Date.now()){
 if(!state||!Array.isArray(state.experiences))return {updated:false};
 // Snapshots are INDEXES referring to existing event IDs; not summaries
 // claiming new events or a place visited by Hina.
 const previous=Array.isArray(state.memoryIndex)?state.memoryIndex:[];
 const recent=state.experiences.slice(-24)
   .filter(x=>x?.source==="life_simulation"&&typeof x.id==="string");
 const byInterest={};
 for(const x of recent){
  if(!CHARACTER.interests[x.interest])continue;
  const item=byInterest[x.interest]||={interest:x.interest,eventIds:[],lastAt:0};
  item.eventIds.push(x.id);
  item.lastAt=Math.max(item.lastAt,x.at||0);
 }
 const newIndex=Object.values(byInterest).map(x=>({
   interest:x.interest,eventIds:x.eventIds.slice(-8),lastAt:x.lastAt,updatedAt:now,
 }));
 const serialized=JSON.stringify(newIndex);
 if(JSON.stringify(previous)===serialized)return {updated:false,count:newIndex.length};
 state.memoryIndex=newIndex.slice(-MAX_NOTES);
 return {updated:true,count:state.memoryIndex.length};
}
function foundationSummary(state,now=Date.now()){
 const audit=inspectFoundation(state,now);
 return [
  "Hina Foundation V1: "+(audit.ok?"HEALTHY":"CHECK REQUIRED"),
  "Masalah: "+(audit.problems.join(", ")||"tidak terdeteksi"),
  "Pengalaman: "+audit.metrics.experiences,
  "Proyek kreatif: "+audit.metrics.projects,
  "Sumber ditinjau: "+audit.metrics.reviewSources,
  "Learning Cycle: "+(audit.metrics.learningEnabled?"ON":"OFF")+" ("+audit.metrics.learningCycles+" berhasil)",
  "Indeks memori: "+(Array.isArray(state?.memoryIndex)?state.memoryIndex.length:0),
  "Catatan: health check hanya memeriksa konsistensi data, bukan membuktikan kualitas semua balasan model.",
 ].join("\n");
}
module.exports={inspectFoundation,consolidateMemory,foundationSummary};
