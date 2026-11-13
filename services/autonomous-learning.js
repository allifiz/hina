// Autonomous Learning Cycle V1. Off by default; at most one research cycle
// per seven days. No automatic messages or LLM calls.
const {verifyProjectKnowledge,attachReview}=require("./knowledge-verification");
const WEEK=7*86400000;
const defaults=()=>({version:1,enabled:false,lastAttemptAt:0,lastSuccessAt:0,
 cycles:0,failed:0,lastStatus:"not_started",history:[]});
function normalizeLearning(raw){
 const s=defaults();if(raw?.version!==1)return s;
 const safeDate=x=>Number.isFinite(x)&&x>=0?x:0;
 return {version:1,enabled:raw.enabled===true,lastAttemptAt:safeDate(raw.lastAttemptAt),
  lastSuccessAt:safeDate(raw.lastSuccessAt),cycles:Math.max(0,Math.min(9999,Math.floor(Number(raw.cycles)||0))),
  failed:Math.max(0,Math.min(9999,Math.floor(Number(raw.failed)||0))),
  lastStatus:typeof raw.lastStatus==="string"?raw.lastStatus.slice(0,60):"not_started",
  history:(Array.isArray(raw.history)?raw.history:[]).filter(x=>Number.isFinite(x.at)&&
   typeof x.status==="string").slice(-12).map(x=>({at:x.at,status:x.status.slice(0,60)}))};
}
function learningEligibility(state,now=Date.now(),force=false){
 const s=normalizeLearning(state?.autonomousLearning);
 if(!s.enabled&&!force)return {ok:false,reason:"disabled"};
 if(state?.paused)return {ok:false,reason:"life_paused"};
 if(!force && s.lastAttemptAt>0 && now-s.lastAttemptAt<WEEK)return {ok:false,reason:"weekly_cooldown"};
 const active=state?.creativeProjects?.projects?.find(p=>p.status==="active");
 if(!active)return {ok:false,reason:"no_active_project"};
 return {ok:true,project:active};
}
function toggleLearning(state,enabled,now=Date.now()){
 const s=normalizeLearning(state.autonomousLearning);
 s.enabled=Boolean(enabled);
 // Do not retroactively trigger research for every missed week.
 if(s.enabled&&!state.autonomousLearning?.enabled)s.lastAttemptAt=now;
 state.autonomousLearning=s;
 return s;
}
async function runLearningCycle(state,{now=Date.now(),verify=verifyProjectKnowledge,
 persist=()=>{},force=false}={}){
 const check=learningEligibility(state,now,force);
 if(!check.ok)return {ok:false,reason:check.reason};
 // Reserve the attempt BEFORE any await: concurrent scheduler ticks cannot
 // exceed cadence/cost budget.
 const s=normalizeLearning(state.autonomousLearning);
 s.lastAttemptAt=now;s.lastStatus="in_progress";
 state.autonomousLearning=s;
 persist();
 let result;
 try{result=await verify(check.project,{now});}
 catch{result={ok:false,reason:"verification_failed"};}
 const current=state.creativeProjects?.projects?.find(p=>p.id===check.project.id&&p.status==="active");
 if(result?.ok&&current&&attachReview(state,current.id,result.review,now)){
   s.lastStatus="sources_reviewed";s.lastSuccessAt=now;s.cycles++;
 }else{s.lastStatus=result?.reason||"no_review";s.failed++;}
 s.history.push({at:now,status:s.lastStatus});s.history=s.history.slice(-12);
 persist();
 return {ok:s.lastStatus==="sources_reviewed",reason:s.lastStatus};
}
function learningSummary(state){
 const s=normalizeLearning(state.autonomousLearning);
 return ["Autonomous Learning: "+(s.enabled?"ON":"OFF"),
  "Cadence: maksimal 1 pencarian + 3 pengambilan sumber per 7 hari",
  "Siklus berhasil: "+s.cycles,"Gagal: "+s.failed,
  "Status: "+s.lastStatus,
  "Pencarian dan perbandingan teks bukan verifikasi kebenaran final."].join("\n");
}
function startLearningScheduler({getState,save,intervalMs=2*3600000}={}){
 if(typeof getState!=="function"||typeof save!=="function")throw Error("state hooks required");
 let running=false;
 const timer=setInterval(async()=>{
   if(running)return;
   running=true;
   try{await runLearningCycle(getState(),{persist:save});}
   catch(error){console.error("[LEARNING]",error.message);}
   finally{running=false;}
 },Math.max(3600000,intervalMs));
 timer.unref?.();return timer;
}
module.exports={defaults,normalizeLearning,learningEligibility,toggleLearning,
 runLearningCycle,learningSummary,startLearningScheduler};
