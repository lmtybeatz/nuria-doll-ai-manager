const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
async function user(request,env){const m=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);if(!m)return null;const r=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+m[1]}});return r.ok?await r.json():null;}
async function decrypt(v,keyB64){const raw=Uint8Array.from(atob(keyB64),c=>c.charCodeAt(0));if(raw.length!==32)throw new Error("Clé de chiffrement Meta invalide.");const [iv,data]=v.split(".");const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));return JSON.parse(new TextDecoder().decode(bytes));}
async function graph(url){const r=await fetch(url),d=await r.json();if(!r.ok||d.error)throw new Error(String(d.error?.message||"Erreur Graph API").slice(0,220));return d;}
async function collect(url,maxPages=4){const out=[];let next=url;for(let i=0;next&&i<maxPages;i++){const u=new URL(next);if(!["graph.facebook.com"].includes(u.hostname))throw new Error("Pagination Meta non autorisée.");const d=await graph(u);if(Array.isArray(d.data))out.push(...d.data);next=d.paging?.next||null;}return out;}
function date(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();}
function row(provider,c,media){const id=String(c.id||"").trim(),message=String(c.message||c.text||"").trim();if(!id||!message)return null;return {provider,external_comment_id:id,external_parent_id:c.parent?.id||c.parent_id||null,external_media_id:String(media.id),media_title:String(media.title||media.caption||"Publication "+provider),media_url:media.url||null,author_platform_id:String(c.from?.id||c.user?.id||""),author_name:String(c.from?.name||c.username||c.user?.username||"Utilisateur"),message_text:message.slice(0,5000),comment_created_at:date(c.created_time||c.timestamp),like_count:Math.max(0,Number(c.like_count||0)),reply_count:Math.max(0,Number(c.comment_count||c.replies_count||0)),platform_status:"PUBLISHED"};}
async function save(base,admin,owner,artist,rows){const unique=[...new Map(rows.filter(Boolean).map(x=>[x.provider+":"+x.external_comment_id,x])).values()];let stored=0;for(let i=0;i<unique.length;i+=100){const batch=unique.slice(i,i+100).map(x=>({...x,owner_id:owner,artist_id:artist,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()}));const r=await fetch(base+"/rest/v1/ai_community_messages?on_conflict=owner_id,artist_id,provider,external_comment_id",{method:"POST",headers:{...admin,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch)});if(!r.ok)throw new Error("Enregistrement des commentaires Meta impossible.");stored+=batch.length;}return stored;}
export async function onRequestPost({request,env}){
 let stage="configuration";
 try{
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","META_TOKEN_ENCRYPTION_KEY","META_GRAPH_API_VERSION","META_APP_ID","META_APP_SECRET"].filter(k=>!env[k]);if(missing.length)return json({error:"Configuration Meta incomplète.",missing},503);
  stage="session";const u=await user(request,env);if(!u?.id)return json({error:"Connexion requise."},401);
  const body=await request.json().catch(()=>({})),artistId=body.artist_id;if(!artistId)return json({error:"Espace artiste manquant."},400);
  const base=env.SUPABASE_URL.replace(/\/$/,""),admin={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const ar=await fetch(base+"/rest/v1/ai_artists?id=eq."+encodeURIComponent(artistId)+"&owner_id=eq."+encodeURIComponent(u.id)+"&status=eq.active&select=id",{headers:admin});if(!ar.ok||!(await ar.json()).length)return json({error:"Espace artiste non autorisé."},404);
  stage="connexion";const cr=await fetch(base+"/rest/v1/ai_social_connections?owner_id=eq."+encodeURIComponent(u.id)+"&artist_id=eq."+encodeURIComponent(artistId)+"&provider=eq.meta&select=token_ciphertext,account_metadata,scopes",{headers:admin});if(!cr.ok)return json({error:"Connexion Meta indisponible."},502);const connections=await cr.json();if(!connections.length)return json({error:"Connecte d'abord Facebook et Instagram pour cet artiste."},404);
  const tokens=await decrypt(connections[0].token_ciphertext,env.META_TOKEN_ENCRYPTION_KEY),version=env.META_GRAPH_API_VERSION,all=[],warnings=[];
  const granted=Array.isArray(connections[0].scopes)?connections[0].scopes:[];
  const required=["pages_read_engagement","pages_read_user_content","instagram_basic","instagram_manage_comments","pages_show_list"];
  const missingScopes=required.filter(s=>!granted.includes(s));
  if(missingScopes.length)return json({error:"Autorisations de lecture des commentaires manquantes. Mets à jour la configuration de connexion Meta puis reconnecte les comptes.",missing_permissions:missingScopes,settings_required:true},403);
  stage="facebook";
  for(const page of (tokens.pages||[])){
   if(!page.id||!page.access_token){warnings.push("Une Page Facebook n'a pas de jeton Page.");continue;}
   try{
    const url=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(page.id)+"/feed");url.searchParams.set("fields","id,message,permalink_url,created_time,comments.limit(100){id,message,created_time,from,like_count,comment_count,parent}");url.searchParams.set("limit","10");url.searchParams.set("access_token",page.access_token);
    const posts=await collect(url.toString(),2);
    for(const post of posts){const comments=post.comments?.data||[];for(const c of comments)all.push(row("facebook",c,{id:post.id,title:post.message||"Publication Facebook",url:post.permalink_url}));}
   }catch(e){warnings.push("Facebook ("+(page.name||page.id)+") : "+e.message);}
  }
  stage="instagram";
  const accounts=tokens.instagram_accounts||[];
  for(const account of accounts){
   if(!account.id)continue;
   try{
    const mediaUrl=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(account.id)+"/media");mediaUrl.searchParams.set("fields","id,caption,permalink,timestamp,comments_count");mediaUrl.searchParams.set("limit","10");mediaUrl.searchParams.set("access_token",tokens.system_user_access_token||tokens.user_access_token);
    const media=await collect(mediaUrl.toString(),1);
    for(const post of media){
     const commentsUrl=new URL("https://graph.facebook.com/"+version+"/"+encodeURIComponent(post.id)+"/comments");commentsUrl.searchParams.set("fields","id,text,timestamp,username,like_count,replies_count");commentsUrl.searchParams.set("limit","100");commentsUrl.searchParams.set("access_token",tokens.system_user_access_token||tokens.user_access_token);
     const comments=await collect(commentsUrl.toString(),2);
     for(const c of comments)all.push(row("instagram",c,{id:post.id,title:post.caption||"Publication Instagram",url:post.permalink}));
    }
   }catch(e){warnings.push("Instagram ("+(account.username||account.id)+") : "+e.message);}
  }
  stage="enregistrement";const stored=await save(base,admin,u.id,artistId,all);
  return json({success:true,stored,facebook_comments:all.filter(x=>x?.provider==="facebook").length,instagram_comments:all.filter(x=>x?.provider==="instagram").length,warnings,synced_at:new Date().toISOString()});
 }catch(e){console.error("COMMUNITY_META_SYNC",JSON.stringify({stage,message:String(e?.message||"erreur").slice(0,220)}));return json({error:String(e?.message||"Synchronisation Meta impossible."),stage},502);}
}
