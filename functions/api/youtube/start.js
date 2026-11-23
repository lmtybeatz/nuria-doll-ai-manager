const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return b64u(a);};
async function hmac(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));}
async function verify(request,env){const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});return r.ok?await r.json():null;}
export async function onRequestGet({request,env}){
 if(!env.YOUTUBE_CLIENT_ID||!env.YOUTUBE_REDIRECT_URI||!env.YOUTUBE_OAUTH_STATE_SECRET||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return json({error:"Configuration YouTube incomplète côté serveur."},500);
 const user=await verify(request,env);if(!user?.id)return json({error:"Connexion parent/manager requise."},401);
 const state=random(32),verifier=random(48),challenge=b64u(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const payload=b64u(new TextEncoder().encode(JSON.stringify({state,verifier,uid:user.id,exp:Date.now()+600000})));
 const sig=await hmac(payload,env.YOUTUBE_OAUTH_STATE_SECRET);
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 url.searchParams.set("client_id",env.YOUTUBE_CLIENT_ID);url.searchParams.set("redirect_uri",env.YOUTUBE_REDIRECT_URI);url.searchParams.set("response_type","code");url.searchParams.set("scope","https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly");url.searchParams.set("access_type","offline");url.searchParams.set("prompt","consent");url.searchParams.set("include_granted_scopes","true");url.searchParams.set("state",state);url.searchParams.set("code_challenge",challenge);url.searchParams.set("code_challenge_method","S256");
 return new Response(JSON.stringify({authorization_url:url.toString()}),{headers:{...H,"set-cookie":"nd_yt_oauth="+payload+"."+sig+"; HttpOnly; Secure; SameSite=Lax; Path=/api/youtube; Max-Age=600"}});
}