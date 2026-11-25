const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return b64u(a);};
async function sign(value,secret){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return b64u(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));
}
async function verifyUser(request,env){
 const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!match)return null;
 const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
 return response.ok?await response.json():null;
}
export async function onRequestGet({request,env}){
 const required=["META_APP_ID","META_APP_SECRET","META_LOGIN_CONFIG_ID","META_REDIRECT_URI","META_OAUTH_STATE_SECRET","META_TOKEN_ENCRYPTION_KEY","META_GRAPH_API_VERSION","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"];
 const missing=required.filter(key=>!env[key]);if(missing.length)return json({error:"Configuration Meta incomplète côté serveur.",missing},503);
 const user=await verifyUser(request,env);if(!user?.id)return json({error:"Connexion gestionnaire requise."},401);
 const artistId=new URL(request.url).searchParams.get("artist_id");if(!artistId)return json({error:"Espace artiste manquant."},400);
 const base=env.SUPABASE_URL.replace(/\/$/,"");
 const check=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!check.ok)return json({error:"Vérification de l’espace artiste impossible."},502);
 if(!(await check.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
 const state=random(32),payload=b64u(new TextEncoder().encode(JSON.stringify({state,uid:user.id,artistId,exp:Date.now()+600000})));
 const signature=await sign(payload,env.META_OAUTH_STATE_SECRET);
 // Unified Login: les permissions sont portées par la configuration Meta, pas par scope dans l'URL.
 const url=new URL("https://www.facebook.com/"+env.META_GRAPH_API_VERSION+"/dialog/oauth");
 url.searchParams.set("client_id",env.META_APP_ID);
 url.searchParams.set("config_id",env.META_LOGIN_CONFIG_ID);
 url.searchParams.set("redirect_uri",env.META_REDIRECT_URI);
 url.searchParams.set("response_type","code");
 url.searchParams.set("state",state);
 return new Response(JSON.stringify({authorization_url:url.toString()}),{headers:{...H,"set-cookie":"amm_meta_oauth="+payload+"."+signature+"; HttpOnly; Secure; SameSite=Lax; Path=/api/meta; Max-Age=600"}});
}
