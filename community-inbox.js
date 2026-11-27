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
      const card=document.createElement("article");card.className="community-comment";
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
        const textarea=document.createElement("textarea");textarea.value=item.ai_draft;textarea.setAttribute("aria-label","Modifier le brouillon de réponse");
        const note=document.createElement("small");note.className="community-draft-note";note.textContent="Brouillon non publié. Relis-le avant toute utilisation.";
        const save=makeButton("Enregistrer le brouillon",async()=>{save.disabled=true;try{const ctx=await context();await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id:item.id,ai_draft:textarea.value});await loadInbox();}catch(e){setStatus(e.message,true);}finally{save.disabled=false;}});
        draftBox.append(title,textarea,note,save);card.append(draftBox);
      }
      const actions=document.createElement("div");actions.className="community-comment-actions";
      if(!item.ai_draft)actions.append(makeButton("Préparer une réponse IA",()=>prepareDraft(item,card), "primary"));
      if(item.workflow_status!=="ignored")actions.append(makeButton(item.workflow_status==="new"?"Marquer comme lu":"Ignorer",()=>updateMessage(item.id,{workflow_status:item.workflow_status==="new"?"read":"ignored"})));
      else actions.append(makeButton("Réintégrer",()=>updateMessage(item.id,{workflow_status:"new"})));
      card.append(actions);list.append(card);
    });
  }
  function setStatus(message,bad=false){
    const node=$("#communityStatus");if(node){node.textContent=message;node.classList.toggle("is-error",bad);}
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
  async function syncTikTok(){
    if(busy)return;busy=true;
    const button=$("#communitySyncTikTok"),refresh=$("#communityRefresh");
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
        setStatus(saved.stored+" commentaire(s) TikTok synchronisé(s). Jusqu’à 20 commentaires ont été demandés par vidéo sur les 10 dernières vidéos."+(errors.length?" Certaines vidéos n’ont pas pu être lues ("+errors.length+").":""));
      }else{
        await loadInbox();
        setStatus(errors.length?"Aucun commentaire récupéré. "+errors.slice(0,2).join(" · "):"Aucun commentaire public trouvé dans les vidéos consultées.");
      }
    }catch(error){setStatus(error.message,true);}
    finally{busy=false;if(button){button.disabled=false;button.textContent="Synchroniser TikTok";}if(refresh)refresh.disabled=false;}
  }
  async function prepareDraft(item,card){
    if(busy)return;busy=true;
    const trigger=[...card.querySelectorAll("button")].find(button=>button.textContent.includes("Préparer"));
    if(trigger){trigger.disabled=true;trigger.textContent="Préparation du brouillon…";}
    try{
      const ctx=await context();
      const child=String(ctx.artistName||"").trim().toUpperCase()==="NURIA DOLL";
      const task=[
        "Prépare un brouillon de réponse publique au commentaire suivant pour l’artiste "+String(ctx.artistName||"artiste actif")+".",
        "COMMENTAIRE : "+String(item.message_text||"").slice(0,1200),
        "RÈGLES : réponds dans la langue du commentaire si elle est identifiable, sinon en français. Sois bref, naturel, poli et adapté à la communauté de cet artiste. Pour les questions commerciales, titres, liens, dates ou disponibilités, utilise uniquement les faits confirmés du contexte de l’artiste. N’invente aucun prix, URL, date ni disponibilité. Ne demande jamais de coordonnées, de photos, d’adresse, de lieu de rencontre ou de conversation privée. Ne divulgue aucune information personnelle.",
        child?"PROTECTION PARENTALE : NURIA DOLL est une artiste mineure. Aucun échange privé, aucune rencontre, aucun renseignement personnel, scolaire, familial ou de localisation. En cas de sujet sensible ou de doute, signale qu'une vérification parentale est nécessaire.":"En cas de message sensible, harcèlement, menace ou demande inappropriée, ne réponds pas au fond et signale qu'une vérification du gestionnaire est nécessaire.",
        "Retourne uniquement un brouillon court, sans guillemets et sans prétendre qu'il a été envoyé."
      ].join("\n\n");
      const response=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,task})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error(payload.error||"L’IA n’a pas pu préparer le brouillon.");
      await api("/api/community/inbox",ctx,"PATCH",{artist_id:ctx.artistId,id:item.id,ai_draft:String(payload.answer).trim(),workflow_status:"drafted"});
      await loadInbox();
      setStatus(child?"Brouillon préparé. Validation parentale obligatoire avant toute publication.":"Brouillon préparé et enregistré. Il n’a pas été publié.");
    }catch(error){setStatus(error.message,true);}
    finally{busy=false;}
  }
  function mount(){
    $("#communitySyncTikTok")?.addEventListener("click",syncTikTok);
    $("#communityRefresh")?.addEventListener("click",loadInbox);
    $("#communityPlatformFilter")?.addEventListener("change",render);
    $("#communityStatusFilter")?.addEventListener("change",render);
    $("#communitySearch")?.addEventListener("input",render);
    window.addEventListener("aimm:view-changed",event=>{if(event.detail?.view==="community")void loadInbox();});
    window.addEventListener("aimm:artist-changed",()=>{if($("#view-community")?.classList.contains("active-view"))void loadInbox();});
    if($("#view-community")?.classList.contains("active-view"))void loadInbox();
  }
  document.addEventListener("DOMContentLoaded",mount);
})();
