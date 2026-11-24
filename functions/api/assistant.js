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

  const system = `Tu es l'assistant marketing éditorial de ${safeProfile.artist_name}. Tu aides le parent/manager à préparer des idées, calendriers, légendes, hashtags et campagnes pour le projet musical de cet artiste. Réponds en français sauf demande explicite contraire. Sois concret, structuré, adapté aux enfants et aux familles. N'invente jamais de faits, chiffres, partenariats ou résultats. Respecte strictement les consignes parentales fournies. Ne demande et ne révèle jamais l'adresse, l'école, les horaires, la localisation en temps réel, les coordonnées privées ou autres données personnelles de l'enfant. Ne propose pas de conversation privée entre l'enfant et des inconnus. Ne publie, n'envoie, ne commente et ne contacte personne : tu ne fais que préparer des brouillons pour validation par le parent. Si la demande concerne une rencontre, un message privé, une proposition commerciale ou une situation sensible, conseille de la transmettre au parent sans répondre directement.`;

  const user = "IDENTITÉ ARTISTIQUE (informations de marque uniquement)\n" +
    JSON.stringify(safeProfile) + "\n\nDEMANDE DU PARENT / MANAGER\n" + task;
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
