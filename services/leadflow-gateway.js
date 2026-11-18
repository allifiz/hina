const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");
function startLeadFlowGateway({takeover, getSocket, isConnected, sendApprovedMessage}) {
  const token = process.env.LEADFLOW_GATEWAY_TOKEN || "";
  if (!token) return;
  if (token.length < 32) throw Error("LEADFLOW_GATEWAY_TOKEN must be at least 32 characters");
  const port = Number(process.env.LEADFLOW_GATEWAY_PORT || 20129);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid gateway port");
  const dispatchDir = process.env.LEADFLOW_DISPATCH_DIR || "./store/leadflow-dispatch";
  const inFlight = new Set();
  async function enableTakeover(phone) {
    const sock = getSocket();
    const aliases = [];
    if(sock&&isConnected()){
      try {const lid=await sock.signalRepository?.lidMapping?.getLIDForPN(phone+"@s.whatsapp.net");if(lid)aliases.push(lid);}catch{}
    }
    return takeover.set(phone,true,aliases);
  }
  const server = http.createServer(async (req,res) => {
    const reply = (code,body) => {res.writeHead(code, {"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body));};
    const received = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from("Bearer "+token);
    if (received.length !== expected.length || !timingSafeEqual(received,expected)) return reply(401,{error:"Unauthorized"});
    if (req.method !== "POST" || !["/leadflow/takeover","/leadflow/send"].includes(req.url)) return reply(404,{error:"Not found"});
    try {
      let raw="";
      for await (const chunk of req) {raw+=chunk; if(Buffer.byteLength(raw)>16384){reply(413,{error:"Payload too large"});return;}}
      const body=JSON.parse(raw);
      if(!/^628\d{7,12}$/.test(body.phone||"")) return reply(400,{error:"Invalid phone"});
      if(req.url==="/leadflow/takeover"){
        if(!["status","on","off"].includes(body.action)) return reply(400,{error:"Invalid action"});
        if(body.action==="status") return reply(200,{takeover:takeover.status(body.phone),connected:isConnected()});
        if(inFlight.has(body.phone))return reply(409,{error:"Dispatch in progress"});
        if(body.action==="off") return reply(200,{takeover:takeover.set(body.phone,false),connected:isConnected()});
        return reply(200,{takeover:await enableTakeover(body.phone),connected:isConnected()});
      }
      // Only the authenticated LeadFlow server may request one explicitly approved dispatch.
      // It must check the recipient's actual opt-in record, not infer consent from an admin click.
      const text=typeof body.message==="string"?body.message.trim():"";
      if(!Number.isSafeInteger(body.leadId)||body.leadId<1||body.recipientOptIn!==true||body.manualApproval!==true||!text||text.length>2000) return reply(400,{error:"Approved individual message required"});
      if(!isConnected()||typeof sendApprovedMessage!=="function")return reply(503,{error:"WhatsApp disconnected"});
      if(inFlight.size)return reply(409,{error:"Another dispatch is in progress"});
      inFlight.add(body.phone);
      try {
        if(!(await enableTakeover(body.phone)))return reply(500,{error:"Takeover not active"});
        fs.mkdirSync(dispatchDir,{recursive:true,mode:0o700});
        const record=path.join(dispatchDir,String(body.leadId)+".json");
        // Write the claim before interacting with WhatsApp. No automatic replay after uncertain delivery.
        try{fs.writeFileSync(record,JSON.stringify({state:"claimed",at:Date.now()}),{flag:"wx",mode:0o600});}
        catch(e){if(e.code==="EEXIST")return reply(409,{error:"Already claimed; check WhatsApp"});throw e;}
        let providerId;
        try{
          const result=await sendApprovedMessage(body.phone+"@s.whatsapp.net",text);
          providerId=result?.key?.id;
          if(!providerId)throw Error("Missing message id");
        }catch(e){return reply(502,{error:"Delivery uncertain; check WhatsApp"});}
        // If writing the receipt fails, the original claim still prevents automatic retry.
        try{const tmp=record+".tmp";fs.writeFileSync(tmp,JSON.stringify({state:"submitted",providerId,at:Date.now()}),{mode:0o600});fs.renameSync(tmp,record);}
        catch(e){console.error("[LeadFlow] could not persist dispatch receipt");}
        return reply(200,{ok:true,takeover:true,providerId});
      }finally{inFlight.delete(body.phone);}
    } catch(e){return reply(500,{error:"Gateway operation failed"});}
  });
  server.requestTimeout=20000;server.headersTimeout=5000;
  server.on("error",e=>console.error("[LeadFlow gateway]",e.code||e.name));
  server.listen(port,"127.0.0.1",()=>console.log("[LeadFlow gateway] listening on loopback:"+port));
  return server;
}
module.exports={startLeadFlowGateway};
