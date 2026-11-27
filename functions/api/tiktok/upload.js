import {getTikTokContext} from "../../_shared/tiktok-auth.js";
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestPost({request,env}){
 try{
  const url=new URL(request.url),ctx=await getTikTokContext(request,env,url.searchParams.get("artist_id"));
  if(env.TIKTOK_CONTENT_POSTING_ENABLED!=="true"||!ctx.scopes.includes("video.upload"))return reply({error:"Permission TikTok manquante : video.upload."},403);
  const uploadUrl=request.headers.get("x-tiktok-upload-url")||"",range=request.headers.get("content-range")||"",type=request.headers.get("content-type")||"video/mp4";
  let parsed;try{parsed=new URL(uploadUrl);}catch{}
  if(!parsed||parsed.protocol!=="https:"||parsed.hostname!=="open-upload.tiktokapis.com"||!parsed.pathname.startsWith("/"))return reply({error:"URL de téléversement TikTok invalide."},400);
  const match=range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if(!match)return reply({error:"En-tête Content-Range invalide."},400);
  const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(total)||start<0||end<start||total<=end)return reply({error:"Plage de téléversement incohérente."},400);
  const bytes=await request.arrayBuffer(),expectedLength=end-start+1;
  if(!bytes.byteLength||bytes.byteLength!==expectedLength||bytes.byteLength>64*1024*1024)return reply({error:"La taille du bloc ne correspond pas à Content-Range ou dépasse 64 Mo."},400);
  if(!["video/mp4","video/quicktime","video/webm"].includes(type))return reply({error:"Format vidéo non pris en charge."},400);
  const upstream=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Range":range,"Content-Length":String(bytes.byteLength),"Content-Type":type},body:bytes});
  const text=await upstream.text();if(!upstream.ok)return reply({error:"TikTok a refusé un bloc vidéo.",upstream_status:upstream.status,details:text.slice(0,500)},502);
  return reply({uploaded:true,status:upstream.status,uploaded_bytes:bytes.byteLength});
 }catch(e){return reply({error:e.message||"Téléversement TikTok impossible.",missing:e.missing||undefined},e.status||502);}
}
