// Cloudflare Pages Function — endpoint de santé public sans donnée sensible.
export async function onRequestGet() {
  return new Response(JSON.stringify({
    application: 'NURIA DOLL AI MANAGER',
    status: 'ok',
    phase: 1,
    automations_enabled: false
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
