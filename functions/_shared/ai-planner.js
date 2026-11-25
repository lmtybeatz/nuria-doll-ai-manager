// Shared planning layer for the private AI Music Manager.
// Classifies requests; it does not execute tools or external actions.
const SKILLS = [
  { key:"music",label:"expertise musicale",terms:/composition|arrangement|beat|instrumental|production musicale|mixage|mastering|genre|direction artistique|sonor/i },
  { key:"marketing",label:"marketing musical",terms:/marketing|promotion|campagne|sortie|single|album|publicité|audience|réseaux sociaux|playlist|radio|presse/i },
  { key:"business",label:"industrie musicale et business",terms:/contrat|édition|éditeur|droit d'auteur|sacem|royalt|distribution|label|licence|cession|synchronisation|management/i },
  { key:"career",label:"développement de carrière",terms:/carrière|développer|positionnement|partenariat|booking|concert|festival|professionnalis/i },
  { key:"creative",label:"communication et création",terms:/biographie|communiqué|storytelling|visuel|clip|concept|légende|caption|affiche|contenu/i },
  { key:"analytics",label:"analyse et stratégie",terms:/analyse|statistique|performance|concurrence|marché|budget|rentabilité|indicateur|kpi|diagnostic/i }
];
const SENSITIVE_ACTION=/\b(publier|publication|envoyer|contacter|répondre à|commenter|supprimer|effacer|acheter|payer|dépenser|lancer une publicité|modifier les accès|partager publiquement)\b/i;
const HIGH_STAKES=/\b(contrat|juridique|litige|droit d'auteur|cession|exclusivité|royalt|fiscal|impôt|investissement|budget publicitaire|dépense)\b/i;
const CURRENT_INFO=/\b(actuellement|aujourd'hui|cette année|dernier|dernière|récent|tarif|prix|réglementation|éligible|disponible|appel à projets|date limite|radio|média|label|playlist)\b/i;

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
    executionMode:"prepare_only",
    canExecuteExternalAction:false
  };
}

export function buildExpertInstructions(plan){
  return [
    "Tu es le moteur expert privé d'AI Music Manager, un conseiller professionnel spécialisé dans la musique et le développement d'artistes.",
    "Compétences à mobiliser : "+plan.skills.join(", ")+".",
    "Comprends l'objectif, le contexte et les contraintes. Si une information indispensable manque, indique ce qui manque ou pose une question ciblée.",
    "Fournis un diagnostic, des options comparées si utile, une recommandation motivée et des étapes concrètes et réalistes.",
    "Distingue faits fournis, hypothèses, estimations et recommandations. N'invente jamais chiffres, sources, contacts, résultats, partenariats ou règles.",
    "Pour les sujets juridiques, contractuels, fiscaux ou financiers, donne une explication générale, signale les limites et recommande une vérification professionnelle lorsque nécessaire.",
    plan.requiresCurrentVerification
      ?"Cette demande peut dépendre d'informations récentes. Aucune recherche Internet n'a été effectuée dans cette requête : signale les éléments à vérifier et ne prétends pas les avoir consultés."
      :"Si la réponse dépend de faits récents non fournis, indique qu'une vérification à jour est nécessaire.",
    plan.riskLevel==="sensitive_action"
      ?"La demande évoque une action externe sensible. Prépare uniquement un brouillon ou une procédure ; aucune publication, prise de contact, dépense, suppression ou modification externe n'est autorisée."
      :"Tu peux préparer des contenus et des plans, mais aucune action externe n'est autorisée dans cette phase.",
    "Réponds en français sauf demande contraire. Sois précis, utile, structuré et proportionné."
  ].join("\n");
}
