(() => {
  const cfg = window.NURIA_AI_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, user = null, signupMode = false, profile = null, settings = null, media = [];
  let artists = [], activeArtistId = null, switchingArtist = false, workspaceLoadVersion = 0;
  const assistantDrafts = new Map();
  const assistantConversations = new Map();
  const assistantApprovals = new Map();
  function assistantConversationKey(artistId){
    return user?.id&&artistId?'nuriaAiManager:assistant:'+user.id+':'+artistId:null;
  }
  function getAssistantConversation(artistId){
    if(!artistId)return [];
    if(assistantConversations.has(artistId))return assistantConversations.get(artistId);
    let messages=[];
    try{
      const key=assistantConversationKey(artistId),saved=key?JSON.parse(sessionStorage.getItem(key)||'[]'):[];
      if(Array.isArray(saved))messages=saved.filter(item=>(item?.role==='user'||item?.role==='assistant')&&typeof item.content==='string').slice(-20).map(item=>({role:item.role,content:item.content.slice(0,5000)}));
    }catch{}
    assistantConversations.set(artistId,messages);
    return messages;
  }
  function persistAssistantConversation(artistId){
    const key=assistantConversationKey(artistId);if(!key)return;
    try{sessionStorage.setItem(key,JSON.stringify((getAssistantConversation(artistId)).slice(-20)));}catch{}
  }
  let assistantAttachments = [];
  let assistantRecorder = null;
  let assistantRecordingArtistId = null;
  let assistantRecordingChunks = [];
  let assistantRecordingTimeout = null;
  const lastAssistantTasks = new Map();
  let latestYoutubeAnalytics=null, latestMetaInsights=null, latestTikTokAnalytics=null, latestTikTokAnalyticsArtistId=null, activeSocialPlatform=null;
  const oauthParams=new URLSearchParams(location.search);
  const oauthArtistId=oauthParams.get('artist_id');
  const tiktokOAuthResult=oauthParams.get('tiktok');
  const tiktokOAuthReason=oauthParams.get('reason');
  const tiktokMcpOAuthResult=oauthParams.get('tiktok_mcp');
  const tiktokMcpOAuthReason=oauthParams.get('reason');
  const recommendationBusy=new Set();
  let campaigns = [], editingCampaignId = null;
  const toast = (msg, bad=false) => { const el=$('#toast'); el.textContent=msg; el.className='toast show'+(bad?' error':''); setTimeout(()=>el.className='toast',3600); };
  window.AIMusicManagerTikTokContext = { get: async () => { const result = await supabase?.auth?.getSession?.(); const videos=latestTikTokAnalyticsArtistId===activeArtistId&&Array.isArray(latestTikTokAnalytics?.videos)?latestTikTokAnalytics.videos.map(video=>({id:String(video.id||video.video_id||''),title:String(video.title||video.video_description||'Vidéo TikTok'),comment_count:video.comment_count??null,share_url:video.share_url||''})).filter(video=>video.id):[]; return { artistId: activeArtistId, artistName: activeArtistName(), accessToken: result?.data?.session?.access_token || null, videos }; } };
  const show = (el) => el.classList.remove('hidden'); const hide = (el) => el.classList.add('hidden');
  function clearAssistantResult(){
    const result=$('#assistantResult');if(result)hide(result);
    const answer=$('#assistantAnswer');if(answer)answer.textContent='';
    const status=$('#assistantStatus');if(status)status.textContent='';
    const approval=$('#assistantApprovalControl');if(approval)approval.innerHTML='';
    const conversation=$('#assistantConversation');if(conversation)conversation.innerHTML='';
    const strategyResult=$('#strategyResult');if(strategyResult)hide(strategyResult);
    const strategyAnswer=$('#strategyAnswer');if(strategyAnswer)strategyAnswer.textContent='';
    const strategyStatus=$('#strategyStatus');if(strategyStatus)strategyStatus.textContent='';
    const strategyApproval=$('#strategyApprovalControl');if(strategyApproval)strategyApproval.innerHTML='';
  }
  function setupMessage() {
    const n=$('#setupNotice'); n.innerHTML='<strong>Configuration nécessaire.</strong> Crée un nouveau projet Supabase, exécute <code>supabase/schema.sql</code>, puis renseigne son URL et sa clé publique dans <code>config.js</code>. Aucun secret privé ne doit être placé dans ce fichier.'; show(n); show($('#authScreen'));
    $('#authTitle').textContent='Configuration requise'; $('#authSubtitle').textContent='L’interface est prête. Connecte d’abord ton nouveau projet Supabase.'; $('#authForm').classList.add('disabled-form'); $('#authSubmit').disabled=true;
  }
  function workspaceStateKey(){return user?.id?`nuriaAiManager:workspace:${user.id}`:null;}
  function readWorkspaceState(){
    const key=workspaceStateKey();if(!key)return {};
    try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}
  }
  function saveWorkspaceState(patch={}){
    const key=workspaceStateKey();if(!key)return;
    try{localStorage.setItem(key,JSON.stringify({...readWorkspaceState(),...patch}));}catch{}
  }
  function nav(view) {
    if(!view||!$(`#view-${view}`))return;
    saveWorkspaceState({view,artistId:activeArtistId||null});
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active-view',v.id===`view-${view}`));
    $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const names={overview:"Vue d'ensemble",brand:'Identité artistique',strategy:'Stratégie marketing',library:'Bibliothèque média',agent:'Configuration IA',connections:'Réseaux sociaux',artists:'Gérer les artistes'};
    $('#pageTitle').textContent=names[view]; $('#crumb').textContent=view==='overview'?'CENTRE DE COMMANDE':activeArtistName().toUpperCase()+' · '+names[view].toUpperCase();
    $('#backToDashboard').classList.toggle('hidden',view==='overview');
    if(window.innerWidth<=760) $('#sidebar').classList.remove('open');
    // Charger YouTube uniquement à l'ouverture de la rubrique Réseaux sociaux.
    if(view==='connections'&&user&&supabase){void youtubeStatus();void metaStatus();void loadTikTokStatus();}
  }
  function authMode(){ $('#authTitle').textContent=signupMode?'Créer ton compte':'Connexion'; $('#authSubtitle').textContent=signupMode?'Crée ton accès privé de gestionnaire.':'Connecte-toi à ton espace de gestion privé.'; $('#authSubmit').innerHTML=signupMode?'Créer mon compte <span>→</span>':'Se connecter <span>→</span>'; $('#authSwitchText').textContent=signupMode?'Tu as déjà un compte ?':'Pas encore de compte ?'; $('#authSwitch').textContent=signupMode?'Se connecter':'Créer un compte'; $('#authPassword').autocomplete=signupMode?'new-password':'current-password'; }
  async function init(){
    if(!configured){setupMessage();return;}
    if(!window.supabase?.createClient){
      show($('#authScreen'));
      $('#authTitle').textContent='Connexion indisponible';
      $('#authSubtitle').textContent='La bibliothèque de connexion Supabase ne s’est pas chargée. Recharge la page ou essaie sans bloqueur de contenu.';
      toast('Service de connexion non chargé. Vérifie ta connexion Internet puis recharge la page.',true);
      return;
    }
    try{
      supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data:{session},error}=await supabase.auth.getSession();
      if(error)throw error;
      if(session){user=session.user;await enterApp();}else show($('#authScreen'));
      supabase.auth.onAuthStateChange(async(_event,session)=>{if(session&&!user){user=session.user;await enterApp();}else if(!session&&user){user=null;assistantConversations.clear();assistantApprovals.clear();assistantDrafts.clear();lastAssistantTasks.clear();hide($('#appShell'));show($('#authScreen'));}});
    }catch(error){
      show($('#authScreen'));
      $('#authSubtitle').textContent='Impossible d’initialiser la connexion : '+(error.message||'erreur inconnue');
      toast('Initialisation impossible : '+(error.message||'erreur inconnue'),true);
    }
  }
  async function enterApp(){
    hide($('#authScreen'));
    const shell=$('#appShell');
    $('#userEmail').textContent=user.email||'Compte connecté';
    updateAccountMenuIdentity();
    await loadArtists();
    renderAssistantConversation(activeArtistId);
    const savedView=readWorkspaceState().view;
    const validViews=['overview','brand','strategy','library','agent','connections','artists'];
    // Restaurer la rubrique pendant que l'application est encore masquée.
    // L'utilisateur ne voit donc jamais brièvement la vue d'ensemble par défaut.
    nav((tiktokOAuthResult||tiktokMcpOAuthResult)?'connections':(validViews.includes(savedView)?savedView:'overview'));
    show(shell);
    await reloadArtistWorkspace();
    if(tiktokOAuthResult==='connected')toast('Compte TikTok connecté à '+activeArtistName()+'.');
    else if(tiktokOAuthResult==='error')toast('Connexion TikTok non aboutie. Motif : '+(tiktokOAuthReason||'erreur inconnue')+'.',true);
    if(tiktokMcpOAuthResult==='connected')toast('Gestion des commentaires TikTok connectée pour '+activeArtistName()+'.');
    else if(tiktokMcpOAuthResult==='error')toast('Connexion TikTok Social non aboutie. Motif : '+(tiktokMcpOAuthReason||'erreur inconnue')+'.',true);
    if(tiktokOAuthResult||tiktokMcpOAuthResult){history.replaceState({},'',location.pathname+location.hash);}
  }
  async function loadArtists(){
    const {data,error}=await supabase.from('ai_artists').select('id,artist_name,is_default,status,created_at').eq('status','active').order('is_default',{ascending:false}).order('artist_name');
    if(error)throw new Error('Chargement des espaces artistes impossible : '+error.message);
    artists=data||[];
    if(!artists.length)throw new Error('Aucun espace artiste trouvé. Vérifie la migration multi-artistes.');
    const savedState=readWorkspaceState();
    if(oauthArtistId&&artists.some(a=>a.id===oauthArtistId))activeArtistId=oauthArtistId;
    else if(savedState.artistId&&artists.some(a=>a.id===savedState.artistId))activeArtistId=savedState.artistId;
    if(!activeArtistId||!artists.some(a=>a.id===activeArtistId)){
      activeArtistId=(artists.find(a=>a.is_default)||artists[0]).id;
    }
    saveWorkspaceState({artistId:activeArtistId});
    renderArtistSwitcher();
  }
  function activeArtistName(){return artists.find(a=>a.id===activeArtistId)?.artist_name||'artiste sélectionné';}
  function updateAccountMenuIdentity(){
    const email=user?.email||'Compte connecté';
    const initial=(email.trim()[0]||'G').toLocaleUpperCase('fr-FR');
    const avatar=$('#accountMenuButton');if(avatar)avatar.textContent=initial;
    const menuEmail=$('#accountMenuEmail');if(menuEmail)menuEmail.textContent=email;
  }
  function isNuriaDollArtist(name=activeArtistName()){
    return String(name||'').trim().toLocaleUpperCase('fr-FR')==='NURIA DOLL';
  }
  function applyArtistContext(){
    const name=activeArtistName(),child=isNuriaDollArtist(name);
    document.querySelectorAll('[data-nuria-only]').forEach(el=>el.classList.toggle('hidden',!child));
    const description=$('#strategyDescription');if(description)description.textContent='Construis un plan d’action réaliste pour développer le projet musical de '+name+'.';
    const brandOption=$('#campaignBrandOption');if(brandOption)brandOption.textContent='Marque de '+name;
    const role=$('#userRoleLabel');if(role)role.textContent=child?'Parent / Manager':'Artiste / Manager';
    const accountRole=$('#accountMenuRole');if(accountRole)accountRole.textContent=child?'Parent / Manager':'Artiste / Manager';
    const bellWrap=$('.notification-wrap');if(bellWrap)bellWrap.classList.toggle('hidden',!child);
    const history=$('.parent-approval-history');if(history)history.classList.toggle('hidden',!child);
    const guardrails=$('#brandForm')?.elements.parent_guardrails?.closest('label');if(guardrails)guardrails.classList.toggle('hidden',!child);
    const prompts={
      calendar:'Propose un calendrier éditorial de 7 jours pour '+name+', avec une idée de contenu par jour.',
      captions:'Écris 3 légendes différentes pour annoncer une nouvelle chanson de '+name+', adaptées à son public cible.',
      videos:'Propose 5 idées de vidéos courtes et simples pour faire découvrir l’univers musical de '+name+'.'
    };
    document.querySelectorAll('[data-prompt-template]').forEach(button=>{button.dataset.prompt=prompts[button.dataset.promptTemplate]||'';});
    const strategyForm=$('#strategyForm');
    if(strategyForm&&strategyForm.dataset.artistId!==activeArtistId){
      strategyForm.reset();strategyForm.dataset.artistId=activeArtistId;
      if(child){
        strategyForm.elements.project.value='Papa dis moi — premier single de DOLL & FRIENDS';
        strategyForm.elements.budget.value='25 000 à 50 000 FCFA';
        strategyForm.elements.markets.value='Bénin, France et Europe francophone';
        strategyForm.elements.channels.value='Radios, médias web, presse, labels, YouTube, TikTok, Instagram et Facebook';
      }
    }
    const assistantStatus=$('#assistantStatus');if(assistantStatus)assistantStatus.textContent=child?'Les réponses sont des brouillons à vérifier par le parent.':'Les réponses sont des propositions à examiner avant utilisation.';
    const assistantTask=$('#assistantTask');if(assistantTask)assistantTask.placeholder=child?'Ex. : Prépare une campagne de communication sur 10 jours pour la chanson Papa dis moi.':'Ex. : Prépare une campagne de communication sur 10 jours pour mon prochain single.';
    const settingsForm=$('#settingsForm');
    if(settingsForm?.elements.autonomy_mode)settingsForm.elements.autonomy_mode.value=child?'parent_guarded':'draft_only';
  }
  function renderArtistSwitcher(){
    const select=$('#artistSwitcher');if(!select)return;
    select.innerHTML='';
    artists.forEach(artist=>{const option=document.createElement('option');option.value=artist.id;option.textContent=artist.artist_name+(artist.is_default?' · principal':'');select.append(option);});
    select.value=activeArtistId||'';
    renderArtistManagement();
    const researchName=$('#researchArtistName');if(researchName&&document.activeElement!==researchName)researchName.value=activeArtistName();
    const current=artists.find(a=>a.id===activeArtistId);
    if(current){const name=$('#currentArtistName');if(name)name.textContent=current.artist_name;
      const facebookLabel=$('.social-card-facebook h3 + p');if(facebookLabel)facebookLabel.textContent='Page Facebook de '+current.artist_name;
      const youtubeLabel=$('.social-card-youtube h3 + p');if(youtubeLabel)youtubeLabel.textContent='Chaîne YouTube de '+current.artist_name;
      const bioField=$('#brandForm')?.elements.bio;
      if(bioField)bioField.placeholder='Présente '+current.artist_name+' en quelques phrases...';
    }
    applyArtistContext();
  }
  async function reloadArtistWorkspace(){
    if(!activeArtistId)return;
    const version=++workspaceLoadVersion;
    const artistId=activeArtistId;
    switchingArtist=true;
    applyArtistContext();
    profile=null;settings=null;media=[];campaigns=[];
    resetCampaignForm();resetYoutubeDashboard();
    $('#mediaCount').textContent='0';$('#libraryCount').textContent='0 fichier';
    $('#mediaList').innerHTML='<div class="empty-state">Chargement des médias…</div>';
    $('#campaignCount').textContent='0 campagne';
    $('#campaignList').innerHTML='<div class="empty-state">Chargement des campagnes…</div>';
    $('#settingsForm')?.reset();
    if(!isNuriaDollArtist()){parentApprovals=[];renderNotificationCenter();}
    else {parentApprovals=[];const history=$('#parentApprovalHistory');if(history)history.textContent='Chargement des validations…';}
    try{
      const tasks=[loadProfile(version),loadSettings(version),loadMedia(version),loadCampaigns(version),loadYoutubeRecommendationHistory(version),loadArtistResearch(version)];
      if(isNuriaDollArtist())tasks.push(loadParentApprovals(version));
      else {parentApprovals=[];renderParentApprovals();}
      await Promise.all(tasks);
      applyArtistContext();
      if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
      const current=artists.find(a=>a.id===artistId);
      const heading=$('#activeArtistLabel');if(heading)heading.textContent=current?.artist_name||'Artiste sélectionné';
      const welcome=$('#welcomeArtistName');if(welcome)welcome.textContent=current?.artist_name||'ton artiste';
      const crumb=$('#crumb');if(crumb&&$('#pageTitle').textContent!=="Vue d'ensemble")crumb.textContent=(current?.artist_name||'ARTISTE')+' · '+$('#pageTitle').textContent.toUpperCase();
    }finally{if(version===workspaceLoadVersion)switchingArtist=false;}
  }
  $('#artistSwitcher')?.addEventListener('change',async e=>{
    if(activeArtistId)assistantDrafts.set(activeArtistId,$('#assistantTask')?.value||'');
    if(assistantRecorder?.state==='recording')assistantRecorder.stop();
    clearAssistantAttachments();
    activeArtistId=e.target.value;
    saveWorkspaceState({artistId:activeArtistId});
    clearAssistantResult();
    resetCampaignForm();
    resetYoutubeDashboard();
    $('#assistantTask').value=assistantDrafts.get(activeArtistId)||'';
    renderAssistantConversation(activeArtistId);
    resizeAssistantComposer();
    // Mettre à jour immédiatement tous les libellés dépendant de l’artiste actif.
    renderArtistSwitcher();
    await reloadArtistWorkspace();
    if($('#view-connections').classList.contains('active-view')){await Promise.all([youtubeStatus(),metaStatus(),loadTikTokStatus()]);}
    toast('Espace artiste sélectionné.');
  });
  $('#addArtistButton')?.addEventListener('click',async()=>{
    const name=prompt('Nom du nouvel artiste :');
    if(name===null)return;
    const artistName=name.trim();
    if(!artistName){toast('Saisis un nom d’artiste.',true);return;}
    if(artists.some(a=>a.artist_name.trim().toLocaleLowerCase()===artistName.toLocaleLowerCase())){toast('Cet artiste existe déjà dans ton espace.',true);return;}
    if(activeArtistId)assistantDrafts.set(activeArtistId,$('#assistantTask')?.value||'');
    if(assistantRecorder?.state==='recording')assistantRecorder.stop();
    clearAssistantAttachments();
    const button=$('#addArtistButton');button.disabled=true;
    try{
      const {data,error}=await supabase.from('ai_artists').insert({owner_id:user.id,artist_name:artistName,status:'active',is_default:false}).select('id,artist_name,is_default,status,created_at').single();
      if(error)throw error;
      if(activeArtistId)assistantDrafts.set(activeArtistId,$('#assistantTask')?.value||'');
      artists.push(data);activeArtistId=data.id;saveWorkspaceState({artistId:activeArtistId});clearAssistantResult();resetCampaignForm();resetYoutubeDashboard();$('#assistantTask').value=assistantDrafts.get(activeArtistId)||'';renderAssistantConversation(activeArtistId);renderArtistSwitcher();
      await reloadArtistWorkspace();
      toast('Espace « '+artistName+' » créé. Tu peux maintenant compléter son identité.');
      nav('brand');
    }catch(error){toast('Création impossible : '+error.message,true);}
    finally{button.disabled=false;}
  });

  let pendingArtistDeletionId=null;
  function renderArtistManagement(){
    const list=$('#artistManagementList'),count=$('#managedArtistCount');if(!list)return;
    if(count)count.textContent=artists.length+' artiste'+(artists.length>1?'s':'');
    list.replaceChildren();
    if(!artists.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Aucun profil artiste disponible.';list.append(empty);return;}
    artists.forEach(artist=>{
      const card=document.createElement('article');card.className='artist-management-card';
      const identity=document.createElement('div');identity.className='artist-management-identity';
      const avatar=document.createElement('span');avatar.className='artist-management-avatar';avatar.textContent=(artist.artist_name.trim()[0]||'A').toLocaleUpperCase('fr-FR');
      const details=document.createElement('div');details.className='artist-management-details';
      const name=document.createElement('strong');name.textContent=artist.artist_name;
      const meta=document.createElement('small');meta.textContent=(artist.is_default?'Profil principal · ':'')+(artist.status==='active'?'Actif':'Inactif')+(artist.created_at?' · Créé le '+new Date(artist.created_at).toLocaleDateString('fr-FR'):'');
      details.append(name,meta);identity.append(avatar,details);
      const actions=document.createElement('div');actions.className='artist-management-actions';
      const active=document.createElement('span');active.className='artist-management-active';active.textContent=artist.id===activeArtistId?'Actuellement sélectionné':'';
      const remove=document.createElement('button');remove.type='button';remove.className='artist-management-delete';remove.textContent='Supprimer';remove.disabled=artists.length<=1;remove.title=artists.length<=1?'Le dernier profil ne peut pas être supprimé':'Supprimer ce profil artiste';
      remove.addEventListener('click',()=>openArtistDeleteDialog(artist));
      actions.append(active,remove);card.append(identity,actions);list.append(card);
    });
  }
  function openArtistDeleteDialog(artist){
    if(!artist||artists.length<=1){toast('Le dernier profil artiste ne peut pas être supprimé.',true);return;}
    pendingArtistDeletionId=artist.id;
    $('#artistDeleteDescription').textContent='Tu demandes la suppression définitive de « '+artist.artist_name+' ». Son identité, ses campagnes, recommandations, validations, connexions sociales et médias associés seront supprimés. Cette action est irréversible.';
    $('#artistDeletePassword').value='';$('#artistDeleteError').textContent='';
    show($('#artistDeleteDialog'));$('#artistDeletePassword').focus();
  }
  function closeArtistDeleteDialog(){
    hide($('#artistDeleteDialog'));$('#artistDeletePassword').value='';$('#artistDeleteError').textContent='';pendingArtistDeletionId=null;
  }
  async function deleteArtistProfile(artist){
    if(!artist||artists.length<=1)throw new Error('Le dernier profil artiste ne peut pas être supprimé.');
    const fallback=artists.find(item=>item.id!==artist.id);
    if(!fallback)throw new Error('Aucun autre profil disponible pour prendre le relais.');
    const {data:mediaRows,error:mediaError}=await supabase.from('ai_media_library').select('storage_path').eq('artist_id',artist.id).eq('owner_id',user.id);
    if(mediaError)throw new Error('Impossible de vérifier les médias de cet artiste : '+mediaError.message);
    let promotedDefault=false;
    if(artist.is_default){
      const {error:promoteError}=await supabase.from('ai_artists').update({is_default:true}).eq('id',fallback.id).eq('owner_id',user.id);
      if(promoteError)throw new Error('Impossible de transférer le profil principal : '+promoteError.message);
      promotedDefault=true;
    }
    const {error:deleteError}=await supabase.from('ai_artists').delete().eq('id',artist.id).eq('owner_id',user.id);
    if(deleteError){
      if(promotedDefault)await supabase.from('ai_artists').update({is_default:false}).eq('id',fallback.id).eq('owner_id',user.id);
      throw new Error('Suppression impossible : '+deleteError.message);
    }
    const paths=(mediaRows||[]).map(row=>row.storage_path).filter(Boolean);
    let storageWarning='';
    if(paths.length){
      const {error:storageError}=await supabase.storage.from('nuria-private-media').remove(paths);
      if(storageError)storageWarning=' Certains fichiers médias du stockage n’ont pas pu être nettoyés : '+storageError.message;
    }
    assistantDrafts.delete(artist.id);assistantConversations.delete(artist.id);assistantApprovals.delete(artist.id);lastAssistantTasks.delete(artist.id);
    try{sessionStorage.removeItem('nuriaAiManager:assistant:'+user.id+':'+artist.id);}catch{}
    const wasActive=activeArtistId===artist.id;
    artists=artists.filter(item=>item.id!==artist.id);
    if(wasActive)activeArtistId=null;
    await loadArtists();
    renderArtistManagement();
    if(wasActive){
      $('#assistantTask').value=assistantDrafts.get(activeArtistId)||'';
      clearAssistantResult();renderAssistantConversation(activeArtistId);
      await reloadArtistWorkspace();
    }
    toast('Profil « '+artist.artist_name+' » supprimé.'+(storageWarning?' Vérifie le nettoyage du stockage.':''),!!storageWarning);
  }
  $('#artistDeleteForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const artist=artists.find(item=>item.id===pendingArtistDeletionId);
    if(!artist){closeArtistDeleteDialog();return;}
    const password=$('#artistDeletePassword').value;
    if(!password){$('#artistDeleteError').textContent='Saisis le mot de passe du compte gestionnaire.';return;}
    const button=$('#artistDeleteConfirm');button.disabled=true;button.textContent='Vérification…';
    $('#artistDeleteError').textContent='';
    try{
      const email=user?.email;
      if(!email||!user?.id)throw new Error('Session gestionnaire introuvable. Reconnecte-toi.');
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw new Error('Mot de passe incorrect. La suppression n’a pas été effectuée.');
      if(data.user?.id!==user.id)throw new Error('Le compte authentifié ne correspond pas au gestionnaire connecté.');
      await deleteArtistProfile(artist);
      closeArtistDeleteDialog();
    }catch(error){
      $('#artistDeleteError').textContent=error.message||'La suppression a échoué.';
    }finally{
      button.disabled=false;button.textContent='Confirmer la suppression';
      $('#artistDeletePassword').value='';
    }
  });
  $('#artistDeleteClose')?.addEventListener('click',closeArtistDeleteDialog);
  $('#artistDeleteCancel')?.addEventListener('click',closeArtistDeleteDialog);
  $('#artistDeleteDialog')?.addEventListener('click',event=>{if(event.target.id==='artistDeleteDialog')closeArtistDeleteDialog();});


  let parentApprovals=[];
  function renderNotificationCenter(){
    const count=$('#notificationCount'),items=$('#notificationItems'),summary=$('#notificationSummary');
    if(!count||!items)return;
    const pending=parentApprovals.filter(x=>!x.approved);
    count.textContent=String(pending.length);
    count.classList.toggle('hidden',pending.length===0);
    if(summary)summary.textContent=pending.length?pending.length+' proposition(s) à vérifier':'Aucune validation en attente';
    items.innerHTML='';
    if(!pending.length){
      const empty=document.createElement('p');empty.className='notification-empty';empty.textContent='Tout est à jour. Aucune proposition ne demande ton attention.';items.append(empty);
    }else{
      pending.slice(0,8).forEach(record=>{
        const row=document.createElement('article');row.className='notification-item';
        const dot=document.createElement('span');dot.className='notification-dot';
        const body=document.createElement('div');body.className='notification-item-body';
        const title=document.createElement('strong');title.textContent=record.title||'Proposition à valider';
        const detail=document.createElement('small');detail.textContent=(record.source_type==='youtube'?'Recommandations YouTube':record.source_type==='strategy'?'Stratégie marketing':'Proposition IA')+' · '+new Date(record.created_at).toLocaleString('fr-FR');
        body.append(title,detail);row.append(dot,body);items.append(row);
      });
    }
    const permission=$('#notificationPermissionStatus'),enable=$('#enableNotifications');
    if(permission&&enable){
      const supported='Notification' in window;
      permission.textContent=!supported?'Alertes système non prises en charge par ce navigateur.':Notification.permission==='granted'?'Alertes du navigateur activées.':Notification.permission==='denied'?'Alertes bloquées dans les réglages du navigateur.':'Tu peux autoriser les alertes sur cet appareil.';
      enable.textContent=Notification.permission==='granted'?'Alertes activées':Notification.permission==='denied'?'Voir les réglages du navigateur':'Activer les alertes';
      enable.disabled=!supported||Notification.permission==='granted';
    }
  }
  async function notifyParent(title,body){
    if(!isNuriaDollArtist()||!('Notification' in window)||Notification.permission!=='granted')return;
    try{
      const registration=await navigator.serviceWorker?.getRegistration('/');
      if(registration?.showNotification){
        await registration.showNotification(title,{body,icon:'/assets/icon.svg',badge:'/assets/icon.svg',tag:'nuria-ai-manager-parent',renotify:true,data:{url:'/'}});
      }else{
        new Notification(title,{body,icon:'/assets/icon.svg',tag:'nuria-ai-manager-parent'});
      }
    }catch(error){console.warn('Notification navigateur indisponible :',error);}
  }
  const bell=$('#notificationBell'),panel=$('#notificationPanel');
  bell?.addEventListener('click',()=>{
    const opening=panel.classList.contains('hidden');
    panel.classList.toggle('hidden',!opening);
    bell.setAttribute('aria-expanded',String(opening));
    if(opening)renderNotificationCenter();
  });
  $('#notificationClose')?.addEventListener('click',()=>{panel.classList.add('hidden');bell?.setAttribute('aria-expanded','false');});
  $('#enableNotifications')?.addEventListener('click',async()=>{
    if(!('Notification' in window)){toast('Ce navigateur ne prend pas en charge les notifications.',true);return;}
    try{
      const permission=await Notification.requestPermission();
      renderNotificationCenter();
      if(permission==='granted'){await notifyParent('AI MUSIC MANAGER','Les alertes de validation sont activées pour NURIA DOLL.');toast('Notifications activées sur cet appareil.');}
      else toast(permission==='denied'?'Autorisation refusée. Modifie-la dans les réglages du navigateur.':'Autorisation non accordée.',true);
    }catch(error){toast('Impossible d’activer les notifications : '+error.message,true);}
  });
  document.addEventListener('click',event=>{
    if(panel&&!panel.classList.contains('hidden')&&!event.target.closest('.notification-wrap')){
      panel.classList.add('hidden');bell?.setAttribute('aria-expanded','false');
    }
  });
  async function saveParentApproval(sourceType,sourceKey,title,content,targetArtistId=activeArtistId){
    const targetArtist=artists.find(a=>a.id===targetArtistId);
    if(!isNuriaDollArtist(targetArtist?.artist_name))return null;
    const artistId=targetArtistId;
    const payload={owner_id:user.id,artist_id:artistId,source_type:sourceType,source_key:artistId+':'+sourceKey,title,content,updated_at:new Date().toISOString()};
    const {data,error}=await supabase.from('ai_parent_approvals').upsert(payload,{onConflict:'owner_id,source_type,source_key'}).select('*').single();
    if(error)throw new Error('Enregistrement de la validation impossible : '+error.message+'. Vérifie que la migration parent_approvals.sql a été exécutée.');
    if(artistId===activeArtistId){
      const index=parentApprovals.findIndex(x=>x.id===data.id);
      if(index>=0)parentApprovals[index]=data;else parentApprovals.unshift(data);
      renderParentApprovals();renderNotificationCenter();
    }
    void notifyParent('Validation parentale requise',title+' attend ta vérification.');
    return data;
  }
  function renderApprovalControl(record,target){
    if(!target)return;
    target.innerHTML='';
    const wrap=document.createElement('div');wrap.className='parent-approval-control';
    const status=document.createElement('span');status.className='tag '+(record.approved?'green':'amber');
    status.textContent=record.approved?'Validée par le parent':'En attente de validation';
    const button=document.createElement('button');button.type='button';button.className='btn '+(record.approved?'secondary':'primary')+' parent-approval-button';
    button.textContent=record.approved?'Annuler la validation':'Valider cette proposition';
    button.addEventListener('click',async()=>{
      const next=!record.approved;
      const prompt=next?'Confirmer que tu as vérifié cette proposition et que tu l’autorises à être utilisée ?':'Annuler la validation parentale de cette proposition ?';
      if(!confirm(prompt))return;
      button.disabled=true;
      const {data,error}=await supabase.from('ai_parent_approvals').update({approved:next,approved_at:next?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',record.id).select('*').single();
      button.disabled=false;
      if(error){toast('Mise à jour impossible : '+error.message,true);return;}
      const i=parentApprovals.findIndex(x=>x.id===data.id);if(i>=0)parentApprovals[i]=data;
      renderApprovalControl(data,target);renderParentApprovals();
      toast(next?'Proposition validée par le parent.':'Validation annulée.');
    });
    wrap.append(status,button);target.append(wrap);
  }
  function renderParentApprovals(){
    const list=$('#parentApprovalHistory');if(!list)return;
    list.innerHTML='';
    if(!parentApprovals.length){list.textContent='Aucune proposition enregistrée pour le moment.';return;}
    parentApprovals.forEach(record=>{
      const item=document.createElement('article');item.className='parent-approval-item';
      const info=document.createElement('div');const title=document.createElement('strong');title.textContent=record.title;
      const meta=document.createElement('small');meta.textContent=(record.source_type==='youtube'?'Recommandations YouTube':record.source_type==='strategy'?'Stratégie marketing':'Assistant marketing')+' · '+new Date(record.created_at).toLocaleString('fr-FR');
      const state=document.createElement('span');state.className='tag '+(record.approved?'green':'amber');state.textContent=record.approved?'Validée':'À valider';
      info.append(title,meta);item.append(info,state);
      const button=document.createElement('button');button.type='button';button.className='text-btn';button.textContent='Afficher';
      button.addEventListener('click',()=>{const text=record.content;const win=window.open('','_blank');if(!win){toast('Autorise les fenêtres contextuelles pour afficher cette proposition.',true);return;}win.document.write('<!doctype html><html lang="fr"><meta charset="utf-8"><title>'+escapeText(record.title)+'</title><body style="font:15px/1.7 Arial,sans-serif;max-width:850px;margin:40px auto;padding:0 20px;color:#302638"><h1>'+escapeText(record.title)+'</h1><pre style="white-space:pre-wrap;font:inherit">'+escapeText(text)+'</pre></body></html>');win.document.close();});
      item.append(button);list.append(item);
    });
  }
  async function loadParentApprovals(version=workspaceLoadVersion){
    if(!isNuriaDollArtist()){parentApprovals=[];renderParentApprovals();renderNotificationCenter();return;}
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_parent_approvals').select('*').eq('artist_id',artistId).order('created_at',{ascending:false}).limit(50);
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    if(error){const list=$('#parentApprovalHistory');if(list)list.textContent='Historique indisponible. Exécute la migration parent_approvals.sql dans le projet Supabase de l’AI Manager.';return;}
    parentApprovals=data||[];renderParentApprovals();renderNotificationCenter();
  }

  function resetBrandFormForArtist(){
    const f=$('#brandForm');
    f.reset();
    Array.from(f.elements).forEach(el=>{
      if(!el.name)return;
      if(el.type==='color')el.value=el.name==='primary_color'?'#7047A6':'#E8E8E8';
      else if(el.type==='checkbox'||el.type==='radio')el.checked=false;
      else if(el.tagName==='SELECT')el.selectedIndex=0;
      else el.value='';
    });
    if(f.elements.artist_name)f.elements.artist_name.value=activeArtistName();
    if(isNuriaDollArtist()){
      f.elements.genre.value='Pop enfantine, Afro-pop, Pop';
      f.elements.target_audience.value="Enfants et adultes sensibles à l'univers de l'enfance";
      f.elements.tone.value='Joyeux, bienveillant, créatif, familial et adapté à un public intergénérationnel.';
      f.elements.parent_guardrails.value="Ne jamais divulguer d'informations personnelles, de localisation, d'école, d'emploi du temps ou de coordonnées de l'enfant. Toute demande sensible, rencontre, proposition commerciale ou message privé doit être transmise au parent. Ne jamais inventer de faits biographiques.";
      f.elements.primary_color.value='#6D45A6';f.elements.secondary_color.value='#E8B9D4';
    }
    $('#brandMessage').textContent='Complète les informations propres à cet artiste puis enregistre.';
  }
  async function loadProfile(version=workspaceLoadVersion){
    const artistId=activeArtistId;
    profile=null;
    resetBrandFormForArtist();
    $('#brandCheck').classList.remove('done');
    $('#brandCheck').textContent='3';
    $('#profileStatus').textContent='À compléter';
    const {data,error}=await supabase.from('ai_brand_profile').select('*').eq('artist_id',artistId).maybeSingle();
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    if(error){toast('Chargement du profil : '+error.message,true);return;}
    const child=isNuriaDollArtist();
    const nuriaDefaults={
      genre:'Pop enfantine, Afro-pop, Pop',
      target_audience:"Enfants et adultes sensibles à l'univers de l'enfance",
      tone:'Joyeux, bienveillant, créatif, familial et adapté à un public intergénérationnel.',
      primary_color:'#6D45A6',
      secondary_color:'#E8B9D4'
    };
    profile=data?{...data,artist_name:activeArtistName()}:null;
    if(profile&&!child){
      Object.entries(nuriaDefaults).forEach(([key,value])=>{if(profile[key]===value)profile[key]=null;});
      profile.parent_guardrails='';
    }
    const f=$('#brandForm');
    if(profile){
      Object.entries(profile).forEach(([k,v])=>{if(k==='parent_guardrails'&&!child)return;const el=f.elements[k];if(el&&v!==null)el.value=v;});
      f.elements.artist_name.value=activeArtistName();
      $('#profileStatus').textContent='Configuré';
      $('#brandCheck').classList.add('done');
      $('#brandCheck').textContent='✓';
    }
  }
  async function loadSettings(version=workspaceLoadVersion){
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_settings').select('*').eq('artist_id',artistId).maybeSingle();
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    if(error){settings=null;return;}
    settings=data;const f=$('#settingsForm');f.reset();
    if(data){['primary_goal','planning_horizon','autonomy_mode','monthly_budget_usd'].forEach(k=>{if(f.elements[k]&&data[k]!==null)f.elements[k].value=data[k];});}
  }
  function researchSectionLabel(kind){
    return ({discography:"Discographie et sorties",biography:"Biographie et identité",debut:"Premières sorties et parcours",presence:"Présence officielle en ligne",general:"Autres informations"})[kind]||"Sources complémentaires";
  }
  function safeResearchUrl(value){
    try{const parsed=new URL(value);return parsed.protocol==="https:"||parsed.protocol==="http:"?parsed.href:"";}catch{return "";}
  }
  function renderArtistResearchHistory(rows=[]){
    const list=$("#artistResearchHistory");if(!list)return;
    list.replaceChildren();
    if(!rows.length){const empty=document.createElement("div");empty.className="empty-state";empty.textContent="Aucun dossier de recherche enregistré pour cet artiste.";list.append(empty);return;}
    rows.forEach(row=>{
      const card=document.createElement("article");card.className="artist-research-card";
      const head=document.createElement("div");head.className="artist-research-card-head";
      const identity=document.createElement("div");identity.className="artist-research-card-identity";
      const title=document.createElement("strong");title.textContent=row.subject_name||"Recherche artiste";
      const meta=document.createElement("small");meta.textContent=(row.source_count||0)+" source(s) · "+(row.researched_at?new Date(row.researched_at).toLocaleString("fr-FR"):"date inconnue")+" · "+(row.status==="partial"?"recherche partielle":"recherche terminée");
      identity.append(title,meta);
      const toggle=document.createElement("button");toggle.type="button";toggle.className="btn secondary";toggle.textContent="Ouvrir le dossier";
      const content=document.createElement("div");content.className="artist-research-report hidden";
      const context=row.queries&&row.queries.identity_context?row.queries.identity_context:null;
      if(context){
        const identityCard=document.createElement("section");identityCard.className="research-context-card";
        const identityTitle=document.createElement("h4");identityTitle.textContent="Repères d’identification";
        const identityText=document.createElement("p");
        identityText.textContent=[context.legal_name,context.country,context.city,context.genre,context.affiliation].filter(Boolean).join(" · ")||"Aucune précision complémentaire";
        identityCard.append(identityTitle,identityText);
        const suppliedLinks=[["YouTube",context.youtube],["Instagram",context.instagram],["Facebook",context.facebook],["TikTok",context.tiktok],["Site officiel",context.website]].filter(item=>safeResearchUrl(item[1]));
        if(suppliedLinks.length){const links=document.createElement("div");links.className="research-context-links";suppliedLinks.forEach(([label,url])=>{const a=document.createElement("a");a.href=safeResearchUrl(url);a.target="_blank";a.rel="noopener noreferrer";a.textContent=label;links.append(a);});identityCard.append(links);}
        if(context.notes){const note=document.createElement("p");note.textContent=context.notes;identityCard.append(note);}
        content.append(identityCard);
      }
      const grouped={};(Array.isArray(row.sources)?row.sources:[]).forEach(source=>{const key=source.kind||"general";(grouped[key]||(grouped[key]=[])).push(source);});
      const kinds=Object.keys(grouped);
      if(!kinds.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="Aucune source exploitable dans ce dossier.";content.append(empty);}
      kinds.forEach(kind=>{
        const section=document.createElement("section");section.className="research-result-section";
        const heading=document.createElement("h4");heading.textContent=researchSectionLabel(kind)+" · "+grouped[kind].length;
        const grid=document.createElement("div");grid.className="research-source-grid";
        grouped[kind].forEach(source=>{
          const url=safeResearchUrl(source.url);if(!url)return;
          const item=document.createElement("article");item.className="artist-research-source";
          const category=document.createElement("small");category.textContent=source.domain||new URL(url).hostname;
          const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=source.title||url;
          const snippet=document.createElement("p");snippet.textContent=source.snippet||"Aucun résumé disponible.";
          const foot=document.createElement("div");foot.className="research-source-foot";
          const score=document.createElement("span");score.textContent=Number.isFinite(Number(source.score))?"Pertinence indicative : "+Math.round(Number(source.score)*100)+"%":"Source à vérifier";
          const open=document.createElement("a");open.href=url;open.target="_blank";open.rel="noopener noreferrer";open.textContent="Consulter la source ↗";
          foot.append(score,open);item.append(category,link,snippet,foot);grid.append(item);
        });
        section.append(heading,grid);content.append(section);
      });
      const disclaimer=document.createElement("p");disclaimer.className="research-disclaimer";disclaimer.textContent="À vérifier : les résultats web sont des pistes documentaires. Une source trouvée ne prouve pas à elle seule que l’information concerne cet artiste.";
      content.append(disclaimer);
      toggle.addEventListener("click",()=>{content.classList.toggle("hidden");toggle.textContent=content.classList.contains("hidden")?"Ouvrir le dossier":"Réduire le dossier";});
      head.append(identity,toggle);card.append(head,content);list.append(card);
    });
  }
  async function loadArtistResearch(version=workspaceLoadVersion){
    const artistId=activeArtistId,status=$("#artistResearchStatus");
    if(!artistId||!status)return;
    status.textContent="Chargement des dossiers de recherche…";
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error("Session expirée. Reconnecte-toi.");
      const response=await fetch("/api/research?artist_id="+encodeURIComponent(artistId),{headers:{authorization:"Bearer "+session.access_token}});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||"Historique de recherche indisponible.");
      if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
      const rows=Array.isArray(payload.research)?payload.research:[];
      renderArtistResearchHistory(rows);
      const latestContext=rows[0]?.queries?.identity_context;
      if(latestContext){
        const fields={legal_name:"researchLegalName",country:"researchCountry",city:"researchCity",genre:"researchGenre",affiliation:"researchAffiliation",youtube:"researchYoutube",instagram:"researchInstagram",facebook:"researchFacebook",tiktok:"researchTiktok",website:"researchWebsite",notes:"researchNotes"};
        Object.entries(fields).forEach(([key,id])=>{const input=$("#"+id);if(input&&!input.value&&latestContext[key])input.value=latestContext[key];});
      }
      const nameInput=$("#researchArtistName");if(nameInput&&!nameInput.value)nameInput.value=activeArtistName();
      status.textContent=rows.length?rows.length+" dossier(s) conservé(s) pour "+activeArtistName()+".":"Aucun dossier de recherche enregistré pour cet artiste.";
    }catch(error){
      if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
      status.textContent="Historique indisponible : "+error.message;
      renderArtistResearchHistory([]);
    }
  }
  $("#artistResearchForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const artistId=activeArtistId,name=$("#researchArtistName").value.trim(),button=$("#artistResearchSubmit"),status=$("#artistResearchStatus");
    if(!artistId||!name){status.textContent="Sélectionne un artiste et saisis son nom exact.";return;}
    const read=id=>($("#"+id)?.value||"").trim();
    const identity_context={
      legal_name:read("researchLegalName"),country:read("researchCountry"),city:read("researchCity"),genre:read("researchGenre"),
      affiliation:read("researchAffiliation"),youtube:read("researchYoutube"),instagram:read("researchInstagram"),
      facebook:read("researchFacebook"),tiktok:read("researchTiktok"),website:read("researchWebsite"),notes:read("researchNotes")
    };
    button.disabled=true;button.textContent="Recherche en cours…";
    status.textContent="Recherche ciblée : vérification de l’identité, de la discographie et des profils officiels…";
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error("Session expirée. Reconnecte-toi.");
      const response=await fetch("/api/research",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},body:JSON.stringify({artist_id:artistId,artist_name:name,identity_context})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||"Recherche impossible.",Array.isArray(payload.missing)?"Configuration requise : "+payload.missing.join(", "):"",payload.diagnostic||""].filter(Boolean).join(" — "));
      if(artistId!==activeArtistId)return;
      status.textContent="Recherche "+(payload.status==="partial"?"partielle":"terminée")+" : "+payload.source_count+" source(s). Ouvre le dossier et vérifie l’identité des sources.";
      await loadArtistResearch();
      toast("Dossier de recherche enregistré pour "+name+".");
    }catch(error){if(artistId===activeArtistId){status.textContent=error.message;toast(error.message,true);}}
    finally{button.disabled=false;button.textContent="Rechercher sur le web →";}
  });
  async function loadMedia(version=workspaceLoadVersion){
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_media_library').select('*').eq('artist_id',artistId).order('created_at',{ascending:false});
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    if(error){toast('Chargement des médias : '+error.message,true);return;}
    media=data||[];
    await renderMedia(media,version,artistId);
  }
  async function renderMedia(items=media,version=workspaceLoadVersion,artistId=activeArtistId){
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    $('#mediaCount').textContent=items.length;
    $('#libraryCount').textContent=`${items.length} fichier${items.length>1?'s':''}`;
    $('#mediaCheck').classList.toggle('done',items.length>0);
    $('#mediaCheck').textContent=items.length?'✓':'3';
    $('#mediaList').innerHTML='';
    if(!items.length){
      $('#mediaList').innerHTML='<div class="empty-state">Ta bibliothèque est vide. Ajoute tes premiers médias pour commencer.</div>';
      return;
    }
    for(const item of items){
      const card=document.createElement('article');
      card.className='media-card';
      const isImage=item.mime_type?.startsWith('image/');
      const icon=isImage?'▧':item.mime_type?.startsWith('video/')?'▶':item.mime_type?.startsWith('audio/')?'♫':'▤';
      const meta=isImage?document.createElement('button'):document.createElement('div');
      meta.className='media-thumb'+(isImage?' media-thumb-button':'');
      if(isImage) meta.type='button';
      meta.textContent=icon;
      if(isImage){
        const {data:signedData,error:signedError}=await supabase.storage.from('nuria-private-media').createSignedUrl(item.storage_path,3600);
        if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
        if(!signedError&&signedData?.signedUrl){
          const img=document.createElement('img');
          img.src=signedData.signedUrl;
          img.alt=item.file_name;
          img.loading='lazy';
          img.onerror=()=>{meta.textContent='▧';};
          meta.textContent='';
          meta.append(img);
          meta.title='Ouvrir l’image en grand';
          meta.onclick=()=>window.open(signedData.signedUrl,'_blank','noopener,noreferrer');
        }else{
          meta.title='Aperçu indisponible';
          meta.setAttribute('aria-label','Aperçu indisponible');
        }
      }
      const info=document.createElement('div');
      info.className='media-info';
      const name=document.createElement('strong');
      name.textContent=item.file_name;
      const type=document.createElement('small');
      type.textContent=`${item.category||'Autre'} · ${new Date(item.created_at).toLocaleDateString('fr-FR')}`;
      info.append(name,type);
      const del=document.createElement('button');
      del.className='icon-btn';
      del.textContent='×';
      del.title='Supprimer';
      del.onclick=()=>deleteMedia(item);
      card.append(meta,info,del);
      if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
      $('#mediaList').append(card);
    }
  }
  async function deleteMedia(item){if(!confirm(`Supprimer ${item.file_name} de la bibliothèque ?`))return;const {error:storageError}=await supabase.storage.from('nuria-private-media').remove([item.storage_path]);if(storageError){toast(storageError.message,true);return;}const {error}=await supabase.from('ai_media_library').delete().eq('id',item.id);if(error){toast(error.message,true);return;}toast('Fichier supprimé.');await loadMedia();}
  $('#authForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabase){toast('Le service de connexion n’est pas initialisé. Recharge la page et réessaie.',true);return;}
    const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
    const button=$('#authSubmit');
    button.disabled=true;button.textContent='Connexion en cours…';
    try{
      const {data,error}=signupMode
        ?await supabase.auth.signUp({email,password})
        :await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(signupMode&&!data.session)toast('Compte créé. Vérifie ton e-mail pour confirmer ton adresse.');
      else toast('Connexion réussie.');
    }catch(error){
      toast(error.message||'La connexion a échoué. Réessaie.',true);
    }finally{
      button.disabled=false;
      button.innerHTML=signupMode?'Créer mon compte <span>→</span>':'Se connecter <span>→</span>';
    }
  });
  $('#authSwitch').onclick=()=>{signupMode=!signupMode;authMode();};
  $('#signOut').onclick=async()=>{await supabase.auth.signOut();user=null;hide($('#appShell'));show($('#authScreen'));};
  const accountMenuButton=$('#accountMenuButton'),accountMenu=$('#accountMenu');
  accountMenuButton?.addEventListener('click',event=>{event.stopPropagation();const opening=accountMenu.classList.contains('hidden');accountMenu.classList.toggle('hidden',!opening);accountMenuButton.setAttribute('aria-expanded',String(opening));});
  document.addEventListener('click',event=>{if(accountMenu&&!accountMenu.classList.contains('hidden')&&!accountMenu.contains(event.target)&&!accountMenuButton?.contains(event.target)){hide(accountMenu);accountMenuButton?.setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&accountMenu&&!accountMenu.classList.contains('hidden')){hide(accountMenu);accountMenuButton?.setAttribute('aria-expanded','false');}});
  $('#accountMenuSignOut')?.addEventListener('click',()=>$('#signOut')?.click());
  $('#accountMenuManageArtists')?.addEventListener('click',()=>{hide(accountMenu);accountMenuButton?.setAttribute('aria-expanded','false');renderArtistManagement();nav('artists');});
  $('#managementAddArtist')?.addEventListener('click',()=>$('#addArtistButton')?.click());
  const mobileMenu=$('#mobileMenu'),sidebar=$('#sidebar');
  let mobileMenuBackdrop=$('#mobileMenuBackdrop');
  if(!mobileMenuBackdrop){
    mobileMenuBackdrop=document.createElement('button');
    mobileMenuBackdrop.type='button';
    mobileMenuBackdrop.id='mobileMenuBackdrop';
    mobileMenuBackdrop.className='mobile-menu-backdrop';
    mobileMenuBackdrop.setAttribute('aria-label','Fermer le menu');
    mobileMenuBackdrop.setAttribute('aria-hidden','true');
    document.body.append(mobileMenuBackdrop);
  }
  const closeMobileMenu=()=>{
    sidebar?.classList.remove('open');
    mobileMenuBackdrop?.classList.remove('active');
    mobileMenu?.setAttribute('aria-expanded','false');
    mobileMenu?.setAttribute('aria-label','Ouvrir le menu');
    mobileMenuBackdrop?.setAttribute('aria-hidden','true');
    document.body.classList.remove('mobile-navigation-open');
  };
  const openMobileMenu=()=>{
    if(!sidebar)return;
    sidebar.classList.add('open');
    mobileMenuBackdrop?.classList.add('active');
    mobileMenu?.setAttribute('aria-expanded','true');
    mobileMenu?.setAttribute('aria-label','Fermer le menu');
    mobileMenuBackdrop?.setAttribute('aria-hidden','false');
    document.body.classList.add('mobile-navigation-open');
  };
  $$('.nav-item[data-view]').forEach(b=>b.onclick=()=>{nav(b.dataset.view);closeMobileMenu();});
  $$('[data-goto]').forEach(b=>b.onclick=()=>{nav(b.dataset.goto);closeMobileMenu();});
  mobileMenu?.addEventListener('click',()=>{
    if(sidebar?.classList.contains('open'))closeMobileMenu();
    else openMobileMenu();
  });
  mobileMenuBackdrop?.addEventListener('click',closeMobileMenu);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMobileMenu();});
  window.addEventListener('resize',()=>{if(!window.matchMedia('(max-width: 760px)').matches)closeMobileMenu();});
  $('#backToDashboard').onclick=()=>nav('overview');
  $('#brandForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),payload=Object.fromEntries(f.entries());payload.owner_id=user.id;payload.artist_id=activeArtistId;payload.updated_at=new Date().toISOString();const query=supabase.from('ai_brand_profile').upsert(payload,{onConflict:'artist_id'});const {error}=await query;if(error){$('#brandMessage').textContent=error.message;toast('Impossible d’enregistrer le profil.',true);return;}$('#brandMessage').textContent='Profil enregistré.';toast('Identité artistique enregistrée.');await loadProfile();});
  $('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),p=Object.fromEntries(f.entries());p.owner_id=user.id;p.artist_id=activeArtistId;p.monthly_budget_usd=Number(p.monthly_budget_usd);p.planning_horizon=Number(p.planning_horizon);p.updated_at=new Date().toISOString();const {error}=await supabase.from('ai_settings').upsert(p,{onConflict:'artist_id'});if(error){$('#settingsMessage').textContent=error.message;toast(error.message,true);return;}$('#settingsMessage').textContent='Paramètres enregistrés. Aucun service payant n’a été activé.';toast('Paramètres enregistrés.');});
  function appendAssistantInline(parent,text){
    const pattern=/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;let cursor=0,match;
    while((match=pattern.exec(text))){if(match.index>cursor)parent.append(document.createTextNode(text.slice(cursor,match.index)));const token=match[0];let node;
      if(token.startsWith('`')){node=document.createElement('code');node.textContent=token.slice(1,-1);}
      else if(token.startsWith('**')||token.startsWith('__')){node=document.createElement('strong');node.textContent=token.slice(2,-2);}
      else{node=document.createElement('em');node.textContent=token.slice(1,-1);}
      parent.append(node);cursor=pattern.lastIndex;
    }
    if(cursor<text.length)parent.append(document.createTextNode(text.slice(cursor)));
  }
  function renderAssistantMarkdown(container,markdown){
    container.replaceChildren();const lines=String(markdown||'').replace(/\r/g,'').split('\n');let i=0;
    const isBlock=line=>/^\s*(#{1,3}\s|[-*•]\s+|\d+\.\s+|>\s?|\`\`\`|\|.*\|\s*$)/.test(line);
    while(i<lines.length){
      const line=lines[i].trim();if(!line){i++;continue;}
      if(line.startsWith('```')){const code=[];i++;while(i<lines.length&&!lines[i].trim().startsWith('```'))code.push(lines[i++]);i++;const pre=document.createElement('pre'),block=document.createElement('code');block.textContent=code.join('\n');pre.append(block);container.append(pre);continue;}
      const heading=line.match(/^(#{1,3})\s+(.+)$/);if(heading){const node=document.createElement('h'+Math.min(4,heading[1].length+1));appendAssistantInline(node,heading[2]);container.append(node);i++;continue;}
      if(/^[-*_]{3,}$/.test(line)){container.append(document.createElement('hr'));i++;continue;}
      if(/^\|.*\|$/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}/.test(lines[i+1])){const rows=[line];i+=2;while(i<lines.length&&/^\|.*\|$/.test(lines[i].trim()))rows.push(lines[i++].trim());const table=document.createElement('table');rows.forEach((row,index)=>{const tr=document.createElement('tr');row.replace(/^\||\|$/g,'').split('|').forEach(cell=>{const td=document.createElement(index===0?'th':'td');appendAssistantInline(td,cell.trim());tr.append(td);});table.append(tr);});container.append(table);continue;}
      if(/^>\s?/.test(line)){const quote=document.createElement('blockquote');const p=document.createElement('p');appendAssistantInline(p,line.replace(/^>\s?/,'').trim());quote.append(p);container.append(quote);i++;continue;}
      if(/^[-*•]\s+/.test(line)||/^\d+\.\s+/.test(line)){const ordered=/^\d+\.\s+/.test(line),list=document.createElement(ordered?'ol':'ul');while(i<lines.length&&((ordered?/^\d+\.\s+/:/^[-*•]\s+/).test(lines[i].trim()))){const li=document.createElement('li');appendAssistantInline(li,lines[i++].trim().replace(ordered?/^\d+\.\s+/:/^[-*•]\s+/,''));list.append(li);}container.append(list);continue;}
      const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!isBlock(lines[i].trim()))paragraph.push(lines[i++].trim());const p=document.createElement('p');appendAssistantInline(p,paragraph.join(' '));container.append(p);
    }
  }
  function renderAssistantConversation(artistId=activeArtistId){
    const container=$('#assistantConversation');if(!container)return;container.replaceChildren();
    const messages=getAssistantConversation(artistId);
    if(!messages.length){const empty=document.createElement('div');empty.className='assistant-empty';const symbol=document.createElement('span');symbol.textContent='✧';const title=document.createElement('strong');title.textContent='Comment puis-je t’aider ?';const detail=document.createElement('p');detail.textContent='Décris ton objectif ou commence avec une suggestion ci-dessus.';empty.append(symbol,title,detail);container.append(empty);hide($('#assistantResult'));return;}
    messages.forEach(message=>{const article=document.createElement('article');article.className='assistant-message '+(message.role==='user'?'user':'assistant');const label=document.createElement('span');label.className='assistant-message-label';label.textContent=message.role==='user'?'Toi':'Assistant';const body=document.createElement('div');body.className='assistant-message-content';if(message.role==='assistant')renderAssistantMarkdown(body,message.content);else body.textContent=message.content;article.append(label,body);container.append(article);});
    const last=[...messages].reverse().find(message=>message.role==='assistant');if(last){$('#assistantAnswer').textContent=last.content;show($('#assistantResult'));const approval=assistantApprovals.get(artistId);if(approval)renderApprovalControl(approval,$('#assistantApprovalControl'));else $('#assistantApprovalControl').replaceChildren();}
    container.scrollTop=container.scrollHeight;
  }
  function resizeAssistantComposer(){const field=$('#assistantTask');if(!field)return;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,220)+'px';}
  function updateAssistantDraft(){if(activeArtistId)assistantDrafts.set(activeArtistId,$('#assistantTask').value);resizeAssistantComposer();}
  function renderAssistantAttachments(){
    const preview=$('#assistantAttachmentPreview');if(!preview)return;preview.replaceChildren();preview.classList.toggle('hidden',assistantAttachments.length===0);
    assistantAttachments.forEach((item,index)=>{const chip=document.createElement('div');chip.className='assistant-attachment-chip';const img=document.createElement('img');img.src=item.previewUrl;img.alt=item.file.name;const name=document.createElement('span');name.textContent=item.file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Retirer '+item.file.name);remove.addEventListener('click',()=>{URL.revokeObjectURL(item.previewUrl);assistantAttachments.splice(index,1);renderAssistantAttachments();});chip.append(img,name,remove);preview.append(chip);});
  }
  function clearAssistantAttachments(){assistantAttachments.forEach(item=>URL.revokeObjectURL(item.previewUrl));assistantAttachments=[];renderAssistantAttachments();$('#assistantImageInput').value='';}
  async function imageAsDataUrl(file){
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));if(!blob)throw new Error('Impossible de préparer cette image.');return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Lecture de l’image impossible.'));reader.readAsDataURL(blob);});
  }
  $('#assistantImageInput').addEventListener('change',event=>{
    const files=[...event.target.files];for(const file of files){if(assistantAttachments.length>=3){toast('Trois images maximum par message.',true);break;}if(!file.type.startsWith('image/')){toast('Choisis un fichier image.',true);continue;}if(file.size>12*1024*1024){toast(file.name+' dépasse 12 Mo.',true);continue;}assistantAttachments.push({file,previewUrl:URL.createObjectURL(file)});}renderAssistantAttachments();event.target.value='';
  });
  $('#assistantAttachButton').addEventListener('click',()=>$('#assistantImageInput').click());
  $('#assistantTask').addEventListener('input',updateAssistantDraft);
  $('#assistantTask').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('#assistantForm').requestSubmit();}});
  async function transcribeAssistantAudio(blob,recordingArtistId){
    const button=$('#assistantRecordButton'),recordStatus=$('#assistantRecordingStatus');button.disabled=true;recordStatus.textContent='Transcription…';$('#assistantStatus').textContent='Transcription de la note vocale…';
    try{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');const form=new FormData();form.append('file',blob,'note-vocale.webm');const response=await fetch('/api/transcribe',{method:'POST',headers:{authorization:'Bearer '+session.access_token},body:form});const payload=await response.json().catch(()=>({}));if(!response.ok||!payload.text)throw new Error(payload.error||'Transcription impossible.');if(recordingArtistId&&recordingArtistId!==activeArtistId){const previous=assistantDrafts.get(recordingArtistId)||'';assistantDrafts.set(recordingArtistId,[previous,payload.text.trim()].filter(Boolean).join('\n'));toast('La transcription a été ajoutée au brouillon de l’artiste d’origine.');return;}const field=$('#assistantTask');field.value+=(field.value.trim()?'\n':'')+payload.text.trim();updateAssistantDraft();field.focus();$('#assistantStatus').textContent='Texte transcrit. Tu peux le relire et le modifier avant envoi.';recordStatus.textContent='Transcription ajoutée';}catch(error){recordStatus.textContent='';toast(error.message||'Transcription impossible.',true);}finally{button.disabled=false;}
  }
  $('#assistantRecordButton').addEventListener('click',async()=>{
    const button=$('#assistantRecordButton'),recordStatus=$('#assistantRecordingStatus');
    if(assistantRecorder&&assistantRecorder.state==='recording'){assistantRecorder.stop();button.classList.remove('recording');button.textContent='🎙';recordStatus.textContent='Traitement de la note…';return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('L’enregistrement audio n’est pas pris en charge par ce navigateur.',true);return;}
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});assistantRecordingArtistId=activeArtistId;const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':(MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'');assistantRecordingChunks=[];assistantRecorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);assistantRecorder.ondataavailable=event=>{if(event.data?.size)assistantRecordingChunks.push(event.data);};assistantRecorder.onstop=async()=>{clearTimeout(assistantRecordingTimeout);stream.getTracks().forEach(track=>track.stop());const blob=new Blob(assistantRecordingChunks,{type:assistantRecorder.mimeType||'audio/webm'});assistantRecorder=null;button.classList.remove('recording');button.textContent='🎙';const recordedFor=assistantRecordingArtistId;assistantRecordingArtistId=null;if(blob.size)await transcribeAssistantAudio(blob,recordedFor);};assistantRecorder.start();button.classList.add('recording');button.textContent='■';recordStatus.textContent='Enregistrement…';$('#assistantStatus').textContent='Parle maintenant. Appuie de nouveau sur le micro pour terminer.';assistantRecordingTimeout=setTimeout(()=>{if(assistantRecorder?.state==='recording'){assistantRecorder.stop();button.classList.remove('recording');button.textContent='🎙';recordStatus.textContent='Limite de 60 secondes atteinte.';}},60000);}catch(error){toast('Accès au microphone refusé ou indisponible : '+(error.message||''),true);}
  });
  async function submitAssistantTask(task){
    const cleanTask=String(task||'').trim();if(!cleanTask&&!assistantAttachments.length)return;
    const artistId=activeArtistId,submit=$('#assistantSubmit'),status=$('#assistantStatus');lastAssistantTasks.set(artistId,cleanTask);
    submit.disabled=true;status.classList.add('is-thinking');status.textContent='L’assistant réfléchit…';hide($('#assistantResult'));
    try{
      const {data:{session},error:sessionError}=await supabase.auth.getSession();if(sessionError||!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const images=[];for(const item of assistantAttachments)images.push({data_url:await imageAsDataUrl(item.file)});
      const messages=(getAssistantConversation(artistId)).slice(-8).map(message=>({role:message.role,content:message.content.slice(0,5000)}));
      const taskText=cleanTask||(images.length?'Analyse les images jointes dans le contexte de l’artiste actif.':'');
      const response=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},body:JSON.stringify({task:taskText,artist_id:artistId,images,history:messages})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||'Le service IA n’a pas répondu correctement.',Array.isArray(payload.missing)&&payload.missing.length?'Variables manquantes : '+payload.missing.join(', '):'',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      if(!payload.answer)throw new Error('Aucune proposition exploitable reçue.');
      const approval=payload.approval_required===true?await saveParentApproval('assistant',crypto.randomUUID(),'Proposition de l’assistant',payload.answer,artistId):null;
      const conversation=getAssistantConversation(artistId);
      if(cleanTask)conversation.push({role:'user',content:cleanTask});else conversation.push({role:'user',content:'Analyse les images jointes.'});
      conversation.push({role:'assistant',content:payload.answer});
      assistantConversations.set(artistId,conversation.slice(-20));
      persistAssistantConversation(artistId);
      if(approval)assistantApprovals.set(artistId,approval);
      if(artistId===activeArtistId){
        renderAssistantConversation(artistId);
        const providerLabel=payload.provider==='cloudflare_workers_ai'?'Cloudflare AI (secours)':'Groq';
        status.textContent='Réponse générée par '+providerLabel+'. Contexte : '+(payload.context?.settings_loaded?'profil et paramètres de '+(payload.context.artist||'l’artiste'):'profil artiste')+'. '+(payload.approval_required?'Validation humaine requise. ':'')+'Mode préparation uniquement · Vérifie-la avant toute utilisation.';
        clearAssistantAttachments();$('#assistantTask').value='';updateAssistantDraft();
      }
    }catch(error){if(artistId===activeArtistId){status.textContent=error.message||'Une erreur est survenue.';toast(status.textContent,true);}}
    finally{submit.disabled=false;submit.textContent='↑';submit.setAttribute('aria-label','Envoyer le message');status.classList.remove('is-thinking');}
  }
  $('#assistantForm').addEventListener('submit',event=>{event.preventDefault();void submitAssistantTask($('#assistantTask').value);});
  $('#regenerateAssistant').addEventListener('click',()=>{const task=lastAssistantTasks.get(activeArtistId)||'';if(task)void submitAssistantTask(task);});
  const assistantTemplates={calendar:'Prépare un calendrier éditorial réaliste de 7 jours pour l’artiste actif, avec des idées de contenus et les objectifs de chaque journée.',captions:'Propose plusieurs légendes adaptées à une prochaine sortie musicale de l’artiste actif, avec des tons différents.',videos:'Propose 5 idées de vidéos courtes adaptées à l’univers et au public de l’artiste actif.'};
  $$('[data-prompt-template]').forEach(button=>button.addEventListener('click',()=>{$('#assistantTask').value=button.dataset.prompt||assistantTemplates[button.dataset.promptTemplate]||'';updateAssistantDraft();$('#assistantTask').focus();}));
  $('#copyAssistant').addEventListener('click',async()=>{const value=$('#assistantAnswer').textContent;try{await navigator.clipboard.writeText(value);toast('Réponse copiée.');}catch{toast('Copie indisponible sur ce navigateur.',true);}});
  resizeAssistantComposer();


  const campaignTypes={single:'Single / sortie',album:'Album / EP',brand:'Marque'};
  const campaignStatuses={draft:'Brouillon',planned:'Planifiée',active:'En cours',completed:'Terminée',archived:'Archivée'};
  const money=(amount,currency)=>amount===null||amount===''?'Budget à définir':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Number(amount))+' '+(currency==='XOF'?'FCFA':currency);
  async function loadCampaigns(version=workspaceLoadVersion){
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_marketing_campaigns').select('*').eq('artist_id',artistId).order('updated_at',{ascending:false});
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    if(error){$('#campaignList').innerHTML='<div class="empty-state">Impossible de charger les campagnes : '+escapeText(error.message)+'</div>';return;}
    campaigns=data||[];renderCampaigns();
  }
  function escapeText(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderCampaigns(){
    $('#campaignCount').textContent=campaigns.length+' campagne'+(campaigns.length>1?'s':'');
    const list=$('#campaignList');list.innerHTML='';
    if(!campaigns.length){list.innerHTML='<div class="empty-state">Aucune campagne pour le moment. Crée ton premier projet ci-dessus.</div>';return;}
    campaigns.forEach(c=>{
      const card=document.createElement('article');card.className='campaign-card';
      const head=document.createElement('div');head.className='campaign-card-head';
      const title=document.createElement('div');title.innerHTML='<div class="campaign-type">'+escapeText(campaignTypes[c.project_type]||c.project_type)+'</div><h4>'+escapeText(c.project_name)+'</h4>';
      const status=document.createElement('span');status.className='campaign-status '+(c.status==='active'?'active':c.status==='completed'?'completed':'');status.textContent=campaignStatuses[c.status]||c.status;
      head.append(title,status);
      const meta=document.createElement('div');meta.className='campaign-meta';
      [c.duration_days+' jours',money(c.budget_amount,c.budget_currency)].forEach(v=>{const s=document.createElement('span');s.textContent=v;meta.append(s);});
      const desc=document.createElement('p');desc.textContent=c.objective||'Objectif non précisé';
      const markets=document.createElement('p');markets.textContent=c.markets?'Territoires : '+c.markets:'Territoires non définis';
      const actions=document.createElement('div');actions.className='campaign-actions';
      const edit=document.createElement('button');edit.type='button';edit.textContent='Modifier';edit.onclick=()=>editCampaign(c.id);
      const del=document.createElement('button');del.type='button';del.className='delete';del.textContent='Supprimer';del.onclick=()=>deleteCampaign(c.id);
      actions.append(edit,del);card.append(head,meta,desc,markets,actions);list.append(card);
    });
  }
  function resetCampaignForm(){
    const f=$('#campaignForm');f.reset();f.elements.id.value='';f.elements.project_type.value='single';f.elements.duration_days.value='30';f.elements.budget_currency.value='XOF';f.elements.status.value='draft';f.elements.objective.value='Lancement et promotion';
    editingCampaignId=null;$('#campaignSave').innerHTML='Enregistrer le projet <span>→</span>';$('#campaignMessage').textContent='Les campagnes restent modifiables.';
  }
  function editCampaign(id){
    const c=campaigns.find(x=>x.id===id);if(!c)return;
    const f=$('#campaignForm');Object.keys(c).forEach(k=>{if(f.elements[k])f.elements[k].value=c[k]??'';});
    editingCampaignId=id;$('#campaignSave').textContent='Enregistrer les modifications';$('#campaignMessage').textContent='Modification de : '+c.project_name;
    $('#campaignForm').scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function deleteCampaign(id){
    const c=campaigns.find(x=>x.id===id);if(!c||!confirm('Supprimer la campagne « '+c.project_name+' » ? Cette action est définitive.'))return;
    const {error}=await supabase.from('ai_marketing_campaigns').delete().eq('id',id);
    if(error){toast('Suppression impossible : '+error.message,true);return;}
    toast('Campagne supprimée.');if(editingCampaignId===id)resetCampaignForm();await loadCampaigns();
  }
  $('#campaignForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!supabase||!user)return;
    const f=e.currentTarget,values=Object.fromEntries(new FormData(f).entries());
    const payload={owner_id:user.id,artist_id:activeArtistId,project_type:values.project_type,project_name:values.project_name.trim(),objective:values.objective.trim(),duration_days:Number(values.duration_days),budget_amount:values.budget_amount===''?null:Number(values.budget_amount),budget_currency:values.budget_currency,markets:values.markets.trim()||null,channels:values.channels.trim()||null,notes:values.notes.trim()||null,status:values.status,updated_at:new Date().toISOString()};
    const editing=Boolean(editingCampaignId);
    const previousCampaign=editing?campaigns.find(c=>c.id===editingCampaignId):null;
    const query=editing?supabase.from('ai_marketing_campaigns').update(payload).eq('id',editingCampaignId):supabase.from('ai_marketing_campaigns').insert(payload);
    const {error}=await query;
    if(error){$('#campaignMessage').textContent=error.message;toast('Enregistrement impossible : '+error.message,true);return;}
    toast(editing?'Campagne mise à jour.':'Campagne créée.');if(payload.status==='completed'&&previousCampaign?.status!=='completed')void notifyParent('Campagne terminée',payload.project_name+' est maintenant marquée comme terminée.');resetCampaignForm();await loadCampaigns();
  });
  $('#campaignCancel').addEventListener('click',resetCampaignForm);

  $('#strategyForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabase||!user)return;
    const form=new FormData(e.currentTarget);
    const values=Object.fromEntries(form.entries());
    const artistId=activeArtistId, artistName=activeArtistName();
    const task=[
      "Élabore une stratégie marketing opérationnelle, réaliste et détaillée pour "+artistName+". Appuie-toi sur son profil artistique actif.",
      "PROJET : "+values.project,
      "OBJECTIF PRINCIPAL : "+values.objective,
      "DURÉE : "+values.duration,
      "BUDGET TOTAL INDICATIF : "+values.budget+" (FCFA). Ne dépasse jamais cette enveloppe. Si le budget est de 0 FCFA, construis exclusivement un plan sans dépense : actions organiques gratuites, contenus réalisables avec les moyens disponibles, démarchage direct non payant et partenariats à solliciter sans garantie. N’inclus aucun achat publicitaire, prestation payante ni frais caché.",
      "TERRITOIRES : "+values.markets,
      "CANAUX PRIORITAIRES : "+values.channels,
      "INFORMATIONS COMPLÉMENTAIRES : "+(values.notes||"Aucune information complémentaire fournie."),
      "",
      "CONSIGNES DE LIVRABLE :",
      "1. Fais un bref diagnostic et formule le positionnement de campagne.",
      "2. Définis 3 à 5 objectifs concrets et des indicateurs mesurables, sans inventer de résultats ni de benchmarks.",
      "3. Propose un plan d'action par semaine adapté à la durée demandée.",
      "4. Répartis le budget en FCFA, avec un total qui ne dépasse jamais l'enveloppe; indique les actions gratuites et les dépenses optionnelles.",
      "5. Prépare un volet relations radios, médias, presse et labels : types de contacts à cibler, éléments à préparer et approche. N'invente aucun nom de contact, partenariat ou accord.",
      "6. Propose les contenus à produire pour les réseaux et plateformes indiqués.",
      "7. Termine par une liste de préparation, les risques/points à confirmer et les 5 prochaines actions prioritaires.",
      ...(isNuriaDollArtist(artistName)?["CADRE SPÉCIFIQUE NURIA DOLL : projet musical porté par une enfant. Le parent est l'interlocuteur unique. Aucune sollicitation privée de l'enfant, aucune information personnelle, localisation, école ou emploi du temps. Toutes les prises de contact, dépenses et publications restent à valider et exécuter par le parent."]:[]),
      "Signale clairement les informations manquantes au lieu de les inventer."
    ].join("\n");
    const submit=$('#strategySubmit'),result=$('#strategyResult'),status=$('#strategyStatus'),answer=$('#strategyAnswer');
    submit.disabled=true;submit.textContent='Analyse et préparation…';status.textContent='L’assistant prépare le plan stratégique…';show(result);answer.textContent='';
    try{
      const {data:{session},error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},
        body:JSON.stringify({task,artist_id:artistId})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||'Le service IA n’a pas répondu correctement.',Array.isArray(payload.missing)&&payload.missing.length?'Variables manquantes : '+payload.missing.join(', '):'',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      if(!payload.answer)throw new Error('Aucune stratégie exploitable reçue.');
      const approval=payload.approval_required===true?await saveParentApproval('strategy',crypto.randomUUID(),'Stratégie marketing',payload.answer,artistId):null;
      if(artistId===activeArtistId){
        answer.textContent=payload.answer;
        if(approval)renderApprovalControl(approval,$('#strategyApprovalControl'));else $('#strategyApprovalControl').innerHTML='';
        const providerLabel=payload.provider==='cloudflare_workers_ai'?'Cloudflare AI (secours)':'Groq';
        status.textContent='Généré par '+providerLabel+' · Mode préparation uniquement · ID : '+(payload.request_id||'non disponible')+'.';
      }
    }catch(err){
      if(artistId===activeArtistId){status.textContent=err.message||'Une erreur est survenue.';toast(status.textContent,true);}
    }finally{
      submit.disabled=false;submit.innerHTML='Générer ma stratégie <span>→</span>';
    }
  });
  $('#copyStrategy').addEventListener('click',async()=>{
    const value=$('#strategyAnswer').textContent;
    try{await navigator.clipboard.writeText(value);toast('Stratégie copiée.');}
    catch{toast('Copie indisponible sur ce navigateur.',true);}
  });
  Array.from(document.querySelectorAll('[data-prompt]')).forEach(button=>button.addEventListener('click',()=>{$('#assistantTask').value=button.dataset.prompt;$('#assistantTask').focus();}));
  $('#copyAssistant').addEventListener('click',async()=>{
    const value=$('#assistantAnswer').textContent;
    try{await navigator.clipboard.writeText(value);toast('Brouillon copié.');}
    catch{toast('Copie indisponible sur ce navigateur.',true);}
  });
  $('#mediaInput').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;const artistId=activeArtistId;for(const file of files){if(file.size>100*1024*1024){toast(`${file.name} dépasse la limite de 100 Mo.`,true);continue;}const safe=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${user.id}/${crypto.randomUUID()}-${safe}`;$('#uploadStatus').textContent=`Envoi de ${file.name}…`;const {error:upErr}=await supabase.storage.from('nuria-private-media').upload(path,file,{contentType:file.type,upsert:false});if(upErr){toast(`Échec de ${file.name} : ${upErr.message}`,true);continue;}const category=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';const {error:dbErr}=await supabase.from('ai_media_library').insert({owner_id:user.id,artist_id:artistId,file_name:file.name,storage_path:path,mime_type:file.type,file_size:file.size,category});if(dbErr){await supabase.storage.from('nuria-private-media').remove([path]);toast(`Erreur d'enregistrement : ${dbErr.message}`,true);continue;}toast(`${file.name} ajouté.`);}$('#uploadStatus').textContent='';e.target.value='';await loadMedia();});

  async function loadYoutubeChannel(){
    const artistId=activeArtistId;
    const panel=$('#youtubeChannelPanel'),status=$('#youtubeChannelSync'),button=$('#refreshYoutube');
    if(!panel)return;
    panel.classList.remove('hidden');status.textContent='Lecture des informations de la chaîne…';button.disabled=true;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const r=await fetch('/api/youtube/channel?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Lecture de la chaîne impossible.');
      if(artistId!==activeArtistId)return;
      const c=d.channel;
      $('#youtubeChannelName').textContent=c.title||'Chaîne YouTube';
      $('#youtubeChannelId').textContent='ID : '+c.id;
      const avatar=$('#youtubeChannelAvatar');
      if(c.thumbnail&&/^https:\/\/yt3\.googleusercontent\.com\//.test(c.thumbnail)){avatar.src=c.thumbnail;avatar.classList.remove('hidden');}else{avatar.removeAttribute('src');avatar.classList.add('hidden');}
      $('#youtubeChannelLink').href=c.url;$('#youtubeChannelLink').textContent=c.custom_url?'@'+c.custom_url.replace(/^@/,''):'Ouvrir la chaîne YouTube';
      $('#youtubeSubscribers').textContent=c.subscribers_hidden?'Masqué':(c.subscriber_count===null?'Indisponible':Number(c.subscriber_count).toLocaleString('fr-FR'));
      $('#youtubeVideos').textContent=c.video_count===null?'—':Number(c.video_count).toLocaleString('fr-FR');
      $('#youtubeViews').textContent=c.view_count===null?'—':Number(c.view_count).toLocaleString('fr-FR');
      $('#youtubeChannelDescription').textContent=c.description||'Aucune description publique renseignée.';
      $('#youtubeChannelPublished').textContent=c.published_at?'Créée le '+new Date(c.published_at).toLocaleDateString('fr-FR'):'';
      status.textContent='Données actualisées le '+new Date(d.synced_at).toLocaleString('fr-FR')+' · Lecture seule';
    }catch(e){if(artistId===activeArtistId){status.textContent='Synchronisation impossible : '+e.message;toast(e.message,true);}}
    finally{if(artistId===activeArtistId)button.disabled=false;}
  }
  const ytNumber=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Number(value||0));
  function appendReportInline(parent,text){
    const pattern=/\*\*(.+?)\*\*|\*(.+?)\*|\x60([^\x60]+)\x60|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let cursor=0,match;
    while((match=pattern.exec(text))){
      if(match.index>cursor)parent.append(document.createTextNode(text.slice(cursor,match.index)));
      let node;
      if(match[1]){node=document.createElement('strong');node.textContent=match[1];}
      else if(match[2]){node=document.createElement('em');node.textContent=match[2];}
      else if(match[3]){node=document.createElement('code');node.textContent=match[3];}
      else{node=document.createElement('a');node.textContent=match[4];node.href=match[5];node.target='_blank';node.rel='noopener noreferrer';}
      parent.append(node);cursor=pattern.lastIndex;
    }
    if(cursor<text.length)parent.append(document.createTextNode(text.slice(cursor)));
  }
  function normalizeRecommendationText(value){
    const namedEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',bull:'•',middot:'·',hellip:'…'};
    return String(value||'').replace(/\r\n?/g,'\n')
      .replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));?/gi,(match,hex,decimal)=>{
        const code=hex?parseInt(hex,16):Number(decimal);
        return Number.isInteger(code)&&code>=0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):match;
      })
      .replace(/&([a-z]+);/gi,(match,name)=>Object.prototype.hasOwnProperty.call(namedEntities,name.toLowerCase())?namedEntities[name.toLowerCase()]:match)
      .replace(/\\?\s*<br\s*\/?>/gi,'\n')
      .replace(/\\([*_\x60])/g,'$1');
  }
  function renderRecommendationMarkdown(markdown,root){
    root.replaceChildren();
    const normalized=normalizeRecommendationText(markdown);
    const lines=normalized.split('\n');
    let i=0;
    const isTableLine=line=>/^\s*\|.*\|\s*$/.test(line);
    const isDivider=line=>/^\s*(---+|\*\s*\*\s*\*|___+)\s*$/.test(line);
    while(i<lines.length){
      const raw=lines[i],line=raw.trim();
      if(!line){i++;continue;}
      if(isDivider(line)){root.append(document.createElement('hr'));i++;continue;}
      if(isTableLine(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
        const table=document.createElement('table'),thead=document.createElement('thead'),tbody=document.createElement('tbody');
        const cells=value=>value.trim().replace(/^\||\|$/g,'').split('|').map(v=>v.trim());
        const head=document.createElement('tr');cells(line).forEach(value=>{const th=document.createElement('th');appendReportInline(th,value);head.append(th);});thead.append(head);table.append(thead);i+=2;
        while(i<lines.length&&isTableLine(lines[i])){const tr=document.createElement('tr');cells(lines[i]).forEach(value=>{const td=document.createElement('td');appendReportInline(td,value);tr.append(td);});tbody.append(tr);i++;}
        table.append(tbody);root.append(table);continue;
      }
      const heading=line.match(/^(#{1,3})\s+(.+)$/);
      const reportSection=line.match(/^\*{0,2}([A-H])\.\s+(.+?)\*{0,2}$/i);
      if(heading){const el=document.createElement(heading[1].length===1?'h2':heading[1].length===2?'h3':'h4');appendReportInline(el,heading[2]);root.append(el);i++;continue;}
      if(reportSection){const el=document.createElement('h2');appendReportInline(el,reportSection[1]+'. '+reportSection[2]);root.append(el);i++;continue;}
      if(/^[-•]\s+/.test(line)){
        const list=document.createElement('ul');
        while(i<lines.length&&/^\s*[-•]\s+/.test(lines[i])){const li=document.createElement('li');appendReportInline(li,lines[i].trim().replace(/^[-•]\s+/,''));list.append(li);i++;}
        root.append(list);continue;
      }
      if(/^\d+[.)]\s+/.test(line)){
        const list=document.createElement('ol');
        while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){const li=document.createElement('li');appendReportInline(li,lines[i].trim().replace(/^\d+[.)]\s+/,''));list.append(li);i++;}
        root.append(list);continue;
      }
      if(line.startsWith('>')){const quote=document.createElement('blockquote');appendReportInline(quote,line.replace(/^>\s?/,''));root.append(quote);i++;continue;}
      const p=document.createElement('p');appendReportInline(p,line);root.append(p);i++;
    }
  }
  function displayYoutubeRecommendation(row,artistId=activeArtistId){
    const output=$('#ytRecommendationText');
    if(!row||!output||artistId!==activeArtistId)return;
    renderRecommendationMarkdown(row.recommendation||'Aucune recommandation disponible.',output);
    output.classList.add('is-collapsed');
    const toggle=$('#toggleYoutubeReport');
    if(toggle){toggle.textContent='Lire la suite';toggle.setAttribute('aria-expanded','false');}
    show($('#ytRecommendationResult'));
    $('#ytRecommendationMeta').textContent=(row.source==='automatic'?'Analyse automatique':'Analyse demandée')+' · '+Number(row.range_days)+' jours · '+new Date(row.created_at).toLocaleString('fr-FR');
    const approvalTarget=$('#ytApprovalControl');
    if(approvalTarget){approvalTarget.innerHTML='';if(isNuriaDollArtist()){(async()=>{try{let record=parentApprovals.find(x=>x.source_type==='youtube'&&x.source_key===artistId+':'+String(row.id));if(!record)record=await saveParentApproval('youtube',String(row.id),'Recommandations YouTube · '+Number(row.range_days)+' jours',row.recommendation||'',artistId);if(artistId===activeArtistId&&record)renderApprovalControl(record,approvalTarget);}catch(error){if(artistId===activeArtistId)approvalTarget.textContent=error.message;}})();}}
  }
  const printReport=()=>{
    document.body.classList.add('printing-youtube-report');
    window.print();
  };
  window.addEventListener('afterprint',()=>document.body.classList.remove('printing-youtube-report'));
  document.addEventListener('click',event=>{
    if(event.target.closest('#printYoutubeReport')){printReport();return;}
    const toggle=event.target.closest('#toggleYoutubeReport');
    if(toggle){
      const output=$('#ytRecommendationText');
      const expanded=toggle.getAttribute('aria-expanded')==='true';
      output.classList.toggle('is-collapsed',expanded);
      toggle.setAttribute('aria-expanded',String(!expanded));
      toggle.textContent=expanded?'Lire la suite':'Réduire';
    }
  });
  async function loadYoutubeRecommendationHistory(version=workspaceLoadVersion){
    const list=$('#ytRecommendationHistory');
    if(!list||!supabase||!user)return;
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_marketing_recommendations')
      .select('id,range_days,end_date,source,recommendation,provider,created_at')
      .eq('artist_id',artistId).not('analytics_snapshot->>platform','in','(facebook,instagram)').order('created_at',{ascending:false}).limit(6);
    if(version!==workspaceLoadVersion||artistId!==activeArtistId)return;
    list.innerHTML='';
    if(error){list.textContent='Historique indisponible. Vérifie que la migration des recommandations a été exécutée.';return;}
    if(!data?.length){list.textContent='Aucune analyse enregistrée pour le moment.';return;}
    data.forEach(row=>{
      const item=document.createElement('button');
      item.type='button';item.className='yt-recommendation-history-item';
      const label=document.createElement('strong');
      label.textContent=(row.source==='automatic'?'Automatique':'Manuelle')+' · '+row.range_days+' jours';
      const date=document.createElement('small');
      date.textContent=new Date(row.created_at).toLocaleString('fr-FR');
      item.append(label,date);item.addEventListener('click',()=>displayYoutubeRecommendation(row));
      list.append(item);
    });
  }
  async function generateYoutubeRecommendations(data,range=30,manual=false){
    const status=$('#ytRecommendationStatus'),button=$('#generateYtRecommendations');
    if(!data||!user)return;
    const artistId=activeArtistId, artistName=activeArtistName();
    const jobKey=artistId+':'+range+':'+data.end_date;
    if(recommendationBusy.has(jobKey))return;
    recommendationBusy.add(jobKey);
    if(manual&&button){button.disabled=true;button.textContent='Analyse en cours…';}
    if(status)status.textContent=manual?'Nouvelle analyse IA en cours…':'Vérification des recommandations enregistrées…';
    try{
      if(!manual){
        const {data:existing,error:lookupError}=await supabase.from('ai_marketing_recommendations')
          .select('id,range_days,end_date,source,recommendation,provider,created_at')
          .eq('artist_id',artistId).eq('range_days',range).eq('end_date',data.end_date).eq('source','automatic')
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(lookupError)throw new Error('Historique indisponible. Exécute la migration SQL des recommandations dans Supabase.');
        if(existing){
          displayYoutubeRecommendation(existing,artistId);
          if(artistId===activeArtistId&&status)status.textContent='Analyse automatique déjà disponible pour cette période.';
          if(artistId===activeArtistId)await loadYoutubeRecommendationHistory();
          return;
        }
      }
      const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!sessionData?.session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const series=(data.series||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      const sumViews=items=>items.reduce((sum,item)=>sum+Number(item.views||0),0);
      const dayMap=new Map(series.map(item=>[item.date,item]));
      const start=new Date(data.start_date+'T00:00:00Z'),end=new Date(data.end_date+'T00:00:00Z');
      const expectedDays=Math.max(0,Math.round((end-start)/86400000)+1);
      const missingDates=[];
      for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
        const key=d.toISOString().slice(0,10);
        if(!dayMap.has(key))missingDates.push(key);
      }
      const windowSum=(lastOffset,count)=>{
        const dates=[];
        for(let i=count-1;i>=0;i--){
          const d=new Date(end);d.setUTCDate(d.getUTCDate()-lastOffset-i);
          dates.push(d.toISOString().slice(0,10));
        }
        if(!dailyTotalsMatch||dates.some(date=>!dayMap.has(date)))return null;
        return sumViews(dates.map(date=>dayMap.get(date)));
      };
      const bestDay=series.reduce((best,item)=>Number(item.views||0)>Number(best?.views||-1)?item:best,null);
      const dailyViewsTotal=sumViews(series);
      const dailyMinutesTotal=series.reduce((sum,item)=>sum+Number(item.minutes_watched||0),0);
      const dailyTotalsMatch=dailyViewsTotal===Number(data.totals?.views||0);
      const dailyMinutesMatch=Math.abs(dailyMinutesTotal-Number(data.totals?.minutes_watched||0))<0.01;
      const topVideos=(data.top_videos||[]).slice(0,5);
      const topViews=topVideos.reduce((sum,v)=>sum+Number(v.views||0),0);
      const snapshot={
        period_days:range,start_date:data.start_date,end_date:data.end_date,
        totals:data.totals||{},
        daily_rows_returned:Number(data.daily_api_rows_returned??series.length),daily_days_filled_zero:Number(data.daily_days_filled_zero||0),expected_calendar_days:expectedDays,missing_daily_dates:missingDates,
        daily_rows_views_total:dailyViewsTotal,daily_rows_minutes_total:Number(dailyMinutesTotal.toFixed(3)),
        daily_totals_match:dailyTotalsMatch,
        daily_minutes_match:dailyMinutesMatch,
        daily_views_average:missingDates.length||!dailyTotalsMatch?null:Number((dailyViewsTotal/expectedDays).toFixed(2)),
        best_day:dailyTotalsMatch&&bestDay&&Number(bestDay.views||0)>0?{date:bestDay.date,views:Number(bestDay.views||0)}:null,
        last_7_days_views:windowSum(0,7),
        previous_7_days_views:windowSum(7,7),
        top_videos_count:topVideos.length,top_videos_are_top_five_only:true,top_videos_views_sum:topViews,
        top_videos:topVideos.map(v=>({
          title:String(v.title||'Vidéo').slice(0,120),views:Number(v.views||0),
          minutes_watched:Number(v.minutes_watched||0),
          average_view_seconds:Number(v.average_view_seconds||0),
          calculated_seconds_per_view:Number(v.views>0?Number(v.minutes_watched||0)*60/Number(v.views):0),
          url:v.url
        }))
      };
      const task='Tu es analyste marketing YouTube senior pour '+artistName+'. Analyse les données de la chaîne associée à cet artiste et produis un rapport utile à son gestionnaire. Appuie-toi sur le profil actif et ses consignes de communication.\n\n'+
        'RÈGLES DE FIABILITÉ OBLIGATOIRES :\n'+
        '1) Utilise uniquement les chiffres du bloc DONNÉES. Ne crée aucun chiffre, date, pic, tendance, cause, source de trafic, taux de clic, rétention, commentaire, partage, donnée démographique ou résultat non fourni.\n'+
        '2) Le bloc SNAPSHOT contient des contrôles de qualité. Si missing_daily_dates n’est pas vide, ne traite pas une journée absente comme zéro : indique que la série quotidienne est incomplète. Le meilleur jour est seulement le meilleur parmi les lignes reçues. Une comparaison sur 7 jours n’est valable que si last_7_days_views et previous_7_days_views sont tous deux des nombres ; sinon indique « comparaison indisponible (données quotidiennes incomplètes ou période insuffisante) ». N’utilise jamais les 7 dernières lignes comme si elles représentaient forcément 7 jours calendaires.\n'+
        '3) Vérifie daily_totals_match et daily_minutes_match. En cas de false, signale l’écart et privilégie totals pour les totaux de chaîne ; ne tente pas de le corriger en inventant ou en additionnant les vidéos du classement. Les totaux de la chaîne sont la référence.\n'+
        '4) top_videos_are_top_five_only=true signifie que la liste est un classement partiel, pas toutes les vidéos. Ne compare jamais la somme des vidéos du top 5 au total de la chaîne comme si les périmètres étaient identiques. Les valeurs minutes_watched du classement peuvent être arrondies à l’affichage : ne les utilise pas pour contredire les totaux de chaîne.\n'+
        '5) Pour chaque vidéo, average_view_seconds est la métrique native averageViewDuration renvoyée par YouTube Analytics : utilise-la en priorité et indique qu’elle vient de YouTube. calculated_seconds_per_view est un contrôle arithmétique dérivé de minutes_watched × 60 / views ; ne l’utilise qu’en contrôle secondaire et signale tout écart notable sans déclarer automatiquement l’une des valeurs fausse. Ces durées moyennes ne sont pas un taux de rétention ni un pourcentage de vidéo regardée. Ne compare pas des vidéos sans connaître leur durée exacte.\n'+
        '6) Distingue explicitement « FAITS MESURÉS », « INTERPRÉTATIONS À TESTER » et « DONNÉES MANQUANTES ». Si une explication n’est pas prouvée, formule-la comme une question ou hypothèse, jamais comme un fait. Signale les petits volumes et évite les conclusions définitives. N’affirme pas que la chaîne est « très faible », « virale » ou « en croissance durable » sur un échantillon aussi réduit. Une hausse de vues ou un pic journalier ne prouve jamais une origine externe, une campagne ou une cause précise.\n'+
        '7) Ne déduis jamais un pourcentage de vues, une part de 100 %, un nombre total de vidéos ou une attribution d’abonnés à une vidéo si le dénominateur ou la métrique correspondante ne sont pas explicitement fournis. Une liste top vidéos ne prouve pas à elle seule qu’elle contient toutes les vidéos. Si tu calcules un pourcentage, refais la division et vérifie le résultat avant de l’écrire (exemple : 24/64 = 37,5 %, et non 40 %).\n'+
        '8) Ne qualifie pas une vidéo de courte ou longue sans connaître sa durée exacte. Ne déduis pas que sa durée explique son average_view_seconds. Ne compare pas ces durées comme un taux de rétention. Pour calculated_seconds_per_view, utilise uniquement les minutes_watched et views de la même vidéo (minutes_watched × 60 / views) ; présente le résultat comme un calcul dérivé et approximatif si les minutes sont arrondies. Ne divise jamais les minutes totales de la chaîne par les vues d’une vidéo. Ne prétends pas que l’écart avec average_view_seconds prouve une différence de comptage ou une anomalie.\n'+
        '9) Ne crée aucune cible chiffrée arbitraire (ex. 15 vues, 45 secondes, +2 abonnés) : propose plutôt de mesurer l’évolution par rapport à une période comparable, ou indique clairement qu’un objectif doit être fixé par le gestionnaire.\n'+
        '10) Pour tout calcul dérivé (moyenne, ratio, pourcentage), vérifie l’opération et affiche le calcul ou sa base. Arrondis clairement ; si les données d’entrée sont arrondies ou de périmètres différents, présente le résultat comme approximatif ou ne le calcule pas.\n'+

        (isNuriaDollArtist(artistName)
          ? 'SÉCURITÉ ET CADRE PARENTAL :\n- NURIA DOLL est une artiste enfant : le parent est l’unique gestionnaire et interlocuteur. Toutes les idées sont des brouillons soumis à validation parentale. Ne publie, ne programme, ne contacte et ne réponds à personne.\n- Ne propose aucun défi, concours ou appel à participation demandant aux enfants d’envoyer, publier ou partager des contenus personnels. N’organise aucune collecte de coordonnées, aucun échange privé avec des mineurs ni aucune rencontre.\n- Protège l’école, le domicile, les habitudes, les horaires, les déplacements, la localisation et toutes les informations personnelles de l’enfant.\n- Privilégie les contenus que le parent peut produire et contrôler ; toute dépense ou action publique doit être validée par le parent.\n\n'
          : 'CONSIGNES DE GESTION :\n- Prépare des analyses et recommandations adaptées à l’artiste et à son public. Ce rapport ne publie, ne programme et ne contacte personne.\n- Respecte les informations et limites définies dans le profil de cet artiste.\n\n')+
        'FORMAT ET PROPRETÉ DU RAPPORT :\n'+
        '- Écris exclusivement en Markdown standard. N’insère aucune balise HTML (<br>, <p>, <div>, etc.) et n’écris aucune entité HTML (&lt;, &#x20;, &#x63;, &nbsp;, etc.). Pour séparer des éléments, utilise de vrais retours à la ligne, des listes Markdown et des tableaux Markdown.\n'+
        '- N’écris pas de balises HTML échappées ou précédées d’une barre oblique inverse. Les mots doivent être écrits normalement, sans encodage caractère par caractère.\n'+
        '- N’invente pas l’existence de vidéos, playlists, visuels, campagnes, making-of ou ressources qui ne figurent pas dans les données ou le profil. Présente toute nouvelle création comme une idée facultative à produire par le gestionnaire.\n'+
        (isNuriaDollArtist(artistName)?'- Pour NURIA DOLL, ne recommande aucun concours, défi participatif, collecte de dessins/photos/vidéos ou contenu personnel d’enfants. Ne demande jamais à l’enfant de se filmer ni de montrer son domicile, son école, ses proches, ses habitudes ou ses coulisses personnelles. Privilégie les contenus réalisés et contrôlés par le parent.\n':'')+
        'FORMAT DE SORTIE (en français, Markdown lisible) :\n'+
        'A. SYNTHÈSE EN 3 LIGNES : période exacte, vues, heures regardées, abonnés gagnés/perdus/net.\n'+
        'B. FAITS MESURÉS : tableau avec indicateur, valeur et ce que la donnée permet réellement de dire.\n'+
        'C. INTERPRÉTATIONS À TESTER : au maximum 3 hypothèses, chacune accompagnée de la donnée qui pourrait la confirmer.\n'+
        'D. DONNÉES MANQUANTES : liste précise des métriques nécessaires pour mieux décider (ex. impressions/CTR, rétention, sources de trafic), sans prétendre les connaître.\n'+
        'E. 3 ACTIONS PRIORITAIRES : pour chacune, objectif, justification fondée sur les données, étapes pratiques, effort (faible/moyen/élevé), indicateur à surveiller. Classe-les par priorité et commence par les actions gratuites et sûres.\n'+
        'F. 3 IDÉES DE CONTENUS : adaptées au genre, au positionnement et au public cible indiqués dans le profil actif, avec format, durée indicative, angle créatif et appel à l’action approprié.\n'+
        'G. MINI-PLAN SUR 7 JOURS : tâches réalistes côté gestionnaire, sans obligation de publier chaque jour.\n'+
        'H. PROCHAINE ÉTAPE : indique les actions que le gestionnaire doit examiner avant toute mise en œuvre.\n'+
        'Évite les recommandations génériques ou risquées. N’invente pas de playlist déjà créée, de campagne existante ou de partenariat. Si les données sont insuffisantes pour une recommandation, dis-le.\n\nDONNÉES MESURÉES (source : YouTube Analytics) :\n'+JSON.stringify(snapshot);
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+sessionData.session.access_token},
        body:JSON.stringify({task,artist_id:artistId})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error([payload.error||'La génération IA a échoué.',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      const row={owner_id:user.id,artist_id:artistId,range_days:range,start_date:data.start_date,end_date:data.end_date,source:manual?'manual':'automatic',recommendation:payload.answer,provider:payload.provider||'unknown',analytics_snapshot:snapshot};
      const {data:saved,error:saveError}=await supabase.from('ai_marketing_recommendations').insert(row).select('id,range_days,end_date,source,recommendation,provider,created_at').single();
      if(saveError)throw new Error('Impossible de sauvegarder la recommandation : '+saveError.message+'. Vérifie la migration SQL.');
      if(artistId===activeArtistId){
        displayYoutubeRecommendation(saved,artistId);
        if(status)status.textContent=(manual?'Nouvelle analyse terminée':'Analyse automatique terminée')+' · '+(payload.fallback_used?'Cloudflare AI':'Groq')+(isNuriaDollArtist(artistName)?' · À valider par le parent.':' · Rapport prêt à examiner.');
        await loadYoutubeRecommendationHistory();
      }
    }catch(error){
      if(artistId===activeArtistId&&status)status.textContent=error.message||'Analyse des recommandations impossible.';
      if(manual&&artistId===activeArtistId)toast(error.message||'Analyse impossible.',true);
    }finally{
      recommendationBusy.delete(jobKey);
      if(manual&&button&&artistId===activeArtistId){button.disabled=false;button.textContent='Générer mes recommandations';}
    }
  }
  async function loadYoutubeAnalytics(range=30){
    const artistId=activeArtistId;
    const status=$('#youtubeAnalyticsStatus'),buttonSet=Array.from(document.querySelectorAll('#youtubeAnalyticsRanges button'));
    buttonSet.forEach(b=>{b.disabled=true;b.classList.toggle('active',Number(b.dataset.range)===range);});
    status.textContent='Chargement des statistiques YouTube…';
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const r=await fetch('/api/youtube/analytics?range='+range+'&artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Lecture des statistiques impossible.');
      if(artistId!==activeArtistId)return;
      const t=d.totals||{};
      $('#ytViewsPeriod').textContent=ytNumber(t.views);
      $('#ytWatchTime').textContent=ytNumber(Math.round((t.minutes_watched||0)/60))+' h';
      $('#ytSubsGained').textContent='+'+ytNumber(t.subscribers_gained);
      $('#ytSubsLost').textContent='−'+ytNumber(t.subscribers_lost);
      $('#ytSubsNet').textContent=(Number(t.subscribers_gained||0)-Number(t.subscribers_lost||0)>=0?'+':'')+ytNumber(Number(t.subscribers_gained||0)-Number(t.subscribers_lost||0));
      $('#ytAnalyticsDates').textContent=new Date(d.start_date+'T00:00:00').toLocaleDateString('fr-FR')+' – '+new Date(d.end_date+'T00:00:00').toLocaleDateString('fr-FR');
      const chart=$('#ytDailyChart');chart.innerHTML='';
      const rows=d.series||[],max=Math.max(1,...rows.map(x=>Number(x.views||0)));
      rows.forEach((item,i)=>{
        const bar=document.createElement('div');bar.className='yt-day-bar';bar.title=new Date(item.date+'T00:00:00').toLocaleDateString('fr-FR')+': '+ytNumber(item.views)+' vues';
        const fill=document.createElement('span');fill.style.height=Math.max(2,Number(item.views||0)/max*100)+'%';bar.append(fill);chart.append(bar);
      });
      const labels=$('#ytChartLabels');labels.innerHTML='';
      [0,Math.floor((rows.length-1)/2),Math.max(0,rows.length-1)].forEach(i=>{const s=document.createElement('small');s.textContent=rows[i]?.date?new Date(rows[i].date+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}):'';labels.append(s);});
      const list=$('#ytTopVideos');list.innerHTML='';
      if(!(d.top_videos||[]).length){list.textContent='Aucune donnée vidéo sur cette période.';}
      (d.top_videos||[]).forEach((v,i)=>{
        const item=document.createElement('a');item.className='yt-top-video';item.href=v.url;item.target='_blank';item.rel='noopener noreferrer';
        const rank=document.createElement('span');rank.className='yt-video-rank';rank.textContent=String(i+1);
        const info=document.createElement('span');info.className='yt-video-info';
        const title=document.createElement('strong');title.textContent=v.title;
        const meta=document.createElement('small');meta.textContent=ytNumber(v.views)+' vues · '+Math.round(v.minutes_watched||0)+' min regardées';
        info.append(title,meta);item.append(rank,info);list.append(item);
      });
      status.textContent='Statistiques du '+range+' derniers jours · Données arrêtées au '+new Date(d.end_date+'T00:00:00').toLocaleDateString('fr-FR')+' · Actualisé '+new Date(d.synced_at).toLocaleTimeString('fr-FR');
      latestYoutubeAnalytics=d;
      void generateYoutubeRecommendations(d,range,false);
    }catch(e){if(artistId===activeArtistId){status.textContent='Statistiques indisponibles : '+e.message;toast(e.message,true);}}
    finally{if(artistId===activeArtistId)buttonSet.forEach(b=>b.disabled=false);}
  }
  function resetYoutubeDashboard(){
    latestYoutubeAnalytics=null;latestMetaInsights=null;
    const recommendationResult=$('#ytRecommendationResult');if(recommendationResult)recommendationResult.classList.add('hidden');
    const recommendationText=$('#ytRecommendationText');if(recommendationText)recommendationText.replaceChildren();
    const recommendationStatus=$('#ytRecommendationStatus');if(recommendationStatus)recommendationStatus.textContent='Aucune recommandation chargée pour cet artiste.';
    const approval=$('#ytApprovalControl');if(approval)approval.replaceChildren();
    ['#ytViewsPeriod','#ytWatchTime','#ytSubsGained','#ytSubsLost','#ytSubsNet'].forEach(selector=>{const el=$(selector);if(el)el.textContent='—';});
    const chart=$('#ytDailyChart');if(chart)chart.replaceChildren();
    const labels=$('#ytChartLabels');if(labels)labels.replaceChildren();
    const videos=$('#ytTopVideos');if(videos)videos.textContent='Aucune donnée disponible pour cet artiste.';
    const history=$('#ytRecommendationHistory');if(history)history.textContent='Chargement de l’historique…';
    const status=$('#youtubeAnalyticsStatus');if(status)status.textContent='Aucune statistique chargée pour cet artiste.';
    const panel=$('#youtubeChannelPanel');if(panel)panel.classList.add('hidden');
    ['#youtubeChannelName','#youtubeChannelId','#youtubeSubscribers','#youtubeVideos','#youtubeViews','#youtubeChannelDescription','#youtubeChannelPublished'].forEach(selector=>{const el=$(selector);if(el)el.textContent='—';});
    const avatar=$('#youtubeChannelAvatar');if(avatar){avatar.removeAttribute('src');avatar.classList.add('hidden');}
    const link=$('#youtubeChannelLink');if(link){link.removeAttribute('href');link.textContent='Ouvrir la chaîne YouTube';}
  }
  async function youtubeStatus(){
    const artistId=activeArtistId;
    resetYoutubeDashboard();
    const box=$('#youtubeStatus'),button=$('#connectYoutube');
    try{
      const {data:{session}}=await supabase.auth.getSession();
      const r=await fetch('/api/youtube/status?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error([d.error||'État indisponible',Array.isArray(d.missing)&&d.missing.length?'Variables manquantes : '+d.missing.join(', '):''].filter(Boolean).join(' — '));
      if(artistId!==activeArtistId)return;
      box.textContent=d.connected?'Chaîne YouTube connectée · Accès en lecture seule':'Aucune chaîne YouTube connectée';
      button.textContent=d.connected?'Reconnecter YouTube':'Connecter YouTube';
      $('#youtubeTag').textContent=d.connected?'Connecté':'Non connecté';
      $('#youtubeTag').className='tag '+(d.connected?'green':'amber');
      const ytCardStatus=$('#youtubeCardStatus');if(ytCardStatus)ytCardStatus.textContent=d.connected?'Chaîne connectée · Statistiques disponibles':'Connecte une chaîne pour activer les statistiques';
      const ytDetailTag=$('#youtubeDetailTag');if(ytDetailTag){ytDetailTag.textContent=d.connected?'Connecté':'À connecter';ytDetailTag.className='tag '+(d.connected?'green':'amber');}
      if(d.connected){await loadYoutubeChannel();await loadYoutubeAnalytics(30);}else {$('#youtubeChannelPanel')?.classList.add('hidden');$('#youtubeAnalyticsStatus').textContent='Connecte une chaîne YouTube pour cet artiste afin de consulter ses statistiques.';}
    }catch(e){if(artistId===activeArtistId){const missing=Array.isArray(e.missing)?' Variables manquantes : '+e.missing.join(', '):'';box.textContent='Statut indisponible : '+e.message+missing;}}
  }
  function openSocialPlatform(platform){
    const names={facebook:"Facebook",instagram:"Instagram",youtube:"YouTube",tiktok:"TikTok"};
    const subtitles={facebook:"Page Facebook, communauté et performances de la Page.",instagram:"Compte professionnel, audience, portée et interactions.",youtube:"Chaîne, statistiques vidéo et recommandations marketing.",tiktok:"Intégration officielle active · suivi du profil, de l’audience et des vidéos."};
    if(!names[platform])return;
    activeSocialPlatform=platform;
    $('#socialPlatformGrid')?.classList.add('hidden');
    $('#socialDetailView')?.classList.remove('hidden');
    $('#socialDetailTitle').textContent=names[platform];
    $('#socialDetailSubtitle').textContent=subtitles[platform];
    ['facebook','instagram','youtube','tiktok'].forEach(name=>{
      const panel=$('#social'+name[0].toUpperCase()+name.slice(1)+'Detail');
      panel?.classList.toggle('hidden',name!==platform);
    });
    $('#socialBackButton')?.focus({preventScroll:true});
  }
  function closeSocialPlatform(){
    activeSocialPlatform=null;
    $('#socialDetailView')?.classList.add('hidden');
    $('#socialPlatformGrid')?.classList.remove('hidden');
  }
  $$('#socialPlatformGrid [data-social-platform]').forEach(card=>{
    card.addEventListener('click',()=>openSocialPlatform(card.dataset.socialPlatform));
  });
  $('#socialBackButton')?.addEventListener('click',closeSocialPlatform);

  function displaySocialRecommendation(platform,row,artistId=activeArtistId){
    const prefix=platform==='facebook'?'fb':'ig';
    const output=$('#'+prefix+'RecommendationText');
    if(!row||!output||artistId!==activeArtistId)return;
    renderRecommendationMarkdown(row.recommendation||'Aucune recommandation disponible.',output);
    output.classList.add('is-collapsed');
    const toggle=$('#'+prefix+'ToggleReport');
    if(toggle){toggle.textContent='Lire la suite';toggle.setAttribute('aria-expanded','false');}
    show($('#'+prefix+'RecommendationResult'));
    const meta=$('#'+prefix+'RecommendationMeta');
    if(meta)meta.textContent=(row.source==='automatic'?'Analyse automatique':'Analyse demandée')+' · Meta · 28 jours · '+new Date(row.created_at).toLocaleString('fr-FR');
  }
  async function loadSocialRecommendationHistory(platform){
    const prefix=platform==='facebook'?'fb':'ig',list=$('#'+prefix+'RecommendationHistory');
    if(!list||!supabase||!activeArtistId)return;
    const artistId=activeArtistId;
    const {data,error}=await supabase.from('ai_marketing_recommendations')
      .select('id,range_days,end_date,source,recommendation,provider,created_at,analytics_snapshot')
      .eq('artist_id',artistId).contains('analytics_snapshot',{platform})
      .order('created_at',{ascending:false}).limit(6);
    if(artistId!==activeArtistId)return;
    list.replaceChildren();
    if(error){list.textContent='Historique indisponible : '+error.message;return;}
    if(!data?.length){list.textContent='Aucune analyse enregistrée pour le moment.';return;}
    data.forEach(row=>{
      const item=document.createElement('button');item.type='button';item.className='yt-recommendation-history-item';
      const label=document.createElement('strong');label.textContent=(row.source==='automatic'?'Automatique':'Manuelle')+' · 28 jours';
      const date=document.createElement('small');date.textContent=new Date(row.created_at).toLocaleString('fr-FR');
      item.append(label,date);item.addEventListener('click',()=>displaySocialRecommendation(platform,row,artistId));list.append(item);
    });
  }
  async function generateSocialRecommendations(platform,metrics,manual=false){
    if(!metrics||!user)return;
    const prefix=platform==='facebook'?'fb':'ig',label=platform==='facebook'?'Facebook':'Instagram';
    const status=$('#'+prefix+'RecommendationStatus'),button=$('#generate'+(platform==='facebook'?'Facebook':'Instagram')+'Recommendations');
    const artistId=activeArtistId,artistName=activeArtistName(),jobKey=artistId+':'+platform+':28';
    if(recommendationBusy.has(jobKey))return;
    recommendationBusy.add(jobKey);
    if(manual&&button){button.disabled=true;button.textContent='Analyse en cours…';}
    if(status)status.textContent=manual?'Nouvelle analyse marketing IA en cours…':'Vérification des recommandations enregistrées…';
    try{
      if(!manual){
        const {data:existing,error}=await supabase.from('ai_marketing_recommendations')
          .select('id,range_days,end_date,source,recommendation,provider,created_at,analytics_snapshot')
          .eq('artist_id',artistId).eq('range_days',30).eq('end_date',new Date(metrics.synced_at||Date.now()).toISOString().slice(0,10))
          .eq('source','automatic').contains('analytics_snapshot',{platform})
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(error)throw error;
        if(existing){displaySocialRecommendation(platform,existing,artistId);if(status)status.textContent='Analyse automatique déjà disponible.';await loadSocialRecommendationHistory(platform);return;}
      }
      const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!sessionData?.session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const endDate=new Date(metrics.synced_at||Date.now()),startDate=new Date(endDate);startDate.setUTCDate(startDate.getUTCDate()-27);
      const snapshot={platform,platform_name:label,period_days:28,start_date:startDate.toISOString().slice(0,10),end_date:endDate.toISOString().slice(0,10),metrics,warnings:Array.isArray(metrics.warnings)?metrics.warnings:[]};
      const child=isNuriaDollArtist(artistName);
      const task='Tu es un stratège marketing musical senior spécialisé dans '+label+'. Prépare un rapport de recommandations pour '+artistName+' à partir exclusivement des données mesurées ci-dessous et du profil artistique actif.\n\n'+
        'RÈGLES DE FIABILITÉ : n’invente aucun chiffre, taux, évolution, audience, démographie, performance de publication ou cause. Les statistiques Meta sont agrégées et ne donnent pas nécessairement les performances par publication. Sépare les faits mesurés, les hypothèses et les données manquantes. Si une métrique est absente ou nulle, indique qu’elle est indisponible et non égale à zéro. Ne prétends pas qu’une stratégie a déjà été appliquée.\n'+
        (child?'SÉCURITÉ ENFANT : NURIA DOLL est une artiste enfant. Toutes les idées sont des brouillons soumis à validation du parent. Ne propose aucun défi participatif, concours, collecte de photos/vidéos/dessins ou coordonnées d’enfants, échange privé avec des mineurs, rencontre, ni révélation de l’école, du domicile, des habitudes ou de la localisation. Les contenus sont préparés et contrôlés par le parent.':'GESTION : ce rapport ne publie, ne programme et ne contacte personne. Respecte le profil artistique et le public cible.')+'\n'+
        'ADAPTATION À LA PLATEFORME : propose des actions spécifiques à '+label+' (Facebook : publications de Page, formats vidéo/Reels, conversation communautaire et partage éditorial ; Instagram : Reels, carrousels, Stories, cohérence visuelle et engagement). Ne transpose pas mécaniquement une tactique d’une plateforme à l’autre.\n'+
        'FORMAT : A. Synthèse des 28 jours ; B. Faits mesurés ; C. Interprétations à tester ; D. Données manquantes ; E. 3 actions prioritaires avec justification, étapes, effort et indicateur à suivre ; F. 3 idées de contenus adaptés à '+label+' ; G. mini-plan de 7 jours ; H. prochaine étape. Écris en français, Markdown propre, concret et sans objectifs chiffrés arbitraires.\n\nDONNÉES MESURÉES :\n'+JSON.stringify(snapshot);
      const response=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+sessionData.session.access_token},body:JSON.stringify({task,artist_id:artistId})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error([payload.error||'La génération IA a échoué.',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      const row={owner_id:user.id,artist_id:artistId,range_days:30,start_date:snapshot.start_date,end_date:snapshot.end_date,source:manual?'manual':'automatic',recommendation:payload.answer,provider:payload.provider||'unknown',analytics_snapshot:snapshot};
      const {data:saved,error:saveError}=await supabase.from('ai_marketing_recommendations').insert(row).select('id,range_days,end_date,source,recommendation,provider,created_at,analytics_snapshot').single();
      if(saveError)throw new Error('Impossible de sauvegarder la recommandation : '+saveError.message);
      if(artistId===activeArtistId){displaySocialRecommendation(platform,saved,artistId);if(status)status.textContent=(manual?'Analyse terminée':'Analyse automatique terminée')+' · '+(payload.fallback_used?'Cloudflare AI':'IA')+(child?' · À valider par le parent.':' · Rapport prêt à examiner.');await loadSocialRecommendationHistory(platform);}
    }catch(error){if(artistId===activeArtistId&&status)status.textContent=error.message||'Analyse impossible.';if(manual&&artistId===activeArtistId)toast(error.message||'Analyse impossible.',true);}
    finally{recommendationBusy.delete(jobKey);if(manual&&button&&artistId===activeArtistId){button.disabled=false;button.textContent='Générer mes recommandations';}}
  }
  document.addEventListener('click',event=>{
    for(const platform of ['facebook','instagram']){
      const prefix=platform==='facebook'?'fb':'ig';
      const toggle=event.target.closest('#'+prefix+'ToggleReport');
      if(toggle){const output=$('#'+prefix+'RecommendationText'),expanded=toggle.getAttribute('aria-expanded')==='true';output.classList.toggle('is-collapsed',expanded);toggle.setAttribute('aria-expanded',String(!expanded));toggle.textContent=expanded?'Lire la suite':'Réduire';}
    }
  });

  async function loadMetaInsights(artistId){
    const statusFacebook=$('#facebookInsightsStatus'),statusInstagram=$('#instagramInsightsStatus');
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const r=await fetch('/api/meta/analytics?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();
      if(!r.ok){
        if(r.status===403&&Array.isArray(d.missing_permissions)){
          const missing=d.missing_permissions;
          const fbMissing=missing.filter(x=>x==='read_insights'||x==='pages_read_engagement');
          const igMissing=missing.filter(x=>x==='instagram_manage_insights');
          if(statusFacebook)statusFacebook.textContent=fbMissing.length?'Autorisation(s) à ajouter dans Meta pour les statistiques Facebook : '+fbMissing.join(', ')+'. Reconnecte ensuite le compte.':'Statistiques Facebook en attente de synchronisation.';
          if(statusInstagram)statusInstagram.textContent=igMissing.length?'Autorisation à ajouter dans Meta pour les statistiques Instagram : '+igMissing.join(', ')+'. Reconnecte ensuite le compte.':'Statistiques Instagram en attente de synchronisation.';
          return;
        }
        throw new Error(d.error||'Statistiques Meta indisponibles.');
      }
      if(artistId!==activeArtistId)return;
      const fb=d.facebook||{},ig=d.instagram||{};
      const warnings=Array.isArray(d.warnings)?d.warnings:[];
      latestMetaInsights={facebook:{synced_at:d.synced_at,warnings,reach:fb.reach,interactions:fb.engagement,views:fb.views},instagram:{synced_at:d.synced_at,warnings,reach:ig.reach,interactions:ig.interactions,views:ig.views}};
      const socialMetrics={synced_at:d.synced_at,warnings};
      void loadSocialRecommendationHistory('facebook');
      void loadSocialRecommendationHistory('instagram');
      void generateSocialRecommendations('facebook',{...socialMetrics,reach:fb.reach??null,interactions:fb.engagement??null,views:fb.views??null},false);
      void generateSocialRecommendations('instagram',{...socialMetrics,reach:ig.reach??null,interactions:ig.interactions??null,views:ig.views??null},false);
      $('#fbReach').textContent=fb.reach==null?'—':ytNumber(fb.reach);
      $('#fbEngagement').textContent=fb.engagement==null?'—':ytNumber(fb.engagement);
      $('#fbViews').textContent=fb.views==null?'—':ytNumber(fb.views);
      $('#igReach').textContent=ig.reach==null?'—':ytNumber(ig.reach);
      $('#igInteractions').textContent=ig.interactions==null?'—':ytNumber(ig.interactions);
      $('#igViews').textContent=ig.views==null?'—':ytNumber(ig.views);
      const synced=d.synced_at?new Date(d.synced_at).toLocaleString('fr-FR'):'';
      if(statusFacebook)statusFacebook.textContent='Données Meta · période glissante de 28 jours · actualisé '+synced+(warnings.filter(x=>x.startsWith('Facebook :')).length?' · '+warnings.filter(x=>x.startsWith('Facebook :')).join(' '):'');
      if(statusInstagram)statusInstagram.textContent='Données Meta · période glissante de 28 jours · actualisé '+synced+(warnings.filter(x=>x.startsWith('Instagram :')).length?' · '+warnings.filter(x=>x.startsWith('Instagram :')).join(' '):'');
    }catch(e){
      if(artistId===activeArtistId){
        if(statusFacebook)statusFacebook.textContent='Statistiques Facebook indisponibles : '+e.message;
        if(statusInstagram)statusInstagram.textContent='Statistiques Instagram indisponibles : '+e.message;
      }
    }
  }
  $('#refreshFacebookInsights')?.addEventListener('click',()=>loadMetaInsights(activeArtistId));
  $('#refreshInstagramInsights')?.addEventListener('click',()=>loadMetaInsights(activeArtistId));
  $('#generateFacebookRecommendations')?.addEventListener('click',()=>{const data=latestMetaInsights?.facebook;if(data)generateSocialRecommendations('facebook',data,true);else $('#fbRecommendationStatus').textContent='Actualise d’abord les statistiques Facebook.';});
  $('#generateInstagramRecommendations')?.addEventListener('click',()=>{const data=latestMetaInsights?.instagram;if(data)generateSocialRecommendations('instagram',data,true);else $('#igRecommendationStatus').textContent='Actualise d’abord les statistiques Instagram.';});

  async function loadTikTokStatus(){
    const artistId=activeArtistId,box=$('#tiktokStatus'),button=$('#connectTikTok');if(!artistId||!box)return;
    box.textContent='Vérification de la connexion TikTok…';
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Session expirée.');
      const r=await fetch('/api/tiktok/status?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Statut TikTok indisponible.');
      if(artistId!==activeArtistId)return;
      const connected=!!d.connected,account=d.account||{};
      const tag=$('#tiktokTag'),detail=$('#tiktokDetailTag');
      [tag,detail].forEach(el=>{if(el){el.textContent=connected?'Connecté':'À connecter';el.className='tag '+(connected?'green':'amber');}});
      box.textContent=connected?'Connexion officielle active pour « '+activeArtistName()+' ». Les données du compte sont accessibles.':'Aucun compte TikTok connecté pour cet artiste.';
      if(button)button.textContent=connected?'Reconnecter ce compte TikTok':'Connecter un compte TikTok';
      if(connected){const recStatus=$('#tiktokRecommendationStatus'),recButton=$('#generateTikTokRecommendations');if(recStatus)recStatus.textContent='Compte connecté. Chargement des statistiques avant analyse IA…';if(recButton)recButton.disabled=true;$('#tiktokAccountPanel')?.classList.remove('hidden');$('#tiktokDisplayName').textContent=account.display_name||'Compte TikTok';$('#tiktokUsername').textContent=account.username?'@'+account.username:'Nom d’utilisateur non disponible avec les autorisations actuelles';const avatar=$('#tiktokAvatar');if(account.avatar_url&&avatar){avatar.src=account.avatar_url;avatar.classList.remove('hidden');}const link=$('#tiktokProfileLink');if(link){link.href=account.profile_deep_link||'https://www.tiktok.com/';}void loadTikTokAnalytics(artistId);}
      else $('#tiktokAccountPanel')?.classList.add('hidden');
    }catch(e){if(artistId===activeArtistId)box.textContent='Statut TikTok indisponible : '+e.message;}
  }
  async function loadTikTokAnalytics(artistId,options={}){
    const append=options.append===true,existing=append&&latestTikTokAnalyticsArtistId===artistId?latestTikTokAnalytics:null;
    const status=$('#tiktokInsightsStatus'),list=$('#tiktokVideoList');
    if(append&&(!existing?.has_more||existing.cursor==null))return;
    if(!append&&latestTikTokAnalyticsArtistId!==artistId){latestTikTokAnalytics=null;latestTikTokAnalyticsArtistId=null;if(list)list.replaceChildren();}
    if(status)status.textContent=append?'Chargement des vidéos supplémentaires…':'Chargement des données TikTok…';
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Session expirée.');
      const query=new URLSearchParams({artist_id:artistId});if(append)query.set('cursor',String(existing.cursor));
      const r=await fetch('/api/tiktok/analytics?'+query.toString(),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Statistiques TikTok indisponibles.');
      if(artistId!==activeArtistId)return;
      const a=d.account||{},incoming=Array.isArray(d.videos)?d.videos:[];
      $('#ttFollowers').textContent=a.follower_count==null?'—':ytNumber(a.follower_count);
      $('#ttLikes').textContent=a.likes_count==null?'—':ytNumber(a.likes_count);
      $('#ttVideos').textContent=a.video_count==null?'—':ytNumber(a.video_count);
      $('#ttFollowing').textContent=a.following_count==null?'—':ytNumber(a.following_count);
      if(list){
        if(!append)list.replaceChildren();
        if(!append&&!incoming.length)list.textContent='Aucune vidéo accessible ou autorisation video.list non accordée.';
        else incoming.forEach(v=>{
          const card=document.createElement('article');card.className='tiktok-video-card';
          if(v.cover_image_url){const img=document.createElement('img');img.src=v.cover_image_url;img.alt='Aperçu vidéo';img.loading='lazy';card.append(img);}
          const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),link=document.createElement('a');
          title.textContent=v.title||v.video_description||'Vidéo TikTok';
          meta.textContent=(v.view_count==null?'—':ytNumber(v.view_count)+' vues')+' · '+(v.like_count==null?'—':ytNumber(v.like_count)+' j’aime')+' · '+(v.comment_count==null?'—':ytNumber(v.comment_count)+' commentaires')+' · '+(v.share_count==null?'—':ytNumber(v.share_count)+' partages');
          link.href=v.share_url||'#';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Voir la vidéo';info.append(title,meta,link);card.append(info);list.append(card);
        });
        $('#tiktokLoadMoreVideos')?.remove();
        if(d.has_more&&d.cursor!=null){
          const more=document.createElement('button');more.id='tiktokLoadMoreVideos';more.type='button';more.className='btn secondary';more.textContent='Charger les 20 vidéos suivantes';
          more.addEventListener('click',async()=>{more.disabled=true;more.textContent='Chargement…';await loadTikTokAnalytics(artistId,{append:true});});
          list.append(more);
        }
      }
      const mergedVideos=append?[...(existing?.videos||[]),...incoming]:incoming;
      latestTikTokAnalytics={...a,videos:mergedVideos,warnings:d.warnings||[],synced_at:d.synced_at,cursor:d.cursor??null,has_more:!!d.has_more};
      latestTikTokAnalyticsArtistId=artistId;
      window.dispatchEvent(new CustomEvent('aimm:tiktok-videos-updated',{detail:{artistId}}));
      if(status)status.textContent=(append?'Vidéos supplémentaires chargées · ':'Données actualisées ')+(append?mergedVideos.length+' vidéos au total':new Date(d.synced_at).toLocaleString('fr-FR'))+(d.warnings?.length?' · '+d.warnings.join(' · '):'');
      const recStatus=$('#tiktokRecommendationStatus'),recButton=$('#generateTikTokRecommendations');
      if(recStatus)recStatus.textContent='Données TikTok chargées ('+mergedVideos.length+' vidéos disponibles). Tu peux maintenant générer une analyse marketing pour cet artiste.';
      if(recButton)recButton.disabled=false;
    }catch(e){
      if(artistId===activeArtistId){
        if(status)status.textContent=(append?'Chargement des vidéos supplémentaires impossible : ':'Statistiques TikTok indisponibles : ')+e.message;
        if(!append){const recStatus=$('#tiktokRecommendationStatus'),recButton=$('#generateTikTokRecommendations');if(recStatus)recStatus.textContent='Les statistiques ne sont pas encore disponibles. Vérifie la connexion puis actualise les données.';if(recButton)recButton.disabled=true;}
      }
    }
  }
  function summarizeTikTokVideos(data){
    const videos=Array.isArray(data.videos)?data.videos:[];
    const syncedAt=new Date(data.synced_at||Date.now());
    const end=Number.isNaN(syncedAt.getTime())?new Date():syncedAt;
    const start=new Date(end.getTime()-28*24*60*60*1000);
    const parsed=videos.map(video=>{
      const raw=Number(video.create_time);
      const date=Number.isFinite(raw)&&raw>0?new Date(raw*1000):null;
      return {...video,_date:date&&!Number.isNaN(date.getTime())?date:null};
    });
    const inWindow=parsed.filter(video=>video._date&&video._date>=start&&video._date<=end);
    const sum=(items,key)=>{
      const available=items.filter(item=>item[key]!==null&&item[key]!==undefined&&item[key]!==''&&Number.isFinite(Number(item[key])));
      const total=available.reduce((acc,item)=>acc+Number(item[key]),0);
      return {value:available.length===items.length&&items.length?total:null,observed_total:total,available:available.length,total_items:items.length};
    };
    const views=sum(inWindow,'view_count'),likes=sum(inWindow,'like_count'),comments=sum(inWindow,'comment_count'),shares=sum(inWindow,'share_count');
    const likeRate=views.value>0&&likes.value!==null?Number((likes.value/views.value*100).toFixed(2)):null;
    const engagementRate=views.value>0&&likes.value!==null&&comments.value!==null&&shares.value!==null
      ?Number(((likes.value+comments.value+shares.value)/views.value*100).toFixed(2)):null;
    const dated=parsed.filter(video=>video._date).sort((a,b)=>a._date-b._date);
    const asIso=date=>date?date.toISOString():null;
    return {
      window_days:28,window_start:asIso(start),window_end:asIso(end),
      account:{followers:data.follower_count??null,following:data.following_count??null,lifetime_likes:data.likes_count??null,lifetime_video_count:data.video_count??null},
      videos_in_window:inWindow.length,returned_videos:videos.length,undated_videos:parsed.length-dated.length,
      observed_sample_start:asIso(dated[0]?._date),observed_sample_end:asIso(dated.at(-1)?._date),
      views,likes,comments,shares,like_rate_percent:likeRate,engagement_rate_percent:engagementRate,
      videos:inWindow.map(video=>({title:video.title||video.video_description||'Sans titre',views:video.view_count??null,likes:video.like_count??null,comments:video.comment_count??null,shares:video.share_count??null,created_at:asIso(video._date)})),
      warnings:Array.isArray(data.warnings)?data.warnings:[]
    };
  }
  function formatTikTokFact(metric){
    if(!metric)return 'Indisponible';
    if(metric.total_items===0)return '—';
    if(metric.value===null)return 'Partiel · '+metric.available+'/'+metric.total_items+' données';
    return Number(metric.value).toLocaleString('fr-FR');
  }
  function formatTikTokDate(value){
    if(!value)return 'Date inconnue';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'Date inconnue':date.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
  }
  function renderTikTokRecommendationFacts(summary){
    const root=$('#tiktokRecommendationFacts');if(!root)return;
    root.replaceChildren();
    const sampleRange=summary.observed_sample_start&&summary.observed_sample_end
      ?formatTikTokDate(summary.observed_sample_start)+' – '+formatTikTokDate(summary.observed_sample_end)
      :'Dates insuffisantes';
    const facts=[
      ['Vidéos reçues',String(summary.returned_videos)],
      ['Période de l’échantillon',sampleRange],
      ['Vidéos sur 28 jours',String(summary.videos_in_window)],
      ['Vues sur 28 jours',formatTikTokFact(summary.views)],
      ['J’aime sur 28 jours',formatTikTokFact(summary.likes)],
      ['Taux j’aime / vues',summary.like_rate_percent===null?'Non calculable':summary.like_rate_percent.toLocaleString('fr-FR')+' %'],
      ['Commentaires',formatTikTokFact(summary.comments)],
      ['Partages',formatTikTokFact(summary.shares)],
      ['Engagement complet',summary.engagement_rate_percent===null?'Non calculable':summary.engagement_rate_percent.toLocaleString('fr-FR')+' %']
    ];
    facts.forEach(([label,value])=>{
      const card=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
      strong.textContent=value;small.textContent=label;card.append(strong,small);root.append(card);
    });
    const note=document.createElement('p');
    note.textContent='Lecture des chiffres : l’échantillon correspond aux vidéos renvoyées par TikTok, tandis que les totaux et taux de performance portent uniquement sur les vidéos datées dans les 28 jours précédant la synchronisation. Ces deux périmètres ne doivent pas être confondus.';
    root.append(note);
    const missing=[];
    if(summary.views.value===null)missing.push('vues');
    if(summary.likes.value===null)missing.push('j’aime');
    if(summary.comments.value===null)missing.push('commentaires');
    if(summary.shares.value===null)missing.push('partages');
    if(missing.length){
      const warning=document.createElement('p');
      warning.textContent='Données incomplètes : '+missing.join(', ')+'. Les totaux ou taux qui en dépendent ne sont pas présentés comme complets.';
      root.append(warning);
    }
  }
  async function generateTikTokRecommendations(){
    const artistId=activeArtistId,data=latestTikTokAnalytics,status=$('#tiktokRecommendationStatus'),button=$('#generateTikTokRecommendations');
    if(!artistId||!data){if(status)status.textContent='Les statistiques TikTok doivent être chargées avant de lancer l’analyse.';return;}
    if(recommendationBusy.has(artistId+':tiktok'))return;
    recommendationBusy.add(artistId+':tiktok');button.disabled=true;button.textContent='Analyse en cours…';
    try{
      const {data:sessionData,error}=await supabase.auth.getSession();if(error||!sessionData?.session?.access_token)throw new Error('Session expirée.');
      const summary=summarizeTikTokVideos(data);
      const task='Tu es un analyste marketing musical senior spécialisé TikTok. Prépare un rapport utile, précis et directement exploitable pour '+activeArtistName()+'.\n\n'+
        'RÈGLES DE FIABILITÉ OBLIGATOIRES : utilise uniquement les données fournies. Les compteurs du compte sont des valeurs globales à la date de synchronisation, pas des résultats sur 28 jours. Le nombre de vidéos récupérées dans la fenêtre n’est pas le nombre total de vidéos du compte. Les vidéos sans date valide sont exclues du calcul de période. N’additionne jamais des métriques partielles pour les présenter comme un total complet : indique la couverture disponible. Ne calcule un taux que si tous ses composants sont présents. N’invente ni commentaires, ni partages, ni évolution, ni démographie, ni heures optimales, ni causalité. Si l’échantillon est faible, dis-le. Ne prétends pas que TikTok favorise mécaniquement une fréquence de publication.\n'+
        'ANALYSE : commence par une synthèse de 3 lignes, puis les faits mesurés, les limites/données manquantes, 3 priorités argumentées, 5 idées de vidéos avec accroche et format, un calendrier souple sur 7 jours et les indicateurs à suivre. Les recommandations doivent être proportionnées à la taille réelle de l’audience et aux performances observées. Ne fixe pas de quotas de publication arbitraires ; propose un rythme testable et soutenable. Les heures de publication sont à tester, jamais à présenter comme optimales sans données.\n'+
        'DISTINCTION DES PÉRIMÈTRES : indique explicitement le nombre de vidéos reçues par l’API et leur plage de dates observée, puis sépare les vidéos réellement incluses dans la fenêtre de 28 jours. N’utilise jamais les vues/j’aime de l’échantillon complet comme s’ils correspondaient aux 28 jours. Si les dates observées couvrent une période plus longue ou plus courte que 28 jours, signale-le.\n'+
        (isNuriaDollArtist(activeArtistName())?'SÉCURITÉ ENFANT RENFORCÉE : NURIA DOLL est une artiste enfant. Les idées sont des propositions destinées au parent/gestionnaire et nécessitent sa validation. Ne propose ni live, ni défi participatif, ni concours, ni collecte de contenus/photos/coordonnées d’enfants, ni conversation privée avec des mineurs, ni rencontre avec des abonnés. N’expose jamais école, domicile, habitudes, trajets, localisation en temps réel ou informations personnelles. Les commentaires sont modérés par le parent. Les CTA doivent inviter à apprécier la musique sans solliciter de contact privé.':'GESTION : aucune publication, programmation ou prise de contact automatique. Toutes les propositions restent des brouillons à valider par le gestionnaire.')+'\n'+
        'PRÉSENTATION : Markdown propre, avec vrais retours à la ligne. Utilise des titres courts (##), des listes à puces et des paragraphes courts. N’utilise aucun tableau, aucune balise HTML, aucun <br>, aucun bloc de texte compact. Ne répète pas les données sans les interpréter. Termine par une action immédiate claire. Réponds en français.\n\nDONNÉES CALCULÉES ET PÉRIMÈTRE :\n'+JSON.stringify(summary);
      const response=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+sessionData.session.access_token},body:JSON.stringify({task,artist_id:artistId})});
      const payload=await response.json();if(!response.ok||!payload.answer)throw new Error(payload.error||'Génération IA impossible.');
      if(artistId!==activeArtistId)return;
      renderTikTokRecommendationFacts(summary);
      renderRecommendationMarkdown(payload.answer,$('#tiktokRecommendationText'));
      $('#tiktokRecommendationText').classList.add('is-collapsed');
      const toggle=$('#toggleTikTokReport');if(toggle){toggle.textContent='Lire la suite';toggle.setAttribute('aria-expanded','false');}
      $('#tiktokRecommendationMeta').textContent='TikTok · synchronisé le '+new Date(data.synced_at||Date.now()).toLocaleString('fr-FR')+' · '+(payload.provider==='cloudflare_workers_ai'?'Moteur IA de secours':'Moteur IA');
      $('#tiktokRecommendationResult').classList.remove('hidden');status.textContent='Analyse terminée. Les chiffres calculés et les limites des données sont affichés séparément.';
    }catch(e){if(artistId===activeArtistId)status.textContent='Analyse marketing impossible : '+e.message;}
    finally{recommendationBusy.delete(artistId+':tiktok');if(artistId===activeArtistId){button.disabled=false;button.textContent='Générer mes recommandations';}}
  }
  $('#toggleTikTokReport')?.addEventListener('click',()=>{
    const output=$('#tiktokRecommendationText'),toggle=$('#toggleTikTokReport');
    if(!output||!toggle)return;
    const collapsed=output.classList.toggle('is-collapsed');
    toggle.textContent=collapsed?'Lire la suite':'Réduire';
    toggle.setAttribute('aria-expanded',String(!collapsed));
  });
  $('#connectTikTok')?.addEventListener('click',async()=>{
    try{const artistId=activeArtistId;if(!artistId)throw new Error('Sélectionne un artiste.');const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Reconnecte-toi.');
      const r=await fetch('/api/tiktok/start',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify({artist_id:artistId})});
      const d=await r.json();if(!r.ok||!d.authorization_url)throw new Error([d.error||'Connexion TikTok impossible.',d.missing?.length?'Variables manquantes : '+d.missing.join(', '):''].filter(Boolean).join(' — '));
      window.location.assign(d.authorization_url);
    }catch(e){toast(e.message,true);}
  });
  $('#refreshTikTokInsights')?.addEventListener('click',()=>loadTikTokAnalytics(activeArtistId));
  $('#generateTikTokRecommendations')?.addEventListener('click',generateTikTokRecommendations);

  async function metaStatus(){
    const artistId=activeArtistId,box=$('#metaStatus'),button=$('#connectMeta'),accounts=$('#metaAccounts');
    if(!box||!button||!artistId)return;
    box.textContent='Vérification de la connexion Meta…';accounts?.replaceChildren();$('#instagramAccountList')?.replaceChildren();
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Reconnecte-toi.');
      const r=await fetch('/api/meta/status?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error([d.error||'État Meta indisponible',Array.isArray(d.missing)&&d.missing.length?'Variables manquantes : '+d.missing.join(', '):''].filter(Boolean).join(' — '));
      if(artistId!==activeArtistId)return;
      const connected=!!d.connected;
      const pages=Array.isArray(d.pages)?d.pages:[];
      const instagramAccounts=Array.isArray(d.instagram_accounts)&&d.instagram_accounts.length
        ?d.instagram_accounts
        :pages.filter(page=>page.instagram_id).map(page=>({instagram_id:page.instagram_id,instagram_username:page.instagram_username}));
      const facebookConnected=pages.length>0,instagramConnected=instagramAccounts.length>0;
      box.textContent=connected
        ?'Comptes sociaux reliés à « '+activeArtistName()+' » · '+pages.length+' Page(s) Facebook · '+instagramAccounts.length+' compte(s) Instagram.'
        :'Aucune connexion Meta pour cet artiste.';
      button.textContent=connected?'Reconnecter Facebook / Instagram':'Connecter Facebook / Instagram';
      const fbTag=$('#metaFacebookTag'),igTag=$('#metaInstagramTag'),fbDetailTag=$('#facebookDetailTag'),igDetailTag=$('#instagramDetailTag');
      if(fbTag){fbTag.textContent=facebookConnected?'Connecté':'À connecter';fbTag.className='tag '+(facebookConnected?'green':'amber');}
      if(igTag){igTag.textContent=instagramConnected?'Connecté':'À connecter';igTag.className='tag '+(instagramConnected?'green':'amber');}
      if(fbDetailTag){fbDetailTag.textContent=facebookConnected?'Connecté':'À connecter';fbDetailTag.className='tag '+(facebookConnected?'green':'amber');}
      if(igDetailTag){igDetailTag.textContent=instagramConnected?'Connecté':'À connecter';igDetailTag.className='tag '+(instagramConnected?'green':'amber');}
      const fbInsightStatus=$('#facebookInsightsStatus'),igInsightStatus=$('#instagramInsightsStatus');
      if(fbInsightStatus)fbInsightStatus.textContent=facebookConnected?'Vérification des autorisations et chargement des statistiques Facebook…':'Connecte une Page Facebook pour consulter ses statistiques.';
      if(igInsightStatus)igInsightStatus.textContent=instagramConnected?'Vérification des autorisations et chargement des statistiques Instagram…':'Connecte un compte Instagram professionnel pour consulter ses statistiques.';
      const igSummary=$('#instagramAccountSummary');if(igSummary)igSummary.textContent=instagramConnected?'Compte(s) Instagram professionnel(s) relié(s) à « '+activeArtistName()+' ».':'Aucun compte Instagram professionnel détecté pour cet artiste.';
      if(connected){void loadMetaInsights(artistId);}
      if(connected&&accounts){
        pages.forEach(page=>{
          const item=document.createElement('div');item.className='youtube-channel-sync';
          const strong=document.createElement('strong');strong.textContent=page.page_name||'Page Facebook';
          const detail=document.createElement('span');detail.textContent=' · Page Facebook';
          item.append(strong,detail);accounts.append(item);
        });
        instagramAccounts.forEach(account=>{
          const item=document.createElement('div');item.className='youtube-channel-sync';
          const strong=document.createElement('strong');strong.textContent=account.instagram_username?'@'+account.instagram_username:'Compte Instagram';
          const detail=document.createElement('span');detail.textContent=' · Instagram'+(account.name?' · '+account.name:'');
          item.append(strong,detail);
          const igList=$('#instagramAccountList');if(igList)igList.append(item);
        });
      }
    }catch(e){if(artistId===activeArtistId)box.textContent='Statut Meta indisponible : '+e.message;}
  }
  const startMetaConnection=async()=>{
    try{
      const artistId=activeArtistId;if(!artistId)throw new Error('Sélectionne d’abord un espace artiste.');
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Reconnecte-toi.');
      const r=await fetch('/api/meta/start?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok||!d.authorization_url)throw new Error([d.error||'Démarrage de la connexion Meta impossible.',Array.isArray(d.missing)&&d.missing.length?'Variables manquantes : '+d.missing.join(', '):''].filter(Boolean).join(' — '));
      window.location.assign(d.authorization_url);
    }catch(e){toast(e.message,true);}
  };
  $('#connectMeta')?.addEventListener('click',startMetaConnection);
  $('#connectMetaInstagram')?.addEventListener('click',startMetaConnection);
  $('#refreshYoutube').addEventListener('click',loadYoutubeChannel);
  $$('#youtubeAnalyticsRanges button').forEach(b=>b.addEventListener('click',()=>loadYoutubeAnalytics(Number(b.dataset.range))));
  $('#generateYtRecommendations').addEventListener('click',()=>{if(latestYoutubeAnalytics)generateYoutubeRecommendations(latestYoutubeAnalytics,Number(latestYoutubeAnalytics.range||30),true);else $('#ytRecommendationStatus').textContent='Charge d’abord les statistiques YouTube.';});
  $('#connectYoutube').addEventListener('click',async()=>{
    try{
      const artistId=activeArtistId;if(!artistId)throw new Error('Sélectionne d’abord un espace artiste.');
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Reconnecte-toi.');
      const r=await fetch('/api/youtube/start?artist_id='+encodeURIComponent(artistId),{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok||!d.authorization_url){const diagnostic=d.diagnostic?['HTTP '+(d.diagnostic.http_status||''),d.diagnostic.code,d.diagnostic.message,d.diagnostic.hint].filter(Boolean).join(' · '):'';const missing=Array.isArray(d.missing)&&d.missing.length?'Variables manquantes : '+d.missing.join(', '):'';throw new Error([d.error||'Démarrage OAuth impossible.',missing,diagnostic].filter(Boolean).join(' — '));}
      window.location.assign(d.authorization_url);
    }catch(e){toast(e.message,true);}
  });
  const ytParams=new URLSearchParams(location.search);
  if(ytParams.has('youtube')){if(ytParams.get('youtube')==='connected')toast('YouTube est connecté en lecture seule.');else{const reasons={cookie_absent:"Le navigateur n’a pas renvoyé le cookie de sécurité. Vérifie que la connexion s’effectue dans le même navigateur.",secret_etat_absent:"Le secret YOUTUBE_OAUTH_STATE_SECRET manque dans Cloudflare.",signature_cookie_invalide:"Le cookie de sécurité OAuth est invalide ou a été modifié.",autorisation_google_refusee:"Google a refusé ou interrompu l’autorisation.",code_ou_etat_absent:"Google n’a pas renvoyé le code ou l’état OAuth attendu.",etat_invalide:"L’état de sécurité ne correspond pas à la demande initiale.",delai_depasse:"La demande de connexion a expiré. Il faut recommencer.",erreur_echange_google:"Échec de l’échange du code auprès de Google. Vérifie le client ID, le secret et l’URL de redirection.",erreur_chiffrement_jetons:"Échec du chiffrement des jetons YouTube. Vérifie YOUTUBE_TOKEN_ENCRYPTION_KEY.",erreur_enregistrement_supabase:"Échec de l’enregistrement sécurisé dans Supabase. Vérifie la clé secrète et la table ai_social_connections.",erreur_verification_artiste:"Google a terminé l’autorisation, mais le serveur n’a pas réussi à vérifier cet artiste dans Supabase. Vérifie la configuration serveur."};const reason=ytParams.get("reason");toast(reasons[reason]||("Échec YouTube : "+(reason||"cause non précisée")+". Le diagnostic ne contient aucune clé secrète."),true);}history.replaceState({},'',location.pathname);}
  const metaParams=new URLSearchParams(location.search);
  if(metaParams.has('meta')){if(metaParams.get('meta')==='connected')toast('Facebook et Instagram ont été reliés à cet artiste.');else toast('Connexion Meta interrompue ou impossible. Vérifie les accès à la Page et les paramètres OAuth.',true);history.replaceState({},'',location.pathname);}
  const ttParams=new URLSearchParams(location.search);if(ttParams.has('tiktok')){if(ttParams.get('tiktok')==='connected')toast('TikTok est connecté à cet artiste.');else toast('Connexion TikTok interrompue ou impossible. Vérifie les autorisations de l’application et les identifiants OAuth.',true);history.replaceState({},'',location.pathname);}
  init();
})();
