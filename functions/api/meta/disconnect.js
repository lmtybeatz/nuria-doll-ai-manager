const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
export async function onRequestPost({request,env}){
 const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return Response.json({error:"Connexion requise."},{status:401,headers:H});
 const userResponse=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});
 const user=userResponse.ok?await userResponse.json():null;if(!user?.id)return Response.json({error:"Session invalide."},{status:401,headers:H});
 const body=await request.json().catch(()=>({}));if(!body.artist_id)return Response.json({error:"Espace artiste manquant."},{status:400,headers:H});
 const base=env.SUPABASE_URL.replace(/\/$/,""),headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
 const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(body.artist_id)+"&owner_id=eq."+encodeURIComponent(user.id)+"&select=id",{headers});
 if(!artist.ok||!(await artist.json()).length)return Response.json({error:"Espace artiste non autorisé."},{status:404,headers:H});
 const r=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(user.id)+"&artist_id=eq."+encodeURIComponent(body.artist_id)+"&provider=eq.meta",{method:"DELETE",headers});
 if(!r.ok)return Response.json({error:"Déconnexion Meta impossible."},{status:502,headers:H});
 return Response.json({disconnected:true},{headers:H});
}
