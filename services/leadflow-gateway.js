const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
function startLeadFlowGateway({takeover, getSocket, isConnected}) {
  const token = process.env.LEADFLOW_GATEWAY_TOKEN || "";
  if (!token) return;
  if (token.length < 32) throw Error("LEADFLOW_GATEWAY_TOKEN must be at least 32 characters");
  const port = Number(process.env.LEADFLOW_GATEWAY_PORT || 20129);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid gateway port");
  const server = http.createServer(async (req,res) => {
    const reply = (code,body) => {res.writeHead(code, {"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body));};
    const received = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from("Bearer "+token);
    if (received.length !== expected.length || !timingSafeEqual(received,expected)) return reply(401,{error:"Unauthorized"});
    if (req.method !== "POST" || req.url !== "/leadflow/takeover") return reply(404,{error:"Not found"});
    try {
      let raw="";
      for await (const chunk of req) {raw+=chunk; if(raw.length>4096){reply(413,{error:"Payload too large"});return;}}
      const body=JSON.parse(raw);
      if(!/^628\d{7,12}$/.test(body.phone||"")||!["status","on","off"].includes(body.action)) return reply(400,{error:"Invalid request"});
      if(body.action==="status") return reply(200,{takeover:takeover.status(body.phone),connected:isConnected()});
      if(body.action==="off") return reply(200,{takeover:takeover.set(body.phone,false),connected:isConnected()});
      const sock=getSocket();
      let aliases=[];
      if(sock&&isConnected()){
        try {const lid=await sock.signalRepository?.lidMapping?.getLIDForPN(body.phone+"@s.whatsapp.net");if(lid)aliases.push(lid);}catch{}
      }
      return reply(200,{takeover:takeover.set(body.phone,true,aliases),connected:isConnected()});
    } catch(e){return reply(500,{error:"Takeover operation failed"});}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  server.on("error",e=>console.error("[LeadFlow gateway]",e.code||e.name));
  server.listen(port,"127.0.0.1",()=>console.log("[LeadFlow gateway] listening on loopback:"+port));
  return server;
}
module.exports={startLeadFlowGateway};
