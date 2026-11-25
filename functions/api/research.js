// Cloudflare Pages Function — identity-guided research scoped to one owned artist.
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function sbHeaders(env,token){return {apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token,"content-type":"application/json"};}
async function verifySession(request,env){
  const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match)return {error:json({error:"Connexion requise."},401)};
  try{
    const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
    if(!response.ok)return {error:json({error:"Session expirée ou invalide. Reconnecte-toi."},401)};
    const user=await response.json();if(!user?.id)return {error:json({error:"Identité utilisateur invalide."},401)};
    return {user,token:match[1]};
  }catch{return {error:json({error:"Vérification de la connexion impossible."},502)};}
}
function clean(value,max=500){return typeof value==="string"?value.trim().slice(0,max):"";}
function safeUrl(value){
  const raw=clean(value,500);if(!raw)return "";
  try{const u=new URL(raw);return ["https:","http:"].includes(u.protocol)?u.href:"";}catch{return "";}
}
async function searchTavily(apiKey,query){
  const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+apiKey},body:JSON.stringify({query,search_depth:"basic",topic:"general",max_results:5,include_answer:false,include_raw_content:false}),signal:AbortSignal.timeout(25000)});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error("Recherche web indisponible (HTTP "+response.status+").");
  return Array.isArray(payload.results)?payload.results:[];
}
function urlDomain(value){try{return new URL(value).hostname.replace(/^www\./,"");}catch{return "";}}
function makeQueries(subject,context){
  const anchors=[context.country,context.city,context.genre,context.affiliation,context.notes].filter(Boolean).join(" ");
  const exact='"'+subject+'"';
  const qualifier=anchors?" "+anchors:"";
  const queries=[
    {kind:"biography",query:exact+qualifier+" artiste musicien biography official profile"},
    {kind:"discography",query:exact+qualifier+" discography songs singles albums official music"},
    {kind:"debut",query:exact+qualifier+" first single debut release music career"},
  ];
  const official=[["youtube",context.youtube],["instagram",context.instagram],["facebook",context.facebook],["tiktok",context.tiktok],["website",context.website]].filter(item=>item[1]);
  official.forEach(([kind,url])=>{
    const domain=urlDomain(url);
    queries.push({kind:"presence",query:exact+" "+(domain?"site:"+domain+" ":"")+url+" official artist"});
  });
  if(context.legal_name)queries.push({kind:"biography",query:exact+' "'+context.legal_name+'" '+(context.country||"")+" artist"});
  return queries;
}
export async function onRequestGet({request,env}){
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"].filter(key=>!env[key]);if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  const session=await verifySession(request,env);if(session.error)return session.error;
  const url=new URL(request.url),artistId=url.searchParams.get("artist_id")||"";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId))return json({error:"Identifiant d’artiste invalide."},400);
  const query=new URLSearchParams({artist_id:"eq."+artistId,owner_id:"eq."+session.user.id,select:"id,subject_name,status,source_count,sources,queries,notes,researched_at,created_at",order:"researched_at.desc",limit:"10"});
  const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/ai_artist_research?"+query,{headers:sbHeaders(env,session.token)});
  if(!response.ok)return json({error:"Historique de recherche indisponible. Vérifie la migration SQL ai_artist_research."},502);
  return json({research:await response.json()});
}
export async function onRequestPost({request,env}){
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","TAVILY_API_KEY"].filter(key=>!env[key]);if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  const session=await verifySession(request,env);if(session.error)return session.error;
  let body;try{body=await request.json();}catch{return json({error:"Format JSON invalide."},400);}
  const artistId=clean(body.artist_id,64),subject=clean(body.artist_name,100);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId))return json({error:"Identifiant d’artiste invalide."},400);
  if(!subject)return json({error:"Le nom exact de l’artiste est obligatoire."},400);
  const raw=body.identity_context&&typeof body.identity_context==="object"?body.identity_context:{};
  const context={
    legal_name:clean(raw.legal_name,120),country:clean(raw.country,100),city:clean(raw.city,100),genre:clean(raw.genre,180),
    affiliation:clean(raw.affiliation,180),youtube:safeUrl(raw.youtube),instagram:safeUrl(raw.instagram),facebook:safeUrl(raw.facebook),
    tiktok:safeUrl(raw.tiktok),website:safeUrl(raw.website),notes:clean(raw.notes,1200)
  };
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const artistQuery=new URLSearchParams({id:"eq."+artistId,owner_id:"eq."+session.user.id,status:"eq.active",select:"id,artist_name",limit:"1"});
  const artistResponse=await fetch(base+"/rest/v1/ai_artists?"+artistQuery,{headers:sbHeaders(env,session.token)});
  if(!artistResponse.ok)return json({error:"Vérification du profil artiste impossible."},502);
  const rows=await artistResponse.json(),artist=Array.isArray(rows)?rows[0]:null;
  if(!artist)return json({error:"Cet artiste n’appartient pas à ton espace ou n’est pas actif."},404);
  const queries=makeQueries(subject,context);
  const outcomes=await Promise.allSettled(queries.map(item=>searchTavily(env.TAVILY_API_KEY,item.query)));
  const sources=[],seen=new Set(),queryLog=queries.map((item,index)=>({kind:item.kind,query:item.query,status:outcomes[index].status}));
  outcomes.forEach((outcome,index)=>{
    if(outcome.status!=="fulfilled")return;
    outcome.value.forEach(result=>{
      const url=typeof result?.url==="string"?result.url:"";if(!url||seen.has(url))return;seen.add(url);
      sources.push({kind:queries[index].kind,title:String(result.title||"Source sans titre").slice(0,300),url:url.slice(0,2000),domain:urlDomain(url),
        snippet:String(result.content||"").slice(0,2500),score:Number.isFinite(Number(result.score))?Number(result.score):null,published_date:result.published_date||null});
    });
  });
  if(!sources.length)return json({error:"Aucune source exploitable n’a été retournée. Vérifie le nom exact et les précisions d’identité.",queries:queryLog},502);
  const status=outcomes.every(item=>item.status==="fulfilled")?"completed":"partial";
  const saved=await fetch(base+"/rest/v1/ai_artist_research",{method:"POST",headers:{...sbHeaders(env,session.token),prefer:"return=representation"},
    body:JSON.stringify({owner_id:session.user.id,artist_id:artist.id,research_type:"artist_profile",subject_name:subject,status,
      queries:{searches:queryLog,identity_context:context},sources,source_count:sources.length,
      notes:"Recherche orientée par les repères d’identité fournis. Les résultats restent des pistes documentaires à vérifier."})});
  if(!saved.ok){const detail=await saved.text().catch(()=>"");return json({error:"Recherche effectuée, mais sauvegarde du dossier impossible. Vérifie la migration SQL ai_artist_research.",diagnostic:detail.slice(0,300)},502);}
  const savedRows=await saved.json().catch(()=>[]);
  return json({status,artist:{id:artist.id,name:artist.artist_name},subject,research_id:savedRows?.[0]?.id||null,source_count:sources.length,
    queries:queryLog,sources,identity_context:context,
    verification_note:"Les résultats sont des pistes documentaires, pas des faits automatiquement certifiés. Vérifie que chaque source concerne bien l’artiste identifié."});
}
