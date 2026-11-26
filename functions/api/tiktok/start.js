const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
async function sign(v,k){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(k),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(v)));}
async function user(req,env){const m=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});return r.ok?r.json():null;}
export async function onRequestPost({request,env}){
 const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_REDIRECT_URI","META_OAUTH_STATE_SECRET"].filter(k=>!env[k]);
 if(missing.length)return json({error:"Configuration TikTok incomplète.",missing},503);
 const u=await user(request,env);if(!u?.id)return json({error:"Connexion requise."},401);
 const body=await request.json().catch(()=>({}));const artistId=body.artist_id;if(!artistId)return json({error:"Espace artiste manquant."},400);
 const base=env.SUPABASE_URL.replace(/\/$/,""),h={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
 const a=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:h});
 if(!a.ok||!(await a.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
 const state=b64u(crypto.getRandomValues(new Uint8Array(32))),payload=b64u(new TextEncoder().encode(JSON.stringify({state,uid:u.id,artistId,exp:Date.now()+600000}))),sig=await sign(payload,env.META_OAUTH_STATE_SECRET);
 const cookie="amm_tiktok_oauth="+payload+"."+sig+"; HttpOnly; Secure; SameSite=Lax; Path=/api/tiktok; Max-Age=600";
 const url=new URL("https://www.tiktok.com/v2/auth/authorize/");
 url.searchParams.set("client_key",env.TIKTOK_CLIENT_KEY);url.searchParams.set("response_type","code");
 url.searchParams.set("scope","user.info.basic,user.info.stats,video.list,video.publish,video.upload");url.searchParams.set("redirect_uri",env.TIKTOK_REDIRECT_URI);url.searchParams.set("state",state);
 return new Response(JSON.stringify({authorization_url:url.toString()}),{status:200,headers:{...H,"set-cookie":cookie}});
}