(() => {
  const cfg = window.NURIA_AI_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, user = null, signupMode = false, profile = null, settings = null, media = [];
  let latestYoutubeAnalytics=null;
  const recommendationBusy=new Set();
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
      supabase.auth.onAuthStateChange(async(_event,session)=>{if(session&&!user){user=session.user;await enterApp();}else if(!session&&user){user=null;hide($('#appShell'));show($('#authScreen'));}});
    }catch(error){
      show($('#authScreen'));
      $('#authSubtitle').textContent='Impossible d’initialiser la connexion : '+(error.message||'erreur inconnue');
      toast('Initialisation impossible : '+(error.message||'erreur inconnue'),true);
    }
  }
  async function enterApp(){ hide($('#authScreen')); show($('#appShell')); $('#userEmail').textContent=user.email||'Compte connecté'; await Promise.all([loadProfile(),loadSettings(),loadMedia(),loadCampaigns(),loadParentApprovals()]); await youtubeStatus(); }

  let parentApprovals=[];
  async function saveParentApproval(sourceType,sourceKey,title,content){
    const payload={owner_id:user.id,source_type:sourceType,source_key:sourceKey,title,content,updated_at:new Date().toISOString()};
    const {data,error}=await supabase.from('ai_parent_approvals').upsert(payload,{onConflict:'owner_id,source_type,source_key'}).select('*').single();
    if(error)throw new Error('Enregistrement de la validation impossible : '+error.message+'. Vérifie que la migration parent_approvals.sql a été exécutée.');
    const index=parentApprovals.findIndex(x=>x.id===data.id);
    if(index>=0)parentApprovals[index]=data;else parentApprovals.unshift(data);
    renderParentApprovals();
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
  async function loadParentApprovals(){
    const {data,error}=await supabase.from('ai_parent_approvals').select('*').order('created_at',{ascending:false}).limit(50);
    if(error){const list=$('#parentApprovalHistory');if(list)list.textContent='Historique indisponible. Exécute la migration SQL parent_approvals.sql dans le projet Supabase de l’AI Manager.';return;}
    parentApprovals=data||[];renderParentApprovals();
  }

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
      try{
        const approval=await saveParentApproval('assistant',crypto.randomUUID(),'Proposition de l’assistant',payload.answer);
        renderApprovalControl(approval,$('#assistantApprovalControl'));
      }catch(approvalError){toast(approvalError.message,true);}
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
      const approval=await saveParentApproval('strategy',crypto.randomUUID(),'Stratégie marketing',payload.answer);
      renderApprovalControl(approval,$('#strategyApprovalControl'));
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
  function displayYoutubeRecommendation(row){
    const output=$('#ytRecommendationText');
    if(!row||!output)return;
    renderRecommendationMarkdown(row.recommendation||'Aucune recommandation disponible.',output);
    output.classList.add('is-collapsed');
    const toggle=$('#toggleYoutubeReport');
    if(toggle){toggle.textContent='Lire la suite';toggle.setAttribute('aria-expanded','false');}
    show($('#ytRecommendationResult'));
    $('#ytRecommendationMeta').textContent=(row.source==='automatic'?'Analyse automatique':'Analyse demandée')+' · '+Number(row.range_days)+' jours · '+new Date(row.created_at).toLocaleString('fr-FR');
    const approvalTarget=$('#ytApprovalControl');
    if(approvalTarget){approvalTarget.innerHTML='';(async()=>{try{let record=parentApprovals.find(x=>x.source_type==='youtube'&&x.source_key===String(row.id));if(!record)record=await saveParentApproval('youtube',String(row.id),'Recommandations YouTube · '+Number(row.range_days)+' jours',row.recommendation||'');renderApprovalControl(record,approvalTarget);}catch(error){approvalTarget.textContent=error.message;}})();}
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
  async function loadYoutubeRecommendationHistory(){
    const list=$('#ytRecommendationHistory');
    if(!list||!supabase||!user)return;
    const {data,error}=await supabase.from('ai_marketing_recommendations')
      .select('id,range_days,end_date,source,recommendation,provider,created_at')
      .order('created_at',{ascending:false}).limit(6);
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
    const jobKey=range+':'+data.end_date;
    if(recommendationBusy.has(jobKey))return;
    recommendationBusy.add(jobKey);
    if(manual&&button){button.disabled=true;button.textContent='Analyse en cours…';}
    if(status)status.textContent=manual?'Nouvelle analyse IA en cours…':'Vérification des recommandations enregistrées…';
    try{
      if(!manual){
        const {data:existing,error:lookupError}=await supabase.from('ai_marketing_recommendations')
          .select('id,range_days,end_date,source,recommendation,provider,created_at')
          .eq('range_days',range).eq('end_date',data.end_date).eq('source','automatic')
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(lookupError)throw new Error('Historique indisponible. Exécute la migration SQL des recommandations dans Supabase.');
        if(existing){
          displayYoutubeRecommendation(existing);
          if(status)status.textContent='Analyse automatique déjà disponible pour cette période.';
          await loadYoutubeRecommendationHistory();
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
        best_day:bestDay?{date:bestDay.date,views:Number(bestDay.views||0)}:null,
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
      const task='Tu es analyste marketing YouTube senior pour NURIA DOLL, un projet musical familial porté par une enfant et administré exclusivement par son parent. Analyse les données fournies et produis un rapport utile au parent.\n\n'+
        'RÈGLES DE FIABILITÉ OBLIGATOIRES :\n'+
        '1) Utilise uniquement les chiffres du bloc DONNÉES. Ne crée aucun chiffre, date, pic, tendance, cause, source de trafic, taux de clic, rétention, commentaire, partage, donnée démographique ou résultat non fourni.\n'+
        '2) Le bloc SNAPSHOT contient des contrôles de qualité. Si missing_daily_dates n’est pas vide, ne traite pas une journée absente comme zéro : indique que la série quotidienne est incomplète. Le meilleur jour est seulement le meilleur parmi les lignes reçues. Une comparaison sur 7 jours n’est valable que si last_7_days_views et previous_7_days_views sont tous deux des nombres ; sinon indique « comparaison indisponible (données quotidiennes incomplètes ou période insuffisante) ». N’utilise jamais les 7 dernières lignes comme si elles représentaient forcément 7 jours calendaires.\n'+
        '3) Vérifie daily_totals_match et daily_minutes_match. En cas de false, signale l’écart et privilégie totals pour les totaux de chaîne ; ne tente pas de le corriger en inventant ou en additionnant les vidéos du classement. Les totaux de la chaîne sont la référence.\n'+
        '4) top_videos_are_top_five_only=true signifie que la liste est un classement partiel, pas toutes les vidéos. Ne compare jamais la somme des vidéos du top 5 au total de la chaîne comme si les périmètres étaient identiques. Les valeurs minutes_watched du classement peuvent être arrondies à l’affichage : ne les utilise pas pour contredire les totaux de chaîne.\n'+
        '5) Pour chaque vidéo, average_view_seconds est la métrique native averageViewDuration renvoyée par YouTube Analytics : utilise-la en priorité et indique qu’elle vient de YouTube. calculated_seconds_per_view est un contrôle arithmétique dérivé de minutes_watched × 60 / views ; ne l’utilise qu’en contrôle secondaire et signale tout écart notable sans déclarer automatiquement l’une des valeurs fausse. Ces durées moyennes ne sont pas un taux de rétention ni un pourcentage de vidéo regardée. Ne compare pas des vidéos sans connaître leur durée exacte.\n'+
        '6) Distingue explicitement « FAITS MESURÉS », « INTERPRÉTATIONS À TESTER » et « DONNÉES MANQUANTES ». Si une explication n’est pas prouvée, formule-la comme une question ou hypothèse, jamais comme un fait. Signale les petits volumes et évite les conclusions définitives. N’affirme pas que la chaîne est « très faible », « virale » ou « en croissance durable » sur un échantillon aussi réduit. Une hausse de vues ou un pic journalier ne prouve jamais une origine externe, une campagne ou une cause précise.\n'+
        '7) Ne déduis jamais un pourcentage de vues, une part de 100 %, un nombre total de vidéos ou une attribution d’abonnés à une vidéo si le dénominateur ou la métrique correspondante ne sont pas explicitement fournis. Une liste top vidéos ne prouve pas à elle seule qu’elle contient toutes les vidéos. Si tu calcules un pourcentage, refais la division et vérifie le résultat avant de l’écrire (exemple : 24/64 = 37,5 %, et non 40 %).\n'+
        '8) Ne qualifie pas une vidéo de courte ou longue sans connaître sa durée exacte. Ne déduis pas que sa durée explique son average_view_seconds. Ne compare pas ces durées comme un taux de rétention. Pour calculated_seconds_per_view, utilise uniquement les minutes_watched et views de la même vidéo (minutes_watched × 60 / views) ; présente le résultat comme un calcul dérivé et approximatif si les minutes sont arrondies. Ne divise jamais les minutes totales de la chaîne par les vues d’une vidéo. Ne prétends pas que l’écart avec average_view_seconds prouve une différence de comptage ou une anomalie.\n'+
        '9) Ne crée aucune cible chiffrée arbitraire (ex. 15 vues, 45 secondes, +2 abonnés) : propose plutôt de mesurer l’évolution par rapport à une période comparable, ou indique clairement qu’un objectif doit être fixé par le parent.\n'+
        '10) Pour tout calcul dérivé (moyenne, ratio, pourcentage), vérifie l’opération et affiche le calcul ou sa base. Arrondis clairement ; si les données d’entrée sont arrondies ou de périmètres différents, présente le résultat comme approximatif ou ne le calcule pas.\n'+

        'SÉCURITÉ ET CADRE PARENTAL :\n'+
        '- Le parent est l’unique gestionnaire et interlocuteur. Toutes les idées sont des brouillons soumis à validation parentale. Ne publie, ne programme, ne contacte et ne réponds à personne.\n'+
        '- INTERDICTION ABSOLUE de proposer un défi, concours, challenge ou appel à participation qui demande aux enfants ou aux familles de filmer, créer, envoyer, publier, commenter avec un contenu personnel ou partager des vidéos/photos/dessins/témoignages d’enfants. Ne propose jamais « filmez votre danse », « postez votre vidéo », « partagez vos créations » ou équivalent. Les idées participatives doivent rester hors ligne et privées dans le cercle familial ; les CTA publics se limitent à regarder, écouter ou partager le lien officiel par un adulte.\n'+
        '- Ne propose jamais de collecte de coordonnées, messages privés avec des enfants, rendez-vous, concours exigeant des échanges directs avec des mineurs, ni demande d’envoi de photos, vidéos, dessins identifiables ou autres contenus personnels d’enfants. Les appels à l’action s’adressent aux adultes et peuvent inviter à regarder, écouter ou partager publiquement le contenu officiel, sans solliciter de réponse privée.\n'+
        '- Ne demande pas de données démographiques individuelles sur les enfants. Ne recommande pas de collecter des données d’âge ou de profil d’enfants ; les statistiques démographiques ne sont pas une priorité pour ce projet. N’ajoute pas les données démographiques des enfants à la liste des données manquantes ou aux actions à mener.\n'+
        '- N’expose jamais école, domicile, habitudes, horaires, déplacements, localisation en temps réel, contacts privés ou informations personnelles de l’enfant.\n'+
        '- Privilégie des contenus que le parent peut produire et contrôler : clips, extraits musicaux, paroles/karaoké, animation, instruments, coulisses centrées sur la musique sans détails privés, histoires et culture béninoise. La présence de l’enfant à l’image n’est jamais une obligation.\n'+
        '- Toute action payante doit être signalée comme optionnelle et soumise à validation du parent ; ne promets aucun résultat.\n\n'+
        'FORMAT ET PROPRETÉ DU RAPPORT :\n'+
        '- Écris exclusivement en Markdown standard. N’insère aucune balise HTML (<br>, <p>, <div>, etc.) et n’écris aucune entité HTML (&lt;, &#x20;, &#x63;, &nbsp;, etc.). Pour séparer des éléments, utilise de vrais retours à la ligne, des listes Markdown et des tableaux Markdown.\n'+
        '- N’écris pas de balises HTML échappées ou précédées d’une barre oblique inverse. Les mots doivent être écrits normalement, sans encodage caractère par caractère.\n'+
        '- N’invente pas l’existence de vidéos, playlists, visuels, campagnes, making-of ou ressources qui ne figurent pas dans les données ou le profil. Présente toute nouvelle création comme une idée facultative à produire par le parent.\n'+
        '- Ne recommande aucun concours, défi participatif, collecte de dessins/photos/vidéos, contenu de fans ou UGC impliquant des enfants. Ne demande jamais à l’enfant de se filmer ni de montrer son domicile, son école, ses proches, ses habitudes ou ses coulisses personnelles. Privilégie les visuels d’illustration, animations, pochettes, paroles et plans d’instruments réalisés et contrôlés par le parent.\n'+
        'FORMAT DE SORTIE (en français, Markdown lisible) :\n'+
        'A. SYNTHÈSE EN 3 LIGNES : période exacte, vues, heures regardées, abonnés gagnés/perdus/net.\n'+
        'B. FAITS MESURÉS : tableau avec indicateur, valeur et ce que la donnée permet réellement de dire.\n'+
        'C. INTERPRÉTATIONS À TESTER : au maximum 3 hypothèses, chacune accompagnée de la donnée qui pourrait la confirmer.\n'+
        'D. DONNÉES MANQUANTES : liste précise des métriques nécessaires pour mieux décider (ex. impressions/CTR, rétention, sources de trafic), sans prétendre les connaître.\n'+
        'E. 3 ACTIONS PRIORITAIRES : pour chacune, objectif, justification fondée sur les données, étapes pratiques, effort (faible/moyen/élevé), indicateur à surveiller. Classe-les par priorité et commence par les actions gratuites et sûres.\n'+
        'F. 3 IDÉES DE CONTENUS : adaptées à la pop enfantine et aux familles, avec format, durée indicative, angle créatif et appel à l’action destiné aux parents/familles.\n'+
        'G. MINI-PLAN SUR 7 JOURS : tâches réalistes côté parent/manager, sans obligation de publier chaque jour.\n'+
        'H. VALIDATION PARENTALE : rappelle clairement qu’aucune action publique ne sera effectuée sans accord du parent.\n'+
        'Évite les recommandations génériques ou risquées. N’invente pas de playlist déjà créée, de campagne existante ou de partenariat. Si les données sont insuffisantes pour une recommandation, dis-le.\n\nDONNÉES MESURÉES (source : YouTube Analytics) :\n'+JSON.stringify(snapshot);
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+sessionData.session.access_token},
        body:JSON.stringify({task,profile:profile||{artist_name:'NURIA DOLL',genre:'Pop enfantine',target_audience:'Enfants et familles'}})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.answer)throw new Error([payload.error||'La génération IA a échoué.',payload.diagnostic||'',payload.fallback_diagnostic||''].filter(Boolean).join(' — '));
      const row={owner_id:user.id,range_days:range,start_date:data.start_date,end_date:data.end_date,source:manual?'manual':'automatic',recommendation:payload.answer,provider:payload.provider||'unknown',analytics_snapshot:snapshot};
      const {data:saved,error:saveError}=await supabase.from('ai_marketing_recommendations').insert(row).select('id,range_days,end_date,source,recommendation,provider,created_at').single();
      if(saveError)throw new Error('Impossible de sauvegarder la recommandation : '+saveError.message+'. Vérifie la migration SQL.');
      displayYoutubeRecommendation(saved);
      if(status)status.textContent=(manual?'Nouvelle analyse terminée':'Analyse automatique terminée')+' · '+(payload.fallback_used?'Cloudflare AI':'Groq')+' · À valider par le parent.';
      await loadYoutubeRecommendationHistory();
    }catch(error){
      if(status)status.textContent=error.message||'Analyse des recommandations impossible.';
      if(manual)toast(error.message||'Analyse impossible.',true);
    }finally{
      recommendationBusy.delete(jobKey);
      if(manual&&button){button.disabled=false;button.textContent='Générer mes recommandations';}
    }
  }
  async function loadYoutubeAnalytics(range=30){
    const status=$('#youtubeAnalyticsStatus'),buttonSet=$$('#youtubeAnalyticsRanges button');
    buttonSet.forEach(b=>{b.disabled=true;b.classList.toggle('active',Number(b.dataset.range)===range);});
    status.textContent='Chargement des statistiques YouTube…';
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const r=await fetch('/api/youtube/analytics?range='+range,{headers:{authorization:'Bearer '+session.access_token}});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Lecture des statistiques impossible.');
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
    }catch(e){status.textContent='Statistiques indisponibles : '+e.message;toast(e.message,true);}
    finally{buttonSet.forEach(b=>b.disabled=false);}
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
      if(d.connected){await loadYoutubeChannel();await loadYoutubeAnalytics(30);}else $('#youtubeChannelPanel')?.classList.add('hidden');
    }catch(e){box.textContent='Statut indisponible : '+e.message;}
  }
  $('#refreshYoutube').addEventListener('click',loadYoutubeChannel);
  $$('#youtubeAnalyticsRanges button').forEach(b=>b.addEventListener('click',()=>loadYoutubeAnalytics(Number(b.dataset.range))));
  $('#generateYtRecommendations').addEventListener('click',()=>{if(latestYoutubeAnalytics)generateYoutubeRecommendations(latestYoutubeAnalytics,Number(latestYoutubeAnalytics.range||30),true);else $('#ytRecommendationStatus').textContent='Charge d’abord les statistiques YouTube.';});
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
