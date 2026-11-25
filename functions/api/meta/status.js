const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
async function verifyUser(request,env){
 const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});
 return r.ok?await r.json():null;
}
export async function onRequestGet({request,env}){
 const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"].filter(k=>!env[k]);
 if(missing.length)return Response.json({error:"Configuration serveur incomplète.",missing},{status:503,headers:H});
 const user=await verifyUser(request,env);if(!user?.id)return Response.json({error:"Connexion requise."},{status:401,headers:H});
 const artistId=new URL(request.url).searchParams.get("artist_id");if(!artistId)return Response.json({error:"Espace artiste manquant."},{status:400,headers:H});
 const base=env.SUPABASE_URL.replace(/\/$/,""),headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
 const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id",{headers});
 if(!artist.ok||!(await artist.json()).length)return Response.json({error:"Espace artiste introuvable ou non autorisé."},{status:404,headers:H});
 const r=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(user.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.meta&select=connected_at,account_metadata,scopes",{headers});
 if(!r.ok)return Response.json({error:"État Meta indisponible."},{status:502,headers:H});
 const rows=await r.json(),row=rows[0];
 return Response.json({connected:!!row,connected_at:row?.connected_at||null,pages:row?.account_metadata?.pages||[],scopes:row?.scopes||[]},{headers:H});
}
