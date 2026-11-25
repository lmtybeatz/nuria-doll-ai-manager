// Cloudflare Pages Function — private AI assistant.
// Groq is primary; Cloudflare Workers AI is the fallback. No external action is executed here.
import { planAssistantRequest, buildExpertInstructions } from "../_shared/ai-planner.js";

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function supabaseHeaders(env,token){return {apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+token,"content-type":"application/json"};}

async function verifySession(request,env){
  const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match)return {error:json({error:"Connexion requise."},401)};
  try{
    const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
    if(!response.ok)return {error:json({error:"Session expirée ou invalide. Reconnecte-toi."},401)};
    const user=await response.json();
    if(!user?.id)return {error:json({error:"Identité utilisateur invalide."},401)};
    return {user,accessToken:match[1]};
  }catch{return {error:json({error:"Vérification de la connexion impossible."},502)};}
}

async function readOwnedArtistProfile(env,token,ownerId,artistId){
  const base=env.SUPABASE_URL.replace(/\/$/,""),headers=supabaseHeaders(env,token);
  const aq=new URLSearchParams({id:"eq."+artistId,owner_id:"eq."+ownerId,status:"eq.active",select:"id,artist_name,status",limit:"1"});
  const ar=await fetch(base+"/rest/v1/ai_artists?"+aq.toString(),{headers});
  if(!ar.ok)throw new Error("Vérification de l'espace artiste impossible (HTTP "+ar.status+").");
  const artists=await ar.json(),artist=Array.isArray(artists)?artists[0]:null;
  if(!artist)return {error:json({error:"Artiste introuvable, inactif ou non autorisé pour ce compte."},404)};
  const pq=new URLSearchParams({artist_id:"eq."+artistId,owner_id:"eq."+ownerId,select:"artist_name,genre,bio,target_audience,language,tone,parent_guardrails",limit:"1"});
  const pr=await fetch(base+"/rest/v1/ai_brand_profile?"+pq.toString(),{headers});
  if(!pr.ok)throw new Error("Lecture du profil artistique impossible (HTTP "+pr.status+").");
  const rows=await pr.json(),saved=Array.isArray(rows)?rows[0]:null;
  return {artist,profile:{
    artist_name:artist.artist_name,genre:saved?.genre||"",bio:saved?.bio||"",
    target_audience:saved?.target_audience||"",language:saved?.language||"Français",
    tone:saved?.tone||"",parent_guardrails:saved?.parent_guardrails||""
  }};
}

function makePrompt(task,profile,plan){
  const name=String(profile.artist_name||"Artiste").trim().slice(0,80);
  const isNuriaDoll=name.toLocaleUpperCase("fr-FR")==="NURIA DOLL";
  const safe={
    artist_name:name,genre:String(profile.genre||"À préciser").slice(0,160),
    bio:String(profile.bio||"").slice(0,700),target_audience:String(profile.target_audience||"À définir").slice(0,200),
    language:String(profile.language||"Français").slice(0,40),
    tone:String(profile.tone||"Professionnel, authentique et adapté au public cible").slice(0,300),
    parent_guardrails:isNuriaDoll?String(profile.parent_guardrails||"").slice(0,1000):""
  };
  const common="N’invente jamais de faits, chiffres, partenariats ou résultats. Respecte le profil et les consignes. Ne publie, n’envoie, ne commente et ne contacte personne : prépare uniquement des propositions.";
  const child="Ce projet est porté par une enfant : le parent est l’interlocuteur unique. Ne demande et ne révèle jamais l’adresse, l’école, les horaires, la localisation en temps réel, les coordonnées privées ou autres données personnelles de l’enfant. Ne propose pas de conversation privée entre l’enfant et des inconnus. Toute rencontre, proposition commerciale ou situation sensible doit être transmise au parent. Les propositions sont soumises à validation parentale.";
  const system=[buildExpertInstructions(plan),"Contexte de l'artiste actif : "+name+".","Identité artistique enregistrée : "+JSON.stringify(safe),common,isNuriaDoll?child:"N'applique pas de consignes parentales propres à un autre projet."].join("\n\n");
  return {system,user:"DEMANDE DU GESTIONNAIRE\n"+task,approvalRequired:isNuriaDoll};
}

async function askGroq(env,system,user){
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+env.GROQ_API_KEY},
    body:JSON.stringify({model:"openai/gpt-oss-120b",messages:[{role:"system",content:system},{role:"user",content:user}],max_completion_tokens:3000}),
    signal:AbortSignal.timeout(18000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data?.error?.message||"Groq HTTP "+response.status);error.status=response.status;throw error;}
  const answer=data?.choices?.[0]?.message?.content;
  if(typeof answer!=="string"||!answer.trim())throw new Error("Groq n'a retourné aucun texte.");
  return answer.trim();
}

async function askCloudflare(env,system,user){
  if(!env.AI||typeof env.AI.run!=="function")throw new Error("La liaison Cloudflare Workers AI (AI) est absente.");
  const result=await env.AI.run("@cf/zai-org/glm-4.7-flash",{messages:[{role:"system",content:system},{role:"user",content:user}],max_tokens:3000});
  const answer=typeof result==="string"?result:typeof result?.response==="string"?result.response:typeof result?.choices?.[0]?.message?.content==="string"?result.choices[0].message.content:"";
  if(!answer.trim())throw new Error("Cloudflare Workers AI n'a retourné aucun texte.");
  return answer.trim();
}

async function logAgentRun(env,token,userId,artistId,plan,provider,model,status,startedAt,task,errorCode=null){
  try{
    const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/ai_agent_runs",{
      method:"POST",headers:{...supabaseHeaders(env,token),prefer:"return=minimal"},
      body:JSON.stringify({owner_id:userId,artist_id:artistId,task_category:plan.category,risk_level:plan.riskLevel,provider:provider||"none",model:model||null,status,request_excerpt:String(task||"").slice(0,500),duration_ms:Date.now()-startedAt,error_code:errorCode})
    });
    return response.ok;
  }catch{return false;}
}

export async function onRequestPost({request,env}){
  const missing=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"].filter(key=>!env[key]);
  const hasGroq=!!env.GROQ_API_KEY,hasWorkersAI=!!env.AI&&typeof env.AI.run==="function";
  if(missing.length||(!hasGroq&&!hasWorkersAI)){
    if(!hasGroq&&!hasWorkersAI)missing.push("GROQ_API_KEY ou liaison Workers AI (AI)");
    return json({error:"Configuration serveur incomplète.",missing,diagnostic:"Groq est prioritaire. Workers AI est facultatif si GROQ_API_KEY est configurée."},500);
  }
  const session=await verifySession(request,env);
  if(session.error)return session.error;
  let body;
  try{const raw=await request.text();if(raw.length>30000)return json({error:"Demande trop volumineuse (30 000 caractères maximum)."},413);body=JSON.parse(raw);}
  catch{return json({error:"Format de demande invalide."},400);}
  const task=typeof body.task==="string"?body.task.trim():"";
  const artistId=typeof body.artist_id==="string"?body.artist_id.trim():"";
  if(!task)return json({error:"Décris ce que tu souhaites préparer."},400);
  if(task.length>20000)return json({error:"La demande est trop longue (20 000 caractères maximum)."},400);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId))
    return json({error:"Identifiant d'artiste invalide. Sélectionne un artiste puis réessaie."},400);

  const startedAt=Date.now(),requestId=crypto.randomUUID();
  let owned;
  try{owned=await readOwnedArtistProfile(env,session.accessToken,session.user.id,artistId);}
  catch(error){return json({error:"Impossible de vérifier le profil de l'artiste.",diagnostic:String(error?.message||"Erreur Supabase").slice(0,250),request_id:requestId},502);}
  if(owned.error)return owned.error;

  const plan=planAssistantRequest(task),{system,user,approvalRequired}=makePrompt(task,owned.profile,plan);
  // Phase 1 is deliberately read-only: advice and drafts only.
  if(String(env.FORCE_AI_FALLBACK||"").toLowerCase()==="true"){
    try{
      const answer=await askCloudflare(env,system,user);
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","completed",startedAt,task);
      return json({answer,provider:"cloudflare_workers_ai",model:"@cf/zai-org/glm-4.7-flash",status:"completed",fallback_used:true,forced_test:true,approval_required:approvalRequired,request_id:requestId,plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,execution_mode:plan.executionMode}});
    }catch(error){
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","failed",startedAt,task,"provider_error");
      return json({error:"Le test du moteur de secours Cloudflare AI a échoué.",fallback_diagnostic:"Cloudflare AI : "+String(error?.message||"erreur inconnue").slice(0,300),request_id:requestId},502);
    }
  }
  let groqError=null;
  if(hasGroq){
    try{
      const answer=await askGroq(env,system,user);
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"groq","openai/gpt-oss-120b","completed",startedAt,task);
      return json({answer,provider:"groq",model:"openai/gpt-oss-120b",status:"completed",approval_required:approvalRequired,request_id:requestId,plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,execution_mode:plan.executionMode}});
    }catch(error){groqError=error;}
  }
  try{
    const answer=await askCloudflare(env,system,user);
    await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","completed",startedAt,task);
    return json({answer,provider:"cloudflare_workers_ai",model:"@cf/zai-org/glm-4.7-flash",status:"completed",fallback_used:true,approval_required:approvalRequired,request_id:requestId,plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,execution_mode:plan.executionMode}});
  }catch(error){
    await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"none",null,"failed",startedAt,task,"provider_error");
    return json({error:"Aucun moteur IA n'a pu traiter la demande.",diagnostic:groqError?"Groq : "+String(groqError?.message||"erreur inconnue").slice(0,300):"Groq : clé non configurée.",fallback_diagnostic:"Cloudflare AI : "+String(error?.message||"erreur inconnue").slice(0,300),request_id:requestId},502);
  }
}
