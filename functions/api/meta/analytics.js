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
async function inspectToken(version,token,env){
 const url=new URL("https://graph.facebook.com/"+version+"/debug_token");
 url.searchParams.set("input_token",token);
 url.searchParams.set("access_token",env.META_APP_ID+"|"+env.META_APP_SECRET);
 const d=await graph(url);
 if(!d.data?.is_valid)throw new Error("Le jeton Meta enregistré est invalide ou révoqué. Reconnecte Facebook et Instagram.");
 if(String(d.data.app_id)!==String(env.META_APP_ID))throw new Error("Le jeton Meta appartient à une autre application. Reconnecte le compte avec AI Music Manager Social.");
 return {scopes:Array.isArray(d.data.scopes)?d.data.scopes:[],granular:Array.isArray(d.data.granular_scopes)?d.data.granular_scopes:[]};
}
function permissionGranted(info,scope,assetId){
 if(!info.scopes.includes(scope))return false;
 const granular=info.granular.find(x=>x.scope===scope);
 return !(granular?.target_ids?.length&&assetId&&!granular.target_ids.map(String).includes(String(assetId)));
}
function latestMetric(payload){
 const item=payload?.data?.[0];
 const values=item?.values||[];
 if(values.length){
  const value=values[values.length-1].value;
  if(typeof value==="number")return value;
  if(value&&typeof value==="object")return Object.values(value).reduce((a,b)=>a+(Number(b)||0),0);
  if(value!==null&&value!==undefined&&value!=="")return Number(value);
 }
 const total=item?.total_value?.value;
 if(typeof total==="number")return total;
 return null;
}
async function readMetric(version,id,token,metric,period){
 const url=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(id)+"/insights");
 url.searchParams.set("metric",metric);url.searchParams.set("period",period);url.searchParams.set("access_token",token);
 try{return {value:latestMetric(await graph(url)),error:null};}
 catch(e){return {value:null,error:String(e?.message||"Métrique indisponible.").slice(0,180)};}
}
async function readMetricSet(version,id,token,metrics,period){
 const entries=await Promise.all(metrics.map(async metric=>[metric,await readMetric(version,id,token,metric,period)]));
 const values=Object.fromEntries(entries.map(([name,result])=>[name,result.value]));
 const errors=entries.filter(([,result])=>result.error).map(([name,result])=>name+": "+result.error);
 if(entries.every(([,result])=>result.value===null))return {values,errors,empty:true};
 return {values,errors,empty:false};
}
export async function onRequestGet({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","META_TOKEN_ENCRYPTION_KEY","META_GRAPH_API_VERSION","META_APP_ID","META_APP_SECRET"].filter(k=>!env[k]);
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
  stage="dechiffrement_jeton";const tokens=await decrypt(rows[0].token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY);
  const systemToken=tokens.access_token||tokens.system_user_access_token||tokens.user_access_token;
  if(!systemToken)throw new Error("Jeton Meta absent. Reconnecte les comptes.");
  const version=env.META_GRAPH_API_VERSION;
  stage="verification_autorisations_reelles";
  const permissionInfo=await inspectToken(version,systemToken,env);
  const metadata=rows[0].account_metadata||{};
  const pages=Array.isArray(tokens.pages)?tokens.pages:[];
  const instagramAccounts=Array.isArray(tokens.instagram_accounts)?tokens.instagram_accounts:[];
  const pageMeta=Array.isArray(metadata.pages)?metadata.pages:[];
  const igMeta=Array.isArray(metadata.instagram_accounts)?metadata.instagram_accounts:[];
  const page=pages.find(x=>x.access_token)||pages[0]||null;
  const instagram=instagramAccounts[0]||null;
  const hasPages=pageMeta.length>0||pages.length>0;
  const hasInstagram=igMeta.length>0||instagramAccounts.length>0;
  const missingPermissions=[];
  if(hasPages){
   for(const scope of ["pages_read_engagement","read_insights"])
    if(!permissionGranted(permissionInfo,scope,page?.id))missingPermissions.push(scope);
  }
  if(hasInstagram&&!permissionGranted(permissionInfo,"instagram_manage_insights",instagram?.id))missingPermissions.push("instagram_manage_insights");
  if(missingPermissions.length)return json({connected:true,ready:false,missing_permissions:missingPermissions,actual_scopes:permissionInfo.scopes,error:"Meta n’a pas accordé toutes les autorisations nécessaires à ce jeton."},403);
  const result={facebook:null,instagram:null,synced_at:new Date().toISOString(),warnings:[]};
  if(hasPages){
   if(!page?.access_token)throw new Error("Jeton d’accès à la Page absent. Reconnecte Facebook pour renouveler l’accès à la Page.");
   stage="insights_facebook";
   const data=await readMetricSet(version,page.id,page.access_token,["page_impressions","page_post_engagements","page_media_view"],"days_28");
   result.facebook={page_name:page.name||"",reach:data.values.page_impressions,engagement:data.values.page_post_engagements,views:data.values.page_media_view};
   if(data.errors.length)result.warnings.push("Facebook : "+data.errors.join(" · "));
   if(data.empty)result.warnings.push("Facebook : Meta ne renvoie aucune statistique pour cette Page. Les insights peuvent notamment être indisponibles si la Page compte moins de 100 mentions J’aime.");
  }
  if(hasInstagram){
   if(!instagram?.id)throw new Error("Compte Instagram professionnel absent dans la connexion Meta.");
   stage="insights_instagram";
   const data=await readMetricSet(version,instagram.id,systemToken,["reach","total_interactions","views"],"days_28");
   result.instagram={username:instagram.username||"",reach:data.values.reach,interactions:data.values.total_interactions,views:data.values.views};
   if(data.errors.length)result.warnings.push("Instagram : "+data.errors.join(" · "));
   if(data.empty)result.warnings.push("Instagram : Meta ne renvoie pas encore de statistiques pour ce compte sur la période sélectionnée.");
  }
  return json({connected:true,ready:true,...result});
 }catch(e){
  console.error("AI_MUSIC_MANAGER_META_INSIGHTS",JSON.stringify({stage,message:String(e?.message||"erreur").slice(0,220)}));
  return json({error:String(e?.message||"Lecture des statistiques Meta impossible."),stage},502);
 }
}
