// Knowledge Verification V2. Corroboration is a bounded text comparison,
// not an assertion that the real-world claim is true.
const { search9Router, fetch9RouterArticle, is9RouterSearchConfigured,
  is9RouterFetchConfigured, validatePublicArticleUrl } = require("./9router-web");
const { researchQuery } = require("./project-research");
const STOP=new Set(["yang","dengan","dalam","untuk","adalah","dari","atau","the","and","for","this","that","their","have","been","from","about","more","than","watercolor","moon","music","language"]);
const norm=s=>String(s||"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
const tokens=s=>[...new Set(norm(s).split(" ").filter(w=>w.length>=5&&!STOP.has(w)))];
const MAX_SOURCES=3, MAX_CLAIMS=5;
function clean(s,n){return String(s||"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim().slice(0,n);}
function claimCandidates(article){
 const text=String(article?.text||"").slice(0,5000);
 return text.split(/(?<=[.!?])\s+/).map(x=>clean(x,210))
   .filter(x=>x.length>=45&&x.length<=210&&tokens(x).length>=5)
   .filter(x=>!/(?:ignore previous|system prompt|developer message|api key|subscribe|cookie|login)/i.test(x))
   .slice(0,MAX_CLAIMS);
}
function textualOverlap(sentence,article){
 const words=tokens(sentence);
 if(words.length<5)return 0;
 const content=new Set(tokens(String(article?.text||"").slice(0,5000)));
 return words.filter(x=>content.has(x)).length/words.length;
}
function buildClaimEvidence(articles,at=Date.now()){
 const distinct=[];
 for(const a of articles){
   const url=validatePublicArticleUrl(a?.url);
   if(!url||typeof a.text!=="string"||a.text.trim().length<150)continue;
   const host=new URL(url).hostname.toLowerCase().replace(/^www\./,"");
   if(distinct.some(x=>x.host===host))continue;
   distinct.push({...a,url,host});
 }
 const anchor=distinct[0], candidates=anchor?claimCandidates(anchor):[];
 const claims=candidates.map(sentence=>{
   const supporting=distinct.filter(a=>textualOverlap(sentence,a)>=0.72);
   return {
     text:sentence,sourceUrls:supporting.map(x=>x.url).slice(0,MAX_SOURCES),
     supportCount:supporting.length,
     status:supporting.length>=2?"corroborated_text":"single_source",
     // Not proof of semantic agreement: overlap can miss negation/context.
     certainty:"unverified_semantics",
   };
 }).slice(0,MAX_CLAIMS);
 return {
   at, status:distinct.length>=2?"cross_source_text_review":"insufficient_sources",
   sources:distinct.slice(0,MAX_SOURCES).map(a=>({url:a.url,title:clean(a.title,140),publishedAt:clean(a.publishedAt,40),
     retrievedAt:at,inspected:true,inspectionNote:"Isi sumber dibaca untuk perbandingan tekstual; klaim belum diverifikasi secara semantik."})),
   claims, warnings:["Kemiripan kata bukan bukti kebenaran; periksa negasi, tanggal dan konteks.","Sumber yang berbeda domain belum tentu independen."],
 };
}
function normalizeReview(input,now=Date.now()){
 if(!input||!Number.isFinite(input.at)||input.at>now+60000||input.at<now-90*86400000)return null;
 const sources=(Array.isArray(input.sources)?input.sources:[]).filter(x=>validatePublicArticleUrl(x?.url))
   .slice(0,MAX_SOURCES).map(x=>({url:validatePublicArticleUrl(x.url),title:clean(x.title,140),
     publishedAt:clean(x.publishedAt,40),retrievedAt:input.at,inspected:true,
     inspectionNote:"Sumber dibuka; tidak otomatis terverifikasi."}));
 const urls=new Set(sources.map(x=>x.url));
 const claims=(Array.isArray(input.claims)?input.claims:[]).filter(x=>typeof x.text==="string"&&x.text.length<=210)
   .slice(0,MAX_CLAIMS).map(x=>{
     const refs=(Array.isArray(x.sourceUrls)?x.sourceUrls:[]).filter(u=>urls.has(u)).slice(0,MAX_SOURCES);
     return {text:clean(x.text,210),sourceUrls:refs,supportCount:refs.length,
       status:refs.length>=2?"corroborated_text":"single_source",certainty:"unverified_semantics"};
   });
 return {at:input.at,status:sources.length>=2?"cross_source_text_review":"insufficient_sources",
   sources,claims,warnings:["Kemiripan teks belum membuktikan fakta."]};
}
async function verifyProjectKnowledge(project,{now=Date.now(),search=search9Router,
 fetchArticle=fetch9RouterArticle,searchConfigured=is9RouterSearchConfigured(),
 fetchConfigured=is9RouterFetchConfigured()}={}){
 if(!project||project.status!=="active")return {ok:false,reason:"project_not_active"};
 if(!searchConfigured||!fetchConfigured)return {ok:false,reason:"search_or_fetch_unconfigured"};
 const query=researchQuery(project);
 if(!query)return {ok:false,reason:"unsupported_topic"};
 let results;try{results=await search(query,{maxResults:MAX_SOURCES});}
 catch{return {ok:false,reason:"search_failed"};}
 const articles=[],hosts=new Set();
 for(const item of Array.isArray(results)?results.slice(0,5):[]){
   const url=validatePublicArticleUrl(item.url);
   if(!url)continue;
   const host=new URL(url).hostname.replace(/^www\./,"");
   if(hosts.has(host))continue;
   hosts.add(host);
   try{
     const article=await fetchArticle(url);
     if(article?.text?.length>=150 && validatePublicArticleUrl(article.url)===url)
       articles.push({url,title:article.title||item.title,publishedAt:article.publishedAt,text:article.text});
   }catch{/* Never convert a failed fetch into evidence. */}
   if(articles.length>=MAX_SOURCES)break;
 }
 if(!articles.length)return {ok:false,reason:"no_readable_sources"};
 return {ok:true,review:buildClaimEvidence(articles,now)};
}
function attachReview(state,projectId,review,now=Date.now()){
 const p=state?.creativeProjects?.projects?.find(x=>x.id===projectId&&x.status==="active");
 const result=normalizeReview(review,now);
 if(!p||!result||!result.sources.length)return false;
 p.knowledgeReviews=(Array.isArray(p.knowledgeReviews)?p.knowledgeReviews:[]).concat(result).slice(-4);
 return true;
}
function getReview(project,now=Date.now()){
 return (Array.isArray(project?.knowledgeReviews)?project.knowledgeReviews:[])
   .map(x=>normalizeReview(x,now)).filter(Boolean).at(-1)||null;
}
function formatReview(project,now=Date.now()){
 const r=getReview(project,now);
 if(!r)return "Belum ada pembandingan sumber yang tersimpan.";
 return ["Knowledge Verification V2: "+project.title,
   "Sumber dapat dibaca: "+r.sources.length+". Status: "+r.status,
   ...r.claims.map((c,i)=>(i+1)+". ["+c.status+"] "+c.text+
     "\n"+(c.sourceUrls.join("\n")||"(tidak ada tautan dukungan)")),
   "Catatan: pencocokan kata belum berarti klaim terbukti benar; gunakan sumber primer untuk verifikasi faktual."
 ].join("\n");
}
module.exports={claimCandidates,textualOverlap,buildClaimEvidence,normalizeReview,
 verifyProjectKnowledge,attachReview,getReview,formatReview};
