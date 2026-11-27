(() => {
  const $ = (selector, root=document) => root.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const MUSIC_URL="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
  const BRAND_URL="https://www.tiktok.com/legal/page/global/bc-policy/en";
  let creatorInfo=null,creatorInfoArtistId=null,publishCapabilities=null,publishCapabilitiesArtistId=null,busy=false,videoPreviewUrl=null;

  function mount(){
    const root=$("#socialTiktokDetail");if(!root||$("#tiktokPublisher"))return;
    const section=document.createElement("section");
    section.id="tiktokPublisher";section.className="social-insights-panel tiktok-publisher";
    section.innerHTML=`
      <div class="tiktok-publisher-heading">
        <div><h4>Studio de publication TikTok</h4><p>Prépare tes contenus, vérifie leur aperçu et choisis les paramètres avant chaque envoi.</p><p class="tt-creator-account" id="ttCreatorAccount">Compte TikTok connecté : informations à actualiser.</p></div>
        <button type="button" class="btn secondary" id="ttCreatorRefresh">Actualiser les paramètres TikTok</button>
      </div>
      <p id="ttPublishCapability" class="youtube-channel-sync" role="status">Les informations du créateur doivent être chargées avant une publication directe.</p>
      <div class="tiktok-publisher-grid">
        <form id="ttVideoForm" class="tiktok-publish-form">
          <h5><span>01</span> Publier une vidéo</h5>
          <label>Fichier vidéo<input id="ttVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm" required></label>
          <div id="ttVideoPreview" class="tt-media-preview hidden"><video id="ttVideoPreviewPlayer" controls playsinline></video></div>
          <label>Légende et hashtags<textarea id="ttVideoCaption" maxlength="2200" rows="3" placeholder="Présente ton contenu… #TikTok" required></textarea><small>2 200 caractères maximum.</small></label>
          <label>Mode de publication<select id="ttVideoMode"><option value="direct">Publication directe</option><option value="draft">Envoyer en brouillon dans TikTok</option></select></label>
          <label>Visibilité<select id="ttVideoPrivacy" disabled><option value="" selected disabled>Choisir la visibilité</option></select></label>
          <div class="tiktok-publish-toggles">
            <label><input id="ttAllowComments" type="checkbox"> Autoriser les commentaires</label>
            <label><input id="ttAllowDuet" type="checkbox"> Autoriser les Duos</label>
            <label><input id="ttAllowStitch" type="checkbox"> Autoriser les Collages</label>
          </div>
          <div class="tt-disclosure">
            <label class="tt-disclosure-toggle"><input id="ttVideoCommercialToggle" type="checkbox"> Ce contenu fait la promotion d’une marque, d’un produit ou d’un service</label>
            <div id="ttVideoCommercialOptions" class="tt-disclosure-options hidden">
              <label><input id="ttVideoYourBrand" type="checkbox"> Ma marque / mon activité</label>
              <label><input id="ttVideoBranded" type="checkbox"> Contenu de marque / partenariat rémunéré</label>
              <small>Choisis au moins une option si le contenu est commercial.</small>
            </div>
            <p id="ttVideoDisclosureNotice" class="tt-disclosure-notice hidden"></p>
            <label class="tt-aigc"><input id="ttVideoAigc" type="checkbox"> Ce contenu est généré par l’intelligence artificielle</label>
            <p id="ttVideoDeclaration" class="tt-declaration"></p>
            <label class="tt-consent"><input id="ttVideoConsent" type="checkbox" required> Je confirme et j’autorise l’envoi de ce contenu à TikTok.</label>
          </div>
          <button class="btn primary" id="ttPublishVideo" type="submit">Publier la vidéo</button>
          <p id="ttVideoResult" class="tiktok-publish-result" role="status"></p>
        </form>
        <form id="ttPhotoForm" class="tiktok-publish-form">
          <h5><span>02</span> Publier des photos</h5>
          <label>URL des images HTTPS<textarea id="ttPhotoUrls" rows="3" placeholder="https://ton-domaine-verifie.com/photo-1.jpg&#10;https://ton-domaine-verifie.com/photo-2.jpg" required></textarea><small>Une URL par ligne. Le domaine doit être vérifié dans TikTok Developers. Maximum 35 images.</small></label>
          <div id="ttPhotoPreview" class="tt-photo-preview hidden"></div>
          <label>Titre de la publication<input id="ttPhotoTitle" type="text" maxlength="90" placeholder="Titre (90 caractères maximum)"></label>
          <label>Description et hashtags<textarea id="ttPhotoCaption" maxlength="4000" rows="3" placeholder="Description de la publication…"></textarea><small>4 000 caractères maximum.</small></label>
          <label>Mode de publication<select id="ttPhotoMode"><option value="direct">Publication directe</option><option value="draft">Envoyer en brouillon dans TikTok</option></select></label>
          <label>Visibilité<select id="ttPhotoPrivacy" disabled><option value="" selected disabled>Choisir la visibilité</option></select></label>
          <div class="tiktok-publish-toggles"><label><input id="ttPhotoAllowComments" type="checkbox"> Autoriser les commentaires</label></div>
          <div class="tt-disclosure">
            <label class="tt-disclosure-toggle"><input id="ttPhotoCommercialToggle" type="checkbox"> Ce contenu fait la promotion d’une marque, d’un produit ou d’un service</label>
            <div id="ttPhotoCommercialOptions" class="tt-disclosure-options hidden">
              <label><input id="ttPhotoYourBrand" type="checkbox"> Ma marque / mon activité</label>
              <label><input id="ttPhotoBranded" type="checkbox"> Contenu de marque / partenariat rémunéré</label>
              <small>Choisis au moins une option si le contenu est commercial.</small>
            </div>
            <p id="ttPhotoDisclosureNotice" class="tt-disclosure-notice hidden"></p>
            <label class="tt-aigc"><input id="ttPhotoAigc" type="checkbox"> Ces photos sont générées par l’intelligence artificielle</label>
            <p id="ttPhotoDeclaration" class="tt-declaration"></p>
            <label class="tt-consent"><input id="ttPhotoConsent" type="checkbox" required> Je confirme et j’autorise l’envoi de ces photos à TikTok.</label>
          </div>
          <button class="btn secondary" id="ttPublishPhoto" type="submit">Envoyer les photos</button>
          <p id="ttPhotoResult" class="tiktok-publish-result" role="status"></p>
        </form>
      </div>
      <div class="tiktok-publish-footnote">L’envoi ne démarre qu’après ton accord explicite. TikTok peut prendre quelques minutes pour traiter le contenu. Les brouillons doivent être finalisés dans l’application TikTok. Les publications publiques restent soumises à l’audit et aux autorisations TikTok.</div>`;
    const rec=$("#socialTiktokDetail .tiktok-recommendations");
    root.insertBefore(section,rec||null);
    $("#ttCreatorRefresh")?.addEventListener("click",()=>refreshPublishingSettings().catch(()=>{}));
    $("#ttVideoForm")?.addEventListener("submit",publishVideo);
    $("#ttPhotoForm")?.addEventListener("submit",publishPhotos);
    $("#ttVideoMode")?.addEventListener("change",()=>{const draft=$("#ttVideoMode").value==="draft";$("#ttPublishVideo").textContent=draft?"Envoyer le brouillon":"Publier la vidéo";});
    $("#ttPhotoMode")?.addEventListener("change",()=>{const draft=$("#ttPhotoMode").value==="draft";$("#ttPublishPhoto").textContent=draft?"Envoyer les photos en brouillon":"Publier les photos";});
    ["Video","Photo"].forEach(kind=>{
      $("#tt"+kind+"CommercialToggle")?.addEventListener("change",()=>syncDisclosure(kind));
      $("#tt"+kind+"Branded")?.addEventListener("change",()=>syncDisclosure(kind));
      $("#tt"+kind+"Privacy")?.addEventListener("change",()=>syncDisclosure(kind));
    });
    $("#ttVideoFile")?.addEventListener("change",previewVideo);
    $("#ttPhotoUrls")?.addEventListener("input",previewPhotos);
    syncDisclosure("Video");syncDisclosure("Photo");
    $("#artistSwitcher")?.addEventListener("change",()=>{creatorInfo=null;creatorInfoArtistId=null;publishCapabilities=null;publishCapabilitiesArtistId=null;fillPrivacy(null);$("#ttCreatorAccount").textContent="Compte TikTok cible : actualise les paramètres de l’artiste actif.";$("#ttPublishCapability").textContent="Les paramètres de l’artiste actif doivent être rechargés avant une publication directe.";});
  }

  async function context(){
    const value=await window.AIMusicManagerTikTokContext?.get?.();
    if(!value?.artistId||!value?.accessToken)throw new Error("Connecte-toi et sélectionne un artiste actif.");
    return value;
  }
  async function api(action,extra={},ctxOverride=null){
    const ctx=ctxOverride||await context();
    const response=await fetch("/api/tiktok/publish",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,action,...extra})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Opération TikTok impossible.");
    return data;
  }
  function fillPrivacy(options){
    [$("#ttVideoPrivacy"),$("#ttPhotoPrivacy")].filter(Boolean).forEach(select=>{
      select.replaceChildren();
      const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Choisir la visibilité";placeholder.disabled=true;placeholder.selected=true;select.append(placeholder);
      (options||[]).forEach(value=>{const option=document.createElement("option");option.value=value;option.textContent=({PUBLIC_TO_EVERYONE:"Tout le monde",MUTUAL_FOLLOW_FRIENDS:"Amis",FOLLOWER_OF_CREATOR:"Abonnés",SELF_ONLY:"Moi uniquement"}[value]||value);select.append(option);});
      select.value="";select.disabled=!options?.length;
    });
    syncDisclosure("Video");syncDisclosure("Photo");
  }
  function applyInteraction(id,disabled){
    const input=$("#"+id);if(!input)return;
    input.checked=false;input.disabled=!!disabled;
    input.closest("label")?.classList.toggle("is-disabled",!!disabled);
  }
  function applyCreatorSettings(info){
    applyInteraction("ttAllowComments",!!info.comment_disabled);
    applyInteraction("ttAllowDuet",!!info.duet_disabled);
    applyInteraction("ttAllowStitch",!!info.stitch_disabled);
    applyInteraction("ttPhotoAllowComments",!!info.comment_disabled);
    const account=$("#ttCreatorAccount");
    if(account)account.textContent="Compte TikTok cible : "+(info.creator_nickname||"Créateur")+(info.creator_username?" (@"+info.creator_username+")":"");
  }
  function setModeAvailability(selectId,direct,upload){
    const select=$("#"+selectId);if(!select)return;
    const directOption=Array.from(select.options).find(o=>o.value==="direct"),draftOption=Array.from(select.options).find(o=>o.value==="draft");
    if(directOption)directOption.disabled=!direct;if(draftOption)draftOption.disabled=!upload;
    if(!direct&&upload)select.value="draft";else if(direct)select.value="direct";
  }
  async function loadCapabilities(ctxOverride=null){
    const ctx=ctxOverride||await context(),result=await api("capabilities",{},ctx),current=await context();
    if(current.artistId!==ctx.artistId)return null;
    publishCapabilities=result;publishCapabilitiesArtistId=ctx.artistId;
    setModeAvailability("ttVideoMode",!!result.direct_posting,!!result.draft_upload);
    setModeAvailability("ttPhotoMode",!!result.direct_posting,!!result.draft_upload);
    const any=!!result.direct_posting||!!result.draft_upload;
    $("#ttPublishVideo").disabled=!any;$("#ttPublishPhoto").disabled=!any;
    if(!result.enabled)$("#ttPublishCapability").textContent="Content Posting API n’est pas encore activé dans la configuration serveur.";
    else if(!result.direct_posting&&result.draft_upload)$("#ttPublishCapability").textContent="L’envoi en brouillon est disponible. La publication directe attend l’autorisation video.publish.";
    else if(result.direct_posting)$("#ttPublishCapability").textContent="Publication directe autorisée par les permissions actuelles. Actualisation des paramètres du créateur…";
    else $("#ttPublishCapability").textContent="Aucune permission video.publish ou video.upload n’est encore accordée. Ajoute les permissions TikTok puis reconnecte le compte.";
    if(!result.direct_posting){creatorInfo=null;creatorInfoArtistId=null;fillPrivacy(null);}
    return result;
  }
  async function refreshPublishingSettings(){
    const caps=await loadCapabilities();
    if(caps?.direct_posting)await loadCreatorInfo();
  }
  async function loadCreatorInfo(ctxOverride=null){
    const ctx=ctxOverride||await context();
    const status=$("#ttPublishCapability");if(status)status.textContent="Lecture des paramètres et autorisations du compte TikTok…";
    try{
      const result=await api("creator_info",{},ctx);
      const current=await context();if(current.artistId!==ctx.artistId)return null;
      creatorInfo=result.creator||{};creatorInfoArtistId=ctx.artistId;
      fillPrivacy(creatorInfo.privacy_level_options);
      applyCreatorSettings(creatorInfo);
      const max=creatorInfo.max_video_post_duration_sec;
      if(status)status.textContent="Paramètres du compte chargés. Choisis manuellement la visibilité et les interactions pour chaque publication."+(max?" Durée vidéo maximale : "+max+" secondes.":"");
      const file=$("#ttVideoFile");if(file)file.dataset.maxDuration=String(max||0);
      return creatorInfo;
    }catch(error){
      creatorInfo=null;creatorInfoArtistId=null;fillPrivacy(null);
      if(status)status.textContent="Paramètres de publication directe indisponibles : "+error.message+". Le mode brouillon peut rester disponible si video.upload est autorisé.";
      throw error;
    }
  }
  function syncDisclosure(kind){
    const prefix="tt"+kind;
    const toggle=$("#"+prefix+"CommercialToggle"),options=$("#"+prefix+"CommercialOptions"),yourBrand=$("#"+prefix+"YourBrand"),branded=$("#"+prefix+"Branded"),privacy=$("#tt"+kind+"Privacy"),declaration=$("#"+prefix+"Declaration");
    const enabled=!!toggle?.checked;
    options?.classList.toggle("hidden",!enabled);
    if(!enabled){if(yourBrand)yourBrand.checked=false;if(branded)branded.checked=false;}
    if(branded&&privacy){
      const selfOption=Array.from(privacy.options).find(o=>o.value==="SELF_ONLY");
      if(privacy.value==="SELF_ONLY"&&branded.checked)branded.checked=false;
      branded.disabled=!enabled||privacy.value==="SELF_ONLY";
      if(selfOption)selfOption.disabled=enabled&&branded.checked;
    }
    const brandedSelected=enabled&&!!branded?.checked;
    const notice=$("#"+prefix+"DisclosureNotice");
    if(notice){const organic=enabled&&!!yourBrand?.checked;notice.textContent=brandedSelected?"Votre photo/vidéo sera étiquetée « Paid partnership ».":organic?"Votre photo/vidéo sera étiquetée « Promotional content ».":"";notice.classList.toggle("hidden",!brandedSelected&&!organic);}
    if(declaration){
      declaration.innerHTML=brandedSelected
        ?'By posting, you agree to TikTok\'s <a href="'+BRAND_URL+'" target="_blank" rel="noopener noreferrer">Branded Content Policy</a> and <a href="'+MUSIC_URL+'" target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.'
        :'By posting, you agree to TikTok\'s <a href="'+MUSIC_URL+'" target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.';
    }
    if(yourBrand?.closest("label"))yourBrand.closest("label").classList.toggle("is-disabled",!enabled);
    if(branded?.closest("label"))branded.closest("label").classList.toggle("is-disabled",!enabled||branded.disabled);
  }
  function validateConsent(kind,direct){
    const prefix="tt"+kind,consent=$("#"+prefix+"Consent"),commercial=$("#"+prefix+"CommercialToggle")?.checked,yourBrand=$("#"+prefix+"YourBrand")?.checked,branded=$("#"+prefix+"Branded")?.checked,privacy=$("#tt"+kind+"Privacy")?.value;
    if(!consent?.checked)throw new Error("Confirme la déclaration TikTok avant l’envoi.");
    if(direct&&!privacy)throw new Error("Choisis manuellement la visibilité de la publication.");
    if(direct&&commercial&&!yourBrand&&!branded)throw new Error("Indique si le contenu promeut ta marque, une autre marque, ou les deux.");
    if(direct&&branded&&privacy==="SELF_ONLY")throw new Error("Un contenu de marque ne peut pas être publié en visibilité privée.");
    return {commercial_disclosure:!!(direct&&commercial),brand_organic_toggle:!!(direct&&commercial&&yourBrand),brand_content_toggle:!!(direct&&commercial&&branded),is_aigc:!!$("#"+prefix+"Aigc")?.checked};
  }
  function previewVideo(){
    const file=$("#ttVideoFile")?.files?.[0],wrap=$("#ttVideoPreview"),player=$("#ttVideoPreviewPlayer");if(!wrap||!player)return;
    if(videoPreviewUrl)URL.revokeObjectURL(videoPreviewUrl);
    if(!file){wrap.classList.add("hidden");player.removeAttribute("src");return;}
    videoPreviewUrl=URL.createObjectURL(file);player.src=videoPreviewUrl;wrap.classList.remove("hidden");
  }
  function previewPhotos(){
    const wrap=$("#ttPhotoPreview");if(!wrap)return;
    const urls=$("#ttPhotoUrls").value.split(/\n+/).map(v=>v.trim()).filter(v=>/^https:\/\//i.test(v)).slice(0,35);
    wrap.replaceChildren();
    urls.forEach(url=>{const img=document.createElement("img");img.src=url;img.alt="Aperçu de la photo";img.loading="lazy";wrap.append(img);});
    wrap.classList.toggle("hidden",!urls.length);
  }
  function setBusy(value,button,label){
    busy=value;if(button){button.disabled=value;button.dataset.originalLabel ||= button.textContent;button.textContent=value?label:button.dataset.originalLabel;}
  }
  async function uploadVideo(file,uploadUrl,chunkSize,artistId,accessToken,resultNode){
    const total=file.size,totalChunks=Math.ceil(total/chunkSize);
    for(let index=0;index<totalChunks;index++){
      const start=index*chunkSize,end=Math.min(start+chunkSize,total),chunk=file.slice(start,end);
      const response=await fetch("/api/tiktok/upload?artist_id="+encodeURIComponent(artistId),{method:"POST",headers:{authorization:"Bearer "+accessToken,"content-type":file.type||"video/mp4","x-tiktok-upload-url":uploadUrl,"content-range":`bytes ${start}-${end-1}/${total}`},body:chunk});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Échec du transfert vidéo (bloc "+(index+1)+").");
      if(resultNode)resultNode.textContent="Transfert sécurisé vers TikTok : "+Math.round((index+1)/totalChunks*100)+" %";
    }
  }
  async function waitForStatus(publishId,resultNode,ctx){
    let last=null;
    for(let attempt=0;attempt<30;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2500));
      const result=await api("status",{publish_id:publishId},ctx);last=result;
      if(resultNode)resultNode.textContent="Traitement TikTok : "+result.status;
      if(["PUBLISH_COMPLETE","SEND_TO_USER_INBOX","FAILED"].includes(result.status))return result;
    }
    return last||{status:"PROCESSING_UPLOAD"};
  }
  async function readVideoDuration(file){
    return new Promise((resolve,reject)=>{const video=document.createElement("video"),url=URL.createObjectURL(file);video.preload="metadata";video.onloadedmetadata=()=>{const duration=video.duration;URL.revokeObjectURL(url);resolve(duration);};video.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Impossible de lire la durée de cette vidéo."));};video.src=url;});
  }
  async function publishVideo(event){
    event.preventDefault();if(busy)return;
    const button=$("#ttPublishVideo"),resultNode=$("#ttVideoResult"),file=$("#ttVideoFile")?.files?.[0],caption=$("#ttVideoCaption")?.value.trim();
    if(!file||!caption){if(resultNode)resultNode.textContent="Choisis une vidéo et sa légende.";return;}
    const ctx=await context().catch(e=>{if(resultNode)resultNode.textContent=e.message;return null;});if(!ctx)return;
    const draft=$("#ttVideoMode").value==="draft";
    try{
      setBusy(true,button,draft?"Préparation du brouillon…":"Préparation de la publication…");
      let info=creatorInfo;
      const caps=publishCapabilitiesArtistId===ctx.artistId?publishCapabilities:await loadCapabilities(ctx);
      if(!draft){if(!caps?.direct_posting)throw new Error("La permission video.publish n’est pas activée pour cet artiste.");info=info&&creatorInfoArtistId===ctx.artistId?info:await loadCreatorInfo(ctx);if(!info?.privacy_level_options?.length)throw new Error("Les paramètres de visibilité du créateur ne sont pas disponibles pour cet artiste.");}
      else if(!caps?.draft_upload)throw new Error("La permission video.upload n’est pas activée pour cet artiste.");
      const disclosure=validateConsent("Video",!draft);
      const max=Number(info?.max_video_post_duration_sec||0);
      if(!["video/mp4","video/quicktime","video/webm"].includes(file.type))throw new Error("Format non pris en charge. Utilise MP4, MOV ou WebM.");
      if(file.size>4*1024*1024*1024)throw new Error("La vidéo dépasse la limite de taille prise en charge (4 Go).");
      const duration=await readVideoDuration(file);if(max&&duration>max)throw new Error("Cette vidéo dure "+Math.ceil(duration)+" s, au-delà de la limite de ce compte ("+max+" s).");
      const init=await api(draft?"init_draft":"init_video",{title:caption,video_size:file.size,privacy_level:$("#ttVideoPrivacy").value,disable_comment:!$("#ttAllowComments").checked,disable_duet:!$("#ttAllowDuet").checked,disable_stitch:!$("#ttAllowStitch").checked,...disclosure},ctx);
      await uploadVideo(file,init.upload_url,init.chunk_size,ctx.artistId,ctx.accessToken,resultNode);
      const final=await waitForStatus(init.publish_id,resultNode,ctx);
      if(final.status==="PUBLISH_COMPLETE")resultNode.textContent="Publication terminée avec succès. Identifiant TikTok : "+(final.post_ids?.[0]||init.publish_id);
      else if(final.status==="SEND_TO_USER_INBOX")resultNode.textContent="Brouillon envoyé. Ouvre TikTok pour le modifier et le publier.";
      else if(final.status==="FAILED")resultNode.textContent="TikTok a refusé la publication : "+(final.fail_reason||"motif non communiqué")+".";
      else resultNode.textContent="Vidéo transférée. Le traitement TikTok continue ; identifiant : "+init.publish_id;
    }catch(error){if(resultNode)resultNode.textContent="Échec : "+error.message;}
    finally{setBusy(false,button);}
  }
  async function publishPhotos(event){
    event.preventDefault();if(busy)return;
    const button=$("#ttPublishPhoto"),resultNode=$("#ttPhotoResult");
    try{
      setBusy(true,button,"Envoi en cours…");
      const ctx=await context();
      const urls=$("#ttPhotoUrls").value.split(/\n+/).map(v=>v.trim()).filter(Boolean),title=$("#ttPhotoTitle").value.trim(),description=$("#ttPhotoCaption").value.trim(),draft=$("#ttPhotoMode").value==="draft";
      if(!urls.length)throw new Error("Ajoute au moins une URL d’image.");
      if(urls.length>35)throw new Error("TikTok accepte au maximum 35 photos par publication.");
      if(title.length>90)throw new Error("Le titre photo ne peut pas dépasser 90 caractères.");
      if(description.length>4000)throw new Error("La description photo ne peut pas dépasser 4 000 caractères.");
      let info=creatorInfo;
      const caps=publishCapabilitiesArtistId===ctx.artistId?publishCapabilities:await loadCapabilities(ctx);
      if(!draft){if(!caps?.direct_posting)throw new Error("La permission video.publish n’est pas activée pour cet artiste.");info=info&&creatorInfoArtistId===ctx.artistId?info:await loadCreatorInfo(ctx);if(!info?.privacy_level_options?.length)throw new Error("Les paramètres de visibilité du créateur ne sont pas disponibles pour cet artiste.");}
      else if(!caps?.draft_upload)throw new Error("La permission video.upload n’est pas activée pour cet artiste.");
      const disclosure=validateConsent("Photo",!draft);
      const result=await api("init_photo",{photo_images:urls,title,description,privacy_level:$("#ttPhotoPrivacy").value,draft,disable_comment:!$("#ttPhotoAllowComments").checked,...disclosure},ctx);
      const status=await waitForStatus(result.publish_id,resultNode,ctx);
      if(status.status==="PUBLISH_COMPLETE")resultNode.textContent="Publication photo terminée. Identifiant : "+(status.post_ids?.[0]||result.publish_id);
      else if(status.status==="SEND_TO_USER_INBOX")resultNode.textContent="Photos envoyées dans les brouillons TikTok.";
      else if(status.status==="FAILED")resultNode.textContent="Échec TikTok : "+(status.fail_reason||"motif non communiqué")+".";
      else resultNode.textContent="Envoi accepté. Le traitement continue : "+result.publish_id;
    }catch(error){if(resultNode)resultNode.textContent="Échec : "+error.message;}
    finally{setBusy(false,button);}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    mount();
    document.querySelectorAll('[data-social-platform="tiktok"]').forEach(button=>button.addEventListener("click",()=>setTimeout(()=>{if($("#socialTiktokDetail")&&!$("#socialTiktokDetail").classList.contains("hidden"))loadCapabilities().catch(()=>{});},150)));
  });
})();