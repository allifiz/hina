// Privacy-first proactive WhatsApp. Disabled by default, enabled only by the
// recipient using /proactive on. No guilt trips or engagement manipulation.
const { getWibClock } = require("./temporal");
const { CHARACTER } = require("./character-core");
const HOUR=3600000, DAY=86400000;
const QUIET_START=21, QUIET_END=8;
const MIN_IDLE=12*HOUR, MAX_IDLE=10*DAY, COOLDOWN=72*HOUR;
const WEEKLY_LIMIT=2;
const REASONS=["watercolor","moon","music","language"];
const SAMPLES={
 watercolor:"tadi kepikiran soal warna cat air. menurut kamu warna yang paling bikin tenang apa?",
 moon:"eh, kamu pernah ngerasa kalau bulan bikin suasana malam beda banget gak?",
 music:"aku lagi kepikiran kenapa ada lagu yang gampang banget nyangkut di kepala wkwk",
 language:"aku baru kepikiran, lucu juga ya gimana kata 'teh' bisa beda rasanya tergantung kalimat",
};

function eligibleForProactive(profile,now=Date.now()) {
  if(!profile || profile.proactiveOptIn!==true) return {ok:false,reason:"not_opted_in"};
  if(profile.banned || profile.muted) return {ok:false,reason:"muted_or_banned"};
  if(profile.relationship?.stage && profile.relationship.stage!=="normal") return {ok:false,reason:"relationship_not_normal"};
  const hour=getWibClock(now).hour;
  if(hour>=QUIET_START || hour<QUIET_END) return {ok:false,reason:"quiet_hours"};
  const last=Number(profile.lastInteractionAt);
  if(!Number.isFinite(last) || last<=0 || last>now) return {ok:false,reason:"unknown_last_chat"};
  const idle=now-last;
  if(idle<MIN_IDLE || idle>MAX_IDLE) return {ok:false,reason:"not_relevant"};
  const proactiveAt=Number(profile.lastProactiveAt||0);
  if(proactiveAt && now-proactiveAt<COOLDOWN) return {ok:false,reason:"cooldown"};
  const weekStart=now-7*DAY;
  const count=(Array.isArray(profile.proactiveLog)?profile.proactiveLog:[])
    .filter(t=>Number.isFinite(t)&&t>=weekStart &&t<=now).length;
  if(count>=WEEKLY_LIMIT) return {ok:false,reason:"weekly_limit"};
  return {ok:true,reason:"opted_in"};
}
function chooseProactiveMessage(life,now=Date.now()) {
  const recent=(life?.experiences||[]).filter(e=>e&&REASONS.includes(e.interest)).slice(-4);
  if(!recent.length) return null;
  const event=recent[recent.length-1];
  if(!Number.isFinite(event.at)||now-event.at>3*DAY||event.at>now) return null;
  return {text:SAMPLES[event.interest],interest:event.interest,eventId:event.id};
}
function updateProactiveAfterSend(profile,now=Date.now()){
  profile.lastProactiveAt=now;
  profile.proactiveLog=(Array.isArray(profile.proactiveLog)?profile.proactiveLog:[])
    .filter(at=>Number.isFinite(at)&&at>=now-7*DAY).concat(now).slice(-WEEKLY_LIMIT);
  // Deliberately DON'T touch lastInteractionAt: outgoing messages aren't user messages.
}
function proactiveStatus(profile) {
  return "Pesan spontan Hina: "+(profile?.proactiveOptIn===true?"ON":"OFF")+
    "\nSaat ON: maksimal 2 pesan per 7 hari, jeda minimal 72 jam, hanya pukul 08.00–20.59 WIB."+
    "\nGunakan /proactive on atau /proactive off kapan saja.";
}
module.exports={eligibleForProactive,chooseProactiveMessage,updateProactiveAfterSend,proactiveStatus};
