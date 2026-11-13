// Hina Character Growth V2: traceable long-term fictional interests.
// No invented physical events, model calls, or retrospective fake experiences.
const { CHARACTER } = require("./character-core");
const { getWibClock } = require("./temporal");
const KEYS = Object.keys(CHARACTER.interests);
const TARGET = 10;
const MAX_REVIEWS = 24;
const MAX_MILESTONES = 32;
const GOALS = Object.freeze({
  watercolor: {title:"memahami teknik dan suasana lukisan cat air", intention:"pelan-pelan belajar warna, tekstur, dan komposisi"},
  moon: {title:"mengembangkan pemahaman tentang bulan dan langit malam", intention:"mencatat rasa penasaran dan gagasan tentang langit malam"},
  music: {title:"mengenali selera serta nuansa musik", intention:"memahami apa yang bikin sebuah lagu terasa berkesan"},
  language: {title:"mengembangkan ekspresi Sunda-Indonesia yang natural", intention:"memahami pemakaian kata dalam percakapan santai"},
});
function isoWeekKey(at) {
  const {dateKey}=getWibClock(at);
  const date=new Date(dateKey+"T00:00:00Z");
  const weekday=(date.getUTCDay()+6)%7;
  date.setUTCDate(date.getUTCDate()-weekday);
  return date.toISOString().slice(0,10);
}
function freshGoalState(now=Date.now(),interests={}) {
  // Existing exploration establishes preferences, but not invented progress
  // toward a new goal. Each goal starts from its actual activation.
  const ranking=KEYS.slice().sort((a,b)=>
    (Number(interests[b]?.explored)||0)-(Number(interests[a]?.explored)||0));
  return {
    version:2,
    focus:ranking[0],
    goals:Object.fromEntries(KEYS.map(key=>[key,{
      progress:0,phase:0,completed:false,activatedAt:now,lastAdvancedAt:null,
    }])),
    lastReviewWeek:isoWeekKey(now),
    weeklyCounts:Object.fromEntries(KEYS.map(k=>[k,0])),
    reviews:[],
    milestones:[],
  };
}
function normalizeGoalState(raw,now=Date.now(),interests={}) {
  const baseline=freshGoalState(now,interests);
  if(!raw||raw.version!==2)return baseline;
  const result={
    ...baseline,
    focus:KEYS.includes(raw.focus)?raw.focus:baseline.focus,
    lastReviewWeek:typeof raw.lastReviewWeek==="string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastReviewWeek)?
      raw.lastReviewWeek:baseline.lastReviewWeek,
    goals:Object.fromEntries(KEYS.map(key=>{
      const old=raw.goals?.[key]||{};
      const phase=Math.max(0,Math.min(3,Math.floor(Number(old.phase)||0)));
      return [key,{
        progress:Math.max(0,Math.min(TARGET-1,Math.floor(Number(old.progress)||0))),
        phase,
        completed:old.completed===true||phase===3,
        activatedAt:Number.isFinite(old.activatedAt)?old.activatedAt:now,
        lastAdvancedAt:Number.isFinite(old.lastAdvancedAt)?old.lastAdvancedAt:null,
      }];
    })),
    weeklyCounts:Object.fromEntries(KEYS.map(k=>[k,Math.max(0,Math.min(1000,Math.floor(Number(raw.weeklyCounts?.[k])||0)))])),
    reviews:Array.isArray(raw.reviews)?raw.reviews.filter(x=>x&&typeof x.week==="string"&&KEYS.includes(x.focus)).slice(-MAX_REVIEWS):[],
    milestones:Array.isArray(raw.milestones)?raw.milestones.filter(x=>x&&KEYS.includes(x.interest)&&Number.isFinite(x.at)).slice(-MAX_MILESTONES):[],
  };
  return result;
}
function chooseFocus(growth, motivation) {
  const drives=motivation?.drives||{};
  const mapped={watercolor:"creativity",moon:"reflection",music:"expression",language:"curiosity"};
  const ranked=KEYS.filter(key=>!growth.goals[key].completed).map(key=>{
    const goal=growth.goals[key];
    const drive=Number(drives[mapped[key]])||0;
    const progress=goal.progress/TARGET;
    // The review favors unfinished, interesting areas without hard-locking focus.
    const score=drive*0.75 + (1-progress)*0.35+
      (key===growth.focus?0.08:0)+Math.min(2,growth.weeklyCounts[key]||0)*0.03;
    return {key,score};
  }).sort((a,b)=>b.score-a.score||KEYS.indexOf(a.key)-KEYS.indexOf(b.key));
  return ranked[0]?.key||growth.focus;
}
function evaluateWeek(state,at) {
  const growth=state.goalState;
  const week=isoWeekKey(at);
  if(growth.lastReviewWeek===week)return null;
  // Single review per boundary, even after long downtime; don't backfill
  // nonexistent activity as weekly achievements.
  const previous=growth.lastReviewWeek;
  const focusBefore=growth.focus;
  const counts={...growth.weeklyCounts};
  growth.focus=chooseFocus(growth,state.motivation);
  const review={
    week:previous, reviewedAt:at, focus:focusBefore,
    result:counts[focusBefore]>0?"ada refleksi yang tercatat":"belum ada refleksi tercatat",
    counts,
    nextFocus:growth.focus,
  };
  growth.reviews.push(review);
  growth.reviews=growth.reviews.slice(-MAX_REVIEWS);
  growth.weeklyCounts=Object.fromEntries(KEYS.map(k=>[k,0]));
  growth.lastReviewWeek=week;
  return review;
}
function reflectGoal(state,event) {
  if(!event||event.source!=="life_simulation"||!KEYS.includes(event.interest)||!Number.isFinite(event.at))return null;
  if(!state.goalState)state.goalState=freshGoalState(event.at,state.interests);
  const growth=state.goalState;
  evaluateWeek(state,event.at);
  const goal=growth.goals[event.interest];
  if(goal.completed)return null;
  growth.weeklyCounts[event.interest]++;
  goal.progress++;
  if(goal.progress<TARGET)return null;
  goal.progress=0;
  goal.phase=Math.min(3,goal.phase+1);
  goal.completed=goal.phase>=3;
  goal.lastAdvancedAt=event.at;
  const milestone={
    id:event.id+":goal:"+goal.phase,
    at:event.at,interest:event.interest,phase:goal.phase,
    source:"life_simulation",evidence:event.id,
    note:"Tahap perkembangan minat "+CHARACTER.interests[event.interest].name+
      " bertambah berdasarkan "+TARGET+" refleksi simulasi.",
  };
  growth.milestones.push(milestone);
  growth.milestones=growth.milestones.slice(-MAX_MILESTONES);
  if(goal.completed && growth.focus===event.interest)growth.focus=chooseFocus(growth,state.motivation);
  return milestone;
}
function getGoalContext(state) {
  const growth=state.goalState||freshGoalState(Date.now(),state.interests);
  const key=growth.focus;
  const goal=growth.goals[key];
  const latest=growth.reviews.at(-1);
  return [
    "",
    "TUJUAN JANGKA PANJANG KARAKTER (simulasi fiksi, jangan dibacakan):",
    "Prioritas minat saat ini: "+GOALS[key].title+".",
    "Niat naratif: "+GOALS[key].intention+". Tahap "+goal.phase+"/3, progres "+goal.progress+"/"+TARGET+".",
    latest?"Evaluasi terbaru: "+latest.result+". Fokus berikutnya: "+GOALS[latest.nextFocus].title+".":"Belum ada evaluasi mingguan tercatat.",
    "Ceritakan perkembangan ini hanya bila relevan atau ditanya. Jangan membuat klaim telah mengunjungi tempat, bertemu orang, atau belajar secara fisik.",
    "Pencapaian harus berdasarkan event simulasi tercatat. Jangan mengumumkan angka skor, scheduler, fase atau label internal saat chat.",
    "Karakter inti Hina tidak berubah hanya karena kemajuan suatu tujuan.",
  ].join("\n");
}
function getGoalSummary(state) {
  const growth=state.goalState||freshGoalState(Date.now(),state.interests);
  return [
    "Long-term Goals V2",
    "Fokus: "+GOALS[growth.focus].title,
    "Evaluasi mingguan: "+growth.reviews.length,
    "Milestone tujuan: "+growth.milestones.length,
    ...KEYS.map(k=>GOALS[k].title+": tahap "+growth.goals[k].phase+"/3, "+
      growth.goals[k].progress+"/"+TARGET+(growth.goals[k].completed?" (selesai)":"")),
  ].join("\n");
}
module.exports={GOALS,TARGET,KEYS,isoWeekKey,freshGoalState,normalizeGoalState,evaluateWeek,
  reflectGoal,chooseFocus,getGoalContext,getGoalSummary};
