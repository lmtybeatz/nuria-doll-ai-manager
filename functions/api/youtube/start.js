const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return b64u(a);};
async function hmac(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));}
async function verify(request,env){const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});return r.ok?await r.json():null;}
export async function onRequestGet({request,env}){
 const required=["YOUTUBE_CLIENT_ID","YOUTUBE_REDIRECT_URI","YOUTUBE_OAUTH_STATE_SECRET","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"];
 const missing=required.filter(key=>!env[key]);
 if(missing.length)return json({error:"Configuration YouTube incomplète côté serveur.",missing},500);
 const user=await verify(request,env);if(!user?.id)return json({error:"Connexion parent/manager requise."},401);
 const artistId=new URL(request.url).searchParams.get("artist_id");
 if(!artistId)return json({error:"Espace artiste manquant."},400);
 const base=env.SUPABASE_URL.replace(/\/$/,"");
 const artistResponse=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!artistResponse.ok){
  const raw=await artistResponse.text();
  let detail={};try{const parsed=JSON.parse(raw);detail={code:parsed.code||null,message:parsed.message||null,hint:parsed.hint||null};}catch{detail.message=raw.slice(0,240);}
  console.error("NURIA_YOUTUBE_ARTIST_VERIFY",JSON.stringify({http_status:artistResponse.status,...detail}));
  return json({error:"Vérification de l'espace artiste impossible.",diagnostic:{http_status:artistResponse.status,code:detail.code,message:detail.message,hint:detail.hint}},502);
 }
 if(!(await artistResponse.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
 const state=random(32),verifier=random(48),challenge=b64u(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const payload=b64u(new TextEncoder().encode(JSON.stringify({state,verifier,uid:user.id,artistId,exp:Date.now()+600000})));
 const sig=await hmac(payload,env.YOUTUBE_OAUTH_STATE_SECRET);
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 url.searchParams.set("client_id",env.YOUTUBE_CLIENT_ID);url.searchParams.set("redirect_uri",env.YOUTUBE_REDIRECT_URI);url.searchParams.set("response_type","code");url.searchParams.set("scope","https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly");url.searchParams.set("access_type","offline");url.searchParams.set("prompt","consent");url.searchParams.set("include_granted_scopes","true");url.searchParams.set("state",state);url.searchParams.set("code_challenge",challenge);url.searchParams.set("code_challenge_method","S256");
 return new Response(JSON.stringify({authorization_url:url.toString()}),{headers:{...H,"set-cookie":"nd_yt_oauth="+payload+"."+sig+"; HttpOnly; Secure; SameSite=Lax; Path=/api/youtube; Max-Age=600"}});
}