import {getTikTokContext,tiktokApi} from "../../_shared/tiktok-auth.js";
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export async function onRequestPost({request,env}){
 let body={};try{body=await request.json();}catch{return reply({error:"Requête JSON invalide."},400);}
 try{
  const ctx=await getTikTokContext(request,env,body.artist_id),token=ctx.token.access_token,action=body.action;
  if(action==="creator_info"){
   const data=await tiktokApi("/v2/post/publish/creator_info/query/",token,{});
   return reply({creator:data,scopes:ctx.scopes});
  }
  if(action==="init_video"||action==="init_draft"){
   if(!body.title||typeof body.title!=="string"||body.title.length>2200)return reply({error:"Ajoute une légende de 2 200 caractères maximum."},400);
   const draft=action==="init_draft",size=Number(body.video_size);
   if(!Number.isSafeInteger(size)||size<1||size>4*1024*1024*1024)return reply({error:"Taille de vidéo invalide (maximum 4 Go)."},400);
   const chunkSize=Math.min(size,10*1024*1024),total=Math.ceil(size/chunkSize),privacy=String(body.privacy_level||"SELF_ONLY");
   if(!draft&&!privacy)return reply({error:"Choisis une visibilité avant la publication."},400);\n   if(!draft&&body.commercial_disclosure&&!body.brand_organic_toggle&&!body.brand_content_toggle)return reply({error:"Indique le type de contenu commercial."},400);\n   const postInfo={title:body.title,privacy_level:privacy,disable_comment:!!body.disable_comment,disable_duet:!!body.disable_duet,disable_stitch:!!body.disable_stitch,brand_organic_toggle:!!body.brand_organic_toggle,brand_content_toggle:!!body.brand_content_toggle,is_aigc:!!body.is_aigc};
   const path=draft?"/v2/post/publish/inbox/video/init/":"/v2/post/publish/video/init/";
   const requestBody=draft?{source_info:{source:"FILE_UPLOAD",video_size:size,chunk_size:chunkSize,total_chunk_count:total}}:{post_info:postInfo,source_info:{source:"FILE_UPLOAD",video_size:size,chunk_size:chunkSize,total_chunk_count:total}};
   const data=await tiktokApi(path,token,requestBody);
   if(!data.upload_url||!data.publish_id)throw new Error("TikTok n’a pas fourni les informations de téléversement.");
   return reply({publish_id:data.publish_id,upload_url:data.upload_url,chunk_size:chunkSize,total_chunks:total,draft});
  }
  if(action==="init_photo"){
   const images=Array.isArray(body.photo_images)?body.photo_images.filter(x=>typeof x==="string"&&/^https:\/\//i.test(x)):[];if(!images.length||images.length>35)return reply({error:"Fournis entre 1 et 35 URL d’images HTTPS hébergées sur un domaine vérifié par TikTok."},400);
   if(!body.draft&&!body.privacy_level)return reply({error:"Choisis une visibilité avant la publication photo."},400);\n   if(!body.draft&&body.commercial_disclosure&&!body.brand_organic_toggle&&!body.brand_content_toggle)return reply({error:"Indique le type de contenu commercial."},400);\n   const postInfo=body.draft?{title:String(body.title||"").slice(0,90),description:String(body.description||"").slice(0,4000)}:{title:String(body.title||"").slice(0,90),description:String(body.description||"").slice(0,4000),privacy_level:body.privacy_level,disable_comment:!!body.disable_comment,auto_add_music:!!body.auto_add_music,brand_organic_toggle:!!body.brand_organic_toggle,brand_content_toggle:!!body.brand_content_toggle};\n   const data=await tiktokApi("/v2/post/publish/content/init/",token,{post_info:postInfo,source_info:{source:"PULL_FROM_URL",photo_images:images,photo_cover_index:0},post_mode:body.draft?"MEDIA_UPLOAD":"DIRECT_POST",media_type:"PHOTO",is_aigc:!!body.is_aigc});
   return reply({publish_id:data.publish_id,draft:!!body.draft});
  }
  if(action==="status"){
   if(!body.publish_id)return reply({error:"Identifiant de publication manquant."},400);
   const data=await tiktokApi("/v2/post/publish/status/fetch/",token,{publish_id:body.publish_id});
   return reply({status:data.status,fail_reason:data.fail_reason||null,post_ids:data.publicaly_available_post_id||[],uploaded_bytes:data.uploaded_bytes??null,downloaded_bytes:data.downloaded_bytes??null});
  }
  return reply({error:"Action TikTok non reconnue."},400);
 }catch(e){return reply({error:e.message||"Opération TikTok impossible.",missing:e.missing||undefined,details:e.details||undefined},e.status||502);}
}
