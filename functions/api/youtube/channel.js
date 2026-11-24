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
 if(!ivText||!dataText)throw new Error("Jeton chiffré illisible.");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(ivText),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(dataText),c=>c.charCodeAt(0)));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function onRequestGet({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","YOUTUBE_CLIENT_ID","YOUTUBE_CLIENT_SECRET","YOUTUBE_TOKEN_ENCRYPTION_KEY"].filter(k=>!env[k]);
  if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  stage="verification_session";
  const u=await verify(request,env);if(!u?.id)return json({error:"Connexion parent/manager requise."},401);
  stage="lecture_jeton";
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const artistId=new URL(request.url).searchParams.get("artist_id");
  if(!artistId)return json({error:"Espace artiste manquant."},400);
  const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!ar.ok)return json({error:"Vérification de l'espace artiste impossible."},502);
  if(!(await ar.json()).length)return json({error:"Espace artiste introuvable ou non autorisé."},404);
  const q=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.youtube&select=token_ciphertext,connected_at,scopes",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!q.ok)return json({error:"Impossible de lire la connexion YouTube.",stage,http_status:q.status},502);
  const rows=await q.json();if(!rows.length)return json({error:"Aucune chaîne YouTube connectée."},404);
  if(!(rows[0].scopes||[]).includes("https://www.googleapis.com/auth/youtube.readonly"))return json({error:"L'autorisation YouTube en lecture seule est absente. Reconnecte la chaîne."},403);
  stage="dechiffrement_jeton";
  const tokens=await decrypt(rows[0].token_ciphertext,env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
  if(!tokens.refresh_token)throw new Error("Jeton de renouvellement absent. Reconnecte YouTube.");
  stage="renouvellement_google";
  const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
  const refreshed=await tr.json();
  if(!tr.ok||!refreshed.access_token)return json({error:"Google n'a pas pu renouveler l'accès. Reconnecte YouTube.",stage,google_error:refreshed.error||"refresh_failed"},502);
  stage="lecture_chaine";
  const cr=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",{headers:{authorization:"Bearer "+refreshed.access_token}});
  const cd=await cr.json();
  if(!cr.ok)return json({error:"Google n'a pas pu retourner les informations de la chaîne.",stage,google_error:cd.error?.errors?.[0]?.reason||cd.error?.status||"youtube_api_error"},502);
  const c=cd.items?.[0];if(!c)return json({error:"Aucune chaîne YouTube n'a été trouvée pour ce compte Google."},404);
  const sn=c.snippet||{},st=c.statistics||{};
  return json({connected:true,connected_at:rows[0].connected_at,channel:{id:c.id,title:sn.title||"",description:sn.description||"",custom_url:sn.customUrl||"",published_at:sn.publishedAt||null,thumbnail:sn.thumbnails?.high?.url||sn.thumbnails?.medium?.url||sn.thumbnails?.default?.url||"",view_count:st.viewCount??null,subscriber_count:st.hiddenSubscriberCount?null:(st.subscriberCount??null),subscribers_hidden:!!st.hiddenSubscriberCount,video_count:st.videoCount??null,url:"https://www.youtube.com/channel/"+encodeURIComponent(c.id)},synced_at:new Date().toISOString()});
 }catch(e){
  console.error("NURIA_YOUTUBE_CHANNEL_ERROR",JSON.stringify({stage,message:String(e?.message||"erreur inconnue").slice(0,180)}));
  return json({error:String(e?.message||"Erreur lors de la lecture de la chaîne YouTube."),stage},500);
 }
}
