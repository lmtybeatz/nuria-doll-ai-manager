const clear="amm_meta_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/meta; Max-Age=0";
const redirect=(origin,query)=>new Response(null,{status:302,headers:{location:origin+"/?meta="+query,"set-cookie":clear,"cache-control":"no-store"}});
const b64decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function verifyCookie(value,secret){
 const parts=value.split(".");if(parts.length!==2)return null;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const valid=await crypto.subtle.verify("HMAC",key,b64decode(parts[1]),new TextEncoder().encode(parts[0]));
 return valid?JSON.parse(new TextDecoder().decode(b64decode(parts[0]))):null;
}
async function encrypt(value,keyB64){
 const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("META_TOKEN_ENCRYPTION_KEY doit contenir 32 octets en Base64.");
 const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));
 return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(data)));
}
async function graphCollection(version,edge,token,fields){
 const url=new URL("https://graph.facebook.com/"+version+"/"+edge);
 url.searchParams.set("fields",fields);url.searchParams.set("limit","100");url.searchParams.set("access_token",token);
 const items=[];let next=url.toString(),pages=0;
 while(next&&pages<25){
  const parsed=new URL(next);
  if(parsed.hostname!=="graph.facebook.com")throw new Error("URL de pagination Graph API non autorisée.");
  const response=await fetch(parsed),data=await response.json();
  if(!response.ok||data.error)throw new Error("Lecture Graph API impossible ("+String(data.error?.code||response.status)+").");
  if(Array.isArray(data.data))items.push(...data.data);
  next=data.paging?.next||null;pages++;
 }
 if(next)throw new Error("La pagination Graph API dépasse la limite de sécurité.");
 return items;
}
export async function onRequestGet({request,env}){
 const origin=new URL(request.url).origin,fail=reason=>redirect(origin,"error&reason="+encodeURIComponent(reason));
 try{
  const cookie=(request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("amm_meta_oauth="))?.slice("amm_meta_oauth=".length);
  if(!cookie||!env.META_OAUTH_STATE_SECRET)return fail("cookie_ou_secret_absent");
  const payload=await verifyCookie(cookie,env.META_OAUTH_STATE_SECRET);if(!payload)return fail("signature_invalide");
  const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state");
  if(u.searchParams.has("error"))return fail("autorisation_refusee");
  if(!code||state!==payload.state||payload.exp<Date.now())return fail("etat_invalide_ou_expire");
  const version=env.META_GRAPH_API_VERSION,redirectUri=env.META_REDIRECT_URI;
  if(!env.META_APP_ID||!env.META_APP_SECRET||!env.META_LOGIN_CONFIG_ID||!env.META_TOKEN_ENCRYPTION_KEY)return fail("configuration_meta_incomplete");
  // Unified Login returns a system-user access token: no fb_exchange_token long-lived-user-token exchange.
  const exchange=new URL("https://graph.facebook.com/"+version+"/oauth/access_token");
  exchange.searchParams.set("client_id",env.META_APP_ID);exchange.searchParams.set("client_secret",env.META_APP_SECRET);
  exchange.searchParams.set("redirect_uri",redirectUri);exchange.searchParams.set("code",code);
  const tokenResponse=await fetch(exchange),tokenData=await tokenResponse.json();
  if(!tokenResponse.ok||!tokenData.access_token)throw new Error("Échange du code Unified Login refusé ("+String(tokenData.error?.code||tokenResponse.status)+").");
  const accessToken=tokenData.access_token;
  // Retrieve both asset families. Pages are read without requesting page tokens until Page-management permissions are approved.
  const [pagesRaw,instagramRaw]=await Promise.all([
   graphCollection(version,"me/accounts",accessToken,"id,name,access_token,instagram_business_account{id,username}"),
   graphCollection(version,"me/assigned_instagram_accounts",accessToken,"id,username,name,profile_picture_url,permitted_roles")
  ]);
  const pages=pagesRaw.map(p=>({
   id:String(p.id),name:p.name||"",access_token:p.access_token||null,
   instagram_business_account:p.instagram_business_account?.id?{
    id:String(p.instagram_business_account.id),username:p.instagram_business_account.username||null
   }:null
  }));
  const instagramMap=new Map();
  for(const account of instagramRaw){
   if(account?.id)instagramMap.set(String(account.id),{
    id:String(account.id),username:account.username||null,name:account.name||null,
    profile_picture_url:account.profile_picture_url||null,
    permitted_roles:Array.isArray(account.permitted_roles)?account.permitted_roles:[]
   });
  }
  // Keep linked Instagram accounts visible even if Meta omits them from the assigned-assets edge.
  for(const page of pages){
   const linked=page.instagram_business_account;
   if(linked?.id&&!instagramMap.has(linked.id))instagramMap.set(linked.id,{id:linked.id,username:linked.username,name:null,profile_picture_url:null,permitted_roles:[]});
  }
  const instagramAccounts=[...instagramMap.values()];
  if(!instagramAccounts.length)throw new Error("Aucun compte Instagram professionnel attribué à cette connexion Meta.");
  const pagesForUi=pages.map(page=>{
   const ig=page.instagram_business_account?.id?instagramMap.get(page.instagram_business_account.id):null;
   return {page_id:page.id,page_name:page.name,instagram_id:ig?.id||null,instagram_username:ig?.username||null};
  });
  const encrypted=await encrypt({
   token_type:"system_user",
   system_user_access_token:accessToken,
   user_access_token:accessToken,
   pages,
   instagram_accounts:instagramAccounts
  },env.META_TOKEN_ENCRYPTION_KEY);
  const metadata={
   pages:pagesForUi,
   instagram_accounts:instagramAccounts.map(account=>({
    instagram_id:account.id,instagram_username:account.username,
    name:account.name,profile_picture_url:account.profile_picture_url,
    permitted_roles:account.permitted_roles
   })),
   token_type:"system_user",
   connected_at:new Date().toISOString()
  };
  const base=env.SUPABASE_URL.replace(/\/$/,""),admin={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const artist=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(payload.artistId)+"&owner_id=eq."+encodeURIComponent(payload.uid)+"&status=eq.active&select=id",{headers:admin});
  if(!artist.ok||!(await artist.json()).length)throw new Error("Espace artiste invalide ou non autorisé.");
  const scopes=["business_management","pages_show_list","pages_read_engagement","read_insights","instagram_basic","instagram_manage_insights","instagram_content_publish","instagram_manage_comments","instagram_manage_messages"];
  const save=await fetch(base+"/rest/v1/ai_social_connections?on_conflict=owner_id,artist_id,provider",{
   method:"POST",headers:{...admin,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},
   body:JSON.stringify({owner_id:payload.uid,artist_id:payload.artistId,provider:"meta",token_ciphertext:encrypted,scopes,account_metadata:metadata,connected_at:new Date().toISOString(),updated_at:new Date().toISOString()})
  });
  if(!save.ok)throw new Error("Enregistrement sécurisé de la connexion Meta impossible.");
  return redirect(origin,"connected");
 }catch(error){
  console.error("AI_MUSIC_MANAGER_META_OAUTH",String(error?.message||"erreur").slice(0,220));
  return fail("connexion_impossible");
 }
}
