/**
 * WG-Putzplan – Sync-Server (Cloudflare Worker + R2) mit Web-Push
 *
 * Speichert den verschlüsselten Plan je WG und verschickt Push-Nachrichten.
 * - Der Client schickt als "Authorization: Bearer <hash>" einen SHA-256-Hash des WG-Schlüssels.
 * - Der R2-Key leitet sich daraus ab: niemand ohne passenden Hash kommt an den Plan.
 * - Der Inhalt ist Ende-zu-Ende verschlüsselt (AES-GCM im Browser) – der Server sieht nur Chiffretext.
 * - Push-Abos liegen je WG in einem Objekt "push-<token>"; die Nachricht wird nach
 *   RFC 8291/8292 (aes128gcm) verschluesselt und mit VAPID (ES256) signiert.
 *
 * Noetige Bindungen:
 *   PLANS         R2-Bucket (Name z. B. "wg-putzplan")
 *   VAPID_PUBLIC  Variable: oeffentlicher VAPID-Schluessel, 65 Byte, base64url
 *   VAPID_PRIVATE Secret: privater VAPID-Schluessel als PKCS#8, base64url
 * Optionaler Cron-Trigger "0 * * * *" fuer die taegliche Erinnerung.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type'
};

const PUSH_PREFIX = 'push-';
// Marker-Objekt: haelt fest, wann der Cron zuletzt gelaufen ist. Es liegt
// bewusst ausserhalb der Praefixe "plan-" und "push-" und wird vom
// Aufraeumen nicht angefasst.
const CRON_MARKER = 'sys-cron-last';
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
// Nur Endpunkte der bekannten Push-Dienste zulassen. Sonst koennte ein
// WG-Mitglied ueber den Worker beliebige Adressen abrufen lassen (SSRF).
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',         // Chrome / Android / FCM
  'push.services.mozilla.com',  // Firefox
  'push.apple.com',             // Safari / iOS
  'notify.windows.com'          // Edge / Windows
];
// Wochentag (0 = Sonntag) eines Zeitpunkts in der Zeitzone des Geraets.
// Zeitzone in Minuten (Offset). Aeltere Abos speichern ganze Stunden -
// "tzMin" hat dann Vorrang, sonst wird "tz" (Stunden) umgerechnet.
function tzMinutesOf(sub) {
  if (sub && typeof sub.tzMin === 'number') return sub.tzMin;
  return (sub && typeof sub.tz === 'number') ? sub.tz * 60 : 0;
}
function localWeekday(utcMs, tzMinutes) {
  const d = new Date(utcMs + (tzMinutes || 0) * 60000);
  return d.getUTCDay();
}
function allowedPushEndpoint(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    for (const suffix of PUSH_HOST_SUFFIXES) {
      if (host === suffix || host.endsWith('.' + suffix)) return true;
    }
    return false;
  } catch (e) { return false; }
}

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
  }
  // Kein "Topic"-Header: der gehoert nicht zum Web-Push-Protokoll und wird
  // vom Push-Dienst ignoriert (oder mit einem 400 abgelehnt).
  return h;
}
async function sendPush(env, sub, payloadObj) {
  const endpoint = sub.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) throw new Error('ungültiger Push-Endpunkt');
  // Die Erlaubnisliste wird auch beim Senden geprueft - nicht nur beim
  // Speichern. Sonst wuerde ein fremd eingeschleuster Endpunkt abgerufen.
  if (!allowedPushEndpoint(endpoint)) {
    const e = new Error('Push-Endpunkt nicht erlaubt');
    e.gone = true;
    throw e;
  }
  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const body = await encryptPush(sub, JSON.stringify(payloadObj));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: pushHeaders(endpoint, jwt),
    body: body
  });
  // 404/410 = Abo nicht mehr vorhanden. Manche Anbieter melden ein
  // abgelaufenes Abo allerdings mit 400 (z. B. FCM "InvalidRegistration").
  if (res.status === 404 || res.status === 410) {
    const e = new Error('abo ungültig (' + res.status + ')');
    e.gone = true;
    throw e;
  }
  if (res.status === 400) {
    const txt = await res.text().catch(function () { return ''; });
    if (/invalidregistration|unregistered|notregistered|expired/i.test(txt)) {
      const e = new Error('abo ungültig (400)');
      e.gone = true;
      throw e;
    }
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
// Aufraeumen: Abo-Listen, zu denen es keinen (aktiven) Plan mehr gibt.
// Der Plan selbst wird NICHT geloescht - so verliert keine WG ihre Daten.
async function cleanupPushObjects(env, maxAgeDays) {
  const maxAge = (maxAgeDays || 120) * 86400000;
  let cursor = null, removed = 0, checked = 0;
  do {
    const res = await env.PLANS.list(cursor
      ? { prefix: PUSH_PREFIX, limit: 1000, cursor: cursor }
      : { prefix: PUSH_PREFIX, limit: 1000 });
    for (let i = 0; i < res.objects.length; i++) {
      const key = res.objects[i].key;
      if (key.length !== PUSH_PREFIX.length + 64) continue;   // nur Objekte im neuen Format
      checked++;
      const token = key.slice(PUSH_PREFIX.length);
      let drop = false;
      try {
        const plan = await env.PLANS.get('plan-' + token);
        if (!plan) {
          // Verwaist: es gibt keinen Plan dazu. Wichtig: Das Abo nicht sofort
          // loeschen - wer die Erinnerungen VOR dem ersten Sync einschaltet,
          // wuerde sie sonst beim naechsten Aufraeumlauf wieder verlieren.
          // Erst nach 30 Tagen ohne Plan gilt es als verwaist.
          let subAge = 0;
          try {
            const sub = await env.PLANS.get(key);
            const j = JSON.parse(await sub.text());
            subAge = j.updatedAt || 0;
          } catch (e) { subAge = 0; }
          drop = !!subAge && (Date.now() - subAge) > 30 * 86400000;
        } else {
          let savedAt = 0;
          try { const j = JSON.parse(await plan.text()); savedAt = j.savedAt || 0; } catch (e) { savedAt = 0; }
          if (savedAt && (Date.now() - savedAt) > maxAge) drop = true;  // laenger nicht benutzt
        }
      } catch (e) { drop = false; }
      if (drop) {
        try { await env.PLANS.delete(key); removed++; } catch (e) { /* egal */ }
      }
    }
    cursor = res.truncated ? res.cursor : null;
  } while (cursor);
  return { checked: checked, removed: removed };
}
async function notifyPlan(env, token, excludeDevice, payloadObj) {
  const subs = await loadSubs(env, token);
  const targets = [];
  const keep = [];
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    // Das Geraet, das die Aenderung ausgeloest hat, bekommt keine Nachricht.
    if (excludeDevice && s.dev && s.dev === excludeDevice) { keep.push(s); continue; }
    targets.push(s);
  }
  // Parallel zustellen: bei mehreren Geraeten sonst zu langsam.
  const settled = await Promise.allSettled(targets.map((s) => sendPush(env, s, payloadObj)));
  let sent = 0, removed = 0, failed = 0;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') { sent++; keep.push(targets[i]); }
    else if (r.reason && r.reason.gone) { removed++; }   // unbrauchbares Abo: entfernen
    else { failed++; keep.push(targets[i]); }
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
      // "cronLast": wann der stuendliche Aufruf zuletzt gelaufen ist. Damit
      // laesst sich pruefen, ob die taegliche Erinnerung wirklich ausloest.
      let cronLast = 0, cronRuns = 0;
      try {
        const marker = await env.PLANS.get(CRON_MARKER);
        if (marker) {
          const j = JSON.parse(await marker.text());
          cronLast = j.at || 0; cronRuns = j.runs || 0;
        }
      } catch (e) { /* egal */ }
      return json({
        ok: true,
        service: 'wg-putzplan-sync',
        time: Date.now(),
        push: !!(env.VAPID_PRIVATE && env.VAPID_PUBLIC),
        vapidPublic: env.VAPID_PUBLIC || null,
        cronLast: cronLast,
        cronRuns: cronRuns
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
          // 5 MB: R2 objekte duerfen weit groesser sein. Das Limit ist nur
          // ein Schutz gegen absurde Requests. Die Content-Length wird VOR dem
          // Lesen geprueft, sonst laeuft der Worker beim Puffern in sein Limit.
          const clen = parseInt(request.headers.get('Content-Length') || '0', 10);
          if (clen > 5000000) return json({ error: 'too large' }, 413);
          const text = await request.text();
          if (text.length > 5000000) return json({ error: 'too large' }, 413);
          let payload;
          try { payload = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
          // Schemapruefung: verhindert, dass beliebiges JSON (oder Muell) den
          // Plan-Speicher belegt. Verschluesselte Hüllen (v/iv/ct) sind erlaubt.
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return json({ error: 'bad request' }, 400);
          }
          if (payload.members !== undefined && !Array.isArray(payload.members)) {
            return json({ error: 'bad request' }, 400);
          }
          if (payload.rooms !== undefined && !Array.isArray(payload.rooms)) {
            return json({ error: 'bad request' }, 400);
          }
          if (payload.members === undefined && payload.rooms === undefined && !payload.ct) {
            return json({ error: 'bad request' }, 400);
          }

          const prev = await env.PLANS.get(key);
          let prevCid = '';
          // Achtung: prev.body ist ein Stream - JSON.parse(prev.body) schlaegt
          // immer fehl und wuerde jede Aenderung melden (Push-Spam).
          if (prev) { try { prevCid = (JSON.parse(await prev.text()).cid) || ''; } catch (e) { prevCid = ''; } }

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
        // Keine internen Details nach aussen geben.
        return json({ error: 'server error' }, 500);
      }
    }

    /* ---------- Push: Abos ---------- */
    if (path.indexOf('/push/') === 0) {
      const token = tokenFrom(request);
      if (!token) return json({ error: 'unauthorized' }, 401);

      try {
        if (path === '/push/sub' && request.method === 'POST') {
          let body;
          try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
          if (!body || !body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
            return json({ error: 'bad request' }, 400);
          }
          if (!allowedPushEndpoint(body.endpoint)) {
            return json({ error: 'endpoint not allowed' }, 400);
          }
          // p256dh: unkomprimierter P-256-Punkt = 65 Byte.
          // auth: je nach Browser 16 Byte (Standard) oder 8 Byte (aeltere Entwuerfe).
          const authLen = b64uToBytes(body.keys.auth).length;
          if (b64uToBytes(body.keys.p256dh).length !== 65 || authLen < 8 || authLen > 32) {
            return json({ error: 'invalid keys' }, 400);
          }
          const id = await subIdOf(body.endpoint);
          const rec = {
            id: id,
            endpoint: body.endpoint,
            keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
            dev: body.dev || '',
            hour: typeof body.hour === 'number' ? body.hour : -1,
            tz: typeof body.tz === 'number' ? body.tz : 0,
            tzMin: typeof body.tzMin === 'number' ? body.tzMin : 0,
            // Wochentage (0 = Sonntag ... 6 = Samstag). Leer = jeden Tag.
            days: Array.isArray(body.days) ? body.days.filter(function (d) { return typeof d === 'number' && d >= 0 && d <= 6; }) : [],
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
          // WICHTIG: Nur die Objekte DIESES Tokens auflisten. Ein Blick in den
          // ganzen Bucket wuerde die Schluessel aller anderen WGs verraten.
          // Die Abos liegen unter "push-<token>" - ohne Bindestrich danach.
          const pre = await env.PLANS.list({ prefix: PUSH_PREFIX + token, limit: 20 });
          let sample = null, err = '';
          if (pre.objects.length) {
            try { sample = (await pre.objects[0].text()).slice(0, 60); } catch (e) { err = String(e && e.message || e); }
          }
          return json({
            ok: true,
            preCount: pre.objects.length, sample: sample, err: err,
            truncated: !!pre.truncated, cursor: pre.cursor || null
          });
        }

        if (path === '/push/list' && request.method === 'GET') {
          const subs = await loadSubs(env, token);
          const detail = subs.map(function (s) {
            return { id: s.id, dev: s.dev, hour: s.hour, tz: s.tz, tzMin: s.tzMin, days: s.days || [], endpoint: s.endpoint };
          });
          return json({ ok: true, count: subs.length, subs: detail });
        }

        if (path === '/push/test' && request.method === 'POST') {
          const body = await request.json().catch(function () { return {}; });
          const device = (body && body.dev) || '';
          const res = await notifyPlan(env, token, device, MSG.test);
          return json({ ok: true, sent: res.sent, failed: res.failed, total: res.total });
        }

        return json({ error: 'not found' }, 404);
      } catch (e) {
        // Keine internen Details nach aussen geben.
        return json({ error: 'server error' }, 500);
      }
    }

    return json({ error: 'not found' }, 404);
  },

  /* ---------- Cron: tägliche Erinnerung ---------- */
  async scheduled(event, env, ctx) {
    const work = (async function () {
      const utcHour = new Date().getUTCHours();
      let cursor = null;
      do {
      const res = await env.PLANS.list(cursor
        ? { prefix: PUSH_PREFIX, limit: 1000, cursor: cursor }
        : { prefix: PUSH_PREFIX, limit: 1000 });
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
        const keep = [];
        let dropped = 0;
        for (let j = 0; j < subs.length; j++) {
          const s = subs[j];
          // Abgelaufene Abos werden hier direkt entfernt - sonst sammeln sie
          // sich und werden immer wieder versucht.
          if (typeof s.hour !== 'number' || s.hour < 0) { keep.push(s); continue; }
          const tzMin = tzMinutesOf(s);
          const local = Math.floor((((utcHour * 60) + tzMin) % 1440 + 1440) % 1440 / 60);
          if (local !== s.hour) { keep.push(s); continue; }
          // Nur an den gewaehlten Wochentagen erinnern (leer = jeder Tag).
          if (Array.isArray(s.days) && s.days.length && s.days.indexOf(localWeekday(Date.now(), tzMin)) === -1) { keep.push(s); continue; }
          try {
            await sendPush(env, s, MSG.remind);
            keep.push(s);
          } catch (e) {
            if (e && e.gone) { dropped++; continue; }   // Abo ist tot -> entfernen
            keep.push(s);   // ein Fehler darf die anderen Geraete nicht stoppen
          }
        }
        if (dropped) {
          try { await saveSubs(env, token, keep); } catch (e) { /* egal */ }
        }
      }
      cursor = res.truncated ? res.cursor : null;
      } while (cursor);
      // Nachweis, dass der Cron wirklich gelaufen ist.
      try {
        const old = await env.PLANS.get(CRON_MARKER);
        let runs = 0;
        if (old) { try { runs = (JSON.parse(await old.text()).runs) || 0; } catch (e) { runs = 0; } }
        await env.PLANS.put(CRON_MARKER, JSON.stringify({ at: Date.now(), runs: runs + 1 }));
      } catch (e) { /* egal */ }
      // Einmal taeglich (3 Uhr UTC) verwaiste Abo-Listen entfernen.
      if (utcHour === 3) {
        try { await cleanupPushObjects(env); } catch (e) { /* egal */ }
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work);
    return work;
  }
};

/* Für den lokalen Test (Byte-Vergleich gegen http_ece) exportiert. */
export { encryptPush, vapidJwt, b64u, b64uToBytes, pushHeaders, localWeekday, cleanupPushObjects };
