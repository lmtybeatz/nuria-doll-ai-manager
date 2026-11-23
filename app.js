(() => {
  const cfg = window.NURIA_AI_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, user = null, signupMode = false, profile = null, settings = null, media = [];
  const toast = (msg, bad=false) => { const el=$('#toast'); el.textContent=msg; el.className='toast show'+(bad?' error':''); setTimeout(()=>el.className='toast',3600); };
  const show = (el) => el.classList.remove('hidden'); const hide = (el) => el.classList.add('hidden');
  function setupMessage() {
    const n=$('#setupNotice'); n.innerHTML='<strong>Configuration nécessaire.</strong> Crée un nouveau projet Supabase, exécute <code>supabase/schema.sql</code>, puis renseigne son URL et sa clé publique dans <code>config.js</code>. Aucun secret privé ne doit être placé dans ce fichier.'; show(n); show($('#authScreen'));
    $('#authTitle').textContent='Configuration requise'; $('#authSubtitle').textContent='L’interface est prête. Connecte d’abord ton nouveau projet Supabase.'; $('#authForm').classList.add('disabled-form'); $('#authSubmit').disabled=true;
  }
  function nav(view) {
    $$('.view').forEach(v=>v.classList.toggle('active-view',v.id===`view-${view}`));
    $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const names={overview:"Vue d'ensemble",brand:'Identité artistique',library:'Bibliothèque média',agent:'Configuration IA',connections:'Réseaux sociaux'};
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
  async function enterApp(){ hide($('#authScreen')); show($('#appShell')); $('#userEmail').textContent=user.email||'Compte connecté'; await Promise.all([loadProfile(),loadSettings(),loadMedia()]); }
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
    submit.disabled=true;submit.textContent='Préparation en cours…';status.textContent='Gemini prépare une proposition…';hide(result);
    try{
      const {data:{session},error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!session?.access_token)throw new Error('Session expirée. Reconnecte-toi.');
      const currentProfile=profile||Object.fromEntries(new FormData($('#brandForm')).entries());
      const response=await fetch('/api/assistant',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},
        body:JSON.stringify({task,profile:currentProfile})
      });
      let payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error([payload.error||'Le service IA n’a pas répondu correctement.',payload.diagnostic||''].filter(Boolean).join(' — '));
      // Gemini background generation: poll securely until the interaction completes.
      if(payload.id){
        const interactionId=payload.id;
        status.textContent='Gemini travaille en arrière-plan…';
        let completed=false;
        for(let attempt=0;attempt<120;attempt++){
          await new Promise(resolve=>setTimeout(resolve,5000));
          const check=await fetch('/api/assistant?id='+encodeURIComponent(interactionId),{
            headers:{'authorization':'Bearer '+session.access_token}
          });
          payload=await check.json().catch(()=>({}));
          if(!check.ok)throw new Error([payload.error||'Impossible de récupérer la proposition.',payload.diagnostic||''].filter(Boolean).join(' — '));
          if(payload.status==='completed'){completed=true;break;}
          status.textContent='Gemini prépare toujours la proposition… ('+Math.round((attempt+1)*5/60)+' min écoulées)';
        }
        if(!completed)throw new Error('Gemini n’a pas terminé après 10 minutes. La génération peut être encore en cours ; réessaie plus tard.');
      }
      answer.textContent=payload.answer||'Aucune proposition reçue.';
      show(result);status.textContent='Proposition générée. Vérifie-la avant toute utilisation.';
    }catch(err){status.textContent=err.message||'Une erreur est survenue.';toast(status.textContent,true);}
    finally{submit.disabled=false;submit.innerHTML='Générer une proposition <span>→</span>';}
  });
  Array.from(document.querySelectorAll('[data-prompt]')).forEach(button=>button.addEventListener('click',()=>{$('#assistantTask').value=button.dataset.prompt;$('#assistantTask').focus();}));
  $('#copyAssistant').addEventListener('click',async()=>{
    const value=$('#assistantAnswer').textContent;
    try{await navigator.clipboard.writeText(value);toast('Brouillon copié.');}
    catch{toast('Copie indisponible sur ce navigateur.',true);}
  });
  $('#mediaInput').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;for(const file of files){if(file.size>100*1024*1024){toast(`${file.name} dépasse la limite de 100 Mo.`,true);continue;}const safe=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${user.id}/${crypto.randomUUID()}-${safe}`;$('#uploadStatus').textContent=`Envoi de ${file.name}…`;const {error:upErr}=await supabase.storage.from('nuria-private-media').upload(path,file,{contentType:file.type,upsert:false});if(upErr){toast(`Échec de ${file.name} : ${upErr.message}`,true);continue;}const category=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';const {error:dbErr}=await supabase.from('ai_media_library').insert({owner_id:user.id,file_name:file.name,storage_path:path,mime_type:file.type,file_size:file.size,category});if(dbErr){await supabase.storage.from('nuria-private-media').remove([path]);toast(`Erreur d'enregistrement : ${dbErr.message}`,true);continue;}toast(`${file.name} ajouté.`);}$('#uploadStatus').textContent='';e.target.value='';await loadMedia();});
  init();
})();
