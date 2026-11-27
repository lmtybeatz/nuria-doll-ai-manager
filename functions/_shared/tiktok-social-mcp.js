import {getTikTokContext} from "./tiktok-auth.js";
const SERVER="https://business-api.tiktok.com/open_mcp/tt-ads-mcp-organic-social";
const OAUTH=SERVER+"/oauth/tiktok";
const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
export async function decryptMcpToken(value,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement TikTok invalide.");const [iv,data]=value.split(".");const key=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));return JSON.parse(new TextDecoder().decode(plain));}
export async function encryptMcpToken(value,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement TikTok invalide.");const key=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(data)));}
export async function getTikTokSocialMcpContext(request,env,artistId){
 const ctx=await getTikTokContext(request,env,artistId),url=ctx.base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(ctx.user.id)+"&artist_id=eq."+encodeURIComponent(ctx.artistId)+"&provider=eq.tiktok_social_mcp&select=id,token_ciphertext,scopes,account_metadata";
 const res=await fetch(url,{headers:ctx.headers});if(!res.ok)throw Object.assign(new Error("Connexion TikTok Social MCP introuvable."),{status:404});
 const row=(await res.json())[0];if(!row?.token_ciphertext)throw Object.assign(new Error("Connecte d’abord la gestion de communauté TikTok."),{status:404});
 const token=await decryptMcpToken(row.token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY);
 if(Date.now()>Number(token.expires_at||0)-300000){
  if(Date.now()>Number(token.refresh_expires_at||0))throw Object.assign(new Error("Autorisation TikTok Social expirée. Reconnecte le compte."),{status:401});
  const form=new URLSearchParams({grant_type:"refresh_token",refresh_token:token.refresh_token,client_id:token.client_id});
  const rr=await fetch(OAUTH+"/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
  const rd=await rr.json().catch(()=>({}));if(!rr.ok||!rd.access_token)throw Object.assign(new Error(rd.error_description||rd.error||"Renouvellement de l’accès TikTok Social impossible."),{status:401});
  token.access_token=rd.access_token;token.refresh_token=rd.refresh_token||token.refresh_token;token.scope=rd.scope||token.scope;
  token.expires_at=Date.now()+Number(rd.expires_in||86400)*1000;
  token.refresh_expires_at=Date.now()+Number(rd.refresh_token_expires_in||Math.max(0,(token.refresh_expires_at-Date.now())/1000))*1000;
  const saved=await fetch(url,{method:"PATCH",headers:{...ctx.headers,"content-type":"application/json"},body:JSON.stringify({token_ciphertext:await encryptMcpToken(token,env.META_TOKEN_ENCRYPTION_KEY),scopes:String(token.scope||"").split(/\s+/).filter(Boolean),account_metadata:{...(row.account_metadata||{}),scope:token.scope||"",token_expires_at:new Date(token.expires_at).toISOString(),refresh_expires_at:new Date(token.refresh_expires_at).toISOString()},updated_at:new Date().toISOString()})});
  if(!saved.ok)throw Object.assign(new Error("Impossible d’enregistrer le renouvellement TikTok Social."),{status:502});
 }
 return {...ctx,mcpToken:token,connection:row,server:SERVER};
}
export {SERVER,OAUTH,base64url};
