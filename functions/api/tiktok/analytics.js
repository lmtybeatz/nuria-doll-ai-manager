import {getTikTokContext,tiktokApi} from "../../_shared/tiktok-auth.js";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const VIDEO_FIELDS="id,title,video_description,duration,cover_image_url,share_url,embed_link,view_count,like_count,comment_count,share_count,create_time";
const PROFILE_FIELDS="open_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count";
const PROFILE_EXTRA_FIELDS="username,profile_deep_link,bio_description,is_verified";
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

export async function onRequestGet({request,env}){
 const url=new URL(request.url),artistId=url.searchParams.get("artist_id"),rawCursor=url.searchParams.get("cursor");
 if(!artistId)return reply({error:"Espace artiste manquant."},400);
 let cursor=null;
 if(rawCursor!==null){cursor=Number(rawCursor);if(!Number.isSafeInteger(cursor)||cursor<0)return reply({error:"Curseur de pagination invalide."},400);}
 try{
  const ctx=await getTikTokContext(request,env,artistId),warnings=[];
  let account={};
  try{
   const profileFields=ctx.scopes.includes("user.info.profile")?PROFILE_FIELDS+","+PROFILE_EXTRA_FIELDS:PROFILE_FIELDS;
   const response=await fetch("https://open.tiktokapis.com/v2/user/info/?fields="+encodeURIComponent(profileFields),{headers:{authorization:"Bearer "+ctx.token.access_token}});
   const payload=await response.json().catch(()=>({}));
   if(!response.ok||payload.error?.code&&payload.error.code!=="ok")throw new Error(payload.error?.message||"Profil TikTok indisponible.");
   account=payload.data?.user||{};
  }catch(error){warnings.push("Profil : "+error.message);}
  let videos=[],nextCursor=null,hasMore=false;
  try{
   const body={max_count:20};if(cursor!==null)body.cursor=cursor;
   const data=await tiktokApi("/v2/video/list/",ctx.token.access_token,body,VIDEO_FIELDS);
   videos=Array.isArray(data.videos)?data.videos:[];
   nextCursor=data.cursor??null;hasMore=Boolean(data.has_more);
  }catch(error){warnings.push("Vidéos : "+error.message);}
  return reply({account,videos,cursor:nextCursor,has_more:hasMore,warnings,synced_at:new Date().toISOString()});
 }catch(error){
  return reply({error:error.message||"Statistiques TikTok indisponibles.",missing:error.missing||undefined},error.status||502);
 }
}
