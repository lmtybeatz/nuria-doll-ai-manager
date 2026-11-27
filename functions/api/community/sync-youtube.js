const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
async function user(request,env){const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});return r.ok?await r.json():null;}
async function decrypt(v,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement YouTube invalide.");const [iv,data]=v.split(".");const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));return JSON.parse(new TextDecoder().decode(bytes));}
async function google(url,token){const r=await fetch(url,{headers:{authorization:"Bearer "+token}}),d=await r.json();if(!r.ok)throw new Error(String(d.error?.message||d.error?.errors?.[0]?.reason||"Erreur YouTube API").slice(0,220));return d;}
function norm(comment,video){const s=comment.snippet||{},id=String(comment.id||"");const text=String(s.textOriginal||s.textDisplay||"").trim();if(!id||!text)return null;return {provider:"youtube",external_comment_id:id,external_parent_id:s.parentId||null,external_media_id:String(video.id),media_title:video.title||"Vidéo YouTube",media_url:"https://www.youtube.com/watch?v="+encodeURIComponent(video.id),author_platform_id:String(s.authorChannelId?.value||""),author_name:String(s.authorDisplayName||"Utilisateur YouTube"),message_text:text.slice(0,5000),comment_created_at:s.publishedAt||null,like_count:Math.max(0,Number(s.likeCount||0)),reply_count:0,platform_status:s.moderationStatus||"published"};}
async function save(base,admin,owner,artist,rows){const unique=[...new Map(rows.filter(Boolean).map(x=>[x.external_comment_id,x])).values()];let stored=0;for(let i=0;i<unique.length;i+=100){const batch=unique.slice(i,i+100).map(x=>({...x,owner_id:owner,artist_id:artist,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()}));const r=await fetch(base+"/rest/v1/ai_community_messages?on_conflict=owner_id,artist_id,provider,external_comment_id",{method:"POST",headers:{...admin,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch)});if(!r.ok)throw new Error("Enregistrement des commentaires YouTube impossible.");stored+=batch.length;}return stored;}
export async function onRequestPost({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","YOUTUBE_CLIENT_ID","YOUTUBE_CLIENT_SECRET","YOUTUBE_TOKEN_ENCRYPTION_KEY"].filter(k=>!env[k]);if(missing.length)return json({error:"Configuration YouTube incomplète.",missing},503);
  stage="session";const u=await user(request,env);if(!u?.id)return json({error:"Connexion requise."},401);
  const body=await request.json().catch(()=>({})),artistId=body.artist_id;if(!artistId)return json({error:"Espace artiste manquant."},400);
  const base=env.SUPABASE_URL.replace(/\/$/,""),admin={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:admin});if(!ar.ok||!(await ar.json()).length)return json({error:"Espace artiste non autorisé."},404);
  stage="connexion";const cr=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.youtube&select=token_ciphertext,scopes",{headers:admin});if(!cr.ok)return json({error:"Connexion YouTube indisponible."},502);const rows=await cr.json();if(!rows.length)return json({error:"Connecte d'abord la chaîne YouTube de cet artiste."},404);
  if(!(rows[0].scopes||[]).includes("https://www.googleapis.com/auth/youtube.readonly"))return json({error:"Autorisation YouTube en lecture seule manquante. Reconnecte la chaîne."},403);
  const tokens=await decrypt(rows[0].token_ciphertext,env.YOUTUBE_TOKEN_ENCRYPTION_KEY);if(!tokens.refresh_token)throw new Error("Jeton de renouvellement Google absent. Reconnecte YouTube.");
  stage="renouvellement";const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.YOUTUBE_CLIENT_ID,client_secret:env.YOUTUBE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})}),td=await tr.json();if(!tr.ok||!td.access_token)throw new Error("Google n'a pas pu renouveler l'accès YouTube. Reconnecte la chaîne.");
  const access=td.access_token;stage="chaine";const ch=await google("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",access),channel=ch.items?.[0];if(!channel)throw new Error("Aucune chaîne YouTube trouvée.");
  const playlist=channel.contentDetails?.relatedPlaylists?.uploads;if(!playlist)throw new Error("Playlist des vidéos de la chaîne introuvable.");
  stage="videos";const pl=await google("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId="+encodeURIComponent(playlist)+"&maxResults=10",access);
  const videos=(pl.items||[]).map(x=>({id:x.contentDetails?.videoId,title:x.snippet?.title||"Vidéo YouTube"})).filter(x=>x.id),all=[],warnings=[];
  for(const video of videos){
   try{
    let pageToken="",pages=0;
    do{
     const params=new URLSearchParams({part:"snippet,replies",videoId:video.id,maxResults:"100",order:"time",textFormat:"plainText"});if(pageToken)params.set("pageToken",pageToken);
     const data=await google("https://www.googleapis.com/youtube/v3/commentThreads?"+params.toString(),access);
     for(const thread of data.items||[]){
      const top=thread.snippet?.topLevelComment;if(top){const item=norm(top,video);if(item){item.reply_count=Number(thread.snippet?.totalReplyCount||0);all.push(item);}}
      for(const reply of thread.replies?.comments||[]){const item=norm(reply,video);if(item)all.push(item);}
     }
     pageToken=data.nextPageToken||"";pages++;
    }while(pageToken&&pages<2);
   }catch(e){warnings.push(video.title+": "+e.message);}
  }
  stage="enregistrement";const stored=await save(base,admin,u.id,artistId,all);
  return json({success:true,stored,videos_checked:videos.length,warnings,synced_at:new Date().toISOString()});
 }catch(e){console.error("COMMUNITY_YOUTUBE_SYNC",JSON.stringify({stage,message:String(e?.message||"erreur").slice(0,220)}));return json({error:String(e?.message||"Synchronisation YouTube impossible."),stage},502);}
}
