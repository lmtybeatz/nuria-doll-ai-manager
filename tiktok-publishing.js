(() => {
  const $ = (selector, root=document) => root.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  let creatorInfo = null, busy = false;
  function mount(){
    const root=$("#socialTiktokDetail"); if(!root || $("#tiktokPublisher")) return;
    const section=document.createElement("section");
    section.id="tiktokPublisher"; section.className="social-insights-panel tiktok-publisher";
    section.innerHTML=`
      <div class="tiktok-publisher-heading"><div><h4>Studio de publication TikTok</h4><p>Prépare et publie depuis AI Music Manager, ou envoie un brouillon dans TikTok.</p></div><button type="button" class="btn secondary" id="ttCreatorRefresh">Charger les options TikTok</button></div>
      <p id="ttPublishCapability" class="youtube-channel-sync" role="status">Les options du compte seront chargées avant toute publication.</p>
      <div class="tiktok-publisher-grid">
        <form id="ttVideoForm" class="tiktok-publish-form">
          <h5><span>01</span> Publier une vidéo</h5>
          <label>Fichier vidéo<input id="ttVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm" required></label>
          <label>Légende et hashtags<textarea id="ttVideoCaption" maxlength="2200" rows="3" placeholder="Présente ton contenu… #TikTok" required></textarea><small>2 200 caractères maximum.</small></label>
          <label>Mode de publication<select id="ttVideoMode"><option value="direct">Publication directe</option><option value="draft">Envoyer en brouillon dans TikTok</option></select></label>
          <label>Visibilité<select id="ttVideoPrivacy"><option value="SELF_ONLY">Chargement des options…</option></select></label>
          <div class="tiktok-publish-toggles"><label><input id="ttAllowComments" type="checkbox" checked> Autoriser les commentaires</label><label><input id="ttAllowDuet" type="checkbox" checked> Autoriser les Duos</label><label><input id="ttAllowStitch" type="checkbox" checked> Autoriser les Collages</label></div>
          <button class="btn primary" id="ttPublishVideo" type="submit">Publier la vidéo</button>
          <p id="ttVideoResult" class="tiktok-publish-result" role="status"></p>
        </form>
        <form id="ttPhotoForm" class="tiktok-publish-form">
          <h5><span>02</span> Publier des photos</h5>
          <label>URL des images HTTPS<textarea id="ttPhotoUrls" rows="3" placeholder="https://ton-domaine-verifie.com/photo-1.jpg&#10;https://ton-domaine-verifie.com/photo-2.jpg" required></textarea><small>Une URL par ligne. Le domaine doit être vérifié dans TikTok Developers.</small></label>
          <label>Légende<textarea id="ttPhotoCaption" maxlength="2200" rows="3" placeholder="Légende de la publication…"></textarea></label>
          <label>Visibilité<select id="ttPhotoPrivacy"><option value="SELF_ONLY">Chargement des options…</option></select></label>
          <label><input id="ttPhotoDraft" type="checkbox"> Envoyer comme brouillon</label>
          <button class="btn secondary" id="ttPublishPhoto" type="submit">Envoyer les photos</button>
          <p id="ttPhotoResult" class="tiktok-publish-result" role="status"></p>
        </form>
      </div>
      <div class="tiktok-publish-footnote">Chaque envoi exige une action explicite du gestionnaire. Les vidéos envoyées en brouillon doivent être finalisées dans TikTok. Tant que l’application n’a pas passé l’audit TikTok, les publications directes peuvent être limitées à « Moi uniquement ».</div>`;
    const rec=$("#socialTiktokDetail .tiktok-recommendations");
    root.insertBefore(section,rec||null);
    $("#ttCreatorRefresh")?.addEventListener("click",loadCreatorInfo);
    $("#ttVideoForm")?.addEventListener("submit",publishVideo);
    $("#ttPhotoForm")?.addEventListener("submit",publishPhotos);
    $("#ttVideoMode")?.addEventListener("change",()=>{const draft=$("#ttVideoMode").value==="draft";$("#ttPublishVideo").textContent=draft?"Envoyer le brouillon":"Publier la vidéo";});
  }
  async function context(){
    const value=await window.AIMusicManagerTikTokContext?.get?.();
    if(!value?.artistId||!value?.accessToken)throw new Error("Connecte-toi et sélectionne un artiste actif.");
    return value;
  }
  async function api(action,extra={}){
    const ctx=await context();
    const response=await fetch("/api/tiktok/publish",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+ctx.accessToken},body:JSON.stringify({artist_id:ctx.artistId,action,...extra})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Opération TikTok impossible.");
    return data;
  }
  function fillPrivacy(options){
    const selects=[$("#ttVideoPrivacy"),$("#ttPhotoPrivacy")].filter(Boolean);
    const labels={PUBLIC_TO_EVERYONE:"Tout le monde",MUTUAL_FOLLOW_FRIENDS:"Amis",FOLLOWER_OF_CREATOR:"Abonnés",SELF_ONLY:"Moi uniquement"};
    selects.forEach(select=>{select.replaceChildren();(options?.length?options:["SELF_ONLY"]).forEach(value=>{const option=document.createElement("option");option.value=value;option.textContent=labels[value]||value;select.append(option);});});
  }
  async function loadCreatorInfo(){
    const status=$("#ttPublishCapability");if(status)status.textContent="Lecture des autorisations de publication TikTok…";
    try{
      const result=await api("creator_info");creatorInfo=result.creator||{};
      fillPrivacy(creatorInfo.privacy_level_options);
      const max=creatorInfo.max_video_post_duration_sec;
      if(status)status.textContent="Compte prêt : @"+(creatorInfo.creator_username||creatorInfo.creator_nickname||"TikTok")+". Visibilités autorisées chargées."+(max?" Durée vidéo maximale : "+max+" secondes.":"");
      const file=$("#ttVideoFile");if(file)file.dataset.maxDuration=String(max||0);
      return creatorInfo;
    }catch(error){if(status)status.textContent="Options de publication indisponibles : "+error.message+" Vérifie que Content Posting API et video.publish sont activés et approuvés.";throw error;}
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
  async function waitForStatus(publishId,resultNode){
    let last=null;
    for(let attempt=0;attempt<30;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2500));
      const result=await api("status",{publish_id:publishId});last=result;
      if(resultNode)resultNode.textContent="Traitement TikTok : "+result.status;
      if(["PUBLISH_COMPLETE","SEND_TO_USER_INBOX","FAILED"].includes(result.status))return result;
    }
    return last||{status:"PROCESSING_UPLOAD"};
  }
  async function publishVideo(event){
    event.preventDefault();if(busy)return;
    const button=$("#ttPublishVideo"),resultNode=$("#ttVideoResult"),file=$("#ttVideoFile")?.files?.[0],caption=$("#ttVideoCaption")?.value.trim();
    if(!file||!caption){if(resultNode)resultNode.textContent="Choisis une vidéo et sa légende.";return;}
    const ctx=await context().catch(e=>{if(resultNode)resultNode.textContent=e.message;return null;});if(!ctx)return;
    const mode=$("#ttVideoMode").value,draft=mode==="draft";
    try{
      setBusy(true,button,draft?"Préparation du brouillon…":"Préparation de la publication…");
      const info=creatorInfo||await loadCreatorInfo(),max=Number(info.max_video_post_duration_sec||0);
      if(max&&file.type.startsWith("video/")&&file.size>4*1024*1024*1024)throw new Error("La vidéo dépasse la limite de taille prise en charge.");
      const chunkSize=10*1024*1024,totalChunks=Math.ceil(file.size/chunkSize);
      const init=await api(draft?"init_draft":"init_video",{title:caption,video_size:file.size,privacy_level:draft?"SELF_ONLY":$("#ttVideoPrivacy").value,disable_comment:!$("#ttAllowComments").checked,disable_duet:!$("#ttAllowDuet").checked,disable_stitch:!$("#ttAllowStitch").checked});
      await uploadVideo(file,init.upload_url,init.chunk_size||chunkSize,ctx.artistId,ctx.accessToken,resultNode);
      const final=await waitForStatus(init.publish_id,resultNode);
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
      const urls=$("#ttPhotoUrls").value.split(/\n+/).map(v=>v.trim()).filter(Boolean),caption=$("#ttPhotoCaption").value.trim();
      if(!urls.length)throw new Error("Ajoute au moins une URL d’image.");
      const result=await api("init_photo",{photo_images:urls,title:caption,description:caption,privacy_level:$("#ttPhotoPrivacy").value,draft:$("#ttPhotoDraft").checked});
      const status=await waitForStatus(result.publish_id,resultNode);
      if(status.status==="PUBLISH_COMPLETE")resultNode.textContent="Publication photo terminée. Identifiant : "+(status.post_ids?.[0]||result.publish_id);
      else if(status.status==="SEND_TO_USER_INBOX")resultNode.textContent="Photos envoyées dans les brouillons TikTok.";
      else if(status.status==="FAILED")resultNode.textContent="Échec TikTok : "+(status.fail_reason||"motif non communiqué")+".";
      else resultNode.textContent="Envoi accepté. Le traitement continue : "+result.publish_id;
    }catch(error){if(resultNode)resultNode.textContent="Échec : "+error.message;}
    finally{setBusy(false,button);}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    mount();
    document.querySelectorAll('[data-social-platform="tiktok"]').forEach(button=>button.addEventListener("click",()=>setTimeout(()=>{if($("#socialTiktokDetail")&&!$("#socialTiktokDetail").classList.contains("hidden"))loadCreatorInfo().catch(()=>{});},150)));
  });
})();