// Cloudflare Pages Function — Groq primary + Cloudflare Workers AI fallback.
// Secrets are server-side only. Supabase publishable key is used only to verify the user's session.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function verifySession(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return { error: json({ error: "Connexion requise." }, 401) };
  try {
    const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: "Bearer " + tokenMatch[1]
      }
    });
    if (!response.ok) return { error: json({ error: "Session expirée ou invalide. Reconnecte-toi." }, 401) };
    return { user: await response.json() };
  } catch {
    return { error: json({ error: "Vérification de la connexion impossible." }, 502) };
  }
}

function makePrompt(task, profile) {
  const safeProfile = {
    artist_name: String(profile.artist_name || "NURIA DOLL").slice(0, 80),
    genre: String(profile.genre || "Pop enfantine").slice(0, 160),
    bio: String(profile.bio || "").slice(0, 700),
    target_audience: String(profile.target_audience || "Enfants et familles").slice(0, 200),
    language: String(profile.language || "Français").slice(0, 40),
    tone: String(profile.tone || "Joyeux, bienveillant, créatif et familial").slice(0, 300),
    parent_guardrails: String(profile.parent_guardrails || "").slice(0, 1000)
  };

  const system = `Tu es l'assistant IA de stratégie, recherche préparatoire et communication du projet musical identifié dans le PROFIL ARTISTIQUE fourni. Tu travailles pour le parent/manager, jamais directement pour l'enfant. Utilise systématiquement le nom, le genre, la biographie, le public, la langue, le ton et les consignes du profil actif : ne remplace jamais un autre artiste par NURIA DOLL et ne mélange jamais les identités de plusieurs artistes.

RÈGLES DE FIABILITÉ :
- Réponds en français sauf demande explicite contraire. Sois précis, structuré et adapté au public cible du profil.
- Distingue clairement les faits fournis, les déductions et les suggestions. N'invente jamais de noms, chiffres, dates, sources, crédits, partenariats, contacts, statistiques ou résultats.
- Tu ne disposes pas d'un accès direct au Web, aux moteurs de recherche ni aux réseaux sociaux dans cette requête. Ne prétends donc jamais avoir effectué une recherche en direct, vérifié un compte, consulté une page ou confirmé une information externe.
- Pour une demande d'identification ou de recherche sur une personne, un artiste, un média, une radio, un label ou une entreprise, exploite les critères fournis un par un. Si les éléments ne permettent pas une identification fiable, dis-le explicitement, explique ce qui manque et pose une seule question de clarification ciblée au lieu de produire une liste vague.
- Quand des informations vérifiables sont nécessaires mais absentes, demande des liens, documents ou résultats de recherche à analyser. Ne transforme jamais une hypothèse en certitude.
- Donne des recommandations concrètes, liées au profil actif et à l'objectif demandé. Évite les conseils génériques et indique les limites de tes données.
- Respecte strictement les consignes parentales. Ne demande et ne révèle jamais l'adresse, l'école, les horaires, la localisation en temps réel, les coordonnées privées ou autres données personnelles de l'enfant. Ne propose pas de conversation privée entre l'enfant et des inconnus.
- Ne publie, n'envoie, ne commente et ne contacte personne : tu prépares uniquement des brouillons pour validation par le parent. Toute rencontre, message privé, proposition commerciale ou situation sensible doit être transmise au parent.`;

  const user = "ARTISTE ACTIF : " + safeProfile.artist_name + "\n" +
    "IDENTITÉ ARTISTIQUE (informations de marque uniquement)\n" + JSON.stringify(safeProfile) +
    "\n\nDEMANDE DU PARENT / MANAGER\n" + task +
    "\n\nConsigne finale : réponds uniquement pour l'artiste actif ci-dessus. Si la demande exige une recherche externe en direct, indique clairement que cet accès n'est pas disponible dans cette requête et ne fabrique aucun résultat.";
  return { system, user };
}

async function askGroq(env, system, user) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.GROQ_API_KEY
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_completion_tokens: 3000
    }),
    signal: AbortSignal.timeout(18000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "Groq HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Groq n'a retourné aucun texte.");
  return answer.trim();
}

async function askCloudflare(env, system, user) {
  if (!env.AI || typeof env.AI.run !== "function") throw new Error("La liaison Cloudflare Workers AI (AI) est absente.");
  const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: 3000
  });
  const answer = typeof result === "string" ? result :
    typeof result?.response === "string" ? result.response :
    typeof result?.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : "";
  if (!answer.trim()) throw new Error("Cloudflare Workers AI n'a retourné aucun texte.");
  return answer.trim();
}

export async function onRequestPost({ request, env }) {
  if (!env.GROQ_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.AI) {
    return json({ error: "Configuration serveur incomplète. Vérifie GROQ_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et la liaison Workers AI nommée AI." }, 500);
  }

  const session = await verifySession(request, env);
  if (session.error) return session.error;

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 30000) return json({ error: "Demande trop volumineuse (30 000 caractères maximum)." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Format de demande invalide." }, 400);
  }

  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task) return json({ error: "Décris ce que tu souhaites préparer." }, 400);
  if (task.length > 20000) return json({ error: "La demande est trop longue (20 000 caractères maximum)." }, 400);

  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const { system, user } = makePrompt(task, profile);

  // Temporary controlled test: FORCE_AI_FALLBACK=true skips Groq and tests Cloudflare Workers AI.
  if (String(env.FORCE_AI_FALLBACK || "").toLowerCase() === "true") {
    try {
      const answer = await askCloudflare(env, system, user);
      return json({
        answer,
        provider: "cloudflare_workers_ai",
        model: "@cf/zai-org/glm-4.7-flash",
        status: "completed",
        fallback_used: true,
        forced_test: true,
        approval_required: true
      });
    } catch (fallbackError) {
      return json({
        error: "Le test du moteur de secours Cloudflare AI a échoué.",
        fallback_diagnostic: "Cloudflare AI : " + String(fallbackError?.message || "erreur inconnue").slice(0, 300)
      }, 502);
    }
  }

  // Primary provider: Groq. Any provider/network/quota failure triggers the Cloudflare fallback.
  try {
    const answer = await askGroq(env, system, user);
    return json({ answer, provider: "groq", model: "openai/gpt-oss-120b", status: "completed", approval_required: true });
  } catch (groqError) {
    try {
      const answer = await askCloudflare(env, system, user);
      return json({
        answer,
        provider: "cloudflare_workers_ai",
        model: "@cf/zai-org/glm-4.7-flash",
        status: "completed",
        fallback_used: true,
        approval_required: true
      });
    } catch (fallbackError) {
      return json({
        error: "Les deux moteurs IA sont momentanément indisponibles.",
        diagnostic: "Groq : " + String(groqError?.message || "erreur inconnue").slice(0, 300),
        fallback_diagnostic: "Cloudflare AI : " + String(fallbackError?.message || "erreur inconnue").slice(0, 300)
      }, 502);
    }
  }
}
