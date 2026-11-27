const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
async function decrypt(value,keyB64){
 const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));
 if(raw.length!==32)throw new Error("Clé de chiffrement TikTok invalide.");
 const [iv,data]=String(value||"").split(".");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
 return JSON.parse(new TextDecoder().decode(plain));
}
export async function onRequestPost({request,env}){
 const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY"].filter(k=>!env[k]);
 if(missing.length)return Response.json({error:"Configuration serveur incomplète.",missing},{status:503,headers:H});
 const match=(request.headers.get("authorization")||"").match(/^Bearer\\s+(.+)$/i);
 if(!match)return Response.json({error:"Connexion requise."},{status:401,headers:H});
 const base=env.SUPABASE_URL.replace(/\\/$/,"");
 const auth=await fetch(base+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
 const user=auth.ok?await auth.json():null;
 if(!user?.id)return Response.json({error:"Session invalide."},{status:401,headers:H});
 const body=await request.json().catch(()=>({})),artistId=String(body.artist_id||"");
 if(!artistId)return Response.json({error:"Espace artiste manquant."},{status:400,headers:H});
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
 const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=id",{headers});
 if(!artist.ok||!(await artist.json()).length)return Response.json({error:"Espace artiste non autorisé."},{status:404,headers:H});
 const query=base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(user.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.tiktok";
 const connection=await fetch(query+"&select=token_ciphertext",{headers});
 if(!connection.ok)return Response.json({error:"Connexion TikTok introuvable."},{status:502,headers:H});
 const row=(await connection.json())[0];
 if(!row)return Response.json({disconnected:true,revoked:true},{headers:H});
 let revoked=false,warning="";
 try{
  if(!env.META_TOKEN_ENCRYPTION_KEY||!env.TIKTOK_CLIENT_KEY||!env.TIKTOK_CLIENT_SECRET)throw new Error("Configuration de révocation indisponible.");
  const token=await decrypt(row.token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY);
  if(!token.access_token)throw new Error("Jeton TikTok absent.");
  const form=new URLSearchParams({client_key:env.TIKTOK_CLIENT_KEY,client_secret:env.TIKTOK_CLIENT_SECRET,token:token.access_token});
  const revoke=await fetch("https://open.tiktokapis.com/v2/oauth/revoke/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","cache-control":"no-cache"},body:form});
  if(!revoke.ok)throw new Error("TikTok n’a pas confirmé la révocation distante.");
  const result=await revoke.json().catch(()=>({}));
  if(result.error||result.error_description)throw new Error(result.error_description||result.error);
  revoked=true;
 }catch(error){warning=String(error?.message||"Révocation distante non confirmée").slice(0,220);}
 const removed=await fetch(query,{method:"DELETE",headers});
 if(!removed.ok)return Response.json({error:"Impossible de retirer la connexion TikTok de cet artiste."},{status:502,headers:H});
 return Response.json({disconnected:true,revoked,warning:warning||null},{headers:H});
}
