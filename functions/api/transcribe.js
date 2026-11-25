// Cloudflare Pages Function — ephemeral voice-note transcription through Groq Whisper.
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
export async function onRequestPost({request,env}){
  if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return json({error:"Configuration Supabase incomplète."},500);
  if(!env.GROQ_API_KEY)return json({error:"La transcription vocale nécessite une clé GROQ_API_KEY active."},503);
  const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
  if(!match)return json({error:"Connexion requise."},401);
  try{
    const auth=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:"Bearer "+match[1]}});
    if(!auth.ok)return json({error:"Session expirée ou invalide. Reconnecte-toi."},401);
    const user=await auth.json();if(!user?.id)return json({error:"Identité utilisateur invalide."},401);
  }catch{return json({error:"Vérification de la connexion impossible."},502);}
  const declared=Number(request.headers.get("content-length")||0);if(declared>25*1024*1024)return json({error:"La note vocale dépasse 25 Mo."},413);
  let incoming;try{incoming=await request.formData();}catch{return json({error:"Fichier audio invalide."},400);}
  const file=incoming.get("file");
  if(!file||typeof file.arrayBuffer!=="function"||!file.size)return json({error:"Aucun enregistrement audio reçu."},400);
  if(file.size>24*1024*1024)return json({error:"La note vocale dépasse 24 Mo."},413);
  const allowed=/^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav|flac|mp3))(?:;.*)?$/i;
  if(file.type&&!allowed.test(file.type))return json({error:"Format audio non pris en charge. Utilise WebM, OGG, MP4, WAV ou MP3."},415);
  try{
    const form=new FormData();form.set("file",file,file.name||"voice-note.webm");form.set("model","whisper-large-v3-turbo");form.set("response_format","json");form.set("prompt","Transcris fidèlement dans la langue parlée. Conserve les noms propres et le vocabulaire de la musique et du marketing.");
    const response=await fetch("https://api.groq.com/openai/v1/audio/transcriptions",{method:"POST",headers:{authorization:"Bearer "+env.GROQ_API_KEY},body:form,signal:AbortSignal.timeout(45000)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)return json({error:"La transcription Groq a échoué : "+String(payload?.error?.message||"HTTP "+response.status).slice(0,220)},502);
    const text=typeof payload.text==="string"?payload.text.trim():"";
    if(!text)return json({error:"Aucune parole claire n’a été détectée dans cet enregistrement."},422);
    return json({text,model:"whisper-large-v3-turbo",stored:false});
  }catch(error){return json({error:"Transcription indisponible : "+String(error?.message||"erreur réseau").slice(0,220)},502);}
}
