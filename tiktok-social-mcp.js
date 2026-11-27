(() => {
  const $=(s,r=document)=>r.querySelector(s);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let tools=[],busy=false;
  function mount(){
    const root=$("#socialTiktokDetail");if(!root||$("#tiktokSocialMcp"))return;
    const section=document.createElement("section");section.id="tiktokSocialMcp";section.className="social-insights-panel tt-mcp-panel";
    section.innerHTML=`
      <div class="tt-mcp-head"><div><h4>Communauté & interactions TikTok</h4><p>Lire les commentaires, préparer des réponses et gérer les interactions avec les autorisations TikTok.</p></div><span id="ttMcpBadge" class="tag amber">Non connecté</span></div>
      <p id="ttMcpStatus" class="youtube-channel-sync" role="status">Vérification de la connexion à TikTok Social…</p>
      <div class="tt-mcp-actions"><button id="ttMcpConnect" type="button" class="btn primary">Connecter la gestion des commentaires</button><button id="ttMcpLoadTools" type="button" class="btn secondary hidden">Charger les outils disponibles</button></div>
      <div id="ttMcpQuickComments" class="tt-mcp-quick hidden">
        <div class="tt-mcp-quick-heading"><div><h5>Commentaires des vidéos</h5><p>Choisis une vidéo déjà chargée dans le tableau TikTok. Les commentaires s’afficheront directement ici.</p></div></div>
        <label class="tt-mcp-video-picker">Vidéo<select id="ttMcpVideo"><option value="">Chargement des vidéos…</option></select></label>
        <div class="tt-mcp-actions"><button id="ttMcpLoadComments" type="button" class="btn primary">Afficher les commentaires</button></div>
        <p id="ttMcpCommentsStatus" class="muted" role="status"></p>
        <div id="ttMcpComments" class="tt-mcp-comments" aria-live="polite"></div>
      </div>
      <details id="ttMcpAdvanced" class="tt-mcp-advanced">
        <summary>Outils TikTok avancés</summary>
        <div class="tt-mcp-actions"><button id="ttMcpLoadTools" type="button" class="btn secondary hidden">Actualiser les outils disponibles</button></div>
        <div id="ttMcpWorkbench" class="tt-mcp-workbench hidden">
          <label>Action TikTok<select id="ttMcpTool"><option value="">Choisir une action…</option></select></label>
          <p id="ttMcpToolDescription" class="muted"></p>
          <div id="ttMcpFields" class="tt-mcp-fields"></div>
          <button id="ttMcpRun" type="button" class="btn primary">Exécuter l’action</button>
          <div id="ttMcpOutput" class="tt-mcp-output" aria-live="polite"></div>
        </div>
      </details>
      <p class="tt-mcp-footnote">Les outils disponibles dépendent des autorisations accordées par TikTok et de la région du compte. Les actions de modération et de réponse sont exécutées uniquement après ton clic de confirmation.</p>`;
    root.append(section);
    $("#ttMcpConnect").addEventListener("click",connect);
    $("#ttMcpLoadTools").addEventListener("click",loadTools);
    $("#ttMcpLoadComments").addEventListener("click",loadComments);
    $("#ttMcpTool").addEventListener("change",renderToolForm);
    $("#ttMcpRun").addEventListener("click",runTool);
    document.querySelectorAll('[data-social-platform="tiktok"]').forEach(button=>button.addEventListener("click",()=>setTimeout(refreshStatus,220)));
    window.addEventListener("aimm:tiktok-videos-updated",()=>renderVideoOptions());
    refreshStatus();
  }
  async function context(){const ctx=await window.AIMusicManagerTikTokContext?.get?.();if(!ctx?.artistId||!ctx?.accessToken)throw new Error("Connecte-toi et sélectionne un artiste.");return ctx;}
  async function request(action,extra={}){
    const ctx=await context(),response=await fetch("/api/tiktok/social-mcp",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,action,...extra})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Opération TikTok Social impossible.");return data;
  }
  function status(message,bad=false){const node=$("#ttMcpStatus");if(node)node.textContent=message;const badge=$("#ttMcpBadge");if(badge){badge.textContent=bad?"À connecter":"Connecté";badge.className="tag "+(bad?"amber":"green");}}
  async function connect(){
    if(busy)return;const button=$("#ttMcpConnect");button.disabled=true;button.textContent="Préparation de la connexion…";
    try{const ctx=await context(),response=await fetch("/api/tiktok/social-mcp/start",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId})}),data=await response.json().catch(()=>({}));if(!response.ok||!data.auth_url)throw new Error(data.error||"Impossible de démarrer l’autorisation TikTok Social.");window.location.assign(data.auth_url);}
    catch(e){status(e.message,true);button.disabled=false;button.textContent="Réessayer la connexion";}
  }
  async function refreshStatus(){
    try{const data=await request("status");status("Gestion de communauté connectée. Autorisations : "+String(data.scopes||"").split(" ").filter(Boolean).join(", "));$("#ttMcpConnect").classList.add("hidden");$("#ttMcpLoadTools").classList.remove("hidden");await loadTools();}
    catch(e){status(e.message,true);$("#ttMcpConnect").classList.remove("hidden");$("#ttMcpLoadTools").classList.add("hidden");$("#ttMcpWorkbench").classList.add("hidden");}
  }
  async function renderVideoOptions(){
    const select=$("#ttMcpVideo");if(!select)return;
    try{
      const ctx=await context(),videos=Array.isArray(ctx.videos)?ctx.videos.filter(v=>v.id):[];
      const previous=select.value;
      select.replaceChildren(new Option(videos.length?"Choisir une vidéo…":"Aucune vidéo chargée",""));
      videos.forEach(video=>{
        const count=video.comment_count==null?"commentaires non renseignés":video.comment_count+" commentaire(s)";
        select.add(new Option(String(video.title||"Vidéo TikTok").slice(0,85)+" · "+count,String(video.id)));
      });
      if(videos.some(v=>String(v.id)===previous))select.value=previous;
      else if(videos.length)select.value=String(videos[0].id);
      $("#ttMcpLoadComments").disabled=!videos.length;
      $("#ttMcpCommentsStatus").textContent=videos.length
        ?videos.length+" vidéo(s) disponible(s). Sélectionne une vidéo puis affiche ses commentaires."
        :"Les vidéos TikTok sont encore en cours de chargement. Actualise les statistiques du compte puis réessaie.";
    }catch(error){$("#ttMcpCommentsStatus").textContent=error.message;}
  }
  async function loadComments(){
    if(busy)return;
    const videoId=$("#ttMcpVideo")?.value,tool=tools.find(t=>t.name==="account_user_comment_list_get");
    const output=$("#ttMcpComments"),statusNode=$("#ttMcpCommentsStatus"),button=$("#ttMcpLoadComments");
    if(!tool){statusNode.textContent="L’outil officiel de lecture des commentaires n’est pas disponible.";return;}
    if(!videoId){statusNode.textContent="Sélectionne d’abord une vidéo TikTok.";return;}
    busy=true;button.disabled=true;button.textContent="Chargement des commentaires…";output.replaceChildren();
    try{
      const result=await request("tools/call",{name:tool.name,arguments:{video_id:videoId,include_replies:true,max_count:20,status:"PUBLIC",sort_field:"create_time",sort_order:"desc",cursor:0}});
      const parsed=parseToolText(result),data=parsed?.data?.data||parsed?.data||parsed;
      const comments=Array.isArray(data?.comments)?data.comments:[];
      renderCommentCards(output,comments);
      const count=comments.length;
      statusNode.textContent=count
        ?count+" commentaire(s) récupéré(s) pour cette vidéo."
        :"Aucun commentaire public n’a été retourné pour cette vidéo.";
      if(data?.has_more)statusNode.textContent+=" D’autres commentaires sont disponibles dans la pagination avancée.";
    }catch(error){statusNode.textContent="Lecture des commentaires impossible : "+error.message;}
    finally{busy=false;button.disabled=false;button.textContent="Actualiser les commentaires";}
  }
  function formatCommentDate(value){
    const number=Number(value),date=Number.isFinite(number)&&number>0?new Date(number*1000):new Date(value);
    return Number.isNaN(date.getTime())?"Date non disponible":date.toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  }
  function renderCommentCards(output,comments){
    output.replaceChildren();
    if(!comments.length){const empty=document.createElement("p");empty.className="tt-mcp-empty";empty.textContent="Aucun commentaire public retourné pour cette vidéo.";output.append(empty);return;}
    comments.forEach(comment=>{
      const card=document.createElement("article");card.className="tt-mcp-comment";
      const header=document.createElement("div");header.className="tt-mcp-comment-head";
      const author=document.createElement("strong");author.textContent=comment.username?"@"+comment.username:(comment.display_name||"Utilisateur TikTok");
      const date=document.createElement("small");date.textContent=formatCommentDate(comment.create_time);
      header.append(author,date);
      const body=document.createElement("p");body.textContent=comment.text||comment.comment_text||"(Commentaire sans texte)";
      const meta=document.createElement("small");meta.textContent=(comment.likes??comment.like_count??0)+" j’aime · "+(comment.replies??comment.reply_count??0)+" réponse(s) · "+(comment.status||"visibilité inconnue");
      const draftButton=document.createElement("button");draftButton.type="button";draftButton.className="btn secondary tt-mcp-draft-button";draftButton.textContent="Préparer une réponse avec l’IA";
      draftButton.addEventListener("click",()=>prepareAiReply(comment,card,draftButton));
      card.append(header,body,meta,draftButton);output.append(card);
    });
  }
  async function loadTools(){
    const button=$("#ttMcpLoadTools");if(button){button.disabled=true;button.textContent="Chargement…";}
    try{
      const data=await request("tools/list");tools=(data.tools||[]).filter(t=>/comment|video|insight|discovery|hashtag|profile|benchmark/i.test(t.name+" "+(t.annotations?.title||"")+" "+(t.description||"")));
      const select=$("#ttMcpTool");select.replaceChildren(new Option("Choisir une action…",""));
      tools.forEach(tool=>select.add(new Option((tool.annotations?.title||tool.name)+" · "+tool.name,tool.name)));
      const preferred=tools.find(t=>t.name==="account_user_comment_list_get")||tools.find(t=>/comment.*list|list.*comment/i.test(t.name+" "+(t.annotations?.title||"")));if(preferred)select.value=preferred.name;
      $("#ttMcpQuickComments").classList.remove("hidden");
      $("#ttMcpWorkbench").classList.remove("hidden");renderToolForm();
      await renderVideoOptions();
      status(tools.length+" outils TikTok disponibles. Les actions de commentaires et d’analyse sont chargées dynamiquement.");
    }catch(e){status("Impossible de charger les outils TikTok : "+e.message,true);}
    finally{if(button){button.disabled=false;button.textContent="Actualiser les outils disponibles";}}
  }
  function renderToolForm(){
    const tool=tools.find(t=>t.name===$("#ttMcpTool")?.value),fields=$("#ttMcpFields"),description=$("#ttMcpToolDescription");fields.replaceChildren();$("#ttMcpOutput").replaceChildren();$("#ttMcpRun").disabled=!tool;
    if(!tool){description.textContent="Sélectionne une action. Les champs sont générés à partir du schéma officiel renvoyé par TikTok.";return;}
    description.textContent=tool.description||"";
    const schema=tool.inputSchema||{},props=schema.properties||{},required=schema.required||[];
    Object.entries(props).forEach(([name,def],index)=>{
      const label=document.createElement("label");label.className="tt-mcp-field";const caption=document.createElement("span");caption.textContent=(def.title||name)+(required.includes(name)?" *":"");label.append(caption);
      let input;
      if(Array.isArray(def.enum)){input=document.createElement("select");input.add(new Option("Choisir…",""));def.enum.forEach(v=>input.add(new Option(String(v),String(v))));}
      else if(def.type==="boolean"){input=document.createElement("input");input.type="checkbox";}
      else if(def.type==="object"||def.type==="array"){input=document.createElement("textarea");input.rows=3;input.placeholder=def.type==="array"?"Valeurs au format JSON [ … ]":"Objet au format JSON { … }";}
      else{input=document.createElement("input");input.type=def.type==="integer"||def.type==="number"?"number":"text";input.placeholder=def.description||name;if(def.format==="date-time")input.type="datetime-local";}
      input.dataset.prop=name;input.dataset.type=def.type||"string";input.dataset.required=required.includes(name)?"1":"0";
      if(def.default!==undefined&&input.type!=="checkbox")input.value=String(def.default);
      if(def.default===true&&input.type==="checkbox")input.checked=true;
      if(def.description){const help=document.createElement("small");help.textContent=def.description;label.append(caption,input,help);}else label.append(input);
      fields.append(label);
    });
    if(!Object.keys(props).length){const note=document.createElement("p");note.textContent="Cette action ne demande aucun paramètre.";fields.append(note);}
  }
  function parseToolText(result){
    let value=result;
    for(let depth=0;depth<5;depth++){
      if(value?.structuredContent&&typeof value.structuredContent==="object"){value=value.structuredContent;continue;}
      if(Array.isArray(value?.content)){
        const text=value.content.find(item=>item?.type==="text"&&typeof item.text==="string")?.text;
        if(text){try{value=JSON.parse(text);continue;}catch{}}
      }
      if(value?.result&&typeof value.result==="object"){value=value.result;continue;}
      break;
    }
    return value;
  }
  async function prepareAiReply(comment,card,button){
    const commentText=String(comment?.text||comment?.comment_text||"").trim().slice(0,1200);
    if(!commentText){status("Ce commentaire ne contient aucun texte exploitable pour préparer une réponse.",true);return;}
    button.disabled=true;button.textContent="Préparation du brouillon…";
    let panel=card.querySelector(".tt-mcp-ai-draft");
    if(!panel){panel=document.createElement("div");panel.className="tt-mcp-ai-draft";card.append(panel);}
    panel.textContent="L’IA prépare une proposition. Aucune publication ne sera effectuée.";
    try{
      const ctx=await context();
      const task=[
        "Prépare un brouillon de réponse publique TikTok à ce commentaire, pour l’artiste "+String(ctx.artistName||"artiste actif")+".",
        "COMMENTAIRE PUBLIC : "+commentText,
        "RÈGLES : réponds en français, avec une phrase très courte, naturelle, chaleureuse et adaptée à une audience familiale. Si le commentaire se limite à un emoji ou à un compliment, remercie simplement la personne. N’invente aucun fait sur l’artiste ou son actualité. N’invite jamais à une conversation privée, à une rencontre, à envoyer des photos, coordonnées ou informations personnelles. Ne mentionne ni école, domicile, horaires, localisation ou habitudes. Ne réponds pas à une demande sensible, une sollicitation privée, une insulte ou un message ambigu : indique alors qu’une vérification parentale est nécessaire.",
        "IMPORTANT : produis uniquement un brouillon. Ne publie, n’envoie et ne modifie absolument rien sur TikTok. Le parent/gestionnaire doit relire et décider lui-même.",
        "FORMAT : une seule proposition, une phrase maximum, sans guillemets ni explication."
      ].join("\n\n");
      const response=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,task})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error(payload.error||"L’assistant IA n’a pas pu préparer le brouillon.");
      panel.replaceChildren();
      const label=document.createElement("strong");label.textContent="Brouillon IA — validation parentale obligatoire";
      const textarea=document.createElement("textarea");textarea.className="tt-mcp-draft-text";textarea.rows=3;textarea.value=String(payload.answer).trim();textarea.setAttribute("aria-label","Brouillon de réponse TikTok à relire et modifier");
      const note=document.createElement("small");note.textContent="Brouillon modifiable uniquement. Aucun envoi ni publication n’a été effectué.";
      const copy=document.createElement("button");copy.type="button";copy.className="btn secondary tt-mcp-copy-draft";copy.textContent="Copier le brouillon";
      copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(textarea.value);copy.textContent="Copié";}catch{textarea.focus();textarea.select();copy.textContent="Texte sélectionné · copie avec Ctrl+C";}});
      panel.append(label,textarea,note,copy);
    }catch(error){panel.textContent="Préparation impossible : "+error.message;}
    finally{button.disabled=false;button.textContent="Préparer une réponse avec l’IA";}
  }
  function renderOutput(result){
    const output=$("#ttMcpOutput");output.replaceChildren();
    const parsed=parseToolText(result),data=parsed?.data?.data||parsed?.data||parsed;
    const comments=data?.comments||data?.comment_list||data?.items;
    if(Array.isArray(comments)){const heading=document.createElement("strong");heading.textContent=comments.length+" commentaires";output.append(heading);renderCommentCards(output,comments);}
    else{const pre=document.createElement("pre");pre.textContent=JSON.stringify(parsed,null,2);pre.className="tt-mcp-json";output.append(pre);}
  }
  async function runTool(){
    if(busy)return;const tool=tools.find(t=>t.name===$("#ttMcpTool").value);if(!tool)return;
    const requiresConfirmation=tool.annotations?.readOnlyHint!==true;
    if(requiresConfirmation&&!window.confirm("TikTok ne déclare pas explicitement cet outil comme une action en lecture seule. Il peut modifier, publier ou gérer des données du compte. Confirmer son exécution ?"))return;
    const args={};
    for(const input of $("#ttMcpFields").querySelectorAll("[data-prop]")){
      const key=input.dataset.prop,type=input.dataset.type;
      if(input.type==="checkbox")args[key]=input.checked;
      else if(input.value.trim()===""){if(input.dataset.required==="1"){input.focus();status("Renseigne le champ obligatoire : "+key,true);return;}}
      else if(type==="integer"||type==="number")args[key]=Number(input.value);
      else if(type==="object"||type==="array"){try{args[key]=JSON.parse(input.value);}catch{input.focus();status("Le champ "+key+" doit contenir un JSON valide.",true);return;}}
      else args[key]=input.value.trim();
    }
    const button=$("#ttMcpRun");busy=true;button.disabled=true;button.textContent="Exécution…";
    try{const result=await request("tools/call",{name:tool.name,arguments:args});renderOutput(result);status("Action TikTok exécutée. Vérifie le résultat ci-dessous.");}
    catch(e){status("Action TikTok impossible : "+e.message,true);$("#ttMcpOutput").textContent=e.message;}
    finally{busy=false;button.disabled=false;button.textContent="Exécuter l’action";}
  }
  document.addEventListener("DOMContentLoaded",mount);
})();