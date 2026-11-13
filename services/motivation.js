// Decision & Motivation Engine V2. State represents fictional motivations,
// not human needs or consciousness. No network calls and no dependence on user activity.
const { CHARACTER } = require("./character-core");
const INTERESTS = Object.keys(CHARACTER.interests);
const BASE = Object.freeze({ curiosity: 0.7, creativity: 0.6, reflection: 0.45, expression: 0.55 });

function clamp(v, lo=0, hi=1) { return Math.max(lo, Math.min(hi, Number(v) || 0)); }

function initialMotivation() {
  return {
    drives: { ...BASE },
    recentFocus: null,
    decisions: 0,
  };
}
function normalizeMotivation(value) {
  if (!value || typeof value !== "object") return initialMotivation();
  return {
    drives: Object.fromEntries(Object.keys(BASE).map(k => [k, clamp(value.drives?.[k] ?? BASE[k])])),
    recentFocus: INTERESTS.includes(value.recentFocus) ? value.recentFocus : null,
    decisions: Math.max(0, Math.min(1000000, Math.floor(Number(value.decisions) || 0))),
  };
}
function mixHash(s) {
  let h=2166136261;
  for(const x of String(s)) {h^=x.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0)/4294967296;
}

// Keyed deterministic variation supports predictable recovery after downtime.
function decideActivity(state, dateKey, slotIndex) {
  const motivation = normalizeMotivation(state.motivation);
  const options = INTERESTS.map(key => {
    const old=state.interests[key] || {};
    const interest=clamp(old.affinity ?? 1, 0, 4)/4;
    const novelty=1-clamp((old.explored || 0)/50);
    const previous=state.experiences.slice(-2).filter(x => x.interest===key).length;
    const drive = key==="watercolor" ? "creativity" : key==="music" ? "expression" :
      key==="language" ? "curiosity" : "reflection";
    const score= motivation.drives[drive]*1.2 + interest*0.4 +
      novelty*0.22 + mixHash(dateKey+":"+slotIndex+":"+key)*0.6 -
      previous*1.1 - (motivation.recentFocus===key?0.15:0);
    return {key,drive,score};
  }).sort((a,b)=>b.score-a.score);
  const selected=options[0];
  const activities=CHARACTER.interests[selected.key].activities;
  const explored=state.interests[selected.key]?.explored || 0;
  const idx=Math.floor(mixHash(dateKey+":"+slotIndex+":activity:"+selected.key)*activities.length + explored)%activities.length;
  const [activity,reflection]=activities[idx];
  return {key:selected.key,activity,reflection,drive:selected.drive,reason:"rasa ingin tahu dan perkembangan minat",score:Math.round(selected.score*100)/100};
}
function applyMotivation(state, decision) {
  const m=normalizeMotivation(state.motivation);
  m.decisions++;
  m.recentFocus=decision.key;
  // A completed simulated reflection temporarily satisfies its associated drive;
  // other drives recover gradually and eventually take priority.
  for(const key of Object.keys(m.drives)) {
    m.drives[key]=clamp(m.drives[key] + (key===decision.drive ? -0.13 : 0.045));
  }
  state.motivation=m;
  return m;
}
function getMotivationContext(state) {
  const m=normalizeMotivation(state?.motivation);
  const ranked=Object.entries(m.drives).sort((a,b)=>b[1]-a[1]);
  const names={curiosity:"rasa penasaran",creativity:"keinginan berkreasi",reflection:"kebiasaan merenung",expression:"keinginan mengekspresikan diri"};
  return "Motivasi karakter simulasi: "+ranked.map(([k,v])=>names[k]+ " "+Math.round(v*100)+"%").join(", ") +
    ". Ini kecenderungan naratif, bukan emosi biologis. Jangan mengumumkan angka kepada user.";
}
module.exports={initialMotivation,normalizeMotivation,decideActivity,applyMotivation,getMotivationContext};
