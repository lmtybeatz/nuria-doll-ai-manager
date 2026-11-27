const clear="amm_tiktok_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/tiktok; Max-Age=0";
const redirect=(origin,q,artistId)=>new Response(null,{status:302,headers:{location:origin+"/?tiktok="+q+(artistId?"&artist_id="+encodeURIComponent(artistId):""),"set-cookie":clear,"cache-control":"no-store"}});
const dec=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function verify(v,k){const p=v.split(".");if(p.length!==2)return null;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(k),{name:"HMAC",hash:"SHA-256"},false,["verify"]);const ok=await crypto.subtle.verify("HMAC",key,dec(p[1]),new TextEncoder().encode(p[0]));return ok?JSON.parse(new TextDecoder().decode(dec(p[0]))):null;}
async function encrypt(v,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement invalide.");const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(v)));return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(data)));}
async function apiToken(code,env){const body=new URLSearchParams({client_key:env.TIKTOK_CLIENT_KEY,client_secret:env.TIKTOK_CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:env.TIKTOK_REDIRECT_URI});const r=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});const response=await r.json();const d=response.data||response;const topError=response.error;const nestedError=d.error;const topCode=typeof topError==="object"?topError?.code:topError;const nestedCode=typeof nestedError==="object"?nestedError?.code:nestedError;const failed=(code)=>!!code&&code!=="ok";if(!r.ok||failed(topCode)||failed(nestedCode)||!d.access_token)throw new Error("Échange OAuth TikTok refusé : "+(d.error_description||response.error_description||(failed(nestedCode)?nestedError?.message||nestedCode:null)||(failed(topCode)?topError?.message||topCode:null)||r.status));return d;}
async function api(path,token,query=""){const r=await fetch("https://open.tiktokapis.com"+path+(query?"?"+query:""),{headers:{authorization:"Bearer "+token}});const d=await r.json();if(!r.ok||d.error?.code&&d.error.code!=="ok")throw new Error(d.error?.message||"Erreur API TikTok");return d.data||{};}
export async function onRequestGet({request,env}){
 const origin=new URL(request.url).origin,fail=q=>redirect(origin,"error&reason="+encodeURIComponent(q));
 try{
  const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("amm_tiktok_oauth="))?.slice("amm_tiktok_oauth=".length);
  if(!cookie||!env.META_OAUTH_STATE_SECRET)return fail("state_absent");
  const p=await verify(cookie,env.META_OAUTH_STATE_SECRET),u=new URL(request.url),code=u.searchParams.get("code");
  if(u.searchParams.has("error"))return fail("autorisation_refusee");
  if(!p||!code||u.searchParams.get("state")!==p.state||p.exp<Date.now())return fail("state_invalide");
  const token=await apiToken(code,env);
  let profile={};
  try{profile=await api("/v2/user/info/",token.access_token,"fields=open_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count");}
  catch(e){console.error("AI_MUSIC_MANAGER_TIKTOK_PROFILE",String(e?.message||"profile_error").slice(0,180));}
  const account=profile.user||{},openId=token.open_id||account.open_id;
  if(!openId)throw new Error("TikTok n’a pas retourné l’identifiant du compte.");
  const encrypted=await encrypt({access_token:token.access_token,refresh_token:token.refresh_token,open_id:openId,expires_at:Date.now()+Number(token.expires_in||7200)*1000,refresh_expires_at:Date.now()+Number(token.refresh_expires_in||15552000)*1000,scope:token.scope||""},env.META_TOKEN_ENCRYPTION_KEY);
  const base=env.SUPABASE_URL.replace(/\/$/,""),h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const a=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(p.artistId)+"&owner_id=eq."+encodeURIComponent(p.uid)+"&status=eq.active&select=id",{headers:h});
  if(!a.ok||!(await a.json()).length)throw new Error("Espace artiste non autorisé.");
  const metadata={open_id:openId,display_name:account.display_name||"",avatar_url:account.avatar_url||"",follower_count:account.follower_count??null,following_count:account.following_count??null,likes_count:account.likes_count??null,video_count:account.video_count??null,scope:token.scope||"",profile_available:!!account.open_id,connected_at:new Date().toISOString(),token_expires_at:new Date(Date.now()+Number(token.expires_in||86400)*1000).toISOString()};
  const save=await fetch(base+"/rest/v1/ai_social_connections?on_conflict=owner_id,artist_id,provider",{method:"POST",headers:{...h,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({owner_id:p.uid,artist_id:p.artistId,provider:"tiktok",token_ciphertext:encrypted,scopes:(token.scope||"").split(",").filter(Boolean),account_metadata:metadata,connected_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
  if(!save.ok)throw new Error("Enregistrement sécurisé TikTok impossible.");
  return redirect(origin,"connected",p.artistId);
 }catch(e){console.error("AI_MUSIC_MANAGER_TIKTOK_OAUTH",String(e?.message||"error").slice(0,220));return fail("connexion_impossible");}
}