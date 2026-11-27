import {getTikTokSocialMcpContext,SERVER} from "../../_shared/tiktok-social-mcp.js";
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function readMcpResponse(response){const text=await response.text();try{return JSON.parse(text);}catch{const dataLine=text.split(/\r?\n/).filter(x=>x.startsWith("data:")).pop();if(dataLine){try{return JSON.parse(dataLine.slice(5).trim());}catch{}}throw new Error("Réponse TikTok Social MCP illisible.");}}
export async function onRequestPost({request,env}){
 let body={};try{body=await request.json();}catch{return reply({error:"Requête JSON invalide."},400);}
 try{
  if(!["status","tools/list","tools/call"].includes(body.action))return reply({error:"Action MCP non autorisée."},400);
  const ctx=await getTikTokSocialMcpContext(request,env,body.artist_id);
  if(body.action==="status")return reply({connected:true,scopes:ctx.mcpToken.scope||"",expires_at:ctx.mcpToken.expires_at,refresh_expires_at:ctx.mcpToken.refresh_expires_at});
  let params={};
  if(body.action==="tools/call"){
   if(typeof body.name!=="string"||!body.name.trim()||!body.arguments||typeof body.arguments!=="object"||Array.isArray(body.arguments))return reply({error:"Outil ou arguments manquants."},400);
   params={name:body.name,arguments:body.arguments};
  }
  const method=body.action==="tools/list"?"tools/list":"tools/call";
  const response=await fetch(SERVER,{method:"POST",headers:{authorization:"Bearer "+ctx.mcpToken.access_token,"content-type":"application/json","accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params})});
  const result=await readMcpResponse(response);
  if(!response.ok)return reply({error:result.error?.message||result.message||"TikTok Social MCP a refusé la requête.",details:result},response.status);
  if(result.error)return reply({error:result.error.message||"Erreur TikTok Social MCP.",details:result.error},502);
  return reply(result.result||result);
 }catch(e){return reply({error:e.message||"Appel TikTok Social MCP impossible.",missing:e.missing||undefined},e.status||502);}
}
