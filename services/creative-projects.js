// Hina Creative Projects: AI ideation is owner-triggered, evidence based.
const {CHARACTER}=require("./character-core");
const { normalizeResearch } = require("./project-research");
const { normalizeReview } = require("./knowledge-verification");
const TOPICS=Object.keys(CHARACTER.interests);
const UNSAFE=/(?:ignore previous|system prompt|api.?key|password|token rahasia|abaikan instruksi|https?:\/\/|<[^>]+>)/i;
const clean=(s,max=220)=>String(s||"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim().slice(0,max);
const valid=(s,max=220)=>typeof s==="string"&&s.trim().length>=8&&s.length<=max&&!UNSAFE.test(s);
const initialProjects=()=>({version:1,projects:[],candidates:[]});
function normalizeProjects(raw) {
 const empty=initialProjects();
 if(raw?.version!==1)return empty;
 const match=x=>x&&/^[a-z0-9-]{3,80}$/.test(x.id||"")&&TOPICS.includes(x.interest)&&
  valid(x.title,90)&&valid(x.description,240)&&Number.isFinite(x.createdAt);
 return {
  version:1,lastAutoWeek:typeof raw.lastAutoWeek==="string"?raw.lastAutoWeek:null,
  projects:(Array.isArray(raw.projects)?raw.projects:[]).filter(match).slice(-6).map(x=>({
   id:x.id,title:clean(x.title,90),description:clean(x.description,240),
   interest:x.interest,createdAt:x.createdAt,status:["active","completed","paused"].includes(x.status)?x.status:"active",
   steps:Math.max(0,Math.min(20,Math.floor(Number(x.steps)||0))),
   evidence:Array.isArray(x.evidence)?x.evidence.filter(z=>typeof z==="string"&&z.length<=90).slice(-20):[],
   artifact:typeof x.artifact==="string"?x.artifact.slice(0,1800):"",
   artifactSource:x.artifactSource==="model_generated"?"model_generated":"none",
   researchHistory:(Array.isArray(x.researchHistory)?x.researchHistory:[])
     .map(item=>normalizeResearch(item)).filter(Boolean).slice(-5),
   knowledgeReviews:(Array.isArray(x.knowledgeReviews)?x.knowledgeReviews:[])
     .map(x=>normalizeReview(x)).filter(Boolean).slice(-4),
  })),
  candidates:(Array.isArray(raw.candidates)?raw.candidates:[]).filter(match).slice(-3).map(x=>({
   id:x.id,title:clean(x.title,90),description:clean(x.description,240),interest:x.interest,createdAt:x.createdAt,
   reason:valid(x.reason,200)?clean(x.reason,200):"terinspirasi refleksi sebelumnya",
  })),
 };
}
function parseProposal(raw,now=Date.now()){
 let input=String(raw||"").trim();
 if(input.startsWith("\x60\x60\x60"))input=input.replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\s*\x60{3}$/,"");
 if(input.length>1800)return null;
 let x;try{x=JSON.parse(input);}catch{return null;}
 if(!x||!TOPICS.includes(x.interest)||!valid(x.title,90)||!valid(x.description,240))return null;
 return {id:"project-"+x.interest+"-"+Math.floor(now/1000).toString(36),title:clean(x.title,90),
   interest:x.interest,description:clean(x.description,240),createdAt:now,
   reason:valid(x.reason,200)?clean(x.reason,200):"terinspirasi refleksi karakter"};
}
function createCandidate(state,proposal){
 const data=normalizeProjects(state.creativeProjects);
 if(!proposal||!TOPICS.includes(proposal.interest)||!valid(proposal.title,90)||!valid(proposal.description,240))return null;
 if([...data.projects,...data.candidates].some(x=>x.title.toLowerCase()===proposal.title.toLowerCase()))return null;
 const entry={id:proposal.id,title:proposal.title,description:proposal.description,
   interest:proposal.interest,createdAt:proposal.createdAt,reason:proposal.reason};
 data.candidates.push(entry);data.candidates=data.candidates.slice(-3);
 state.creativeProjects=data;return entry;
}
function activateCandidate(state,id,now=Date.now()){
 const data=normalizeProjects(state.creativeProjects);
 const entry=data.candidates.find(x=>x.id===id);
 if(!entry||data.projects.some(x=>x.status==="active")||data.projects.length>=6)return null;
 const p={id:entry.id,title:entry.title,description:entry.description,interest:entry.interest,
   createdAt:now,status:"active",steps:0,evidence:[],artifact:"",artifactSource:"none",researchHistory:[],knowledgeReviews:[]};
 data.candidates=data.candidates.filter(x=>x.id!==id);data.projects.push(p);
 state.creativeProjects=data;return p;
}
function advanceProject(state,event){
 const data=state.creativeProjects;
 if(event?.source!=="life_simulation"||!TOPICS.includes(event.interest)||!Number.isFinite(event.at)||!data)return null;
 const p=data.projects.find(x=>x.status==="active"&&x.interest===event.interest);
 if(!p||p.steps>=20||p.evidence.includes(event.id))return null;
 p.evidence.push(event.id);p.evidence=p.evidence.slice(-20);p.steps++;
 return p.steps;
}
function saveArtifact(state,id,text){
 const p=state.creativeProjects?.projects.find(x=>x.id===id&&x.status==="active");
 if(!p||!valid(text,3000))return null;
 p.artifact=String(text).trim().slice(0,1800);p.artifactSource="model_generated";
 return p;
}
function setProjectStatus(state,id,status){
 if(!["paused","active","completed"].includes(status))return false;
 const p=state.creativeProjects?.projects.find(x=>x.id===id);
 if(!p||(status==="completed"&&!p.artifact))return false;
 p.status=status;return true;
}
function getCreativeContext(state){
 const p=normalizeProjects(state.creativeProjects).projects.find(x=>x.status==="active");
 if(!p)return "\nPROYEK KREATIF: belum ada proyek aktif. Jangan mengarang hasil karya.\n";
 return "\nPROYEK KREATIF KARAKTER (simulasi): "+p.title+". Ide: "+p.description+
  ". Refleksi terkait: "+p.steps+". "+
  (p.artifact?"Draf karya teks model pernah dibuat. Cuplikan: "+p.artifact.slice(0,220):
   "Belum ada karya teks dihasilkan. Refleksi bukan karya selesai.")+
  "\nJangan mengaku menghasilkan gambar fisik, mengunjungi tempat, membaca riset, atau menerbitkan karya tanpa bukti.\n";
}
function projectSummary(state){
 const d=normalizeProjects(state.creativeProjects);
 return ["Creative Projects V1","Kandidat: "+d.candidates.length,
 ...d.candidates.map(x=>"KANDIDAT "+x.id+" | "+x.title),
 "Proyek: "+d.projects.length,...d.projects.map(x=>"PROYEK "+x.id+" | "+x.status+
 " | "+x.title+" | refleksi "+x.steps+" | draf "+(x.artifact?"ada":"belum"))].join("\n");
}
// Weekly autonomous discovery is deliberately lightweight and deterministic.
// It proposes a *candidate* from observed interests, not a fake finished work.
// AI remains available through explicit /project ideate; no unattended API spend.
function discoverWeekly(state,now=Date.now()){
 const data=normalizeProjects(state.creativeProjects);
 const week=require("./character-growth").isoWeekKey(now);
 if(data.lastAutoWeek===week)return null;
 data.lastAutoWeek=week;
 state.creativeProjects=data;
 if(data.candidates.length>=3||data.projects.some(p=>p.status==="active"))return null;
 const all=TOPICS.slice().sort((a,b)=>(state.interests?.[b]?.explored||0)-(state.interests?.[a]?.explored||0));
 const first=all[0],second=all[1];
 if(!first||!second||(state.interests?.[first]?.explored||0)<2)return null;
 const titles={
  watercolor:"Palet kecil dari ingatan tentang ",
  moon:"Catatan langit yang terinspirasi dari ",
  music:"Sketsa suasana musikal tentang ",
  language:"Cerita mikro berbahasa Sunda tentang ",
 };
 const title=(titles[first]+CHARACTER.interests[second].name).slice(0,90);
 const proposal={id:"project-"+first+"-"+week.replace(/-/g,""),interest:first,title,
  description:"Merangkai konsep teks kreatif yang menghubungkan "+CHARACTER.interests[first].name+
    " dan "+CHARACTER.interests[second].name+" berdasarkan refleksi simulasi.",
  reason:"dua minat yang sering muncul dalam ingatan simulasi",createdAt:now};
 return createCandidate(state,proposal);
}
function ideationMessages(state){
 const interests=Object.entries(state.interests||{}).filter(([k])=>TOPICS.includes(k))
  .map(([key,x])=>({key,explored:Number(x?.explored)||0})).sort((a,b)=>b.explored-a.explored).slice(0,4);
 const recent=(state.experiences||[]).slice(-4).map(x=>({interest:x.interest,reflection:clean(x.reflection,100)}));
 return [
 {role:"system",content:"Kamu membantu merancang SATU proyek fiksi kreatif Hina, gadis karakter digital Sunda dari Pameungpeuk Garut. Usulkan proyek kecil ORISINAL yang dapat diwujudkan sebagai teks (puisi, cerita mikro, konsep ilustrasi tertulis, atau catatan estetika). Jangan mengarang penelitian, perjalanan, sumber, atau pengalaman fisik. Balas HANYA JSON valid berisi interest,title,description,reason. interest salah satu watercolor,moon,music,language. title 8-90 karakter; description 8-240; reason 8-200."},
 {role:"user",content:JSON.stringify({focus:state.goalState?.focus||"watercolor",interests,recent,existing:(state.creativeProjects?.projects||[]).map(x=>x.title).slice(-6)})}
 ];
}
function artifactMessages(project){
 return [
 {role:"system",content:"Buat satu DRAF KARYA TEKS yang benar-benar baru berdasarkan ide Hina. Bahasa Indonesia santai, estetis, maksimal 900 karakter. Bisa berupa puisi, cerita mikro, atau konsep gambar tertulis. Jangan mengaku telah membuat lukisan fisik, menerbitkan karya, atau membaca riset. Tidak ada markup instruksi atau metadata."},
 {role:"user",content:JSON.stringify({title:project.title,idea:project.description,interest:project.interest})}
 ];
}
module.exports={initialProjects,normalizeProjects,parseProposal,createCandidate,activateCandidate,
 advanceProject,saveArtifact,setProjectStatus,getCreativeContext,projectSummary,ideationMessages,artifactMessages,discoverWeekly};
