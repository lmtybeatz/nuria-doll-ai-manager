// Cloudflare Pages Function — Gemini backend for NURIA DOLL AI MANAGER.
// Secrets are read only from Cloudflare environment variables. Never expose them to the browser.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return json({ error: "Configuration serveur incomplète." }, 500);
  }

  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return json({ error: "Connexion requise." }, 401);

  // Verify the Supabase access token with Supabase Auth. A publishable key is sufficient;
  // no service-role or secret key is used, so database RLS remains in force.
  let authResponse;
  try {
    authResponse = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: "Bearer " + tokenMatch[1]
      }
    });
  } catch {
    return json({ error: "Vérification de la connexion impossible." }, 502);
  }
  if (!authResponse.ok) return json({ error: "Session expirée ou invalide. Reconnecte-toi." }, 401);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Demande trop volumineuse." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Format de demande invalide." }, 400);
  }

  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task) return json({ error: "Décris ce que tu souhaites préparer." }, 400);
  if (task.length > 5000) return json({ error: "La demande est trop longue (5 000 caractères maximum)." }, 400);

  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const safeProfile = {
    artist_name: String(profile.artist_name || "NURIA DOLL").slice(0, 80),
    genre: String(profile.genre || "Pop enfantine").slice(0, 160),
    bio: String(profile.bio || "").slice(0, 700),
    target_audience: String(profile.target_audience || "Enfants et familles").slice(0, 200),
    language: String(profile.language || "Français").slice(0, 40),
    tone: String(profile.tone || "Joyeux, bienveillant, créatif et familial").slice(0, 300),
    parent_guardrails: String(profile.parent_guardrails || "").slice(0, 1000)
  };

  const systemInstruction = `Tu es l'assistant marketing éditorial de NURIA DOLL. Tu aides le parent/manager à préparer des idées, calendriers, légendes, hashtags et campagnes pour un projet musical familial. Réponds en français sauf demande explicite contraire. Sois concret, structuré, adapté aux enfants et aux familles. N'invente jamais de faits, chiffres, partenariats ou résultats. Respecte strictement les consignes parentales fournies. Ne demande et ne révèle jamais l'adresse, l'école, les horaires, la localisation en temps réel, les coordonnées privées ou autres données personnelles de l'enfant. Ne propose pas de conversation privée entre l'enfant et des inconnus. Ne publie, n'envoie, ne commente et ne contacte personne : tu ne fais que préparer des brouillons pour validation par le parent. Si la demande concerne une rencontre, un message privé, une proposition commerciale ou une situation sensible, conseille de la transmettre au parent sans répondre directement.`;

  const prompt = "IDENTITÉ ARTISTIQUE (informations de marque uniquement)\n" +
    JSON.stringify(safeProfile) + "\n\nDEMANDE DU PARENT / MANAGER\n" + task;

  let aiResponse;
  try {
    aiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          system_instruction: systemInstruction,
          input: prompt,
          store: false
        })
      }
    );
  } catch {
    return json({ error: "Le service IA est momentanément inaccessible." }, 502);
  }

  const result = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) {
    // Return a limited diagnostic from Google, never the API key or request headers.
    const providerMessage = typeof result?.error?.message === "string"
      ? result.error.message.slice(0, 500)
      : "Aucun détail fourni par Google.";
    const status = aiResponse.status === 429 ? 429 : 502;
    return json({
      error: status === 429
        ? "La limite temporaire de Gemini est atteinte. Réessaie plus tard."
        : "Gemini a refusé la requête (HTTP " + aiResponse.status + ").",
      diagnostic: providerMessage
    }, status);
  }

  const answer = (typeof result.output_text === "string" ? result.output_text :
    (result.steps || []).filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(part => part.type === "text")
      .map(part => part.text || "")
      .join("\n")).trim();
  if (!answer) return json({ error: "Aucune réponse exploitable n'a été générée." }, 502);

  return json({ answer, approval_required: true });
}
