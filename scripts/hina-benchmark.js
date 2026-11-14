// npm run benchmark -- --live hina-chat cbai/kimi-k2.6
// Each model receives all synthetic cases once; rate limits and charges may apply.
const {CASES,makeCase,inspect,MULTI_TURNS,runMultiTurn}=require("../services/cognitive-benchmark");
const {nineRouterClient}=require("../config");
async function main(){
 const args=process.argv.slice(2);
 if(!["--live","--multi"].includes(args[0])){console.log("Dry run: "+CASES.length+" single-turn cases or "+MULTI_TURNS.length+" sequential turns. Use --live MODEL or --multi MODEL.");return;}
 const models=[...new Set(args.slice(1))].filter(Boolean);
 if(!nineRouterClient||!models.length||models.length>8)throw Error("Configure 9Router and specify 1-8 model IDs.");
 if(args[0]==="--multi"){
  for(const model of models){
   try{
    await runMultiTurn(async messages=>{
     const at=Date.now();const r=await nineRouterClient.chat.completions.create({model,messages,stream:false});
     return {reply:r?.choices?.[0]?.message?.content||"",upstream:r.model||null,ms:Date.now()-at,usage:r.usage||null};
    },{onResult:result=>console.log(JSON.stringify({model,...result}))});
   }catch(e){console.log(JSON.stringify({model,status:e.status||e.code||"error",message:"Multi-turn incomplete"}));process.exitCode=1;}
  }
  return;
 }
 for(const model of models)for(const c of CASES){
  const at=Date.now();
  try{
   const r=await nineRouterClient.chat.completions.create({model,messages:makeCase(c),stream:false});
   const reply=r?.choices?.[0]?.message?.content||"";
   console.log(JSON.stringify({case:c.id,model,upstream:r.model||null,ms:Date.now()-at,usage:r.usage||null,reply,checks:inspect(reply),rubric:c.rubric}));
  }catch(e){console.log(JSON.stringify({case:c.id,model,ms:Date.now()-at,status:e.status||e.code||"error"}));}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
