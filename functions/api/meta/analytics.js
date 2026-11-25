const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
async function verify(request,env){
 const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});
 return r.ok?await r.json():null;
}
async function decrypt(value,keyB64){
 const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement invalide.");
 const [ivText,dataText]=value.split(".");if(!ivText||!dataText)throw new Error("Jeton chiffré illisible.");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(ivText),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(dataText),c=>c.charCodeAt(0)));
 return JSON.parse(new TextDecoder().decode(bytes));
}
async function graph(url){
 const r=await fetch(url),d=await r.json();
 if(!r.ok||d.error)throw new Error(String(d.error?.message||"Graph API a refusé la lecture des statistiques.").slice(0,220));
 return d;
}
function latestMetric(payload,name){
 const item=(payload.data||[]).find(x=>x.name===name);
 const values=item?.values||[];
 const value=values.length?values[values.length-1].value:null;
 return typeof value==="number"?value:(value&&typeof value==="object"?Object.values(value).reduce((a,b)=>a+(Number(b)||0),0):Number(value)||0);
}
async function readInsights(version,id,token,metrics,period){
 const url=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(id)+"/insights");
 url.searchParams.set("metric",metrics.join(","));url.searchParams.set("period",period);url.searchParams.set("access_token",token);
 return graph(url);
}
export async function onRequestGet({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","META_TOKEN_ENCRYPTION_KEY","META_GRAPH_API_VERSION"].filter(k=>!env[k]);
  if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  stage="verification_session";const u=await verify(request,env);if(!u?.id)return json({error:"Connexion requise."},401);
  const artistId=new URL(request.url).searchParams.get("artist_id");if(!artistId)return json({error:"Espace artiste manquant."},400);
  const base=env.SUPABASE_URL.replace(/\/$/,""),headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  stage="verification_artiste";
  const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers});
  if(!artist.ok||!(await artist.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
  stage="lecture_connexion";
  const r=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.meta&select=token_ciphertext,scopes,account_metadata",{headers});
  if(!r.ok)return json({error:"Lecture de la connexion Meta impossible."},502);
  const rows=await r.json();if(!rows.length)return json({error:"Aucune connexion Meta pour cet artiste."},404);
  const scopes=rows[0].scopes||[];
  const metadata=rows[0].account_metadata||{};
  const hasPages=Array.isArray(metadata.pages)&&metadata.pages.length>0;
  const hasInstagram=Array.isArray(metadata.instagram_accounts)&&metadata.instagram_accounts.length>0;
  const required=[...(hasPages?["pages_read_engagement","read_insights"]:[]),...(hasInstagram?["instagram_manage_insights"]:[])];
  const missingPermissions=required.filter(x=>!scopes.includes(x));
  if(missingPermissions.length)return json({connected:true,ready:false,missing_permissions:missingPermissions,error:"Les autorisations de statistiques Meta ne sont pas encore accordées."},403);
  stage="dechiffrement_jeton";const tokens=await decrypt(rows[0].token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY);
  const systemToken=tokens.system_user_access_token||tokens.user_access_token;
  if(!systemToken)throw new Error("Jeton Meta absent. Reconnecte les comptes.");
  const version=env.META_GRAPH_API_VERSION;
  const page=(tokens.pages||[]).find(x=>x.access_token);
  const instagram=(tokens.instagram_accounts||[])[0];
  const result={facebook:null,instagram:null,synced_at:new Date().toISOString()};
  if(hasPages&&!page)throw new Error("Jeton d’accès à la Page absent. Reconnecte Facebook après avoir activé les autorisations d’insights.");
  if(hasInstagram&&!instagram)throw new Error("Compte Instagram professionnel absent dans la connexion Meta.");
  if(page){
   stage="insights_facebook";
   const data=await readInsights(version,page.id,page.access_token,["page_impressions","page_post_engagements","page_media_view"],"days_28");
   result.facebook={page_name:page.name||"",reach:latestMetric(data,"page_impressions"),engagement:latestMetric(data,"page_post_engagements"),views:latestMetric(data,"page_media_view")};
  }
  if(instagram){
   stage="insights_instagram";
   const data=await readInsights(version,instagram.id,systemToken,["reach","accounts_engaged","total_interactions","views"],"days_28");
   result.instagram={username:instagram.username||"",reach:latestMetric(data,"reach"),interactions:latestMetric(data,"total_interactions")||latestMetric(data,"accounts_engaged"),views:latestMetric(data,"views")};
  }
  return json({connected:true,ready:true,...result});
 }catch(e){
  console.error("AI_MUSIC_MANAGER_META_INSIGHTS",JSON.stringify({stage,message:String(e?.message||"erreur").slice(0,220)}));
  return json({error:String(e?.message||"Lecture des statistiques Meta impossible."),stage},502);
 }
}
