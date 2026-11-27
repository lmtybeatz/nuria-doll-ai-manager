const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const allowedWorkflow=new Set(["new","read","drafted","awaiting_approval","ignored"]);
function getBearer(request){return (request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||null;}
async function getContext(request,env,artistId){
  const required=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"];
  const missing=required.filter(key=>!env[key]);
  if(missing.length)throw Object.assign(new Error("Configuration serveur incomplète."),{status:503,missing});
  const token=getBearer(request);if(!token)throw Object.assign(new Error("Connexion requise."),{status:401});
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const userResponse=await fetch(base+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token}});
  if(!userResponse.ok)throw Object.assign(new Error("Session expirée."),{status:401});
  const user=await userResponse.json();if(!user?.id)throw Object.assign(new Error("Session invalide."),{status:401});
  if(!artistId)throw Object.assign(new Error("Espace artiste manquant."),{status:400});
  const admin={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const artistResponse=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id,artist_name",{headers:admin});
  if(!artistResponse.ok||!(await artistResponse.json()).length)throw Object.assign(new Error("Espace artiste introuvable ou non autorisé."),{status:404});
  return {base,user,artistId,admin};
}
function safeText(value,max=5000){return typeof value==="string"?value.trim().slice(0,max):"";}
function normalizedDate(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value==="number"||/^\d+(?:\.\d+)?$/.test(String(value))){
    const n=Number(value),ms=n>1e12?n:n*1000;
    const date=new Date(ms);return Number.isNaN(date.getTime())?null:date.toISOString();
  }
  const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();
}
function safeUrl(value){
  try{const url=new URL(String(value||"")),host=url.hostname.toLowerCase();return url.protocol==="https:"&&(host==="tiktok.com"||host.endsWith(".tiktok.com"))?url.href:null;}catch{return null;}
}
async function handleGet({request,env}){
  try{
    const url=new URL(request.url),ctx=await getContext(request,env,url.searchParams.get("artist_id"));
    const provider=url.searchParams.get("provider"),status=url.searchParams.get("status");
    const query=new URLSearchParams({
      owner_id:"eq."+ctx.user.id,
      artist_id:"eq."+ctx.artistId,
      select:"id,provider,external_comment_id,external_parent_id,external_media_id,media_title,media_url,author_name,message_text,comment_created_at,like_count,reply_count,platform_status,workflow_status,intent,risk_level,ai_draft,published_reply,replied_at,last_synced_at,created_at,updated_at",
      order:"comment_created_at.desc.nullslast,created_at.desc",
      limit:"200"
    });
    if(provider&&provider!=="all")query.set("provider","eq."+provider);
    if(status&&status!=="all")query.set("workflow_status","eq."+status);
    const response=await fetch(ctx.base+"/rest/v1/ai_community_messages?"+query.toString(),{headers:ctx.admin});
    const data=await response.json().catch(()=>[]);
    if(!response.ok)return json({error:"Lecture de la boîte de réception impossible."},502);
    return json({messages:Array.isArray(data)?data:[]});
  }catch(error){return json({error:error.message||"Boîte de réception indisponible.",missing:error.missing||undefined},error.status||500);}
}
async function handlePost({request,env}){
  let body={};try{body=await request.json();}catch{return json({error:"Requête JSON invalide."},400);}
  try{
    const ctx=await getContext(request,env,body.artist_id);
    if(!Array.isArray(body.messages)||body.messages.length>100)return json({error:"Envoie une liste de 1 à 100 commentaires maximum."},400);
    const rows=[];
    for(const item of body.messages){
      const id=safeText(item?.external_comment_id||item?.id,180),mediaId=safeText(item?.external_media_id||item?.video_id,180);
      const message=safeText(item?.message_text||item?.text,5000);
      if(!id||!mediaId||!message)continue;
      const provider=safeText(item?.provider||"tiktok",20);
      if(provider!=="tiktok")return json({error:"La synchronisation disponible dans cette première étape concerne TikTok uniquement."},400);
      const count=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(2147483647,Math.floor(n))):0;};
      rows.push({
        owner_id:ctx.user.id,artist_id:ctx.artistId,provider,
        external_comment_id:id,
        external_parent_id:safeText(item?.external_parent_id||item?.parent_id,180)||null,
        external_media_id:mediaId,
        media_title:safeText(item?.media_title,300)||null,
        media_url:safeUrl(item?.media_url),
        author_platform_id:safeText(item?.author_platform_id,180)||null,
        author_name:safeText(item?.author_name,120)||null,
        message_text:message,
        comment_created_at:normalizedDate(item?.comment_created_at||item?.create_time),
        like_count:count(item?.like_count??item?.likes),
        reply_count:count(item?.reply_count??item?.replies),
        platform_status:safeText(item?.platform_status,60)||null,
        last_synced_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      });
    }
    if(!rows.length)return json({stored:0,message:"Aucun commentaire exploitable n’a été reçu."});
    const endpoint=ctx.base+"/rest/v1/ai_community_messages?on_conflict=owner_id,artist_id,provider,external_comment_id";
    const response=await fetch(endpoint,{method:"POST",headers:{...ctx.admin,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)});
    const data=await response.json().catch(()=>[]);
    if(!response.ok)return json({error:"Enregistrement des commentaires impossible.",details:data?.message||data?.hint||null},502);
    return json({stored:Array.isArray(data)?data.length:rows.length});
  }catch(error){return json({error:error.message||"Synchronisation de commentaires impossible.",missing:error.missing||undefined},error.status||500);}
}
async function handlePatch({request,env}){
  let body={};try{body=await request.json();}catch{return json({error:"Requête JSON invalide."},400);}
  try{
    const ctx=await getContext(request,env,body.artist_id),id=safeText(body.id,80);
    if(!id)return json({error:"Identifiant du commentaire manquant."},400);
    const patch={updated_at:new Date().toISOString()};
    if(body.workflow_status!==undefined){
      if(!allowedWorkflow.has(body.workflow_status))return json({error:"État de traitement non autorisé."},400);
      patch.workflow_status=body.workflow_status;
    }
    if(body.ai_draft!==undefined){
      if(typeof body.ai_draft!=="string"||body.ai_draft.trim().length>150)return json({error:"Un brouillon de réponse TikTok ne peut pas dépasser 150 caractères, espaces compris."},400);
      patch.ai_draft=body.ai_draft.trim();
      if(!patch.workflow_status)patch.workflow_status="drafted";
    }
    if(body.published_reply!==undefined){
      if(typeof body.published_reply!=="string"||!body.published_reply.trim()||body.published_reply.length>150)return json({error:"La réponse publiée est invalide ou dépasse 150 caractères."},400);
      patch.published_reply=body.published_reply.trim();
      patch.replied_at=new Date().toISOString();
      patch.workflow_status="replied";
    }
    if(body.platform_reply_id!==undefined){
      if(typeof body.platform_reply_id!=="string"||body.platform_reply_id.length>180)return json({error:"Identifiant de réponse invalide."},400);
      patch.platform_reply_id=body.platform_reply_id||null;
    }
    if(Object.keys(patch).length===1)return json({error:"Aucune modification reçue."},400);
    const endpoint=ctx.base+"/rest/v1/ai_community_messages?id=eq."+encodeURIComponent(id)+"&owner_id=eq."+encodeURIComponent(ctx.user.id)+"&artist_id=eq."+encodeURIComponent(ctx.artistId);
    const response=await fetch(endpoint,{method:"PATCH",headers:{...ctx.admin,"content-type":"application/json",prefer:"return=representation"},body:JSON.stringify(patch)});
    const data=await response.json().catch(()=>[]);
    if(!response.ok)return json({error:"Mise à jour du commentaire impossible."},502);
    if(!Array.isArray(data)||!data.length)return json({error:"Commentaire introuvable pour cet artiste."},404);
    return json({message:data[0]});
  }catch(error){return json({error:error.message||"Mise à jour impossible.",missing:error.missing||undefined},error.status||500);}
}

export async function onRequest(context){
  const method=context.request.method.toUpperCase();
  if(method==="GET")return handleGet(context);
  if(method==="POST")return handlePost(context);
  if(method==="PATCH")return handlePatch(context);
  return json({error:"Méthode non autorisée."},405);
}
