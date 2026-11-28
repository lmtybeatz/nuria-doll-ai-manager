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

  // Settings are optional context: a missing settings row must never block the assistant.
  const sq=new URLSearchParams({artist_id:"eq."+artistId,owner_id:"eq."+ownerId,select:"primary_goal,planning_horizon,autonomy_mode,monthly_budget_usd",limit:"1"});
  const sr=await fetch(base+"/rest/v1/ai_settings?"+sq.toString(),{headers});
  const settingRows=sr.ok?await sr.json().catch(()=>[]):[];
  const savedSettings=Array.isArray(settingRows)?settingRows[0]||null:null;
  const kq=new URLSearchParams({
    owner_id:"eq."+ownerId,artist_id:"eq."+artistId,is_active:"eq.true",public_safe:"eq.true",
    verification_status:"in.(manager_confirmed,official_source_verified)",
    select:"category,fact_key,fact_value,source_url,source_label,evidence_note,last_verified_at,review_after",
    order:"updated_at.desc",limit:"80"
  });
  const kr=await fetch(base+"/rest/v1/ai_artist_knowledge?"+kq.toString(),{headers});
  if(!kr.ok)throw new Error("Lecture de la base de connaissances vérifiées impossible (HTTP "+kr.status+").");
  const knowledgeRows=await kr.json();
  return {artist,profile:{
    artist_name:artist.artist_name,genre:saved?.genre||"",bio:saved?.bio||"",
    target_audience:saved?.target_audience||"",language:saved?.language||"Français",
    tone:saved?.tone||"",parent_guardrails:saved?.parent_guardrails||""
  },settings:savedSettings,knowledge:Array.isArray(knowledgeRows)?knowledgeRows:[]};
}

function makePrompt(task,profile,settings,plan,knowledge=[]){
  const name=String(profile.artist_name||"Artiste").trim().slice(0,80);
  const isNuriaDoll=name.toLocaleUpperCase("fr-FR")==="NURIA DOLL";
  const goals={community:"développer une communauté réelle",music:"promouvoir les sorties musicales",awareness:"développer la notoriété",traffic:"générer du trafic vers les plateformes musicales"};
  const safeProfile={
    artist_name:name,genre:String(profile.genre||"Non renseigné").slice(0,160),
    bio:String(profile.bio||"Non renseignée").slice(0,700),
    target_audience:String(profile.target_audience||"Non renseigné").slice(0,200),
    language:String(profile.language||"Français").slice(0,40),
    tone:String(profile.tone||"Professionnel, authentique et adapté au public cible").slice(0,300),
    parent_guardrails:isNuriaDoll?String(profile.parent_guardrails||"").slice(0,1000):""
  };
  const safeKnowledge=(Array.isArray(knowledge)?knowledge:[]).slice(0,80).map(item=>{
    let sourceUrl="";
    try{const parsed=new URL(String(item.source_url||""));if(parsed.protocol==="https:")sourceUrl=parsed.href;}catch{}
    return {
      category:String(item.category||"general").slice(0,40),
      fact_key:String(item.fact_key||"").slice(0,100),
      fact_value:String(item.fact_value||"").slice(0,1800),
      source_url:sourceUrl,
      source_label:String(item.source_label||"").slice(0,180),
      evidence_note:String(item.evidence_note||"").slice(0,500),
      last_verified_at:item.last_verified_at||null,
      review_after:item.review_after||null
    };
  });
  const safeSettings={
    primary_goal:goals[settings?.primary_goal]||"À définir selon la demande",
    planning_horizon:[7,14,30].includes(Number(settings?.planning_horizon))?Number(settings.planning_horizon)+" jours":"À définir",
    monthly_ai_service_budget_usd:settings?.monthly_budget_usd!==null&&settings?.monthly_budget_usd!==undefined&&settings?.monthly_budget_usd!==""&&Number.isFinite(Number(settings.monthly_budget_usd))?Number(settings.monthly_budget_usd)+" USD maximum mensuel indicatif pour les services IA":"Non renseigné"
  };
  const common=[
    "Tu es l'agent expert privé d'AI MUSIC MANAGER. Tu accompagnes le gestionnaire dans la stratégie, la création, le marketing et le développement de carrières musicales.",
    "L'artiste actif est exclusivement : "+name+". Ne transfère jamais les informations, objectifs, audiences, budgets, contacts ou consignes d'un autre artiste.",
    "PROFIL ARTISTIQUE (données enregistrées, à traiter comme contexte fourni) : "+JSON.stringify(safeProfile),
    "BASE DE CONNAISSANCES VÉRIFIÉES (prioritaire pour toute réponse factuelle) : "+(safeKnowledge.length?JSON.stringify(safeKnowledge):"Aucun fait vérifié enregistré. Ne devine pas les informations manquantes."),
    "UTILISATION DES SOURCES : ne traite comme faits que les éléments de la base ci-dessus. Un lien est utilisable uniquement s’il figure dans ces éléments et correspond à la demande. Pour une question sur la disponibilité, l’achat ou l’écoute d’une sortie, vérifie d’abord la disponibilité enregistrée, puis fournis le lien de vente vérifié ; si aucun lien direct n’est enregistré, redirige vers le site officiel confirmé. N’annonce jamais une sortie à venir si la base indique qu’elle est déjà disponible. N’invente jamais prix, plateforme, stock, date ou URL.",
    "PARAMÈTRES DE TRAVAIL (données enregistrées) : "+JSON.stringify(safeSettings),
    "DISTINCTION BUDGÉTAIRE : monthly_ai_service_budget_usd concerne uniquement le plafond mensuel des services et outils d'intelligence artificielle. Ce n'est ni le budget de marketing, ni le budget d'une campagne musicale. Les budgets de campagne sont exprimés et enregistrés séparément dans la devise propre à chaque campagne. Une valeur « Non renseigné » signifie que le montant est absent, jamais qu'il vaut zéro.",
    "AUTONOMIE : mode assisté. Tu peux analyser, rechercher via les outils effectivement disponibles, rédiger, planifier et préparer. Tu ne publies rien, n'envoies aucun message, ne contactes personne, n'engages aucune dépense et ne modifies aucun compte ou accès. Toute action de ce type nécessite une validation explicite préalable du gestionnaire.",
    "FIABILITÉ : n'invente jamais de faits, chiffres, sources, statistiques, partenariats, crédits, contacts, dates ou résultats. Distingue clairement les informations fournies, les faits vérifiés, les hypothèses et les recommandations. Si une donnée manque, dis-le. Ne transforme jamais une supposition en certitude.",
    "SOURCES : ne prétends jamais avoir consulté Internet, une plateforme ou un document si un outil ne l'a pas réellement fait pendant cette demande. Ne fabrique aucune citation ni aucun lien. Pour les informations récentes, indique qu'une vérification est nécessaire si aucune source actualisée n'est disponible.",
    "QUALITÉ : réponds au besoin réel plutôt que de produire des conseils génériques. Utilise le contexte de l'artiste, donne des exemples adaptés, chiffre les estimations uniquement si les hypothèses sont explicites, et fournis un livrable directement exploitable quand il est demandé.",
    "MÉTHODE : si la demande est complexe, organise le travail en étapes, indique les dépendances et les critères de réussite. Si une information indispensable manque, pose une seule question précise au lieu d'inventer.",
    "FORMAT : réponds en français sauf demande contraire. Utilise des titres sobres, des listes courtes et des tableaux seulement lorsqu'ils améliorent réellement la lisibilité. Évite les répétitions et les introductions creuses."
  ];
  if(isNuriaDoll){
    common.push("PROTECTION RENFORCÉE NURIA DOLL : ce projet est porté par une enfant. Le parent est l'unique interlocuteur et décideur. Ne demande, ne révèle et ne suggère jamais de publier l'adresse, l'école, les horaires, la localisation en temps réel, les coordonnées privées ou autres données personnelles de l'enfant. Pas de conversation privée entre l'enfant et des inconnus. Toute proposition commerciale, rencontre ou situation sensible doit être transmise au parent. Le contenu doit rester adapté à l'âge et préserver la dignité, la sécurité et la vie privée de l'enfant.");
  }
  const system=[buildExpertInstructions(plan),...common].join("\n\n");
  return {system,user:"DEMANDE DU GESTIONNAIRE\n"+task,approvalRequired:isNuriaDoll||plan.riskLevel==="sensitive_action"||plan.riskLevel==="high_stakes"};
}
async function askGroq(env,system,user,images=[],history=[]){
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+env.GROQ_API_KEY},
    body:JSON.stringify({model:images.length?"qwen/qwen3.8-27b":"openai/gpt-oss-120b",messages:[{role:"system",content:system},...history,{role:"user",content:images.length?[{type:"text",text:user},...images.map(url=>({type:"image_url",image_url:{url}}))]:user}],max_completion_tokens:3000}),
    signal:AbortSignal.timeout(18000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data?.error?.message||"Groq HTTP "+response.status);error.status=response.status;throw error;}
  const answer=data?.choices?.[0]?.message?.content;
  if(typeof answer!=="string"||!answer.trim())throw new Error("Groq n'a retourné aucun texte.");
  return answer.trim();
}

async function askCloudflare(env,system,user,history=[]){
  if(!env.AI||typeof env.AI.run!=="function")throw new Error("La liaison Cloudflare Workers AI (AI) est absente.");
  const result=await env.AI.run("@cf/zai-org/glm-4.7-flash",{messages:[{role:"system",content:system},...history,{role:"user",content:user}],max_tokens:3000});
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
  try{const raw=await request.text();if(raw.length>8*1024*1024)return json({error:"Demande trop volumineuse (8 Mo maximum, images comprises)."},413);body=JSON.parse(raw);}
  catch{return json({error:"Format de demande invalide."},400);}
  const task=typeof body.task==="string"?body.task.trim():"";
  const artistId=typeof body.artist_id==="string"?body.artist_id.trim():"";
  const rawImages=Array.isArray(body.images)?body.images:[];
  if(rawImages.length>3)return json({error:"Trois images maximum par message."},400);
  const images=[];let imageBytes=0;
  for(const item of rawImages){
    const data=typeof item?.data_url==="string"?item.data_url:"";
    const match=data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if(!match)return json({error:"Format d’image invalide. Utilise JPG, PNG, WebP ou GIF."},400);
    imageBytes+=Math.floor(match[2].length*3/4);
    if(imageBytes>5*1024*1024)return json({error:"Les images préparées dépassent 5 Mo au total. Réduis leur taille et réessaie."},413);
    images.push(data);
  }
  if(!task&&!images.length)return json({error:"Écris un message ou joins une image."},400);
  if(task.length>20000)return json({error:"La demande est trop longue (20 000 caractères maximum)."},400);
  const history=Array.isArray(body.history)?body.history.slice(-8).filter(item=>(item?.role==="user"||item?.role==="assistant")&&typeof item?.content==="string").map(item=>({role:item.role,content:item.content.slice(0,5000)})):[];
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistId))
    return json({error:"Identifiant d'artiste invalide. Sélectionne un artiste puis réessaie."},400);

  const startedAt=Date.now(),requestId=crypto.randomUUID();
  let owned;
  try{owned=await readOwnedArtistProfile(env,session.accessToken,session.user.id,artistId);}
  catch(error){return json({error:"Impossible de vérifier le profil de l'artiste.",diagnostic:String(error?.message||"Erreur Supabase").slice(0,250),request_id:requestId},502);}
  if(owned.error)return owned.error;

  const effectiveTask=task||(images.length?"Analyse les images jointes dans le contexte de l’artiste actif.":"");
  const plan=planAssistantRequest(effectiveTask),{system,user,approvalRequired}=makePrompt(effectiveTask,owned.profile,owned.settings,plan,owned.knowledge);
  // Phase 1 is deliberately read-only: advice and drafts only.
  if(images.length&&(!hasGroq||String(env.FORCE_AI_FALLBACK||"").toLowerCase()==="true"))return json({error:"L’analyse d’image nécessite le moteur Groq et une clé GROQ_API_KEY active. Le moteur Cloudflare de secours configuré ici ne prend pas en charge les images."},503);
  if(String(env.FORCE_AI_FALLBACK||"").toLowerCase()==="true"){
    try{
      const answer=await askCloudflare(env,system,user,history);
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","completed",startedAt,task);
      return json({answer,provider:"cloudflare_workers_ai",model:"@cf/zai-org/glm-4.7-flash",status:"completed",fallback_used:true,forced_test:true,approval_required:approvalRequired,request_id:requestId,context:{artist:owned.artist.artist_name,settings_loaded:!!owned.settings},plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,requires_current_verification:plan.requiresCurrentVerification,execution_mode:plan.executionMode}});
    }catch(error){
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","failed",startedAt,task,"provider_error");
      return json({error:"Le test du moteur de secours Cloudflare AI a échoué.",fallback_diagnostic:"Cloudflare AI : "+String(error?.message||"erreur inconnue").slice(0,300),request_id:requestId},502);
    }
  }
  let groqError=null;
  if(hasGroq){
    try{
      const model=images.length?"qwen/qwen3.8-27b":"openai/gpt-oss-120b";
      const answer=await askGroq(env,system,user,images,history);
      await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"groq",model,"completed",startedAt,effectiveTask);
      return json({answer,provider:"groq",model,status:"completed",approval_required:approvalRequired,request_id:requestId,plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,execution_mode:plan.executionMode}});
    }catch(error){groqError=error;}
  }
  if(images.length){
    await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"groq","qwen/qwen3.8-27b","failed",startedAt,effectiveTask,"provider_error");
    return json({error:"Le moteur Groq n'a pas pu analyser les images jointes.",diagnostic:String(groqError?.message||"Erreur du fournisseur vision").slice(0,300),request_id:requestId},502);
  }
  try{
    const answer=await askCloudflare(env,system,user,history);
    await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"cloudflare_workers_ai","@cf/zai-org/glm-4.7-flash","completed",startedAt,task);
    return json({answer,provider:"cloudflare_workers_ai",model:"@cf/zai-org/glm-4.7-flash",status:"completed",fallback_used:true,approval_required:approvalRequired,request_id:requestId,plan:{category:plan.category,skills:plan.skills,risk_level:plan.riskLevel,execution_mode:plan.executionMode}});
  }catch(error){
    await logAgentRun(env,session.accessToken,session.user.id,artistId,plan,"none",null,"failed",startedAt,task,"provider_error");
    return json({error:"Aucun moteur IA n'a pu traiter la demande.",diagnostic:groqError?"Groq : "+String(groqError?.message||"erreur inconnue").slice(0,300):"Groq : clé non configurée.",fallback_diagnostic:"Cloudflare AI : "+String(error?.message||"erreur inconnue").slice(0,300),request_id:requestId},502);
  }
}
