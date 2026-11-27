import {encryptMcpToken,SERVER} from "../../../_shared/tiktok-social-mcp.js";
const clear="amm_tiktok_social_mcp=; HttpOnly; Secure; SameSite=Lax; Path=/api/tiktok/social-mcp; Max-Age=0";
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function verify(value,secret){const p=value.split(".");if(p.length!==2)return null;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);const ok=await crypto.subtle.verify("HMAC",key,decode(p[1]),new TextEncoder().encode(p[0]));return ok?JSON.parse(new TextDecoder().decode(decode(p[0]))):null;}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),origin=url.origin;
 const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("amm_tiktok_social_mcp="))?.slice("amm_tiktok_social_mcp=".length);
 let state=null;try{if(cookie&&env.META_OAUTH_STATE_SECRET)state=await verify(cookie,env.META_OAUTH_STATE_SECRET);}catch{}
 const finish=(result,reason="")=>new Response(null,{status:302,headers:{location:origin+"/?tiktok_mcp="+result+(state?.artistId?"&artist_id="+encodeURIComponent(state.artistId):"")+(reason?"&reason="+encodeURIComponent(reason):""),"set-cookie":clear,"cache-control":"no-store"}});
 try{
  if(url.searchParams.has("error"))return finish("error","autorisation_refusee");
  const code=url.searchParams.get("code"),oauthState=url.searchParams.get("state");
  if(!state||!code||oauthState!==state.state||state.exp<Date.now())return finish("error","state_invalide");
  const metadataResponse=await fetch(SERVER+"/oauth/.well-known/openid-configuration"),metadata=await metadataResponse.json();
  const form=new URLSearchParams({grant_type:"authorization_code",code,code_verifier:state.verifier,redirect_uri:state.redirectUri,client_id:state.clientId});
  const tokenResponse=await fetch(metadata.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
  const tokenData=await tokenResponse.json().catch(()=>({}));if(!tokenResponse.ok||!tokenData.access_token||!tokenData.refresh_token)throw new Error(tokenData.error_description||tokenData.error||"Échange du code OAuth TikTok Social refusé.");
  const now=Date.now(),token={access_token:tokenData.access_token,refresh_token:tokenData.refresh_token,client_id:state.clientId,scope:tokenData.scope||"",expires_at:now+Number(tokenData.expires_in||86400)*1000,refresh_expires_at:now+Number(tokenData.refresh_token_expires_in||31536000)*1000,server:SERVER};
  const encrypted=await encryptMcpToken(token,env.META_TOKEN_ENCRYPTION_KEY);
  const base=env.SUPABASE_URL.replace(/\/$/,""),headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(state.artistId)+"&owner_id=eq."+encodeURIComponent(state.uid)+"&status=eq.active&select=id",{headers});if(!artist.ok||!(await artist.json()).length)throw new Error("Espace artiste non autorisé.");
  const metadataRow={mcp_server:SERVER,scope:token.scope,connected_at:new Date(now).toISOString(),token_expires_at:new Date(token.expires_at).toISOString(),refresh_expires_at:new Date(token.refresh_expires_at).toISOString()};
  const saved=await fetch(base+"/rest/v1/ai_social_connections?on_conflict=owner_id,artist_id,provider",{method:"POST",headers:{...headers,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({owner_id:state.uid,artist_id:state.artistId,provider:"tiktok_social_mcp",token_ciphertext:encrypted,scopes:token.scope.split(/\s+/).filter(Boolean),account_metadata:metadataRow,connected_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()})});
  if(!saved.ok)throw new Error("Enregistrement sécurisé de la connexion TikTok Social impossible.");
  return finish("connected");
 }catch(e){console.error("AI_MUSIC_MANAGER_TIKTOK_SOCIAL_MCP",String(e?.message||"error").slice(0,180));return finish("error","connexion_impossible");}
}
