// Cloudflare Pages Function — web research scoped to one owned artist profile.
// Search provider: Tavily. Results are stored with source URLs for later verification.
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function sbHeaders(env,token){return {apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token,"content-type":"application/json"};}

async function verifySession(request,env){
  const match=(request.headers.get("authorization")||"").match(/^Bearer\\s+(.+)$/i);
  if(!match)return {error:json({error:"Connexion requise."},401)};
  try{
    const response=await fetch(env.SUPABASE_URL.replace(/\\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
    if(!response.ok)return {error:json({error:"Session expirée ou invalide. Reconnecte-toi."},401)};
    const user=await response.json();
    if(!user?.id)return {error:json({error:"Identité utilisateur invalide."},401)};
    return {user,token:match[1]};
  }catch{return {error:json({error:"Vérification de la connexion impossible."},502)};}
}

async function searchTavily(apiKey,query){
  const response=await fetch("https://api.tavily.com/search",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+apiKey},
    body:JSON.stringify({query,search_depth:"basic",topic:"general",max_results:5,include_answer:false,include_raw_content:false}),
    signal:AbortSignal.timeout(25000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("Recherche web indisponible (HTTP "+response.status+").");
  return Array.isArray(payload.results)?payload.results:[];
}

export async function onRequestPost({request,env}){
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","TAVILY_API_KEY"].filter(key=>!env[key]);
  if(missing.length)return json({error:"Configuration serveur incomplète.",missing},503);
  const session=await verifySession(request,env);
  if(session.error)return session.error;

  let body;
  try{body=await request.json();}catch{return json({error:"Format JSON invalide."},400);}
  const artistId=typeof body.artist_id==="string"?body.artist_id.trim():"";
  const subject=typeof body.artist_name==="string"?body.artist_name.trim().slice(0,100):"";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId))return json({error:"Identifiant d’artiste invalide."},400);
  if(!subject)return json({error:"Le nom de l’artiste est obligatoire."},400);

  const base=env.SUPABASE_URL.replace(/\\/$/,"");
  const artistQuery=new URLSearchParams({id:"eq."+artistId,owner_id:"eq."+session.user.id,status:"eq.active",select:"id,artist_name",limit:"1"});
  const artistResponse=await fetch(base+"/rest/v1/ai_artists?"+artistQuery,{headers:sbHeaders(env,session.token)});
  if(!artistResponse.ok)return json({error:"Vérification du profil artiste impossible."},502);
  const rows=await artistResponse.json(),artist=Array.isArray(rows)?rows[0]:null;
  if(!artist)return json({error:"Cet artiste n’appartient pas à ton espace ou n’est pas actif."},404);

  // The saved artist profile is the default subject; explicit names are accepted for research,
  // but the dossier remains attached to the selected artist workspace.
  const queries=[
    {kind:"discography",query:'"'+subject+'" official discography albums singles EP releases'},
    {kind:"biography",query:'"'+subject+'" official biography artist background publicly documented real name'},
    {kind:"debut",query:'"'+subject+'" first release debut single first album release date'},
  ];
  const outcomes=await Promise.allSettled(queries.map(item=>searchTavily(env.TAVILY_API_KEY,item.query)));
  const sources=[],seen=new Set(),queryLog=[];
  outcomes.forEach((outcome,index)=>{
    const item=queries[index];
    queryLog.push({kind:item.kind,query:item.query,status:outcome.status});
    if(outcome.status!=="fulfilled")return;
    outcome.value.forEach(result=>{
      const url=typeof result?.url==="string"?result.url:"";
      if(!url||seen.has(url))return;
      seen.add(url);
      sources.push({
        kind:item.kind,
        title:String(result.title||"Source sans titre").slice(0,300),
        url:url.slice(0,2000),
        snippet:String(result.content||"").slice(0,2500),
        score:Number.isFinite(Number(result.score))?Number(result.score):null,
        published_date:result.published_date||null
      });
    });
  });
  if(!sources.length)return json({error:"Aucune source exploitable n’a été retournée. Vérifie le nom de l’artiste ou la configuration de recherche.",queries:queryLog},502);

  const status=outcomes.every(item=>item.status==="fulfilled")?"completed":"partial";
  const saved=await fetch(base+"/rest/v1/ai_artist_research",{
    method:"POST",
    headers:{...sbHeaders(env,session.token),prefer:"return=representation"},
    body:JSON.stringify({
      owner_id:session.user.id,artist_id:artist.id,research_type:"artist_profile",
      subject_name:subject,status,queries:queryLog,sources,source_count:sources.length,
      notes:"Résultats de recherche web bruts. Les faits doivent être recoupés avant publication."
    })
  });
  if(!saved.ok){
    const detail=await saved.text().catch(()=>"");
    return json({error:"Recherche effectuée, mais sauvegarde du dossier impossible. Vérifie la migration SQL ai_artist_research.",diagnostic:detail.slice(0,300)},502);
  }
  const savedRows=await saved.json().catch(()=>[]);
  return json({
    status,artist:{id:artist.id,name:artist.artist_name},subject,
    research_id:savedRows?.[0]?.id||null,source_count:sources.length,
    queries:queryLog,sources,
    verification_note:"Ces résultats sont des pistes documentaires, pas des faits automatiquement certifiés. Vérifie les dates, les homonymes et les informations biographiques dans les sources originales."
  });
}
