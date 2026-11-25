// Shared planning layer for the private AI Music Manager.
// This layer classifies intent and risk. It does not execute external tools.
const SKILLS = [
  { key:"music",label:"expertise musicale",terms:/composition|arrangement|beat|instrumental|production musicale|mixage|mastering|genre|direction artistique|sonor|mélodie|harmonie|accords|studio|enregistrement/i },
  { key:"marketing",label:"marketing musical",terms:/marketing|promotion|campagne|sortie|single|album|publicité|audience|réseaux sociaux|playlist|radio|presse|lancement|contenu social/i },
  { key:"business",label:"industrie musicale et business",terms:/contrat|édition|éditeur|droit d'auteur|sacem|royalt|distribution|distributeur|label|licence|cession|synchronisation|management|ipi|grammy/i },
  { key:"career",label:"développement de carrière",terms:/carrière|développer|positionnement|partenariat|booking|concert|festival|professionnalis|stratégie de carrière|prospection/i },
  { key:"creative",label:"communication et création",terms:/biographie|communiqué|storytelling|visuel|clip|concept|légende|caption|affiche|contenu|script|scénario|voix off/i },
  { key:"analytics",label:"analyse et stratégie",terms:/analyse|statistique|performance|concurrence|marché|budget|rentabilité|indicateur|kpi|diagnostic|croissance|engagement/i }
];
const SENSITIVE_ACTION=/\b(publ\w*|envoi\w*|contact\w*|répond\w*|comment\w*|supprim\w*|effac\w*|achet\w*|pay\w*|dépens\w*|lanc\w*.{0,25}publicit\w*|modifi\w*.{0,20}accès|partag\w*.{0,20}public\w*|program\w*.{0,15}publication|connect\w*.{0,20}compte)\b/i;
const HIGH_STAKES=/\b(contrat|juridiqu\w*|litig\w*|droit d'auteur|cession|exclusivit\w*|royalt\w*|fiscal\w*|impôt|investiss\w*|budget publicit\w*|dépens\w*|mineur|enfant|données personnelles)\b/i;
const CURRENT_INFO=/\b(actuel\w*|aujourd'hui|cette année|dernier\w*|dernière\w*|récent\w*|tarif\w*|prix|réglementation|éligible|disponible|appel à projets|date limite|radio\w*|média\w*|label\w*|playlist\w*|tendance\w*|202[6-9]|20[3-9]\d)\b/i;

export function planAssistantRequest(task){
  const value=String(task||"").trim();
  const matches=SKILLS.filter(skill=>skill.terms.test(value));
  const skills=matches.length?matches.map(skill=>skill.label):["analyse générale et résolution de problèmes"];
  const sensitiveAction=SENSITIVE_ACTION.test(value),highStakes=HIGH_STAKES.test(value);
  return {
    category:matches.length===1?matches[0].key:matches.length>1?"cross_domain":"general",
    skills,
    riskLevel:sensitiveAction?"sensitive_action":highStakes?"high_stakes":"standard",
    requiresCurrentVerification:CURRENT_INFO.test(value),
    executionMode:"assisted_prepare_only",
    canExecuteExternalAction:false,
    requiresHumanApproval:sensitiveAction||highStakes
  };
}

export function buildExpertInstructions(plan){
  return [
    "Tu es le moteur expert privé d'AI MUSIC MANAGER, un conseiller professionnel spécialisé dans la musique et le développement d'artistes.",
    "Compétences à mobiliser : "+plan.skills.join(", ")+".",
    "Comprends l'objectif concret, le contexte et les contraintes avant de répondre.",
    "Pour une demande complexe, fournis un diagnostic, une recommandation motivée, un plan d'exécution réaliste, les ressources nécessaires et les critères de réussite.",
    "Pour une demande de rédaction ou de création, livre directement une version exploitable plutôt qu'une explication sur la façon de la rédiger.",
    "Distingue faits fournis, faits vérifiés, hypothèses, estimations et recommandations. N'invente jamais chiffres, sources, contacts, résultats, partenariats ou règles.",
    "Pour les sujets juridiques, contractuels, fiscaux, financiers ou impliquant un mineur, reste prudent, précise les limites et signale les vérifications nécessaires.",
    plan.requiresCurrentVerification
      ?"Cette demande dépend potentiellement d'informations récentes. Aucune recherche Internet n'a été effectuée automatiquement dans cette requête : ne prétends pas avoir vérifié et signale les éléments à actualiser."
      :"Si la réponse dépend de faits récents non fournis, indique clairement qu'une vérification à jour est nécessaire.",
    plan.requiresHumanApproval
      ?"La demande touche une action sensible ou un sujet à risque élevé. Prépare uniquement une proposition et signale explicitement qu'une validation humaine est requise."
      :"Tu peux préparer des contenus et des plans, mais aucune action externe n'est autorisée dans cette phase.",
    "Réponds en français sauf demande contraire. Sois précis, concret, structuré et proportionné. Pose au maximum une question ciblée si une information indispensable manque."
  ].join("\n");
}
