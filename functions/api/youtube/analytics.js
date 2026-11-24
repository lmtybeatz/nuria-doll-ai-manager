const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
async function verify(request,env){
 const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
 if(!m)return null;
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});
 return r.ok?await r.json():null;
}
async function decrypt(value,keyB64){
 const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));
 if(raw.length!==32)throw new Error("Clé de chiffrement invalide.");
 const [ivText,dataText]=value.split(".");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(ivText),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(dataText),c=>c.charCodeAt(0)));
 return JSON.parse(new TextDecoder().decode(bytes));
}
function dateOnly(d){return d.toISOString().slice(0,10);}
async function report(accessToken,params){
 const url=new URL("https://youtubeanalytics.googleapis.com/v2/reports");
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const r=await fetch(url,{headers:{authorization:"Bearer "+accessToken}});
 const data=await r.json();
 if(!r.ok)throw new Error("YouTube Analytics : "+(data.error?.errors?.[0]?.reason||data.error?.message||"rapport indisponible"));
 return data;
}
export async function onRequestGet({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","YOUTUBE_CLIENT_ID","YOUTUBE_CLIENT_SECRET","YOUTUBE_TOKEN_ENCRYPTION_KEY"].filter(k=>!env[k]);
  if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  stage="verification_session";
  const u=await verify(request,env);if(!u?.id)return json({error:"Connexion parent/manager requise."},401);
  const requested=new URL(request.url).searchParams.get("range")||"30";
  const days=["7","30","90"].includes(requested)?Number(requested):30;
  stage="lecture_jeton";
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const artistId=new URL(request.url).searchParams.get("artist_id");
  if(!artistId)return json({error:"Espace artiste manquant."},400);
  const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!ar.ok)return json({error:"Vérification de l'espace artiste impossible."},502);
  if(!(await ar.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
  const q=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.youtube&select=token_ciphertext,scopes",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!q.ok)return json({error:"Impossible de lire la connexion YouTube.",stage,http_status:q.status},502);
  const rows=await q.json();if(!rows.length)return json({error:"Aucune chaîne YouTube connectée."},404);
  const scopes=rows[0].scopes||[];
  if(!scopes.includes("https://www.googleapis.com/auth/yt-analytics.readonly"))return json({error:"Autorisation YouTube Analytics absente. Reconnecte la chaîne et accepte la lecture des statistiques."},403);
  stage="dechiffrement_jeton";
  const tokens=await decrypt(rows[0].token_ciphertext,env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  if(!tokens.refresh_token)throw new Error("Jeton de renouvellement absent. Reconnecte YouTube.");
  stage="renouvellement_google";
  const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
  const refreshed=await tr.json();
  if(!tr.ok||!refreshed.access_token)return json({error:"Google n'a pas pu renouveler l'accès. Reconnecte YouTube.",stage,google_error:refreshed.error||"refresh_failed"},502);
  const end=new Date();end.setUTCDate(end.getUTCDate()-1);
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-(days-1));
  const startDate=dateOnly(start),endDate=dateOnly(end);
  stage="rapport_quotidien";
  const daily=await report(refreshed.access_token,{ids:"channel==MINE",startDate,endDate,metrics:"views,estimatedMinutesWatched,subscribersGained,subscribersLost",dimensions:"day",sort:"day"});
  stage="rapport_total";
  const aggregate=await report(refreshed.access_token,{ids:"channel==MINE",startDate,endDate,metrics:"views,estimatedMinutesWatched,subscribersGained,subscribersLost"});
  stage="meilleures_videos";
  const top=await report(refreshed.access_token,{ids:"channel==MINE",startDate,endDate,metrics:"views,estimatedMinutesWatched,averageViewDuration",dimensions:"video",sort:"-views",maxResults:5});
  const ids=(top.rows||[]).map(row=>row[0]).filter(Boolean);
  let details={};
  if(ids.length){
   stage="titres_videos";
   const vr=await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet&id="+ids.map(encodeURIComponent).join(","),{headers:{authorization:"Bearer "+refreshed.access_token}});
   const vd=await vr.json();
   if(vr.ok)for(const v of vd.items||[])details[v.id]=v.snippet?.title||"Vidéo YouTube";
  }
  const headers=daily.columnHeaders||[];
  const idx=Object.fromEntries(headers.map((h,i)=>[h.name,i]));
  const rawDailyRows=daily.rows||[];
  const dailyMap=new Map(rawDailyRows.map(row=>[String(row[idx.day]),row]));
  const series=[];
  let daysFilledZero=0;
  for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
   const key=dateOnly(d),row=dailyMap.get(key);
   if(!row)daysFilledZero++;
   series.push({
    date:key,
    views:Number(row?.[idx.views]||0),
    minutes_watched:Number(row?.[idx.estimatedMinutesWatched]||0),
    subscribers_gained:Number(row?.[idx.subscribersGained]||0),
    subscribers_lost:Number(row?.[idx.subscribersLost]||0)
   });
  }
  const totalHeaders=aggregate.columnHeaders||[];
  const totalIdx=Object.fromEntries(totalHeaders.map((h,i)=>[h.name,i]));
  const totalRow=(aggregate.rows||[])[0]||[];
  const totals={
   views:Number(totalRow[totalIdx.views]||0),
   minutes_watched:Number(totalRow[totalIdx.estimatedMinutesWatched]||0),
   subscribers_gained:Number(totalRow[totalIdx.subscribersGained]||0),
   subscribers_lost:Number(totalRow[totalIdx.subscribersLost]||0)
  };
  const topVideos=(top.rows||[]).map(row=>({id:row[0],title:details[row[0]]||"Vidéo YouTube",views:Number(row[1]||0),minutes_watched:Number(row[2]||0),average_view_seconds:Number(row[3]||0),url:"https://www.youtube.com/watch?v="+encodeURIComponent(row[0])}));
  return json({range:days,start_date:startDate,end_date:endDate,series,daily_api_rows_returned:rawDailyRows.length,daily_days_filled_zero:daysFilledZero,top_videos:topVideos,totals,totals_source:"aggregate_youtube_analytics_report",synced_at:new Date().toISOString()});
 }catch(e){
  console.error("NURIA_YOUTUBE_ANALYTICS_ERROR",JSON.stringify({stage,message:String(e?.message||"erreur inconnue").slice(0,220)}));
  return json({error:String(e?.message||"Erreur lors de la lecture des statistiques YouTube."),stage},502);
 }
}
