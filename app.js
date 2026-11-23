(() => {
  const cfg = window.NURIA_AI_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, user = null, signupMode = false, profile = null, settings = null, media = [];
  let campaigns = [], editingCampaignId = null;
  const toast = (msg, bad=false) => { const el=$('#toast'); el.textContent=msg; el.className='toast show'+(bad?' error':''); setTimeout(()=>el.className='toast',3600); };
  const show = (el) => el.classList.remove('hidden'); const hide = (el) => el.classList.add('hidden');
  function setupMessage() {
    const n=$('#setupNotice'); n.innerHTML='<strong>Configuration nécessaire.</strong> Crée un nouveau projet Supabase, exécute <code>supabase/schema.sql</code>, puis renseigne son URL et sa clé publique dans <code>config.js</code>. Aucun secret privé ne doit être placé dans ce fichier.'; show(n); show($('#authScreen'));
    $('#authTitle').textContent='Configuration requise'; $('#authSubtitle').textContent='L’interface est prête. Connecte d’abord ton nouveau projet Supabase.'; $('#authForm').classList.add('disabled-form'); $('#authSubmit').disabled=true;
  }
  function nav(view) {
    $$('.view').forEach(v=>v.classList.toggle('active-view',v.id===`view-${view}`));
    $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const names={overview:"Vue d'ensemble",brand:'Identité artistique',strategy:'Stratégie marketing',library:'Bibliothèque média',agent:'Configuration IA',connections:'Réseaux sociaux'};
    $('#pageTitle').textContent=names[view]; $('#crumb').textContent=view==='overview'?'CENTRE DE COMMANDE':'NURIA DOLL · '+names[view].toUpperCase();
    $('#backToDashboard').classList.toggle('hidden',view==='overview');
    if(window.innerWidth<=760) $('#sidebar').classList.remove('open');
  }
  function authMode(){ $('#authTitle').textContent=signupMode?'Créer ton compte':'Connexion'; $('#authSubtitle').textContent=signupMode?'Crée ton accès privé de parent ou gestionnaire.':'Connecte-toi à ton espace de gestion privé.'; $('#authSubmit').innerHTML=signupMode?'Créer mon compte <span>→</span>':'Se connecter <span>→</span>'; $('#authSwitchText').textContent=signupMode?'Tu as déjà un compte ?':'Pas encore de compte ?'; $('#authSwitch').textContent=signupMode?'Se connecter':'Créer un compte'; $('#authPassword').autocomplete=signupMode?'new-password':'current-password'; }
  async function init(){
    if(!configured){setupMessage();return;}
    supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:{session}}=await supabase.auth.getSession(); if(session){user=session.user;await enterApp();}else show($('#authScreen'));
    supabase.auth.onAuthStateChange(async(_event,session)=>{if(session&&!user){user=session.user;await enterApp();}else if(!session&&user){user=null;hide($('#appShell'));show($('#authScreen'));}});
  }
  async function enterApp(){ hide($('#authScreen')); show($('#appShell')); $('#userEmail').textContent=user.email||'Compte connecté'; await Promise.all([loadProfile(),loadSettings(),loadMedia(),loadCampaigns()]); await youtubeStatus(); }
  async function loadProfile(){const {data,error}=await supabase.from('ai_brand_profile').select('*').maybeSingle();if(error){toast('Chargement du profil : '+error.message,true);return;}profile=data;if(data){const f=$('#brandForm');Object.entries(data).forEach(([k,v])=>{const el=f.elements[k];if(el&&v!==null)el.value=v;});$('#profileStatus').textContent='Configuré';$('#brandCheck').classList.add('done');$('#brandCheck').textContent='✓';}else $('#profileStatus').textContent='À compléter';}
  async function loadSettings(){const {data,error}=await supabase.from('ai_settings').select('*').maybeSingle();if(error)return;settings=data;if(data){const f=$('#settingsForm');['primary_goal','planning_horizon','autonomy_mode','monthly_budget_usd'].forEach(k=>{if(f.elements[k]&&data[k]!==null)f.elements[k].value=data[k];});}}
  async function loadMedia(){
    const {data,error}=await supabase.from('ai_media_library').select('*').order('created_at',{ascending:false});
    if(error){toast('Chargement des médias : '+error.message,true);return;}
    media=data||[];
    await renderMedia();
  }
  async function renderMedia(){
    $('#mediaCount').textContent=media.length;
    $('#libraryCount').textContent=`${media.length} fichier${media.length>1?'s':''}`;
    $('#mediaCheck').classList.toggle('done',media.length>0);
    $('#mediaCheck').textContent=media.length?'✓':'3';
    $('#mediaList').innerHTML='';
    if(!media.length){
      $('#mediaList').innerHTML='<div class="empty-state">Ta bibliothèque est vide. Ajoute tes premiers médias pour commencer.</div>';
      return;
    }
    for(const item of media){
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
      $('#mediaList').append(card);
    }
  }
  async function deleteMedia(item){if(!confirm(`Supprimer ${item.file_name} de la bibliothèque ?`))return;const {error:storageError}=await supabase.storage.from('nuria-private-media').remove([item.storage_path]);if(storageError){toast(storageError.message,true);return;}const {error}=await supabase.from('ai_media_library').delete().eq('id',item.id);if(error){toast(error.message,true);return;}toast('Fichier supprimé.');await loadMedia();}
  $('#authForm').addEventListener('submit',async e=>{e.preventDefault();if(!supabase)return;const email=$('#authEmail').value,password=$('#authPassword').value;const method=signupMode?supabase.auth.signUp({email,password}):supabase.auth.signInWithPassword({email,password});const {data,error}=await method;if(error){toast(error.message,true);return;}if(signupMode&&!data.session)toast('Compte créé. Vérifie ton e-mail pour confirmer ton adresse.');else toast('Connexion réussie.');});
  $('#authSwitch').onclick=()=>{signupMode=!signupMode;authMode();};
  $('#signOut').onclick=async()=>{await supabase.auth.signOut();user=null;hide($('#appShell'));show($('#authScreen'));};
  $$('.nav-item[data-view]').forEach(b=>b.onclick=()=>nav(b.dataset.view));$$('[data-goto]').forEach(b=>b.onclick=()=>nav(b.dataset.goto));
  $('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#backToDashboard').onclick=()=>nav('overview');
  $('#brandForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),payload=Object.fromEntries(f.entries());payload.owner_id=user.id;payload.updated_at=new Date().toISOString();const query=supabase.from('ai_brand_profile').upsert(payload,{onConflict:'owner_id'});const {error}=await query;if(error){$('#brandMessage').textContent=error.message;toast('Impossible d’enregistrer le profil.',true);return;}$('#brandMessage').textContent='Profil enregistré.';toast('Identité artistique enregistrée.');await loadProfile();});
  $('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),p=Object.fromEntries(f.entries());p.owner_id=user.id;p.monthly_budget_usd=Number(p.monthly_budget_usd);p.planning_horizon=Number(p.planning_horizon);p.updated_at=new Date().toISOString();const {error}=await supabase.from('ai_settings').upsert(p,{onConflict:'owner_id'});if(error){$('#settingsMessage').textContent=error.message;toast(error.message,true);return;}$('#settingsMessage').textContent='Paramètres enregistrés. Aucun service payant n’a été activé.';toast('Paramètres enregistrés.');});
  $('#assistantForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabase||!user)return;
    const task=$('#assistantTask').value.trim();
    if(!task)return;
    const submit=$('#assistantSubmit'),status=$('#assistantStatus'),result=$('#assistantResult'),answer=$('#assistantAnswer');
    submit.disabled=true;submit.textContent='Préparation en cours…';status.textContent='Groq prépare une proposition…';hide(result);
    try{
      const {data:{session},error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const currentProfile=profile||Object.fromEntries(new FormData($('#brandForm')).entries());
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},
        body:JSON.stringify({task,profile:currentProfile})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||'Le service IA n’a pas répondu correctement.',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      if(!payload.answer)throw new Error('Aucune proposition exploitable reçue.');
      answer.textContent=payload.answer;
      show(result);
      status.textContent=payload.fallback_used
        ? 'Proposition générée par Cloudflare AI (secours Groq). Vérifie-la avant toute utilisation.'
        : 'Proposition générée par Groq. Vérifie-la avant toute utilisation.';
    }catch(err){status.textContent=err.message||'Une erreur est survenue.';toast(status.textContent,true);}
    finally{submit.disabled=false;submit.innerHTML='Générer une proposition <span>→</span>';}
  });

  const campaignTypes={single:'Single / sortie',album:'Album / EP',brand:'Marque'};
  const campaignStatuses={draft:'Brouillon',planned:'Planifiée',active:'En cours',completed:'Terminée',archived:'Archivée'};
  const money=(amount,currency)=>amount===null||amount===''?'Budget à définir':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Number(amount))+' '+(currency==='XOF'?'FCFA':currency);
  async function loadCampaigns(){
    const {data,error}=await supabase.from('ai_marketing_campaigns').select('*').order('updated_at',{ascending:false});
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
    const payload={owner_id:user.id,project_type:values.project_type,project_name:values.project_name.trim(),objective:values.objective.trim(),duration_days:Number(values.duration_days),budget_amount:values.budget_amount===''?null:Number(values.budget_amount),budget_currency:values.budget_currency,markets:values.markets.trim()||null,channels:values.channels.trim()||null,notes:values.notes.trim()||null,status:values.status,updated_at:new Date().toISOString()};
    const editing=Boolean(editingCampaignId);
    const query=editing?supabase.from('ai_marketing_campaigns').update(payload).eq('id',editingCampaignId):supabase.from('ai_marketing_campaigns').insert(payload);
    const {error}=await query;
    if(error){$('#campaignMessage').textContent=error.message;toast('Enregistrement impossible : '+error.message,true);return;}
    toast(editing?'Campagne mise à jour.':'Campagne créée.');resetCampaignForm();await loadCampaigns();
  });
  $('#campaignCancel').addEventListener('click',resetCampaignForm);

  $('#strategyForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabase||!user)return;
    const form=new FormData(e.currentTarget);
    const values=Object.fromEntries(form.entries());
    const task=[
      "Élabore une stratégie marketing opérationnelle, réaliste et détaillée pour NURIA DOLL.",
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
      "Adapte absolument la communication à un projet musical porté par une enfant : le parent est l'interlocuteur unique, aucune sollicitation privée de l'enfant, aucune information personnelle, localisation, école ou emploi du temps. Toutes les prises de contact, dépenses et publications restent à valider et exécuter par le parent. Signale clairement les informations manquantes au lieu de les inventer."
    ].join("\n");
    const submit=$('#strategySubmit'),result=$('#strategyResult'),status=$('#strategyStatus'),answer=$('#strategyAnswer');
    submit.disabled=true;submit.textContent='Analyse et préparation…';status.textContent='L’assistant prépare le plan stratégique…';show(result);answer.textContent='';
    try{
      const {data:{session},error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},
        body:JSON.stringify({task,profile:profile||{artist_name:'NURIA DOLL',genre:'Pop enfantine'}})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||'Le service IA n’a pas répondu correctement.',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      if(!payload.answer)throw new Error('Aucune stratégie exploitable reçue.');
      answer.textContent=payload.answer;
      status.textContent=payload.fallback_used?'Généré par Cloudflare AI (secours Groq).':'Généré par Groq.';
    }catch(err){
      status.textContent=err.message||'Une erreur est survenue.';
      toast(status.textContent,true);
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
  $('#mediaInput').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;for(const file of files){if(file.size>100*1024*1024){toast(`${file.name} dépasse la limite de 100 Mo.`,true);continue;}const safe=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${user.id}/${crypto.randomUUID()}-${safe}`;$('#uploadStatus').textContent=`Envoi de ${file.name}…`;const {error:upErr}=await supabase.storage.from('nuria-private-media').upload(path,file,{contentType:file.type,upsert:false});if(upErr){toast(`Échec de ${file.name} : ${upErr.message}`,true);continue;}const category=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';const {error:dbErr}=await supabase.from('ai_media_library').insert({owner_id:user.id,file_name:file.name,storage_path:path,mime_type:file.type,file_size:file.size,category});if(dbErr){await supabase.storage.from('nuria-private-media').remove([path]);toast(`Erreur d'enregistrement : ${dbErr.message}`,true);continue;}toast(`${file.name} ajouté.`);}$('#uploadStatus').textContent='';e.target.value='';await loadMedia();});

  async function loadYoutubeChannel(){
    const panel=$('#youtubeChannelPanel'),status=$('#youtubeChannelSync'),button=$('#refreshYoutube');
    if(!panel)return;
    panel.classList.remove('hidden');status.textContent='Lecture des informations de la chaîne…';button.disabled=true;
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const r=await fetch('/api/youtube/channel',{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Lecture de la chaîne impossible.');
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
    }catch(e){status.textContent='Synchronisation impossible : '+e.message;toast(e.message,true);}
    finally{button.disabled=false;}
  }
  async function youtubeStatus(){
    const box=$('#youtubeStatus'),button=$('#connectYoutube');
    try{
      const {data:{session}}=await supabase.auth.getSession();
      const r=await fetch('/api/youtube/status',{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'État indisponible');
      box.textContent=d.connected?'Chaîne YouTube connectée · Accès en lecture seule':'Aucune chaîne YouTube connectée';
      button.textContent=d.connected?'Reconnecter YouTube':'Connecter YouTube';
      $('#youtubeTag').textContent=d.connected?'Connecté':'Non connecté';
      $('#youtubeTag').className='tag '+(d.connected?'green':'');
      if(d.connected)await loadYoutubeChannel();else $('#youtubeChannelPanel')?.classList.add('hidden');
    }catch(e){box.textContent='Statut indisponible : '+e.message;}
  }
  $('#refreshYoutube').addEventListener('click',loadYoutubeChannel);
  $('#connectYoutube').addEventListener('click',async()=>{
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Reconnecte-toi.');
      const r=await fetch('/api/youtube/start',{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok||!d.authorization_url)throw new Error(d.error||'Démarrage OAuth impossible.');
      window.location.assign(d.authorization_url);
    }catch(e){toast(e.message,true);}
  });
  const ytParams=new URLSearchParams(location.search);
  if(ytParams.has('youtube')){if(ytParams.get('youtube')==='connected')toast('YouTube est connecté en lecture seule.');else{const reasons={cookie_absent:"Le navigateur n’a pas renvoyé le cookie de sécurité. Vérifie que la connexion s’effectue dans le même navigateur.",secret_etat_absent:"Le secret YOUTUBE_OAUTH_STATE_SECRET manque dans Cloudflare.",signature_cookie_invalide:"Le cookie de sécurité OAuth est invalide ou a été modifié.",autorisation_google_refusee:"Google a refusé ou interrompu l’autorisation.",code_ou_etat_absent:"Google n’a pas renvoyé le code ou l’état OAuth attendu.",etat_invalide:"L’état de sécurité ne correspond pas à la demande initiale.",delai_depasse:"La demande de connexion a expiré. Il faut recommencer.",erreur_echange_google:"Échec de l’échange du code auprès de Google. Vérifie le client ID, le secret et l’URL de redirection.",erreur_chiffrement_jetons:"Échec du chiffrement des jetons YouTube. Vérifie YOUTUBE_TOKEN_ENCRYPTION_KEY.",erreur_enregistrement_supabase:"Échec de l’enregistrement sécurisé dans Supabase. Vérifie la clé secrète et la table ai_social_connections."};const reason=ytParams.get("reason");toast(reasons[reason]||("Échec YouTube : "+(reason||"cause non précisée")+". Le diagnostic ne contient aucune clé secrète."),true);}history.replaceState({},'',location.pathname);}
  init();
})();
