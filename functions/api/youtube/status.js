const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
async function user(request,env){
 const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
 if(!m)return null;
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});
 return r.ok?await r.json():null;
}
export async function onRequestGet({request,env}){
 let stage="verification_session";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"].filter(k=>!env[k]);
  if(missing.length){
   console.error("NURIA_YOUTUBE_STATUS_CONFIG",JSON.stringify({missing}));
   return Response.json({error:"Configuration serveur incomplète.",missing},{status:503,headers:H});
  }
  const u=await user(request,env);
  if(!u?.id)return Response.json({error:"Connexion requise."},{status:401,headers:H});
  stage="lecture_supabase";
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const artistId=new URL(request.url).searchParams.get("artist_id");
  if(!artistId)return Response.json({error:"Espace artiste manquant."},{status:400,headers:H});
  const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!ar.ok){
   const raw=await ar.text();let detail={};try{const parsed=JSON.parse(raw);detail={code:parsed.code||null,message:parsed.message||null,hint:parsed.hint||null};}catch{detail.message=raw.slice(0,240);}
   console.error("NURIA_YOUTUBE_ARTIST_VERIFY",JSON.stringify({http_status:ar.status,...detail}));
   return Response.json({error:"Vérification de l'espace artiste impossible.",diagnostic:{http_status:ar.status,code:detail.code,message:detail.message,hint:detail.hint}},{status:502,headers:H});
  }
  if(!(await ar.json()).length)return Response.json({error:"Espace artiste introuvable ou non autorisé."},{status:404,headers:H});
  const r=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.youtube&select=connected_at,scopes",{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY}});
  if(!r.ok){
   console.error("NURIA_YOUTUBE_STATUS_ERROR",JSON.stringify({stage,http_status:r.status}));
   return Response.json({error:"État de connexion indisponible.",stage,http_status:r.status},{status:502,headers:H});
  }
  const rows=await r.json();
  return Response.json({connected:rows.length>0,connected_at:rows[0]?.connected_at||null,scopes:rows[0]?.scopes||[]},{headers:H});
 }catch(e){
  console.error("NURIA_YOUTUBE_STATUS_ERROR",JSON.stringify({stage,message:String(e?.message||"erreur inconnue").slice(0,180)}));
  return Response.json({error:"Erreur interne lors de la vérification YouTube.",stage},{status:500,headers:H});
 }
}
