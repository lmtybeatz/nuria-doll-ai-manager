const clear="amm_meta_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/meta; Max-Age=0";
const redirect=(origin,query)=>new Response(null,{status:302,headers:{location:origin+"/?meta="+query,"set-cookie":clear,"cache-control":"no-store"}});
const b64decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function verifyCookie(value,secret){
 const parts=value.split(".");if(parts.length!==2)return null;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const valid=await crypto.subtle.verify("HMAC",key,b64decode(parts[1]),new TextEncoder().encode(parts[0]));
 return valid?JSON.parse(new TextDecoder().decode(b64decode(parts[0]))):null;
}
async function encrypt(value,keyB64){
 const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("META_TOKEN_ENCRYPTION_KEY doit contenir 32 octets en Base64.");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));
 return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(data)));
}
export async function onRequestGet({request,env}){
 const origin=new URL(request.url).origin;const fail=reason=>redirect(origin,"error&reason="+encodeURIComponent(reason));
 try{
  const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("amm_meta_oauth="))?.slice("amm_meta_oauth=".length);
  if(!cookie||!env.META_OAUTH_STATE_SECRET)return fail("cookie_ou_secret_absent");
  const payload=await verifyCookie(cookie,env.META_OAUTH_STATE_SECRET);if(!payload)return fail("signature_invalide");
  const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state");
  if(u.searchParams.has("error"))return fail("autorisation_refusee");
  if(!code||state!==payload.state||payload.exp<Date.now())return fail("etat_invalide_ou_expire");
  const version=env.META_GRAPH_API_VERSION,redirectUri=env.META_REDIRECT_URI;
  const exchange=new URL("https://graph.facebook.com/"+version+"/oauth/access_token");
  exchange.searchParams.set("client_id",env.META_APP_ID);exchange.searchParams.set("client_secret",env.META_APP_SECRET);
  exchange.searchParams.set("redirect_uri",redirectUri);exchange.searchParams.set("code",code);
  const shortResponse=await fetch(exchange);const shortToken=await shortResponse.json();
  if(!shortResponse.ok||!shortToken.access_token)throw new Error("Échange du code OAuth refusé.");
  const longUrl=new URL("https://graph.facebook.com/"+version+"/oauth/access_token");
  longUrl.searchParams.set("grant_type","fb_exchange_token");longUrl.searchParams.set("client_id",env.META_APP_ID);
  longUrl.searchParams.set("client_secret",env.META_APP_SECRET);longUrl.searchParams.set("fb_exchange_token",shortToken.access_token);
  const longResponse=await fetch(longUrl);const longToken=await longResponse.json();
  if(!longResponse.ok||!longToken.access_token)throw new Error("Impossible d’obtenir un jeton Meta longue durée.");
  const pagesUrl=new URL("https://graph.facebook.com/"+version+"/me/accounts");
  pagesUrl.searchParams.set("fields","id,name,access_token,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("limit","100");pagesUrl.searchParams.set("access_token",longToken.access_token);
  const pagesResponse=await fetch(pagesUrl);const pagesData=await pagesResponse.json();
  if(!pagesResponse.ok)throw new Error("Lecture des Pages Facebook refusée.");
  const pages=(pagesData.data||[]).map(p=>({id:p.id,name:p.name||"",page_access_token:p.access_token||null,instagram_business_account:p.instagram_business_account||null}));
  const instagramPages=pages.filter(p=>p.instagram_business_account?.id);
  if(!instagramPages.length)throw new Error("Aucun compte Instagram professionnel relié à une Page accessible n’a été trouvé. Vérifie les autorisations et l’accès à la Page.");
  const encrypted=await encrypt({user_access_token:longToken.access_token,pages},env.META_TOKEN_ENCRYPTION_KEY);
  const metadata={pages:instagramPages.map(p=>({page_id:p.id,page_name:p.name,instagram_id:p.instagram_business_account.id,instagram_username:p.instagram_business_account.username||null})),connected_at:new Date().toISOString()};
  const base=env.SUPABASE_URL.replace(/\/$/,""),admin={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(payload.artistId)+"&owner_id=eq."+encodeURIComponent(payload.uid)+"&status=eq.active&select=id",{headers:admin});
  if(!artist.ok||!(await artist.json()).length)throw new Error("Espace artiste invalide ou non autorisé.");
  const save=await fetch(base+"/rest/v1/ai_social_connections?on_conflict=owner_id,artist_id,provider",{method:"POST",headers:{...admin,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({owner_id:payload.uid,artist_id:payload.artistId,provider:"meta",token_ciphertext:encrypted,scopes:["pages_show_list","pages_read_engagement","instagram_basic","instagram_manage_insights"],account_metadata:metadata,connected_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
  if(!save.ok)throw new Error("Enregistrement sécurisé de la connexion Meta impossible.");
  return redirect(origin,"connected");
 }catch(error){console.error("AI_MUSIC_MANAGER_META_OAUTH",String(error?.message||"erreur").slice(0,220));return fail("connexion_impossible");}
}
