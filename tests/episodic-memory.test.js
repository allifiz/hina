const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
process.env.LOCAL_MODEL_ENABLED="false";
process.env.NINEROUTER_API_KEY="unit-test-only";
const {
  loadEpisodes,addEpisode,captureIfOptedIn,inferEvent,findEpisodes,
  getEpisodicContext,forgetEpisode,getEpisodeList,resetEpisodeCache,
}=require("../services/episodic-memory");
const A="user-a@lid", B="user-b@lid";
const NOW=Date.parse("2026-11-14T05:00:00Z");
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hina-episode-"));
  const file=path.join(dir,"memory.json");
  resetEpisodeCache();
  t.after(()=>{resetEpisodeCache();fs.rmSync(dir,{recursive:true,force:true});});
  return file;
}
test("default off, explicit opt-in only and conservative plan detection",t=>{
 const file=setup(t);
 const raw="besok aku interview kerja nih";
 assert.equal(captureIfOptedIn(A,raw,{},NOW,file).reason,"not_opted_in");
 assert.equal(getEpisodeList(A,file).length,0);
 assert.ok(inferEvent(raw));
 assert.equal(captureIfOptedIn(A,raw,{episodeAutoOptIn:true},NOW,file).ok,true);
 assert.equal(getEpisodeList(A,file).length,1);
 assert.equal(captureIfOptedIn(A,raw,{episodeAutoOptIn:true},NOW+1000,file).reason,"duplicate");
});
test("never auto-store sensitive chat or hypothetical events",t=>{
 const file=setup(t), profile={episodeAutoOptIn:true};
 const input=[
  "besok aku interview tapi ini cuma misalnya",
  "besok aku ke psikiater",
  "hari ini aku cerita soal pacar meninggal",
  "besok aku transfer rekening",
  "aku sepertinya mau presentasi",
  "kalau besok aku presentasi gimana?",
 ];
 for(const text of input) assert.equal(captureIfOptedIn(A,text,profile,NOW,file).ok,false,text);
 assert.equal(getEpisodeList(A,file).length,0);
});
test("episodic events remain isolated between senders and include WIB timestamps",t=>{
 const file=setup(t);
 addEpisode(A,"besok aku presentasi project kantor",{file,now:NOW});
 addEpisode(B,"besok aku ikut lomba gambar",{file,now:NOW});
 assert.equal(getEpisodeList(A,file).length,1);
 assert.equal(getEpisodeList(B,file).length,1);
 assert.equal(findEpisodes(A,"gimana presentasi project?",3,file).length,1);
 assert.equal(findEpisodes(A,"lomba gambar",3,file).length,0);
 const context=getEpisodicContext(A,"presentasi project",NOW,file);
 assert.match(context,/2026-11-14/);
 assert.match(context,/belum terverifikasi/);
 assert.doesNotMatch(context,/lomba gambar/);
});
test("restart retains memories and delete commands remove only target user",t=>{
 const file=setup(t);
 const a1=addEpisode(A,"tadi aku selesai presentasi demo project",{file,now:NOW});
 addEpisode(A,"minggu depan aku ada ujian pemrograman",{file,now:NOW+500});
 addEpisode(B,"besok aku wawancara kerja",{file,now:NOW});
 assert.equal(a1.ok,true);
 resetEpisodeCache();loadEpisodes(file);
 assert.equal(getEpisodeList(A,file).length,2);
 assert.equal(forgetEpisode(A,a1.event.id,file),1);
 assert.equal(getEpisodeList(A,file).length,1);
 assert.equal(forgetEpisode(A,"semua",file),1);
 assert.equal(getEpisodeList(A,file).length,0);
 assert.equal(getEpisodeList(B,file).length,1);
 const stats=fs.statSync(file);
 if(process.platform!=="win32")assert.equal(stats.mode&0o777,0o600);
});
test("bounded growth with latest events retained",t=>{
 const file=setup(t);
 for(let i=0;i<75;i++)
  assert.equal(addEpisode(A,"aku menyelesaikan task nomor "+i+" dan menyimpan hasilnya",{file,now:NOW+i*1000}).ok,true);
 assert.equal(loadEpisodes(file).users[A].length,60);
 assert.match(getEpisodeList(A,file)[0].description,/nomor 74/);
});
test("WhatsApp wiring is guarded, opt-in and reset clears episodic state",()=>{
 const index=fs.readFileSync(path.join(__dirname,"..","index.js"),"utf8");
 const services=fs.readFileSync(path.join(__dirname,"..","handlers","services.js"),"utf8");
 assert.match(index,/episodeAutoOptIn = true/);
 assert.match(index,/captureIfOptedIn\(sender, textBody, profile\)/);
 assert.match(index,/getEpisodicContext\(sender, textBody\)/);
 assert.match(index,/\/episode add/);
 assert.match(index,/\/episode lupa/);
 assert.match(services,/forgetEpisode\(sender, "semua"\)/);
});
