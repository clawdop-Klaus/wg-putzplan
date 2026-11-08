/**
 * WG-Putzplan – Sync-Server (Cloudflare Worker + R2)
 *
 * Speichert den verschlüsselten Plan je WG.
 * - Der Client schickt als "Authorization: Bearer <hash>" einen SHA-256-Hash des WG-Schlüssels.
 * - Der R2-Key leitet sich daraus ab: niemand ohne passenden Hash kommt an den Plan.
 * - Der Inhalt ist Ende-zu-Ende verschlüsselt (AES-GCM im Browser) – der Server sieht nur Chiffretext.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'wg-putzplan-sync', time: Date.now() });
    }

    if (url.pathname !== '/plan') return json({ error: 'not found' }, 404);

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'unauthorized' }, 401);

    const key = 'plan-' + token;

    try {
      if (request.method === 'GET') {
        const obj = await env.PLANS.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        return new Response(obj.body, {
          status: 200,
          headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
        });
      }

      if (request.method === 'PUT') {
        const text = await request.text();
        if (text.length > 1000000) return json({ error: 'too large' }, 413);
        let payload;
        try { payload = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
        payload.savedAt = Date.now();
        await env.PLANS.put(key, JSON.stringify(payload));
        return json({ ok: true, savedAt: payload.savedAt });
      }

      return json({ error: 'method not allowed' }, 405);
    } catch (e) {
      return json({ error: 'server error', detail: String(e && e.message || e) }, 500);
    }
  }
};
