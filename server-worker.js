/**
 * WG-Putzplan – Sync-Server (Cloudflare Worker + R2) mit Web-Push
 *
 * Speichert den verschlüsselten Plan je WG und verschickt Push-Nachrichten.
 * - Der Client schickt als "Authorization: Bearer <hash>" einen SHA-256-Hash des WG-Schlüssels.
 * - Der R2-Key leitet sich daraus ab: niemand ohne passenden Hash kommt an den Plan.
 * - Der Inhalt ist Ende-zu-Ende verschlüsselt (AES-GCM im Browser) – der Server sieht nur Chiffretext.
 * - Push-Abos werden unter "push-<token>-<subId>" abgelegt; die Nachricht wird nach
 *   RFC 8291/8292 (aes128gcm) verschlüsselt und mit VAPID (ES256) signiert.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type'
};

const PUSH_PREFIX = 'push-';
const RECORD_SIZE = 4096;
const VAPID_SUBJECT = 'https://github.com/clawdop-Klaus/wg-putzplan';

const MSG = {
  changed: { title: 'WG-Putzplan', body: 'Der Putzplan wurde geändert – kurz reinschauen.', tag: 'wg-plan' },
  test: { title: 'WG-Putzplan', body: 'Testnachricht – Benachrichtigungen funktionieren.', tag: 'wg-test' },
  remind: { title: 'WG-Putzplan', body: 'Zeit für den Putzplan – was steht heute an?', tag: 'wg-remind' }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
  });
}

/* ---------- Basis64 (url-safe) ---------- */
function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBytes(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat() {
  const parts = Array.prototype.slice.call(arguments);
  let len = 0;
  for (let i = 0; i < parts.length; i++) len += parts[i].length;
  const out = new Uint8Array(len);
  let off = 0;
  for (let i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
  return out;
}
const SPKI_ECDH_P256_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
]);

/* ---------- Web Push: VAPID (ES256) ---------- */
async function vapidJwt(env, audience) {
  if (!env.VAPID_PRIVATE) throw new Error('VAPID_PRIVATE fehlt');
  const pkcs8 = b64uToBytes(env.VAPID_PRIVATE);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64u(new Uint8Array(sig));
}

/* ---------- Web Push: Verschlüsselung (RFC 8291 / RFC 8188) ---------- */
async function hmacSha256(rawKey, data) {
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}
async function importEcdhPublic(raw65) {
  return crypto.subtle.importKey(
    'spki', concat(SPKI_ECDH_P256_PREFIX, raw65), { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
}
async function encryptPush(subscription, plaintext, opts) {
  const enc = new TextEncoder();
  const authSecret = b64uToBytes(subscription.keys && subscription.keys.auth);
  const uaPublic = b64uToBytes(subscription.keys && subscription.keys.p256dh);
  if (authSecret.length < 8) throw new Error('ungültige Subscription (auth)');
  if (uaPublic.length !== 65) throw new Error('ungültige Subscription (p256dh)');

  // ECDH-Schlüsselpaar (P-256): im Betrieb ephemer, im Test vorgegeben
  let ephPriv, asPublic;
  if (opts && opts.privateKey) {
    ephPriv = await crypto.subtle.importKey('pkcs8', opts.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = opts.asPublic;
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    ephPriv = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  if (!asPublic || asPublic.length !== 65) throw new Error('Sender-Public-Key fehlt');
  const peer = await importEcdhPublic(uaPublic);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, ephPriv, 256));

  const salt = (opts && opts.salt) ? opts.salt : crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 Abschnitt 3.4: IKM aus ECDH- und Auth-Geheimnis, dann CEK/NONCE
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hmacSha256(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const data = enc.encode(plaintext);
  if (data.length + 17 > RECORD_SIZE) throw new Error('Nachricht zu lang');
  const plain = concat(data, new Uint8Array([0x02]));   // Padding-Delimiter des letzten Records
  // RFC 8188 Abschnitt 2: die zusätzlichen Daten sind eine Folge der Länge 0.
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plain
  ));

  // Kopf nach RFC 8188 Abschnitt 2.1: salt(16) | rs(4) | idlen(1) | keyid
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/* ---------- Push senden ---------- */
function pushHeaders(endpoint, jwt) {
  const host = (new URL(endpoint)).host;
  const h = {
    'Authorization': 'vapid t=' + jwt.split('.')[0] + ', k=' + jwt.split('.')[2],
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'TTL': '86400'
  };
  if (host.indexOf('apple') !== -1) {
    h['apns-topic'] = 'web.push.apple.com';
    h['apns-push-type'] = 'alert';
    h['apns-priority'] = '10';
    h['apns-expiration'] = String(Math.floor(Date.now() / 1000) + 3600);
    h['apns-id'] = b64u(crypto.getRandomValues(new Uint8Array(16)));
  } else if (host.indexOf('fcm.googleapis.com') !== -1) {
    h['Topic'] = 'wg-putzplan';
  }
  return h;
}
async function sendPush(env, sub, payloadObj) {
  const endpoint = sub.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) throw new Error('ungültiger Push-Endpunkt');
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const body = await encryptPush(sub, JSON.stringify(payloadObj));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: pushHeaders(endpoint, jwt),
    body: body
  });
  if (res.status === 404 || res.status === 410) {
    const e = new Error('abo ungültig (' + res.status + ')');
    e.gone = true;
    throw e;
  }
  if (!res.ok) {
    const txt = await res.text().catch(function () { return ''; });
    throw new Error('Push-Server antwortet mit ' + res.status + ' ' + txt.slice(0, 120));
  }
  return true;
}

/* ---------- Abos speichern ---------- */
async function subIdOf(endpoint) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const hex = Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  return hex.slice(0, 32);
}
// Abos liegen in einem Objekt je WG: R2-Listen-Ergebnisse tragen keinen Inhalt,
// daher wird der Inhalt immer über get() gelesen.
function pushPlanKey(token) { return PUSH_PREFIX + token; }
async function loadSubs(env, token) {
  const obj = await env.PLANS.get(pushPlanKey(token));
  if (!obj) return [];
  try {
    const data = JSON.parse(await obj.text());
    return (data && Array.isArray(data.subs)) ? data.subs : [];
  } catch (e) { return []; }
}
async function saveSubs(env, token, subs) {
  await env.PLANS.put(pushPlanKey(token), JSON.stringify({ subs: subs, updatedAt: Date.now() }));
}
async function notifyPlan(env, token, excludeDevice, payloadObj) {
  const subs = await loadSubs(env, token);
  let sent = 0, removed = 0, failed = 0;
  const keep = [];
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    if (excludeDevice && s.dev && s.dev === excludeDevice) { keep.push(s); continue; }
    try {
      await sendPush(env, s, payloadObj);
      sent++;
      keep.push(s);
    } catch (e) {
      failed++;
      if (!e || !e.gone) keep.push(s);   // nur unbrauchbare Abos werden entfernt
      else removed++;
    }
  }
  if (removed) { try { await saveSubs(env, token, keep); } catch (x) { /* egal */ } }
  return { sent: sent, failed: failed, removed: removed, total: subs.length };
}

function tokenFrom(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return json({
        ok: true,
        service: 'wg-putzplan-sync',
        time: Date.now(),
        push: !!(env.VAPID_PRIVATE && env.VAPID_PUBLIC),
        vapidPublic: env.VAPID_PUBLIC || null
      });
    }

    /* ---------- Push: öffentlicher VAPID-Schlüssel ---------- */
    if (path === '/push/key') {
      if (!env.VAPID_PUBLIC) return json({ error: 'push not configured' }, 503);
      return json({ publicKey: env.VAPID_PUBLIC });
    }

    /* ---------- Plan ---------- */
    if (path === '/plan') {
      const token = tokenFrom(request);
      if (!token) return json({ error: 'unauthorized' }, 401);
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

          const prev = await env.PLANS.get(key);
          let prevCid = '';
          if (prev) { try { prevCid = (JSON.parse(prev.body).cid) || ''; } catch (e) { prevCid = ''; } }

          payload.savedAt = Date.now();
          await env.PLANS.put(key, JSON.stringify(payload));

          // Änderung erkannt -> andere Geräte benachrichtigen
          const cid = payload.cid || '';
          if (cid && cid !== prevCid) {
            const device = payload.dev || '';
            const work = notifyPlan(env, token, device, MSG.changed);
            if (ctx && ctx.waitUntil) ctx.waitUntil(work);
          }
          return json({ ok: true, savedAt: payload.savedAt });
        }

        return json({ error: 'method not allowed' }, 405);
      } catch (e) {
        return json({ error: 'server error', detail: String(e && e.message || e) }, 500);
      }
    }

    /* ---------- Push: Abos ---------- */
    if (path.indexOf('/push/') === 0) {
      const token = tokenFrom(request);
      if (!token) return json({ error: 'unauthorized' }, 401);

      try {
        if (path === '/push/sub' && request.method === 'POST') {
          const body = await request.json();
          if (!body || !body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
            return json({ error: 'bad request' }, 400);
          }
          const id = await subIdOf(body.endpoint);
          const rec = {
            id: id,
            endpoint: body.endpoint,
            keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
            dev: body.dev || '',
            hour: typeof body.hour === 'number' ? body.hour : -1,
            tz: typeof body.tz === 'number' ? body.tz : 0,
            createdAt: Date.now()
          };
          const subs = await loadSubs(env, token);
          let at = -1;
          for (let i = 0; i < subs.length; i++) { if (subs[i].endpoint === body.endpoint) { at = i; break; } }
          if (at >= 0) subs[at] = rec; else subs.push(rec);
          await saveSubs(env, token, subs);
          return json({ ok: true, id: id });
        }

        if (path === '/push/unsub' && request.method === 'POST') {
          const body = await request.json().catch(function () { return {}; });
          if (!body || !body.endpoint) return json({ error: 'bad request' }, 400);
          const subs = await loadSubs(env, token);
          const keep = [];
          for (let i = 0; i < subs.length; i++) { if (subs[i].endpoint !== body.endpoint) keep.push(subs[i]); }
          await saveSubs(env, token, keep);
          return json({ ok: true });
        }

        if (path === '/push/diag' && request.method === 'GET') {
          const all = await env.PLANS.list({ limit: 20 });
          const pre = await env.PLANS.list({ prefix: PUSH_PREFIX + token + '-', limit: 20 });
          let sample = null, err = '';
          if (pre.objects.length) {
            try { sample = (await pre.objects[0].text()).slice(0, 60); } catch (e) { err = String(e && e.message || e); }
          }
          return json({
            ok: true, allCount: all.objects.length,
            allKeys: all.objects.slice(0, 5).map(function (o) { return o.key; }),
            preCount: pre.objects.length, sample: sample, err: err,
            truncated: !!pre.truncated, cursor: pre.cursor || null
          });
        }

        if (path === '/push/list' && request.method === 'GET') {
          const subs = await loadSubs(env, token);
          return json({ ok: true, count: subs.length });
        }

        if (path === '/push/test' && request.method === 'POST') {
          const body = await request.json().catch(function () { return {}; });
          const device = (body && body.dev) || '';
          const res = await notifyPlan(env, token, device, MSG.test);
          return json({ ok: true, sent: res.sent, failed: res.failed, total: res.total });
        }

        return json({ error: 'not found' }, 404);
      } catch (e) {
        return json({ error: 'server error', detail: String(e && e.message || e) }, 500);
      }
    }

    return json({ error: 'not found' }, 404);
  },

  /* ---------- Cron: tägliche Erinnerung ---------- */
  async scheduled(event, env, ctx) {
    const work = (async function () {
      const utcHour = new Date().getUTCHours();
      const res = await env.PLANS.list({ prefix: PUSH_PREFIX, limit: 1000 });
      for (let i = 0; i < res.objects.length; i++) {
        const key = res.objects[i].key;
        // Nur Objekte im neuen Format (push-<64 Zeichen>) sind Abo-Listen
        if (key.length !== PUSH_PREFIX.length + 64) continue;
        let subs = [];
        try {
          const obj = await env.PLANS.get(key);
          if (!obj) continue;
          const data = JSON.parse(await obj.text());
          subs = (data && Array.isArray(data.subs)) ? data.subs : [];
        } catch (e) { continue; }
        for (let j = 0; j < subs.length; j++) {
          const s = subs[j];
          if (typeof s.hour !== 'number' || s.hour < 0) continue;
          const local = ((utcHour + (s.tz || 0)) % 24 + 24) % 24;
          if (local !== s.hour) continue;
          try {
            await sendPush(env, s, MSG.remind);
          } catch (e) { /* ein Fehler darf die anderen Geräte nicht stoppen */ }
        }
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work);
    return work;
  }
};

/* Für den lokalen Test (Byte-Vergleich gegen http_ece) exportiert. */
export { encryptPush, vapidJwt, b64u, b64uToBytes, pushHeaders };
