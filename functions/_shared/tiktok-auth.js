const base64=(bytes)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function decrypt(value,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement TikTok invalide.");const [iv,data]=value.split(".");const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));return JSON.parse(new TextDecoder().decode(plain));}
async function encrypt(value,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));return base64(iv)+"."+base64(data);}
export async function getTikTokContext(request,env,artistId){
 const required=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","META_TOKEN_ENCRYPTION_KEY","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET"];
 const missing=required.filter(k=>!env[k]);if(missing.length)throw Object.assign(new Error("Configuration serveur incomplète."),{status:503,missing});
 const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!match)throw Object.assign(new Error("Connexion requise."),{status:401});
 const base=env.SUPABASE_URL.replace(/\/$/,""),userRes=await fetch(base+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});if(!userRes.ok)throw Object.assign(new Error("Session expirée."),{status:401});
 const user=await userRes.json();if(!user?.id)throw Object.assign(new Error("Session invalide."),{status:401});
 if(!artistId)throw Object.assign(new Error("Espace artiste manquant."),{status:400});
 const h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
 const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id",{headers:h});if(!ar.ok||!(await ar.json()).length)throw Object.assign(new Error("Espace artiste non autorisé."),{status:404});
 const cr=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(user.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.tiktok&select=token_ciphertext,scopes",{headers:h});if(!cr.ok)throw Object.assign(new Error("Connexion TikTok introuvable."),{status:404});const row=(await cr.json())[0];if(!row?.token_ciphertext)throw Object.assign(new Error("Connecte d’abord un compte TikTok."),{status:404});
 const token=await decrypt(row.token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY);
 if(Date.now()>Number(token.expires_at||0)-300000){
  if(Date.now()>Number(token.refresh_expires_at||0))throw Object.assign(new Error("Autorisation TikTok expirée. Reconnecte le compte."),{status:401});
  const form=new URLSearchParams({client_key:env.TIKTOK_CLIENT_KEY,client_secret:env.TIKTOK_CLIENT_SECRET,grant_type:"refresh_token",refresh_token:token.refresh_token});
  const rr=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});const rd=await rr.json();if(!rr.ok||rd.error||!rd.access_token)throw Object.assign(new Error("Renouvellement du jeton TikTok impossible."),{status:401});
  token.access_token=rd.access_token;token.refresh_token=rd.refresh_token||token.refresh_token;token.expires_at=Date.now()+Number(rd.expires_in||86400)*1000;token.refresh_expires_at=Date.now()+Number(rd.refresh_expires_in||31536000)*1000;
  await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(user.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.tiktok",{method:"PATCH",headers:{...h,"content-type":"application/json"},body:JSON.stringify({token_ciphertext:await encrypt(token,env.META_TOKEN_ENCRYPTION_KEY),updated_at:new Date().toISOString()})});
 }
 return {user,artistId,token,scopes:(row.scopes||[]),base,headers:h};
}
export async function tiktokApi(path,token,body,fields=""){const url="https://open.tiktokapis.com"+path+(fields?"?fields="+encodeURIComponent(fields):"");const r=await fetch(url,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json; charset=UTF-8"},body:JSON.stringify(body||{})});const d=await r.json().catch(()=>({}));if(!r.ok||d.error&&d.error.code!=="ok")throw Object.assign(new Error(d.error?.message||d.error?.code||"Erreur API TikTok."),{status:r.status||502,details:d.error||null});return d.data||{};}
