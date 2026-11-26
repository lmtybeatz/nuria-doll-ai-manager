import {getTikTokContext} from "../../_shared/tiktok-auth.js";
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestPost({request,env}){
 try{
  const url=new URL(request.url),ctx=await getTikTokContext(request,env,url.searchParams.get("artist_id"));
  const uploadUrl=request.headers.get("x-tiktok-upload-url")||"",range=request.headers.get("content-range")||"",type=request.headers.get("content-type")||"video/mp4";
  let parsed;try{parsed=new URL(uploadUrl);}catch{}
  if(!parsed||parsed.protocol!=="https:"||parsed.hostname!=="open-upload.tiktokapis.com"||!parsed.pathname.startsWith("/"))return reply({error:"URL de téléversement TikTok invalide."},400);
  if(!/^bytes \d+-\d+\/\d+$/.test(range))return reply({error:"En-tête Content-Range invalide."},400);
  const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>64*1024*1024)return reply({error:"Bloc vidéo invalide (maximum 64 Mo par bloc)."},400);
  const upstream=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Range":range,"Content-Type":type,"Content-Length":String(bytes.byteLength)},body:bytes});
  const text=await upstream.text();if(!upstream.ok)return reply({error:"TikTok a refusé un bloc vidéo.",upstream_status:upstream.status,details:text.slice(0,500)},502);
  return reply({uploaded:true,status:upstream.status});
 }catch(e){return reply({error:e.message||"Téléversement TikTok impossible.",missing:e.missing||undefined},e.status||502);}
}
