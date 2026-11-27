(() => {
  const $=selector=>document.querySelector(selector);
  const escapeText=value=>String(value??"");
  let messages=[],loadedArtistId=null,busy=false;

  async function context(){
    const ctx=await window.AIMusicManagerTikTokContext?.get?.();
    if(!ctx?.artistId||!ctx?.accessToken)throw new Error("Connecte-toi et sélectionne un artiste.");
    return ctx;
  }
  async function api(path,ctx,method="GET",body=null){
    const response=await fetch(path,{method,headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},...(body?{body:JSON.stringify(body)}:{})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||"Requête impossible.");
    return payload;
  }
  function labelStatus(value){
    return ({new:"À traiter",read:"Lu",drafted:"Brouillon IA",awaiting_approval:"En attente de validation",replied:"Répondu",ignored:"Ignoré",failed:"Erreur"})[value]||"À traiter";
  }
  function formatDate(value){
    if(!value)return "Date non disponible";
    const date=new Date(value);return Number.isNaN(date.getTime())?"Date non disponible":date.toLocaleString("fr-FR",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  }
  function updateStats(){
    $("#communityTotal").textContent=String(messages.length);
    $("#communityPending").textContent=String(messages.filter(m=>["new","read","awaiting_approval"].includes(m.workflow_status)).length);
    $("#communityDrafts").textContent=String(messages.filter(m=>m.workflow_status==="drafted"||!!m.ai_draft).length);
    $("#communityReplied").textContent=String(messages.filter(m=>m.workflow_status==="replied").length);
  }
  function makeButton(text,action,kind="secondary"){
    const button=document.createElement("button");button.type="button";button.className="btn "+kind;button.textContent=text;button.addEventListener("click",action);return button;
  }
  function render(){
    const list=$("#communityList");if(!list)return;
    const platform=$("#communityPlatformFilter")?.value||"all";
    const status=$("#communityStatusFilter")?.value||"all";
    const search=($("#communitySearch")?.value||"").trim().toLocaleLowerCase("fr-FR");
    const filtered=messages.filter(item=>(platform==="all"||item.provider===platform)&&(status==="all"||item.workflow_status===status)&&(!search||[item.author_name,item.message_text,item.media_title].some(value=>String(value||"").toLocaleLowerCase("fr-FR").includes(search))));
    list.replaceChildren();
    if(!filtered.length){
      const empty=document.createElement("div");empty.className="empty-state";
      empty.textContent=messages.length?"Aucun commentaire ne correspond à ces filtres.":"Aucun commentaire synchronisé pour cet artiste. Utilise « Synchroniser TikTok » pour récupérer les commentaires publics de ses dernières vidéos.";
      list.append(empty);return;
    }
    filtered.forEach(item=>{
      const card=document.createElement("article");card.className="community-comment";card.dataset.commentId=String(item.id);
      const head=document.createElement("div");head.className="community-comment-head";
      const authorWrap=document.createElement("div");authorWrap.className="community-comment-author";
      const author=document.createElement("strong");author.textContent=item.author_name?(/^[\w.]+$/.test(item.author_name)?"@"+item.author_name:item.author_name):"Utilisateur TikTok";
      const meta=document.createElement("small");meta.textContent="TikTok · "+formatDate(item.comment_created_at);
      authorWrap.append(author,meta);
      const badge=document.createElement("span");badge.className="tag "+(item.workflow_status==="ignored"?"amber":item.workflow_status==="replied"?"green":"");badge.textContent=labelStatus(item.workflow_status);
      head.append(authorWrap,badge);
      const body=document.createElement("p");body.className="community-comment-body";body.textContent=item.message_text;
      card.append(head,body);
      if(item.media_title||item.media_url){
        const media=document.createElement(item.media_url?"a":"small");
        if(item.media_url){media.href=item.media_url;media.target="_blank";media.rel="noopener noreferrer";media.className="community-comment-media";}
        else media.className="community-comment-meta";
        media.textContent="Publication : "+(item.media_title||"Vidéo TikTok");
        card.append(media);
      }
      const metrics=document.createElement("small");metrics.className="community-comment-meta";metrics.textContent=(item.like_count||0)+" j’aime · "+(item.reply_count||0)+" réponse(s)";
      card.append(metrics);
      if(item.ai_draft){
        const draftBox=document.createElement("div");draftBox.className="community-draft-box";
        const title=document.createElement("strong");title.textContent="Brouillon de réponse IA";
        const textarea=document.createElement("textarea");textarea.value=item.ai_draft;textarea.maxLength=150;textarea.setAttribute("aria-label","Modifier le brouillon de réponse (150 caractères maximum)");
        const note=document.createElement("small");note.className="community-draft-note";
        const updateDraftCounter=()=>{note.textContent=(item.workflow_status==="replied"?"Réponse publiée sur TikTok. ":"Brouillon non publié. ")+textarea.value.length+"/150 caractères.";note.classList.toggle("is-error",textarea.value.length>150);};
        updateDraftCounter();textarea.addEventListener("input",updateDraftCounter);
        const save=makeButton("Enregistrer le brouillon",async()=>{if(textarea.value.trim().length>150){setStatus("Une réponse TikTok ne peut pas dépasser 150 caractères.",true);return;}save.disabled=true;try{const ctx=await context();await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id:item.id,ai_draft:textarea.value});await loadInbox();}catch(e){setStatus(e.message,true);}finally{save.disabled=false;}});
        draftBox.append(title,textarea,note,save);
        if(item.workflow_status!=="replied")draftBox.append(makeButton("Régénérer la proposition IA",()=>prepareDraft(item,card,true),"secondary"));
        if(item.workflow_status!=="replied"){
          const publish=makeButton("Publier la réponse sur TikTok",()=>publishCommentReply(item,textarea,publish),"primary");
          publish.dataset.commentReply="true";publish.disabled=true;publish.textContent="Vérification de l’autorisation TikTok…";
          draftBox.append(publish);
          discoverReplyTool().then(tool=>{
            if(!publish.isConnected)return;
            publish.disabled=!tool;
            publish.textContent=tool?"Publier la réponse sur TikTok":"Réponse directe non disponible pour ce compte";
            publish.title=tool?"La réponse sera publiée uniquement après confirmation.":"TikTok n’a pas exposé l’outil officiel de réponse pour ce compte.";
          }).catch(()=>{if(publish.isConnected){publish.disabled=true;publish.textContent="Outil de réponse indisponible";}});
        }
        card.append(draftBox);
      }
      const actions=document.createElement("div");actions.className="community-comment-actions";
      if(!item.ai_draft)actions.append(makeButton("Préparer une réponse IA",()=>prepareDraft(item,card,false), "primary"));
      if(item.workflow_status!=="ignored")actions.append(makeButton(item.workflow_status==="new"?"Marquer comme lu":"Ignorer",()=>updateMessage(item.id,{workflow_status:item.workflow_status==="new"?"read":"ignored"})));
      else actions.append(makeButton("Réintégrer",()=>updateMessage(item.id,{workflow_status:"new"})));
      card.append(actions);list.append(card);
    });
  }
  function setStatus(message,bad=false){
    [$("#communityStatus"),$("#ttMcpInboxSyncStatus")].forEach(node=>{
      if(node){node.textContent=message;node.classList.toggle("is-error",bad);}
    });
  }
  function showAppNotice(notice){
    const node=$("#communityAppNotice");if(!node||!notice?.message)return;
    node.textContent=(notice.bad?"⚠ ":"ℹ ")+notice.message;
    node.classList.remove("hidden");node.classList.toggle("is-error",!!notice.bad);
  }
  async function loadInbox(){
    const label=$("#communityArtistLabel");if(!label)return;
    try{
      const ctx=await context();loadedArtistId=ctx.artistId;
      label.textContent=ctx.artistName||"Artiste actif";
      const data=await api("/api/community/inbox?artist_id="+encodeURIComponent(ctx.artistId),ctx);
      messages=Array.isArray(data.messages)?data.messages:[];
      updateStats();render();
      setStatus(messages.length?messages.length+" commentaire(s) conservé(s) pour cet artiste.":"Aucun commentaire enregistré pour cet artiste.");
    }catch(error){messages=[];updateStats();render();setStatus(error.message,true);}
  }
  async function updateMessage(id,patch){
    try{const ctx=await context();await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id,...patch});await loadInbox();}
    catch(error){setStatus(error.message,true);}
  }
  function parseMcpResult(result){
    let value=result;
    for(let depth=0;depth<6;depth++){
      if(value?.structuredContent&&typeof value.structuredContent==="object"){value=value.structuredContent;continue;}
      if(Array.isArray(value?.content)){
        const text=value.content.find(part=>part?.type==="text"&&typeof part.text==="string")?.text;
        if(text){try{value=JSON.parse(text);continue;}catch{}}
      }
      if(value?.result&&typeof value.result==="object"){value=value.result;continue;}
      break;
    }
    return value;
  }
  async function mcpRequest(ctx,body){
    return api("/api/tiktok/social-mcp",ctx,"POST",{artist_id:ctx.artistId,...body});
  }
  async function getTikTokVideos(ctx){
    if(Array.isArray(ctx.videos)&&ctx.videos.length)return ctx.videos;
    const response=await fetch("/api/tiktok/analytics?artist_id="+encodeURIComponent(ctx.artistId),{headers:{authorization:"Bearer "+ctx.accessToken}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Impossible de récupérer les vidéos TikTok.");
    return Array.isArray(data.videos)?data.videos:[];
  }
  function normalizeComment(comment,video){
    const id=String(comment?.id||comment?.comment_id||"").trim();
    const text=String(comment?.text||comment?.comment_text||"").trim();
    if(!id||!text)return null;
    const created=comment.create_time??comment.created_at??comment.timestamp??null;
    let createdAt=null;
    if(created!==null&&created!==""){
      const number=Number(created);
      const date=Number.isFinite(number)&&String(created).trim()!==""?new Date(number>1e12?number:number*1000):new Date(created);
      if(!Number.isNaN(date.getTime()))createdAt=date.toISOString();
    }
    return {
      provider:"tiktok",
      external_comment_id:id,
      external_parent_id:String(comment.parent_comment_id||comment.parent_id||""),
      external_media_id:String(video.id||video.video_id||""),
      media_title:String(video.title||video.video_description||"Vidéo TikTok"),
      media_url:String(video.share_url||""),
      author_platform_id:String(comment.user_id||comment.open_id||comment.user?.id||""),
      author_name:String(comment.username||comment.display_name||comment.user?.username||""),
      message_text:text,
      comment_created_at:createdAt,
      like_count:comment.like_count??comment.likes??0,
      reply_count:comment.reply_count??comment.replies??0,
      platform_status:comment.status||"PUBLIC"
    };
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function syncTikTok(triggerButton=null){
    if(busy)return;busy=true;
    const button=triggerButton||$("#communitySyncTikTok"),refresh=$("#communityRefresh");
    const originalButtonText=button?.textContent||"Synchroniser TikTok";
    if(button){button.disabled=true;button.textContent="Synchronisation…";}
    if(refresh)refresh.disabled=true;
    try{
      const ctx=await context();
      setStatus("Récupération de la liste des vidéos TikTok…");
      const videos=(await getTikTokVideos(ctx)).slice(0,10);
      if(!videos.length)throw new Error("Aucune vidéo TikTok disponible pour cet artiste.");
      setStatus("Vérification des outils officiels de commentaires…");
      const toolsResult=await mcpRequest(ctx,{action:"tools/list"});
      const tools=toolsResult.tools||[];
      const commentTool=tools.find(tool=>tool.name==="account_user_comment_list_get")||tools.find(tool=>/comment.*list|list.*comment/i.test(tool.name+" "+(tool.annotations?.title||"")));
      if(!commentTool)throw new Error("L’outil officiel de lecture des commentaires n’est pas disponible pour cette connexion.");
      const gathered=[],errors=[];
      for(let index=0;index<videos.length;index++){
        const video=videos[index];
        if(index)await delay(220);
        setStatus("Lecture des commentaires · vidéo "+(index+1)+"/"+videos.length+"…");
        try{
          const result=await mcpRequest(ctx,{action:"tools/call",name:commentTool.name,arguments:{video_id:String(video.id||video.video_id),include_replies:true,max_count:20,status:"PUBLIC",sort_field:"create_time",sort_order:"desc",cursor:0}});
          const parsed=parseMcpResult(result),data=parsed?.data?.data||parsed?.data||parsed;
          const comments=Array.isArray(data?.comments)?data.comments:Array.isArray(data?.comment_list)?data.comment_list:[];
          comments.forEach(comment=>{const normalized=normalizeComment(comment,video);if(normalized)gathered.push(normalized);});
        }catch(error){errors.push(String(video.title||video.id)+": "+error.message);}
      }
      if(gathered.length){
        const unique=[...new Map(gathered.map(item=>[item.external_comment_id,item])).values()];
        const saved=await api("/api/community/inbox",ctx,"POST",{artist_id:ctx.artistId,messages:unique});
        await loadInbox();
        await autoGenerateMissingDrafts();
        setStatus(saved.stored+" commentaire(s) TikTok synchronisé(s). Jusqu’à 20 commentaires ont été demandés par vidéo sur les 10 dernières vidéos."+(errors.length?" Certaines vidéos n’ont pas pu être lues ("+errors.length+").":""));
      }else{
        await loadInbox();
        setStatus(errors.length?"Aucun commentaire récupéré. "+errors.slice(0,2).join(" · "):"Aucun commentaire public trouvé dans les vidéos consultées.");
      }
    }catch(error){setStatus(error.message,true);}
    finally{busy=false;if(button){button.disabled=false;button.textContent=originalButtonText;}if(refresh)refresh.disabled=false;}
  }
  let replyToolPromise=null,replyToolArtistId=null;
  async function discoverReplyTool(){
    const ctx=await context();
    if(replyToolPromise&&replyToolArtistId===ctx.artistId)return replyToolPromise;
    replyToolArtistId=ctx.artistId;
    replyToolPromise=(async()=>{
      const result=await mcpRequest(ctx,{action:"tools/list"});
      const tools=Array.isArray(result.tools)?result.tools:[];
      const writable=tools.filter(tool=>tool?.annotations?.readOnlyHint!==true);
      return writable.find(tool=>tool.name==="account_user_comment_create")
        ||writable.find(tool=>/comment.*(create|reply_create|reply_post|reply_add)|(?:create|post|publish).*comment/i.test(tool.name||"")&&!/(list|get|query|search)/i.test(tool.name||""))||null;
    })();
    return replyToolPromise;
  }
  function replyArguments(tool,item,replyText){
    const schema=tool?.inputSchema||{},properties=schema.properties||{},required=schema.required||[];
    const args={},known=new Set();
    for(const [key,definition] of Object.entries(properties)){
      const name=key.toLowerCase();
      if(/^(video_id|videoid)$/.test(name)){args[key]=String(item.external_media_id||"");known.add(key);}
      else if(/^(comment_id|parent_comment_id|parent_id)$/.test(name)){args[key]=String(item.external_comment_id||"");known.add(key);}
      else if(/^(text|comment_text|reply_text|content|message)$/.test(name)){args[key]=replyText;known.add(key);}
      else if(/^(business_id|open_id)$/.test(name)){continue;}
      else if(definition?.default!==undefined){args[key]=definition.default;known.add(key);}
    }
    const missing=required.filter(key=>!known.has(key));
    if(missing.length||!Object.keys(args).some(key=>/text|content|message/i.test(key)))return null;
    return args;
  }
  async function publishCommentReply(item,textarea,button){
    if(busy||item.workflow_status==="replied")return;
    const reply=String(textarea?.value||"").trim();
    if(!reply){setStatus("Le texte de la réponse est vide.",true);return;}
    if(reply.length>150){setStatus("La réponse dépasse 150 caractères. Raccourcis-la avant publication.",true);return;}
    const child=String((await context()).artistName||"").trim().toUpperCase()==="NURIA DOLL";
    const confirmation=child
      ?"Validation parentale obligatoire : publier cette réponse publique sur TikTok ?\n\n"+reply+"\n\nConfirmer uniquement si tu es le parent ou le gestionnaire autorisé."
      :"Publier cette réponse publique sur TikTok ?\n\n"+reply;
    if(!window.confirm(confirmation))return;
    busy=true;button.disabled=true;button.textContent="Publication en cours…";
    try{
      const ctx=await context(),tool=await discoverReplyTool();
      if(!tool)throw new Error("TikTok n’a pas exposé d’outil officiel de réponse pour ce compte.");
      const args=replyArguments(tool,item,reply);
      if(!args)throw new Error("Le schéma de l’outil TikTok a changé ou exige des paramètres non reconnus. Aucune publication effectuée.");
      const result=await mcpRequest(ctx,{action:"tools/call",name:tool.name,arguments:args});
      if(result?.isError)throw new Error("TikTok a refusé la publication. Vérifie les autorisations et réessaie.");
      const parsed=parseMcpResult(result);
      if(parsed?.isError||parsed?.error||parsed?.code&&Number(parsed.code)!==0)throw new Error(parsed.message||parsed.error?.message||"TikTok a retourné une erreur de publication.");
      const replyId=String(parsed?.data?.comment_id||parsed?.data?.id||parsed?.comment_id||parsed?.id||"");
      await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id:item.id,published_reply:reply,platform_reply_id:replyId,ai_draft:null});
      await loadInbox();
      setStatus("Réponse publiée sur TikTok et enregistrée dans la boîte de réception.");
    }catch(error){setStatus(error.message||"Publication impossible.",true);}
    finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent="Publier la réponse sur TikTok";}}
  }
  async function prepareDraft(item,card,regenerate=false,silent=false){
    if(busy)return;
    if(regenerate&&!silent&&!window.confirm("Générer une nouvelle proposition ? L’ancien brouillon sera remplacé uniquement si la nouvelle réponse est bien générée."))return;
    busy=true;
    const trigger=[...card.querySelectorAll("button")].find(button=>button.textContent.includes(regenerate?"Régénérer":"Préparer"));
    const originalTriggerText=trigger?.textContent||"";
    if(trigger){trigger.disabled=true;trigger.textContent=regenerate?"Régénération…":"Préparation du brouillon…";}
    try{
      const ctx=await context();
      const child=String(ctx.artistName||"").trim().toUpperCase()==="NURIA DOLL";
      const task=[
        "Prépare un brouillon de réponse publique au commentaire suivant pour l’artiste "+String(ctx.artistName||"artiste actif")+".",
        "COMMENTAIRE : "+String(item.message_text||"").slice(0,5000),
        regenerate?"NOUVELLE TENTATIVE : la proposition précédente ne convient pas. Rédige une réponse réellement différente, avec une autre formulation et un angle naturel. Ne copie pas la proposition précédente : "+String(item.ai_draft||"").slice(0,180):"",
        "RÈGLE ABSOLUE DE LONGUEUR : la réponse finale doit contenir 150 caractères maximum, espaces, emojis et ponctuation compris. Vise 120 à 140 caractères pour garder une marge. Compte les caractères avant de répondre. Si nécessaire, reformule et raccourcis jusqu’à respecter strictement la limite. Ne dépasse jamais 150 caractères, même d’un seul caractère.",
        "RÈGLES DE CONTENU : réponds dans la langue du commentaire si elle est identifiable, sinon en français. Sois bref, naturel, poli et adapté à la communauté de cet artiste. Pour les questions commerciales, titres, liens, dates ou disponibilités, utilise uniquement les faits confirmés du contexte de l’artiste. N’invente aucun prix, URL, date ni disponibilité. Ne demande jamais de coordonnées, de photos, d’adresse, de lieu de rencontre ou de conversation privée. Ne divulgue aucune information personnelle.",
        child?"PROTECTION PARENTALE : NURIA DOLL est une artiste mineure. Aucun échange privé, aucune rencontre, aucun renseignement personnel, scolaire, familial ou de localisation. En cas de sujet sensible ou de doute, signale qu'une vérification parentale est nécessaire.":"En cas de message sensible, harcèlement, menace ou demande inappropriée, ne réponds pas au fond et signale qu'une vérification du gestionnaire est nécessaire.",
        "Retourne uniquement un brouillon court, sans guillemets et sans prétendre qu'il a été envoyé."
      ].join("\n\n");
      const response=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,task})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error(payload.error||"L’IA n’a pas pu préparer le brouillon.");
      let draft=String(payload.answer).trim().replace(/^["'“”]+|["'“”]+$/g,"").replace(/\\s+/g," ");
      if(draft.length>150){draft=draft.slice(0,150);const lastSpace=draft.lastIndexOf(" ");if(lastSpace>100)draft=draft.slice(0,lastSpace);draft=draft.replace(/[\\s,;:–—-]+$/g,"").trim();}
      if(!draft||draft.length>150)throw new Error("Impossible de produire une réponse TikTok de 150 caractères maximum. Réessaie.");
      await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id:item.id,ai_draft:draft,workflow_status:"drafted"});
      await loadInbox();
      setStatus(regenerate?"Nouvelle proposition générée et enregistrée.":(child?"Brouillon préparé. Validation parentale obligatoire avant toute publication.":"Brouillon préparé et enregistré. Il n’a pas été publié."));
    }catch(error){setStatus(error.message,true);}
    finally{busy=false;if(trigger?.isConnected){trigger.disabled=false;trigger.textContent=originalTriggerText;}}
  }
  let autoQueueRunning=false;
  async function autoGenerateMissingDrafts(){
    if(autoQueueRunning||busy)return;
    const pending=messages.filter(item=>!item.ai_draft&&!item.published_reply&&!["replied","ignored"].includes(item.workflow_status));
    if(!pending.length)return;
    autoQueueRunning=true;
    const queueArtistId=loadedArtistId;
    const filter=$("#communityStatusFilter"),previousFilter=filter?.value||"all";
    if(filter)filter.value="all";
    render();
    let completed=0,failed=0;
    try{
      setStatus("Préparation automatique des réponses IA · 0/"+pending.length+"…");
      for(const item of pending){
        if(loadedArtistId!==queueArtistId)break;
        const card=[...($("#communityList")?.querySelectorAll(".community-comment")||[])].find(node=>node.dataset.commentId===String(item.id));
        if(!card){failed++;continue;}
        await prepareDraft(item,card,false,true);
        const current=messages.find(message=>message.id===item.id);
        if(current?.ai_draft)completed++;else failed++;
        setStatus("Génération automatique · "+completed+"/"+pending.length+" réponse(s) prête(s)"+(failed?" · "+failed+" à réessayer":"")+".");
      }
    }finally{
      if(filter)filter.value=previousFilter;
      render();
      autoQueueRunning=false;
      setStatus(completed+" réponse(s) IA préparée(s) automatiquement"+(failed?" · "+failed+" commentaire(s) à réessayer":"")+". Aucune réponse n’a été publiée.");
    }
  }
  function mount(){
    window.addEventListener("aimm:app-notice",event=>showAppNotice(event.detail));
    if(window.AIMM_LAST_TOAST&&Date.now()-window.AIMM_LAST_TOAST.at<600000)showAppNotice(window.AIMM_LAST_TOAST);
    $("#communitySyncTikTok")?.addEventListener("click",syncTikTok);
    window.addEventListener("aimm:community-sync-request",event=>void syncTikTok(event.detail?.button||null));
    $("#communityRefresh")?.addEventListener("click",()=>void loadInbox().then(autoGenerateMissingDrafts));
    $("#communityPlatformFilter")?.addEventListener("change",render);
    $("#communityStatusFilter")?.addEventListener("change",render);
    $("#communitySearch")?.addEventListener("input",render);
    window.addEventListener("aimm:view-changed",event=>{if(event.detail?.view==="community")void loadInbox().then(autoGenerateMissingDrafts);});
    window.addEventListener("aimm:artist-changed",()=>{if($("#view-community")?.classList.contains("active-view"))void loadInbox().then(autoGenerateMissingDrafts);});
    if($("#view-community")?.classList.contains("active-view"))void loadInbox().then(autoGenerateMissingDrafts);
  }
  document.addEventListener("DOMContentLoaded",mount);
})();
