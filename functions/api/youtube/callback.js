const clear="nd_yt_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/youtube; Max-Age=0";
const redirect=(url)=>new Response(null,{status:302,headers:{location:url,"set-cookie":clear,"cache-control":"no-store"}});
const b64decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0));
async function hmac(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);return crypto.subtle.verify("HMAC",key,b64decode(value.split(".")[1]),new TextEncoder().encode(value.split(".")[0]));}
async function encrypt(value,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY doit être une clé Base64 de 32 octets.");const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(data)));}
export async function onRequestGet({request,env}){
 const origin=new URL(request.url).origin;let stage="initialisation";const fail=(reason)=>redirect(origin+"/?youtube=error&reason="+encodeURIComponent(reason));
 try{
  stage="verification_cookie";
  const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("nd_yt_oauth="))?.slice("nd_yt_oauth=".length);
  if(!cookie)return fail("cookie_absent");if(!env.YOUTUBE_OAUTH_STATE_SECRET)return fail("secret_etat_absent");if(!await hmac(cookie,env.YOUTUBE_OAUTH_STATE_SECRET))return fail("signature_cookie_invalide");
  const payload=JSON.parse(new TextDecoder().decode(b64decode(cookie.split(".")[0])));
  const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state");
  if(u.searchParams.has("error"))return fail("autorisation_google_refusee");if(!code||!state)return fail("code_ou_etat_absent");if(state!==payload.state)return fail("etat_invalide");if(payload.exp<Date.now())return fail("delai_depasse");
  stage="echange_google";
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,redirect_uri:env.YOUTUBE_REDIRECT_URI,grant_type:"authorization_code",code_verifier:payload.verifier})});
  const tokens=await tokenResponse.json();if(!tokenResponse.ok||!tokens.access_token)throw new Error("Échange OAuth refusé.");
  if(!tokens.refresh_token)throw new Error("Google n'a pas fourni de jeton de renouvellement. Relance la connexion avec consentement.");
  stage="chiffrement_jetons";
  const encrypted=await encrypt(tokens,env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  stage="enregistrement_supabase";
  const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/ai_social_connections?on_conflict=owner_id,provider",{method:"POST",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({owner_id:payload.uid,provider:"youtube",token_ciphertext:encrypted,scopes:["https://www.googleapis.com/auth/youtube.readonly"],connected_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
  if(!response.ok)throw new Error("Enregistrement sécurisé impossible.");
  return redirect(origin+"/?youtube=connected");
 }catch(e){console.error("NURIA_YOUTUBE_OAUTH_ERROR",JSON.stringify({stage,message:String(e?.message||"erreur inconnue").slice(0,240)}));return fail();}
}