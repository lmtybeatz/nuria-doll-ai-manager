import {getTikTokContext} from "../../../_shared/tiktok-auth.js";
import {decryptMcpToken,base64url,SERVER} from "../../../_shared/tiktok-social-mcp.js";
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
async function sign(value,secret){const encoded=base64url(new TextEncoder().encode(JSON.stringify(value)));const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(encoded));return encoded+"."+base64url(sig);}
export async function onRequestPost({request,env}){
 try{
  const body=await request.json(),ctx=await getTikTokContext(request,env,body.artist_id);
  if(!env.META_OAUTH_STATE_SECRET)throw Object.assign(new Error("Secret d’état OAuth manquant."),{status:503});
  const redirectUri=env.TIKTOK_SOCIAL_MCP_REDIRECT_URI||new URL(request.url).origin+"/api/tiktok/social-mcp/callback";
  const metadataUrl=SERVER+"/oauth/.well-known/openid-configuration";
  const mr=await fetch(metadataUrl);const metadata=await mr.json();if(!mr.ok||!metadata.registration_endpoint||!metadata.authorization_endpoint)throw new Error("Configuration OAuth TikTok Social indisponible.");
  const existingUrl=ctx.base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(ctx.user.id)+"&artist_id=eq."+encodeURIComponent(ctx.artistId)+"&provider=eq.tiktok_social_mcp&select=token_ciphertext";
  const er=await fetch(existingUrl,{headers:ctx.headers});const existing=er.ok?(await er.json())[0]:null;
  let clientId=null;
  if(existing?.token_ciphertext){try{clientId=(await decryptMcpToken(existing.token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY)).client_id||null;}catch{}}
  if(!clientId){
   const reg=await fetch(metadata.registration_endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({client_name:"AI Music Manager",redirect_uris:[redirectUri],token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]})});
   const data=await reg.json().catch(()=>({}));clientId=data.client_id||data.data?.client_id;if(!reg.ok||!clientId)throw new Error(data.error_description||data.message||"Enregistrement OAuth TikTok Social refusé.");
  }
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=base64url(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
  const state=base64url(crypto.getRandomValues(new Uint8Array(24)));
  const payload={state,uid:ctx.user.id,artistId:ctx.artistId,clientId,verifier,redirectUri,exp:Date.now()+600000};
  const cookie=await sign(payload,env.META_OAUTH_STATE_SECRET);
  const auth=new URL(metadata.authorization_endpoint);
  auth.searchParams.set("response_type","code");auth.searchParams.set("resource",SERVER);auth.searchParams.set("client_id",clientId);auth.searchParams.set("redirect_uri",redirectUri);auth.searchParams.set("code_challenge",challenge);auth.searchParams.set("code_challenge_method","S256");
  auth.searchParams.set("scope","user.info.basic user.info.username user.info.stats user.info.profile user.account.type user.insights video.list video.insights comment.list comment.list.manage discovery.search.words");
  auth.searchParams.set("state",state);
  return json({auth_url:auth.toString()},200,{"set-cookie":"amm_tiktok_social_mcp="+cookie+"; HttpOnly; Secure; SameSite=Lax; Path=/api/tiktok/social-mcp; Max-Age=600"});
 }catch(e){return json({error:e.message||"Connexion TikTok Social impossible.",missing:e.missing||undefined},e.status||502);}
}
