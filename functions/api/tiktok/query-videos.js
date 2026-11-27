import {getTikTokContext,tiktokApi} from "../../_shared/tiktok-auth.js";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const VIDEO_FIELDS="id,title,video_description,create_time,cover_image_url,share_url,embed_link,duration,view_count,like_count,comment_count,share_count";
export async function onRequestPost({request,env}){
 let body={};
 try{body=await request.json();}catch{return reply({error:"Corps JSON invalide."},400);}
 const artistId=body.artist_id,rawIds=body.video_ids;
 if(!artistId)return reply({error:"Espace artiste manquant."},400);
 if(!Array.isArray(rawIds)||rawIds.length<1||rawIds.length>20)return reply({error:"Fournis entre 1 et 20 identifiants vidéo par requête."},400);
 const videoIds=[...new Set(rawIds.map(value=>String(value??"").trim()))];
 if(videoIds.length<1||videoIds.length>20||videoIds.some(id=>!/^\d{5,32}$/.test(id)))return reply({error:"Un ou plusieurs identifiants vidéo sont invalides."},400);
 try{
  const ctx=await getTikTokContext(request,env,artistId);
  if(!ctx.scopes.includes("video.list"))return reply({error:"L’autorisation video.list n’est pas accordée à ce compte."},403);
  const data=await tiktokApi("/v2/video/query/",ctx.token.access_token,{filters:{video_ids:videoIds}},VIDEO_FIELDS);
  return reply({videos:Array.isArray(data.videos)?data.videos:[],requested:videoIds.length,synced_at:new Date().toISOString()});
 }catch(error){
  return reply({error:error.message||"Actualisation des aperçus TikTok impossible.",missing:error.missing||undefined},error.status||502);
 }
}
