/* =========================================================
   WG-Putzplan – Anwendungslogik
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Konstanten ---------- */
  const STORAGE_KEY = 'wgputzplan.v1';
  const EPOCH = new Date(2020, 0, 6); // Montag, 6.1.2020 – Basis für die Wochenzählung
  const DAY = 86400000;
  const MEMBER_COLORS = ['#4f6df5', '#12b5a5', '#f0a51b', '#e11d48', '#8b5cf6', '#0ea5e9', '#16a34a', '#db2777', '#ea580c', '#64748b'];
  const EMOJIS = ['🧑', '🧑🏻', '🧑🏽', '🧑🏿', '👩', '👨', '👧', '👦', '🧔', '🐱', '🦊', '🐼', '🐨', '🦉', '🐙', '🐝', '🦄', '🐢'];

  /* ---------- State ---------- */
  let state = load();
  let ui = { view: 'week', weekOffset: 0, planTab: 'weeks', weekIndex: null, lastView: null, weekFilter: 'all' };
  let installPrompt = null;
  let toastTimer = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

  /* =========================================================
     Speicher
     ========================================================= */
  function seed() {
    const members = [
      { id: 'm1', name: 'Anna', emoji: '👩', color: MEMBER_COLORS[0] },
      { id: 'm2', name: 'Ben', emoji: '👨', color: MEMBER_COLORS[1] },
      { id: 'm3', name: 'Clara', emoji: '🧑', color: MEMBER_COLORS[2] }
    ];
    const rooms = [
      {
        id: 'r1', name: 'Küche', icon: '🍳', color: MEMBER_COLORS[0], mode: 'rotation', fixedMember: null, tasks: [
          { id: 't1', title: 'Geschirr abwaschen & einräumen', p: 1, freq: 'w' },
          { id: 't2', title: 'Arbeitsfläche & Herd abwischen', p: 1, freq: 'w' },
          { id: 't3', title: 'Spüle & Wasserhahn reinigen', p: 1, freq: '2w' },
          { id: 't4', title: 'Müll rausbringen', p: 1, freq: 'w' },
          { id: 't5', title: 'Kühlschrank auswischen', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r2', name: 'Bad', icon: '🚿', color: MEMBER_COLORS[1], mode: 'rotation', fixedMember: null, tasks: [
          { id: 't6', title: 'Bad & Spiegel putzen', p: 1, freq: 'w' },
          { id: 't7', title: 'Toilette reinigen', p: 1, freq: 'w' },
          { id: 't8', title: 'Handtücher wechseln', p: 1, freq: '2w' },
          { id: 't9', title: 'Fliesen & Fugen', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r3', name: 'Flur & Wohnzimmer', icon: '🛋️', color: MEMBER_COLORS[2], mode: 'rotation', fixedMember: null, tasks: [
          { id: 't10', title: 'Staubsaugen', p: 1, freq: 'w' },
          { id: 't11', title: 'Flur wischen', p: 1, freq: '2w' },
          { id: 't12', title: 'Sofa & Polster abstauben', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r4', name: 'Müll & Recycling', icon: '🗑️', color: MEMBER_COLORS[3], mode: 'rotation', fixedMember: null, tasks: [
          { id: 't13', title: 'Mülltonnen rausbringen', p: 1, freq: 'w' },
          { id: 't14', title: 'Altpapier & Glas trennen', p: 1, freq: '2w' },
          { id: 't15', title: 'Pfandflaschen wegbringen', p: 2, freq: 'm' }
        ]
      }
    ];
    return {
      version: 1,
      wgName: 'WG-Putzplan',
      members, rooms,
      order: members.map((m) => m.id),
      offsets: computeBalanced(rooms, members.map((m) => m.id), weekIndexOf(new Date())),
      weeks: {},
      currentUser: members[0].id,
      theme: 'auto',
      updatedAt: Date.now()
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1 && Array.isArray(s.members)) return normalize(s);
      }
    } catch (e) { /* defekter Speicher -> Seed */ }
    return seed();
  }

  function normalize(s) {
    s.rooms = Array.isArray(s.rooms) ? s.rooms : [];
    s.members = Array.isArray(s.members) ? s.members : [];
    s.weeks = s.weeks && typeof s.weeks === 'object' ? s.weeks : {};
    s.offsets = s.offsets && typeof s.offsets === 'object' ? s.offsets : {};
    s.order = Array.isArray(s.order) ? s.order.filter((id) => s.members.some((m) => m.id === id)) : s.members.map((m) => m.id);
    s.members.forEach((m, i) => { if (!m.color) m.color = MEMBER_COLORS[i % MEMBER_COLORS.length]; if (!m.emoji) m.emoji = '🧑'; });
    // Mitglieder ohne Platz in der Reihenfolge anhängen
    s.members.forEach((m) => { if (!s.order.includes(m.id)) s.order.push(m.id); });
    if (!s.members.some((m) => m.id === s.currentUser)) s.currentUser = s.members[0] ? s.members[0].id : null;
    if (!s.theme) s.theme = 'auto';
    s.rooms.forEach((r) => {
      r.tasks = Array.isArray(r.tasks) ? r.tasks : [];
      r.mode = r.mode === 'fixed' ? 'fixed' : 'rotation';
      if (!r.fixedMember || !s.members.some((m) => m.id === r.fixedMember)) r.fixedMember = null;
      if (r.mode === 'fixed' && !r.fixedMember) r.mode = 'rotation';
      r.tasks.forEach((t) => {
        if (!t.freq) t.freq = 'w';
        t.p = clampPoints(t.p);
      });
    });
    return s;
  }

  function save(keepTime) {
    // keepTime: den Zeitstempel nicht anfassen. Wird beim Zusammenfuehren
    // benutzt - sonst glaubt das Geraet, es sei neuer als der Server, und
    // schiebt den Stand im 30-Sekunden-Takt zurueck (Endlos-Upload).
    if (!keepTime) state.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Speichern nicht möglich'); }
    schedulePush();
  }

  /* =========================================================
     Datums- & Wochenlogik
     ========================================================= */
  function startOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7; // Montag = 0
    x.setDate(x.getDate() - dow);
    return x;
  }
  function utcDays(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY; }
  function weekIndexOf(date) {
    return Math.round((utcDays(startOfWeek(date)) - utcDays(EPOCH)) / 7);
  }
  function weekStart(idx) {
    return new Date(EPOCH.getFullYear(), EPOCH.getMonth(), EPOCH.getDate() + idx * 7);
  }
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / DAY) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
  }
  const weekKey = (idx) => {
    const i = isoWeek(weekStart(idx));
    return i.year + '-W' + String(i.week).padStart(2, '0');
  };
  function weekLabel(idx) {
    const { year, week } = isoWeek(weekStart(idx));
    return 'KW ' + week + ' · ' + year;
  }
  function weekRange(idx) {
    const s = weekStart(idx);
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
    const fmt = (d) => String(d.getDate()) + '. ' + d.toLocaleDateString('de-DE', { month: 'short' }).replace('.', '') + '.';
    return fmt(s) + ' – ' + fmt(e);
  }
  function isMonthStartWeek(idx) {
    const a = weekStart(idx), b = weekStart(idx - 1);
    return a.getMonth() !== b.getMonth() || a.getFullYear() !== b.getFullYear();
  }
  function taskDue(task, idx) {
    if (task.freq === '2w') return idx % 2 === 0;
    if (task.freq === 'm') return isMonthStartWeek(idx);
    return true;
  }
  const FREQ_LABEL = { w: 'wöchentlich', '2w': 'alle 2 Wochen', m: 'monatlich' };

  /* =========================================================
     Domänenlogik
     ========================================================= */
  const member = (id) => state.members.find((m) => m.id === id) || null;
  const room = (id) => state.rooms.find((r) => r.id === id) || null;
  const activeOrder = () => state.order.filter((id) => !!member(id));

  function assigneeFor(roomId, idx) {
    const r = room(roomId);
    // Feste Zuordnung: immer dieselbe Person
    if (r && r.mode === 'fixed') {
      if (r.fixedMember && member(r.fixedMember)) return r.fixedMember;
    }
    const order = activeOrder();
    if (!order.length) return null;
    const off = state.offsets[roomId] || 0;
    return order[(((idx + off) % order.length) + order.length) % order.length];
  }
  function dueTasks(r, idx) { return r.tasks.filter((t) => taskDue(t, idx)); }
  function weekDone(idx) {
    const wk = state.weeks[weekKey(idx)];
    return (wk && wk.done) || {};
  }
  function doneEntry(roomId, taskId, idx) {
    const w = weekDone(idx);
    return (w[roomId] && w[roomId][taskId]) || null;
  }
  function taskPoints(roomId, taskId) {
    const r = room(roomId);
    if (!r) return 1;
    const t = r.tasks.find((x) => x.id === taskId);
    return t ? clampPoints(t.p) : 1;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function clampPoints(p) {
    const n = Math.round(Number(p) || 1);
    return Math.min(4, Math.max(1, n));
  }
  function weekProgress(idx) {
    let total = 0, done = 0;
    state.rooms.forEach((r) => {
      dueTasks(r, idx).forEach((t) => {
        total++;
        if (doneEntry(r.id, t.id, idx)) done++;
      });
    });
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function pointsOf(memberId) {
    let p = 0;
    Object.values(state.weeks).forEach((wk) => {
      if (!wk.done) return;
      Object.keys(wk.done).forEach((roomId) => {
        Object.keys(wk.done[roomId]).forEach((taskId) => {
          const e = wk.done[roomId][taskId];
          if (e && e.by === memberId) p += taskPoints(roomId, taskId);
        });
      });
    });
    return p;
  }
  function tasksDoneBy(memberId) {
    let n = 0;
    Object.values(state.weeks).forEach((wk) => {
      if (!wk.done) return;
      Object.keys(wk.done).forEach((roomId) => {
        Object.keys(wk.done[roomId]).forEach((taskId) => {
          if (wk.done[roomId][taskId] && wk.done[roomId][taskId].by === memberId) n++;
        });
      });
    });
    return n;
  }
  function weekPointTotal(idx) {
    const w = weekDone(idx);
    let p = 0;
    Object.keys(w).forEach((roomId) => Object.keys(w[roomId]).forEach((tid) => { p += taskPoints(roomId, tid); }));
    return p;
  }

  /* Verteilt die wechselnden Räume so auf die Mitglieder, dass die Arbeitslast
     möglichst gleichmäßig ist. Ergebnis wird als fester Versatz je Raum
     gespeichert, damit der Turnus von Woche zu Woche weiterläuft.
     Räume mit fester Zuordnung bleiben unangetastet. */
  function computeBalanced(rooms, order, idx) {
    const n = order.length;
    const off = {};
    if (!n) return off;
    const loads = new Array(n).fill(0);
    rooms.forEach((r) => {
      if (r.mode === 'fixed') {
        off[r.id] = 0;
        const fi = order.indexOf(r.fixedMember);
        if (fi >= 0) loads[fi] += (r.tasks || []).length;
      }
    });
    rooms.filter((r) => r.mode !== 'fixed')
      .sort((a, b) => (b.tasks || []).length - (a.tasks || []).length)
      .forEach((r) => {
        let bi = 0;
        for (let i = 1; i < n; i++) if (loads[i] < loads[bi]) bi = i;
        loads[bi] += (r.tasks || []).length;
        off[r.id] = (((bi - idx) % n) + n) % n;
      });
    return off;
  }
  function autoBalance() {
    const fixedOff = {};
    state.rooms.forEach((r) => { if (r.mode === 'fixed') fixedOff[r.id] = state.offsets[r.id] || 0; });
    const off = computeBalanced(state.rooms, activeOrder(), weekIndexOf(new Date()));
    Object.assign(off, fixedOff);
    state.offsets = off;
    save();
    render();
    toast('Aufgaben gleichmäßig verteilt ⚖️');
  }

  /* =========================================================
     Rendering
     ========================================================= */
  function render() {
    document.documentElement.dataset.theme = state.theme;
    const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.os = osDark ? 'dark' : 'light';
    $('#wg-name').textContent = state.wgName || 'WG-Putzplan';
    const cur = member(state.currentUser);
    const av = $('#user-avatar');
    av.textContent = cur ? cur.emoji : '👤';
    av.style.background = cur ? cur.color : 'var(--accent)';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === ui.view));
    const main = $('#main');
    const keepScroll = (ui.view === ui.lastView) ? window.scrollY : 0;
    if (ui.view === 'week') main.innerHTML = viewWeek();
    else if (ui.view === 'plan') main.innerHTML = viewPlan();
    else if (ui.view === 'stats') main.innerHTML = viewStats();
    else main.innerHTML = viewMore();
    updateHeader();
    updateBadge();
    // Scroll nur zurücksetzen, wenn die Ansicht wirklich wechselt – sonst springt
    // die Seite beim Abhaken einer Aufgabe nach oben. Die Position wird danach
    // wiederhergestellt, weil Chromium beim Neusatz sonst selbst nachregelt.
    if (ui.view !== ui.lastView) {
      window.scrollTo(0, 0);
      ui.lastView = ui.view;
    } else if (keepScroll) {
      window.scrollTo(0, keepScroll);
    }
  }

  function updateHeader() {
    const idx = currentIndex();
    const sub = $('#week-sub');
    if (ui.view === 'week') {
      sub.textContent = weekRange(idx);
      $('#week-label').textContent = ui.weekOffset === 0 ? 'Diese Woche · ' + weekLabel(idx) : weekLabel(idx) + ' · ' + weekRange(idx);
      $('#weeknav').style.display = '';
    } else {
      sub.textContent = ui.view === 'plan' ? 'Turnus & Mitglieder' : ui.view === 'stats' ? 'Punkte & Auslastung' : 'Einstellungen & Daten';
      $('#weeknav').style.display = 'none';
    }
  }

  const currentIndex = () => weekIndexOf(new Date()) + ui.weekOffset;


  /* ---------- Datei-Download ---------- */
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Kalender-Export (ICS) ---------- */
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function icsStamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function buildIcs(idx) {
    const monday = weekStart(idx);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WG-Putzplan//DE',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape((state.wgName || 'WG') + ' – Putzplan ' + weekLabel(idx))
    ];
    state.rooms.forEach((r, ri) => {
      const tasks = dueTasks(r, idx);
      if (!tasks.length) return;
      const who = member(assigneeFor(r.id, idx));
      const day = ri % 7;
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, 17, 0, 0);
      const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, 18, 0, 0);
      const punkte = tasks.reduce((a, t) => a + clampPoints(t.p), 0);
      const offen = tasks.filter((t) => !doneEntry(r.id, t.id, idx)).length;
      const detail = tasks.map((t) => '• ' + t.title + ' (' + clampPoints(t.p) + ' P' +
        (doneEntry(r.id, t.id, idx) ? ', erledigt' : '') + ')').join('\n');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + r.id + '-' + weekKey(idx) + '@wg-putzplan');
      lines.push('DTSTAMP:' + icsStamp(new Date()));
      lines.push('DTSTART:' + icsStamp(start));
      lines.push('DTEND:' + icsStamp(end));
      lines.push('SUMMARY:' + icsEscape(r.name + ' putzen' + (offen ? ' (' + offen + ' offen)' : '')));
      lines.push('DESCRIPTION:' + icsEscape(
        'Zuständig: ' + (who ? who.name : '–') + '\n' + punkte + ' Punkte gesamt\n' + detail));
      lines.push('CATEGORIES:WG-Putzplan,' + icsEscape(r.name));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // Zeilenfaltung nach RFC 5545 (max. 75 Oktett je Zeile)
    return lines.map(foldIcsLine).join('\r\n');
  }
  function foldIcsLine(line) {
    if (line.length <= 73) return line;
    const out = [];
    let rest = line;
    out.push(rest.slice(0, 73));
    rest = rest.slice(73);
    while (rest.length) {
      out.push(' ' + rest.slice(0, 72));
      rest = rest.slice(72);
    }
    return out.join('\r\n');
  }
  function exportIcs(idx) {
    const name = (state.wgName || 'wg-putzplan').replace(/[^\w\-äöüÄÖÜß ]/g, '').replace(/\s+/g, '-');
    downloadFile(name + '-' + weekKey(idx) + '.ics', buildIcs(idx), 'text/calendar;charset=utf-8');
    toast('Kalenderdatei erzeugt 📅');
  }


  /* =========================================================
     Live-Sync (Cloudflare Worker + R2), Ende-zu-Ende verschlüsselt
     ========================================================= */
  const SYNC_DEFAULT_URL = 'https://wg-putzplan-sync.wg-putzplan.workers.dev';

  function syncCfg() {
    if (!state.sync) state.sync = { enabled: false, url: SYNC_DEFAULT_URL, key: '', enc: true, status: 'aus', lastSync: 0, error: '' };
    if (!state.sync.url) state.sync.url = SYNC_DEFAULT_URL;
    if (state.sync.enc === undefined) state.sync.enc = true;
    return state.sync;
  }
  function syncReady() {
    const c = syncCfg();
    return !!(c.enabled && c.key && c.url);
  }
  function newWgKey() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function aesKeyFrom(key) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('wg-putzplan-e2e-v1'), iterations: 120000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  function b64(buf) {
    const b = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Der Server sieht nur Chiffretext – WG-Schlüssel und Person sind nie Teil des Payloads.
  // theme und quickDefaults sind Geraete-Einstellungen (wie die aktive Person) und
  // werden nicht geteilt: sonst schieben zwei Geraete mit unterschiedlichen
  // Einstellungen den Stand endlos hin und her.
  function planPayload() {
    const s = JSON.parse(JSON.stringify(state));
    delete s.sync;
    delete s.currentUser;
    delete s.theme;
    delete s.quickDefaults;
    return s;
  }
  async function encryptPayload(obj) {
    const c = syncCfg();
    if (!c.enc) return { plain: obj };
    const key = await aesKeyFrom(c.key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { v: 1, iv: b64(iv), ct: b64(ct) };
  }
  async function decryptPayload(payload) {
    if (!payload) return null;
    if (payload.plain) return payload.plain;
    if (!payload.ct) return null;
    const c = syncCfg();
    const key = await aesKeyFrom(c.key);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  // Kanonische Darstellung: Objekt-Schluessel werden sortiert, damit zwei Geraete
  // mit gleichem Inhalt denselben Fingerprint bekommen. Ohne das erkennen sich
  // Geraete nicht wieder, deren Erledigungen in anderer Reihenfolge im Objekt
  // stehen - sie wuerden endlos denselben Stand hin- und herschieben.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(function (k) { out[k] = canonical(value[k]); });
      return out;
    }
    return value;
  }
  function fingerprint(obj) {
    // updatedAt wird bewusst ignoriert: sonst schieben zwei Geräte denselben Stand
    // im 30-Sekunden-Takt hin und her, ohne dass sich etwas ändert.
    const copy = canonical(Object.assign({}, obj));
    delete copy.updatedAt;
    // Mitglieder sind eine Menge, keine Reihenfolge
    if (Array.isArray(copy.members)) {
      copy.members = copy.members.slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
    }
    const s = JSON.stringify(copy);
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return s.length + ':' + h;
  }
  let syncing = false, syncPushTimer = null, serverFp = null;

  function setSyncStatus(status, text) {
    const c = syncCfg();
    c.status = status;
    c.error = status === 'fehler' ? (text || '') : '';
    if (status === 'ok') c.lastSync = Date.now();
    const el = document.getElementById('syncstatus');
    if (el) {
      el.className = 'syncstatus syncstatus--' + status;
      el.textContent = text || status;
    }
    const badge = document.getElementById('syncbadge');
    if (badge) {
      badge.textContent = status === 'ok' ? 'verbunden' : (status === 'fehler' ? 'Fehler' : (status === 'arbeitet' ? 'verbinde …' : 'aus'));
      badge.className = 'pill ' + (status === 'ok' ? 'pill--ok' : (status === 'fehler' ? 'pill--danger' : ''));
    }
  }
  function schedulePush() {
    if (!syncReady()) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(() => { syncCycle(false); }, 1200);
  }
  async function syncCycle(pushOnly, force) {
    const c = syncCfg();
    if (syncing) return;
    if (!force && !c.enabled) return;
    if (!c.key || !c.url) return;
    syncing = true;
    try {
      setSyncStatus('arbeitet', 'Synchronisiere …');
      const auth = 'Bearer ' + (await sha256Hex('wg-putzplan-auth:' + c.key));
      if (!pushOnly) {
        const res = await fetch(c.url.replace(/\/$/, '') + '/plan', { headers: { Authorization: auth } });
        if (res.status === 404) {
          serverFp = null;                     // noch kein Plan vorhanden -> gleich hochladen
        } else if (res.ok) {
          let remote = null;
          try {
            remote = await decryptPayload(await res.json());
          } catch (e) {
            // Fremder Schlüssel oder beschädigte Daten: eigener Stand wird einfach hochgeladen
            remote = null;
          }
          if (remote) {
            serverFp = fingerprint(remote);
            const merged = mergeState(state, remote);
            if (fingerprint(merged) !== fingerprint(state)) {
              state = merged;
              // Zeitstempel des Servers uebernehmen: das Geraet darf sich danach
              // nicht als neuer ausgeben, sonst schiebt es den Stand zurueck.
              state.updatedAt = Math.max(state.updatedAt || 0, remote.updatedAt || 0) || state.updatedAt;
              save(true);
              render();
            }
          } else {
            serverFp = null;
          }
        } else if (res.status === 401) {
          setSyncStatus('fehler', 'Zugriff verweigert – Schlüssel oder Server falsch?');
          return;
        }
      }
      const fp = fingerprint(planPayload());
      if (fp !== serverFp) {
        const payload = await encryptPayload(planPayload());
        payload.cid = await changeId(fp);   // Inhaltskennung: nur mit WG-Schluessel ableitbar
        payload.dev = deviceId();            // welches Geraet hat den Aenderungsstoss ausgeloest
        const put = await fetch(c.url.replace(/\/$/, '') + '/plan', {
          method: 'PUT',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!put.ok) throw new Error('Server antwortet mit ' + put.status);
        serverFp = fp;
        setSyncStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE'));
      } else {
        setSyncStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE'));
      }
    } catch (e) {
      setSyncStatus('fehler', 'Sync-Fehler: ' + (e && e.message ? e.message : e));
    } finally {
      syncing = false;
    }
  }

  /* =========================================================
     Web-Push: Erinnerungen, ohne Konto und ohne Abo
     ========================================================= */
  const PUSH_HOURS = [
    { v: -1, t: 'Aus' }, { v: 8, t: '08:00' }, { v: 10, t: '10:00' }, { v: 12, t: '12:00' },
    { v: 15, t: '15:00' }, { v: 17, t: '17:00' }, { v: 19, t: '19:00' }, { v: 21, t: '21:00' }
  ];
  const DEFAULT_PUSH_HOUR = 17;

  function pushCfg() {
    const c = syncCfg();
    if (!c.push) c.push = { enabled: false, url: '', status: 'aus', error: '', sub: null, hour: DEFAULT_PUSH_HOUR };
    if (c.push.hour === undefined) c.push.hour = DEFAULT_PUSH_HOUR;
    return c.push;
  }
  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function pushPermission() {
    try { return (typeof Notification !== 'undefined') ? Notification.permission : 'denied'; } catch (e) { return 'denied'; }
  }
  // iPadOS 13+ meldet sich als "Macintosh" - nur mit Touch-Punkten erkennbar.
  function isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function deviceId() {
    let id = '';
    try { id = localStorage.getItem('wg-putzplan-device') || ''; } catch (e) { id = ''; }
    if (!id) {
      id = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem('wg-putzplan-device', id); } catch (e) { /* egal */ }
    }
    return id;
  }
  function tzHours() { return Math.round(-new Date().getTimezoneOffset() / 60); }
  function urlB64ToBytes(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // Kennung des Planinhalts. Sie enthaelt keine Information ueber den Plan:
  // ohne den WG-Schluessel laesst sie sich nicht zurueckrechnen.
  async function changeId(fp) {
    const c = syncCfg();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('wg-putzplan-cid-v1:' + fp));
    return b64(new Uint8Array(sig));
  }
  async function pushAuth() {
    const c = syncCfg();
    return 'Bearer ' + (await sha256Hex('wg-putzplan-auth:' + c.key));
  }
  function setPushStatus(status, text) {
    const pc = pushCfg();
    pc.status = status;
    pc.error = status === 'fehler' ? (text || '') : '';
    const el = document.getElementById('pushstatus');
    if (el) { el.className = 'syncstatus syncstatus--' + status; el.textContent = text || status; }
    const badge = document.getElementById('pushbadge');
    if (badge) {
      badge.textContent = status === 'aktiv' ? 'aktiv' : (status === 'fehler' ? 'Fehler' : (status === 'arbeitet' ? 'richte ein …' : 'aus'));
      badge.className = 'pill ' + (status === 'aktiv' ? 'pill--ok' : (status === 'fehler' ? 'pill--danger' : ''));
    }
  }
  async function pushEnable() {
    const c = syncCfg();
    const pc = pushCfg();
    if (!pushSupported()) { setPushStatus('fehler', 'Dieser Browser kann keine Push-Nachrichten senden.'); save(); render(); return; }
    if (!c.key) { toast('Zuerst den WG-Schlüssel eintragen'); return; }
    try {
      setPushStatus('arbeitet', 'Richte Benachrichtigungen ein …');
      save(); render();
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPushStatus('fehler', 'Benachrichtigungen wurden nicht erlaubt.');
        save(); render();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const base = c.url.replace(/\/$/, '');
      const keyRes = await fetch(base + '/push/key');
      if (!keyRes.ok) throw new Error('Der Server unterstützt kein Push (Status ' + keyRes.status + ')');
      const pub = await keyRes.json();
      const appServerKey = urlB64ToBytes(pub.publicKey);
      pc.vapid = pub.publicKey;   // merken: bei Wechsel sind alte Abos wertlos
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        const cur = sub.options && sub.options.applicationServerKey;
        if (!cur || !sameBytes(cur, appServerKey)) { await sub.unsubscribe(); sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
      const j = sub.toJSON();
      const auth = await pushAuth();
      const res = await fetch(base + '/push/sub', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, dev: deviceId(), hour: pc.hour, tz: tzHours() })
      });
      if (!res.ok) throw new Error('Abo konnte nicht gespeichert werden (Status ' + res.status + ')');
      pc.enabled = true; pc.url = base; pc.sub = j; pc.status = 'aktiv'; pc.auth = auth;
      save(); render();
      pushCredToWorker(reg);
      toast('Benachrichtigungen sind aktiv ✓');
    } catch (e) {
      setPushStatus('fehler', 'Push konnte nicht aktiviert werden: ' + (e && e.message ? e.message : e));
      save(); render();
    }
  }
  async function pushDisable() {
    const pc = pushCfg();
    try {
      if (pc.sub && pc.sub.endpoint && pc.url) {
        await fetch(pc.url + '/push/unsub', {
          method: 'POST',
          headers: { Authorization: await pushAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: pc.sub.endpoint })
        }).catch(function () {});
      }
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
    } catch (e) { /* lokal wird trotzdem abgeschaltet */ }
    pc.enabled = false; pc.sub = null; pc.status = 'aus';
    save(); render();
    toast('Benachrichtigungen ausgeschaltet');
  }
  async function pushTest() {
    const c = syncCfg();
    const pc = pushCfg();
    if (!pc.enabled) { toast('Erst die Benachrichtigungen aktivieren'); return; }
    try {
      const res = await fetch(c.url.replace(/\/$/, '') + '/push/test', {
        method: 'POST',
        headers: { Authorization: await pushAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const j = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error('Status ' + res.status);
      toast('Testnachricht an ' + (j.sent || 0) + ' Gerät(e) gesendet');
    } catch (e) {
      toast('Testnachricht fehlgeschlagen: ' + (e && e.message ? e.message : e));
    }
  }
  async function pushResubscribe() {
    const pc = pushCfg();
    const c = syncCfg();
    if (!pc.enabled || !pc.sub) return;
    try {
      await fetch((pc.url || c.url).replace(/\/$/, '') + '/push/sub', {
        method: 'POST',
        headers: { Authorization: await pushAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: pc.sub.endpoint, keys: pc.sub.keys, dev: deviceId(), hour: pc.hour, tz: tzHours() })
      });
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function (reg) { pushCredToWorker(reg); }).catch(function () {});
      }
      toast('Erinnerungszeit gespeichert');
    } catch (e) { toast('Konnte nicht gespeichert werden'); }
  }
  // Der Service Worker braucht die Zugangsdaten, um ein vom Browser
  // erneuertes Abo selbst wieder anzumelden - auch wenn die App gerade
  // nicht offen ist.
  async function pushCredToWorker(reg) {
    const c = syncCfg();
    const pc = pushCfg();
    const target = reg && reg.active ? reg.active : null;
    if (!target || !pc.enabled || !c.key) return;
    try {
      target.postMessage({
        type: 'WG-PUSH-CRED',
        cred: {
          url: (pc.url || c.url).replace(/\/$/, ''),
          auth: await pushAuth(),
          dev: deviceId(),
          hour: pc.hour,
          tz: tzHours()
        }
      });
    } catch (e) { /* egal */ }
  }
  // Beim Start pruefen, ob das Abo noch passt (Server, Schluessel, Browser-Berechtigung)
  async function pushStartup() {
    const pc = pushCfg();
    if (!pc.enabled) return;
    const c = syncCfg();
    if (pc.url && pc.url !== c.url.replace(/\/$/, '')) {
      pc.enabled = false; pc.sub = null; pc.status = 'fehler';
      pc.error = 'Serveradresse hat sich geändert – bitte neu aktivieren.';
      save(); render();
      return;
    }
    if (!pushSupported()) { pc.enabled = false; pc.status = 'aus'; save(); return; }
    // Hat der Server den Push-Schluessel gewechselt? Dann sind alte Abos wertlos.
    try {
      const keyRes = await fetch((pc.url || c.url).replace(/\/$/, '') + '/push/key');
      if (keyRes.ok) {
        const pub = await keyRes.json();
        if (pc.vapid && pub.publicKey && pc.vapid !== pub.publicKey) {
          pc.enabled = false; pc.status = 'fehler';
          pc.error = 'Der Server hat den Push-Schlüssel gewechselt – bitte neu aktivieren.';
          save(); render();
          return;
        }
        if (!pc.vapid) { pc.vapid = pub.publicKey; save(); }
      }
    } catch (e) { /* Server nicht erreichbar: Status bleibt unveraendert */ }
    if (pushPermission() !== 'granted') {
      pc.status = 'fehler'; pc.error = 'Benachrichtigungen sind im Browser blockiert.';
      save(); render();
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        pc.enabled = false; pc.status = 'fehler';
        pc.error = 'Abo im Browser entfernt – bitte neu aktivieren.';
        save(); render();
        return;
      }
      // Ist das Abo noch dem aktuellen WG-Schluessel zugeordnet?
      // Nach einem neuen Schluessel muss es neu angemeldet werden.
      try {
        const auth = await pushAuth();
        if (pc.auth && pc.auth !== auth) {
          const j = sub.toJSON();
          await fetch((pc.url || c.url).replace(/\/$/, '') + '/push/sub', {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, dev: deviceId(), hour: pc.hour, tz: tzHours() })
          });
          pc.auth = auth;
        } else if (!pc.auth) {
          pc.auth = auth;
        }
      } catch (e) { /* egal */ }
      pc.status = 'aktiv';
      save();
      pushCredToWorker(reg);
    } catch (e) { /* egal */ }
  }

  /* ---------- App-Badge: offene eigene Aufgaben ---------- */
  function openTasksOfUser(idx) {
    let n = 0;
    state.rooms.forEach((r) => {
      if (assigneeFor(r.id, idx) !== state.currentUser) return;
      dueTasks(r, idx).forEach((t) => { if (!doneEntry(r.id, t.id, idx)) n++; });
    });
    return n;
  }
  function updateBadge() {
    try {
      if (!navigator.setAppBadge) return;
      const n = openTasksOfUser(currentIndex());
      if (n > 0) navigator.setAppBadge(n);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* Badge-API nicht verfügbar (z. B. iOS ohne Installation) */ }
  }

  /* ---------- Woche ---------- */
  function viewWeek() {
    const idx = currentIndex();
    const p = weekProgress(idx);
    const done = weekDone(idx);
    const myRooms = state.rooms.filter((r) => assigneeFor(r.id, idx) === state.currentUser);
    const others = state.rooms.filter((r) => assigneeFor(r.id, idx) !== state.currentUser);
    const sorted = myRooms.concat(others);

    if (!state.members.length) {
      return '<div class="empty"><div class="empty__ico">👋</div><h3>Noch keine Mitglieder</h3>' +
        '<p>Lege unter <strong>Turnus → Mitglieder</strong> deine WG-Mitglieder an, dann läuft der Plan.</p>' +
        '<p style="margin-top:14px"><button class="btn btn--primary" data-action="goto-members">Mitglieder anlegen</button></p></div>';
    }

    let html = '';
    html += '<section class="card hero">' +
      ring(p.pct) +
      '<div class="hero__txt"><h2>' + (p.total === 0 ? 'Alles klar diese Woche' : (p.done === p.total ? 'Alles erledigt 🎉' : p.done + ' von ' + p.total + ' erledigt')) + '</h2>' +
      '<p>' + heroSub(idx, p) + '</p></div>' +
      '</section>';

    // Filter: alle Räume oder nur die, die an mir hängen
    const onlyMine = ui.weekFilter === 'mine';
    html += '<div class="segmented" style="margin-bottom:12px">' +
      '<button data-action="week-filter" data-filter="all" class="' + (!onlyMine ? 'is-active' : '') + '">Alle Räume</button>' +
      '<button data-action="week-filter" data-filter="mine" class="' + (onlyMine ? 'is-active' : '') + '">Meine Aufgaben</button>' +
      '</div>';

    if (state.rooms.length === 0) {
      html += '<div class="empty"><div class="empty__ico">🧽</div><h3>Noch keine Räume</h3>' +
        '<p>Lege im Tab <strong>Turnus → Räume</strong> die Bereiche fest, die geputzt werden.</p>' +
        '<p style="margin-top:14px"><button class="btn btn--primary" data-action="goto-rooms">Räume anlegen</button></p></div>';
      return html;
    }

    const shown = onlyMine ? sorted.filter((r) => assigneeFor(r.id, idx) === state.currentUser) : sorted;
    if (onlyMine && !shown.length) {
      html += '<div class="empty"><div class="empty__ico">🎉</div><h3>Heute nichts für dich</h3>' +
        '<p>In dieser Woche ist dir kein Raum zugeteilt. Schau in den <strong>Turnus</strong>, wer als Nächstes dran ist.</p>' +
        '<p style="margin-top:14px"><button class="btn" data-action="week-filter" data-filter="all">Alle Räume zeigen</button></p></div>';
      return html;
    }
    shown.forEach((r) => { html += roomCard(r, idx, done); });
    html += quickAddCard(idx);
    return html;
  }

  /* ---------- Schnellerfassung (Schritt 3) ---------- */
  function quickAddCard(idx) {
    if (!state.rooms.length) return '';
    const def = state.quickDefaults || { freq: 'w', p: 1 };
    return '<div class="card"><div class="card__head"><h3>Schnell Aufgabe anlegen</h3>' +
      '<span class="card__sub">' + FREQ_LABEL[def.freq] + ' · ' + clampPoints(def.p) + ' P</span></div>' +
      '<div class="quickadd">' +
      '<select class="input" id="qa-room">' +
      state.rooms.map((r) => '<option value="' + r.id + '">' + esc(r.icon || '') + ' ' + esc(r.name) + '</option>').join('') +
      '</select>' +
      '<input class="input" id="qa-title" placeholder="Aufgabe eintippen …">' +
      '<button class="btn btn--primary" data-action="quick-add">＋</button>' +
      '</div>' +
      '<p class="hint" style="margin-top:8px">Frequenz und Punkte werden von der zuletzt angelegten Aufgabe übernommen – änderbar im Aufgaben-Dialog.</p>' +
      '</div>';
  }

  function heroSub(idx, p) {
    if (p.total === 0) return 'Keine Aufgaben in dieser Woche.';
    const mine = state.rooms.filter((r) => assigneeFor(r.id, idx) === state.currentUser);
    let mineTotal = 0, mineDone = 0;
    mine.forEach((r) => dueTasks(r, idx).forEach((t) => {
      mineTotal++;
      if (doneEntry(r.id, t.id, idx)) mineDone++;
    }));
    const me = member(state.currentUser);
    if (mineTotal && mineDone < mineTotal) {
      return me.name + ': noch ' + (mineTotal - mineDone) + (mineTotal - mineDone === 1 ? ' Aufgabe' : ' Aufgaben') + ' für dich.';
    }
    if (mineTotal) return 'Alles erledigt, ' + me.name + ' – die anderen sind dran.';
    return 'Die anderen sind dran. ' + p.done + '/' + p.total + ' geschafft.';
  }

  function ring(pct) {
    const C = 2 * Math.PI * 27;
    return '<svg class="hero__ring" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="7"/>' +
      '<circle cx="32" cy="32" r="27" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" ' +
      'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="37" text-anchor="middle" fill="#fff" font-size="16" font-weight="700">' + pct + '%</text></svg>';
  }

  function roomCard(r, idx, done) {
    const tasks = dueTasks(r, idx);
    const doneCount = tasks.filter((t) => doneEntry(r.id, t.id, idx)).length;
    const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
    const who = member(assigneeFor(r.id, idx));
    const mine = assigneeFor(r.id, idx) === state.currentUser;
    const later = r.tasks.length - tasks.length;
    const note = (state.weeks[weekKey(idx)] && state.weeks[weekKey(idx)].notes && state.weeks[weekKey(idx)].notes[r.id]) || '';

    let html = '<section class="card room' + (tasks.length && doneCount === tasks.length ? ' room__done' : '') + '">';
    html += '<div class="room__head">' +
      '<div class="room__icon" style="background:' + r.color + '22">' + esc(r.icon || '🧽') + '</div>' +
      '<div class="room__meta"><h3>' + esc(r.name) +
      (mine ? ' <span class="pill pill--accent">Du</span>' : '') +
      (r.mode === 'fixed' ? ' <span class="pill" title="Feste Zuordnung">🔒 fest</span>' : '') + '</h3>' +
      '<p>' + (r.mode === 'fixed'
        ? (who ? '🔒 Immer ' + who.emoji + ' ' + esc(who.name) : '🔒 Keine Person fest zugeordnet')
        : (who ? who.emoji + ' ' + esc(who.name) + ' ist dran' : 'Niemand ist dran')) +
      (later > 0 ? ' · ' + later + ' später' : '') + '</p></div>' +
      '<div class="room__prog">' + doneCount + '/' + tasks.length + '</div>' +
      '</div>';

    if (!tasks.length) {
      html += '<div class="task"><div class="task__label" style="color:var(--muted)">In dieser Woche ist hier nichts fällig.</div></div>';
    }
    tasks.forEach((t) => {
      const e = doneEntry(r.id, t.id, idx);
      const by = e ? member(e.by) : null;
      html += '<div class="task' + (e ? ' is-done' : '') + '" data-action="task" data-room="' + r.id + '" data-task="' + t.id + '">' +
        '<div class="task__box">✓</div>' +
        '<div class="task__label">' + esc(t.title) +
        (t.freq !== 'w' ? '<div class="task__meta">' + FREQ_LABEL[t.freq] + '</div>' : '') + '</div>' +
        (e && by ? '<div class="task__by"><span class="chip-avatar chip-avatar--sm" style="background:' + by.color + '">' + by.emoji + '</span>' + esc(by.name) + '</div>' : '') +
        '<div class="task__pts">' + clampPoints(t.p) + ' P</div>' +
        '<button class="task__edit" data-action="task-edit" data-room="' + r.id + '" data-task="' + t.id + '" aria-label="Aufgabe bearbeiten">✎</button>' +
        '</div>';
    });

    html += '<div class="room__foot">' +
      '<button class="btn btn--sm" data-action="room-note" data-room="' + r.id + '">📝 ' + (note ? 'Notiz ansehen' : 'Notiz') + '</button>' +
      (doneCount < tasks.length
        ? '<button class="btn btn--sm btn--primary" data-action="room-all" data-room="' + r.id + '">' +
          (mine ? 'Alles erledigt' : 'Alles für mich erledigt') + '</button>'
        : '<span class="pill pill--ok" style="align-self:center">✓ fertig</span>') +
      '</div>';
    if (note) html += '<div style="padding:0 14px 12px"><div class="notice">📝 ' + esc(note) + '</div></div>';
    html += '</section>';
    return html;
  }

  /* ---------- Turnus ---------- */
  function viewPlan() {
    const tabs = [['weeks', 'Wochen'], ['members', 'Mitglieder'], ['rooms', 'Räume']];
    let html = '<div class="segmented" style="margin-bottom:14px">' +
      tabs.map((t) => '<button data-action="plan-tab" data-tab="' + t[0] + '" class="' + (ui.planTab === t[0] ? 'is-active' : '') + '">' + t[1] + '</button>').join('') +
      '</div>';
    if (ui.planTab === 'weeks') html += planWeeks();
    else if (ui.planTab === 'members') html += planMembers();
    else html += planRooms();
    return html;
  }

  function planWeeks() {
    const base = weekIndexOf(new Date());
    const weeks = [0, 1, 2, 3, 4, 5].map((o) => base + o);
    const rooms = state.rooms;
    let html = '<div class="card" style="padding:14px 0"><div class="tablewrap"><table class="table"><thead><tr><th>Raum</th>' +
      weeks.map((w) => '<th>' + (w === base ? 'jetzt' : 'KW ' + isoWeek(weekStart(w)).week) + '</th>').join('') +
      '</tr></thead><tbody>';
    rooms.forEach((r) => {
      html += '<tr><td>' + esc(r.icon || '') + ' ' + esc(r.name) +
        (r.mode === 'fixed' ? ' <span title="Feste Zuordnung">🔒</span>' : '') + '</td>';
      weeks.forEach((w) => {
        const a = assigneeFor(r.id, w);
        const m = member(a);
        const mine = a === state.currentUser;
        html += '<td class="' + (mine ? 'is-mine-cell' : '') + '"><span class="cell">' +
          (m ? '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' : '–') +
          (m ? esc(m.name.split(' ')[0]) : '') + '</span></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="card"><div class="card__head"><h3>Turnus anpassen</h3></div>' +
      '<p class="hint">Die Reihenfolge der Mitglieder bestimmt, wer im Wechsel dran ist. Mit dem Schalter "Verschieben" rückt eine Person im Turnus vor.</p>' +
      '<div style="margin-top:12px">';
    activeOrder().forEach((id, i) => {
      const m = member(id);
      html += '<div class="row"><span class="chip-avatar" style="background:' + m.color + '">' + m.emoji + '</span>' +
        '<div class="row__main"><strong>' + esc(m.name) + '</strong><span>' + (i === 0 ? 'Erste Person im Turnus' : 'Position ' + (i + 1)) + '</span></div>' +
        '<div class="row__actions">' +
        '<button class="btn btn--sm btn--icon" data-action="move-up" data-member="' + id + '" ' + (i === 0 ? 'disabled' : '') + '>▲</button>' +
        '<button class="btn btn--sm btn--icon" data-action="move-down" data-member="' + id + '" ' + (i === activeOrder().length - 1 ? 'disabled' : '') + '>▼</button>' +
        '</div></div>';
    });
    html += '</div></div>';

    html += '<div class="card"><div class="card__head"><h3>Raumzuordnung</h3>' +
      '<button class="btn btn--sm" data-action="auto-balance">⚖️ Automatisch verteilen</button></div>' +
      '<p class="card__sub" style="margin:-4px 0 10px">Je Raum entweder wechselnd im Turnus oder fest einer Person zugeteilt</p>';
    state.rooms.forEach((r) => {
      const off = state.offsets[r.id] || 0;
      const fixed = r.mode === 'fixed';
      const fm = member(r.fixedMember);
      html += '<div class="row roommode"><div class="row__main"><strong>' + esc(r.icon || '') + ' ' + esc(r.name) + '</strong>' +
        '<span>' + (fixed
          ? (fm ? 'Immer ' + esc(fm.name) : 'Keine Person gewählt')
          : (off === 0 ? 'Startet bei Position 1' : 'Startet bei Position ' + (off + 1))) + '</span></div>' +
        '<div class="row__actions">' +
        '<div class="segmented segmented--sm">' +
        '<button data-action="room-mode" data-room="' + r.id + '" data-mode="rotation" class="' + (!fixed ? 'is-active' : '') + '">Wechselnd</button>' +
        '<button data-action="room-mode" data-room="' + r.id + '" data-mode="fixed" class="' + (fixed ? 'is-active' : '') + '">Fest</button>' +
        '</div>' +
        (fixed ? '' :
          '<button class="btn btn--sm btn--icon" data-action="offset" data-room="' + r.id + '" data-delta="-1">−</button>' +
          '<button class="btn btn--sm btn--icon" data-action="offset" data-room="' + r.id + '" data-delta="1">+</button>') +
        '</div></div>';
      if (fixed) {
        html += '<div class="fixedpick">';
        state.members.forEach((m) => {
          html += '<button class="chip' + (r.fixedMember === m.id ? ' chip--active' : '') + '" data-action="room-fixed" data-room="' + r.id + '" data-member="' + m.id + '">' +
            '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' + esc(m.name) + '</button>';
        });
        html += '</div>';
      }
    });
    html += '</div>';

    html += '<div class="card"><div class="card__head"><h3>Plan teilen</h3></div>' +
      '<p class="hint">Erzeuge einen Code und schicke ihn per Messenger an die WG. Alle können den Stand damit übernehmen.</p>' +
      '<div class="row" style="border:0"><div class="row__actions" style="flex:1">' +
      '<button class="btn btn--primary btn--block" data-action="share">Code erzeugen</button></div></div>' +
      '<button class="btn btn--block" data-action="import-open">Code einfügen</button></div>';
    return html;
  }

  function planMembers() {
    let html = '<div class="card"><div class="card__head"><h3>Mitglieder</h3><span class="card__sub">' + state.members.length + ' Personen</span></div>';
    state.members.forEach((m) => {
      const p = pointsOf(m.id);
      html += '<div class="row"><span class="chip-avatar" style="background:' + m.color + '">' + m.emoji + '</span>' +
        '<div class="row__main"><strong>' + esc(m.name) + (m.id === state.currentUser ? ' <span class="pill pill--accent">Du</span>' : '') + '</strong>' +
        '<span>' + plural(p, 'Punkt', 'Punkte') + ' · ' + plural(tasksDoneBy(m.id), 'Aufgabe', 'Aufgaben') + '</span></div>' +
        '<div class="row__actions">' +
        '<button class="btn btn--sm" data-action="set-user" data-member="' + m.id + '">Ich</button>' +
        '<button class="btn btn--sm" data-action="edit-member" data-member="' + m.id + '">✎</button>' +
        '</div></div>';
    });
    html += '<button class="btn btn--block btn--primary" style="margin-top:12px" data-action="add-member">+ Person hinzufügen</button></div>';

    html += '<div class="card"><div class="card__head"><h3>Turnus-Reihenfolge</h3></div><p class="hint">Wer oben steht, ist öfter an Position 1. Die Reihenfolge lässt sich auch hier ändern.</p>';
    activeOrder().forEach((id, i) => {
      const m = member(id);
      html += '<div class="row"><span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' +
        '<div class="row__main"><strong>' + esc(m.name) + '</strong><span>Position ' + (i + 1) + '</span></div>' +
        '<div class="row__actions">' +
        '<button class="btn btn--sm btn--icon" data-action="move-up" data-member="' + id + '" ' + (i === 0 ? 'disabled' : '') + '>▲</button>' +
        '<button class="btn btn--sm btn--icon" data-action="move-down" data-member="' + id + '" ' + (i === activeOrder().length - 1 ? 'disabled' : '') + '>▼</button>' +
        '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function planRooms() {
    let html = '<div class="card"><div class="card__head"><h3>Räume & Aufgaben</h3>' +
      '<button class="btn btn--sm btn--primary" data-action="task-new">+ Aufgabe</button></div>';
    if (!state.rooms.length) {
      html += '<p class="hint">Lege zuerst einen Raum an, dann kannst du Aufgaben dazugeben.</p>' +
        '<button class="btn btn--block btn--primary" style="margin-top:12px" data-action="add-room">+ Raum hinzufügen</button></div>';
      return html;
    }
    state.rooms.forEach((r) => {
      const w = dueTasks(r, weekIndexOf(new Date())).length;
      const who = member(assigneeFor(r.id, weekIndexOf(new Date())));
      html += '<div class="roomblock">' +
        '<div class="row"><div class="room__icon" style="background:' + r.color + '22">' + esc(r.icon || '🧽') + '</div>' +
        '<div class="row__main"><strong>' + esc(r.name) +
        (r.mode === 'fixed' ? ' <span class="pill">🔒 fest</span>' : '') + '</strong>' +
        '<span>' + (r.mode === 'fixed'
          ? '🔒 immer ' + (who ? who.emoji + ' ' + esc(who.name) : 'niemand')
          : 'diese Woche ' + (who ? who.emoji + ' ' + esc(who.name) : 'niemand')) +
        ' · ' + plural(r.tasks.length, 'Aufgabe', 'Aufgaben') + ' · ' + w + ' fällig</span></div>' +
        '<div class="row__actions"><button class="btn btn--sm" data-action="edit-room" data-room="' + r.id + '">✎</button>' +
        '<button class="btn btn--sm btn--danger" data-action="del-room" data-room="' + r.id + '">✕</button></div></div>';
      if (!r.tasks.length) {
        html += '<div class="taskrow taskrow--empty">Noch keine Aufgaben in diesem Raum</div>';
      }
      r.tasks.forEach((t) => {
        html += '<button class="taskrow" data-action="task-edit" data-room="' + r.id + '" data-task="' + t.id + '">' +
          '<span class="taskrow__title">' + esc(t.title) + '</span>' +
          '<span class="taskrow__meta">' + FREQ_LABEL[t.freq] + '</span>' +
          '<span class="taskrow__pts">' + clampPoints(t.p) + ' P</span>' +
          '<span class="taskrow__pen">✎</span></button>';
      });
      html += '<button class="btn btn--sm btn--block taskrow__add" data-action="task-new" data-room="' + r.id + '">+ Aufgabe in ' + esc(r.name) + '</button>' +
        '</div>';
    });
    html += '<button class="btn btn--block btn--primary" style="margin-top:12px" data-action="add-room">+ Raum hinzufügen</button></div>';
    return html;
  }

  /* ---------- Statistik ---------- */
  function fairnessOf(list) {
    const vals = list.map((m) => pointsOf(m.id));
    const sum = vals.reduce((a, b) => a + b, 0);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals);
    const spread = max - min;
    const rel = sum ? spread / sum : 0;
    let label, text, ok;
    if (rel <= 0.15) {
      label = 'gut verteilt'; ok = true;
      text = 'Die Punkte liegen nah beieinander – die Arbeit ist gerecht verteilt.';
    } else if (rel <= 0.4) {
      label = 'leichte Unterschiede'; ok = false;
      text = 'Die Arbeit ist überwiegend verteilt, einzelne haben etwas mehr übernommen (Spanne: ' + spread + ' Punkte).';
    } else {
      label = 'deutliche Unterschiede'; ok = false;
      text = 'Die Last ist ungleich verteilt (Spanne: ' + spread + ' Punkte). Mit „Automatisch verteilen“ oder festen Räumen lässt sich das ausgleichen.';
    }
    return { label, text, ok, sum, max, min, spread };
  }

  function viewStats() {
    const idx = currentIndex();
    const p = weekProgress(idx);
    const pts = state.members.map((m) => ({ m, p: pointsOf(m.id), n: tasksDoneBy(m.id) }));
    const max = Math.max(1, ...pts.map((x) => x.p));
    const sum = pts.reduce((a, b) => a + b.p, 0);

    let html = '<div class="card"><div class="card__head"><h3>Punkte</h3><span class="card__sub">gesamt ' + plural(sum, 'Punkt', 'Punkte') + '</span></div>';
    if (!pts.length) html += '<p class="hint">Noch keine Punkte vergeben.</p>';
    pts.sort((a, b) => b.p - a.p).forEach((x) => {
      html += '<div style="margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:9px">' +
        '<span class="chip-avatar chip-avatar--sm" style="background:' + x.m.color + '">' + x.m.emoji + '</span>' +
        '<strong style="flex:1;font-size:14.5px">' + esc(x.m.name) + '</strong>' +
        '<span style="font-weight:750;font-size:14px">' + x.p + ' P</span></div>' +
        '<div class="bar"><div class="bar__fill" style="width:' + Math.round((x.p / max) * 100) + '%;background:' + x.m.color + '"></div></div>' +
        '<div class="hint" style="margin-top:4px">' + plural(x.n, 'Aufgabe', 'Aufgaben') + ' erledigt' + (x.m.id === state.currentUser ? ' · das bist du' : '') + '</div>' +
        '</div>';
    });
    html += '</div>';

    const base = weekIndexOf(new Date());
    const weeks = [];
    for (let o = 7; o >= 0; o--) weeks.push(base - o);
    const wMax = Math.max(1, ...weeks.map((w) => weekPointTotal(w)));
    html += '<div class="card"><div class="card__head"><h3>Aktivität</h3><span class="card__sub">letzte 8 Wochen</span></div><div class="spark">';
    weeks.forEach((w) => {
      const v = weekPointTotal(w);
      const h = Math.round((v / wMax) * 100);
      html += '<div class="spark__bar"><span style="height:' + Math.max(6, h) + '%"></span></div>';
    });
    html += '</div><div class="spark__labels">';
    weeks.forEach((w) => { html += '<span>KW ' + isoWeek(weekStart(w)).week + '</span>'; });
    html += '</div></div>';

    // ---- Fairness: wie gleichmäßig sind die Punkte verteilt? ----
    const active = state.members.filter((m) => pointsOf(m.id) > 0);
    html += '<div class="card"><div class="card__head"><h3>Fairness</h3>' +
      (active.length > 1 ? '<span class="pill ' + (fairnessOf(active).ok ? 'pill--ok' : 'pill--warn') + '">' + fairnessOf(active).label + '</span>' : '') +
      '</div>';
    if (active.length < 2) {
      html += '<p class="hint">Sobald mindestens zwei Personen Punkte haben, sieht man hier, wie gleichmäßig die Arbeit verteilt ist.</p>';
    } else {
      const f = fairnessOf(active);
      html += '<p class="hint">' + esc(f.text) + '</p>';
      html += '<div style="margin-top:12px">';
      active.slice().sort((a, b) => pointsOf(b.id) - pointsOf(a.id)).forEach((m) => {
        const pv = pointsOf(m.id);
        const share = f.sum ? Math.round((pv / f.sum) * 100) : 0;
        html += '<div style="margin-bottom:10px"><div style="display:flex;gap:9px;align-items:center">' +
          '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' +
          '<strong style="flex:1;font-size:14px">' + esc(m.name) + '</strong>' +
          '<span style="font-size:13px;color:var(--muted)">' + pv + ' P · ' + share + ' %</span></div>' +
          '<div class="bar"><div class="bar__fill" style="width:' + Math.min(100, Math.round((pv / f.max) * 100)) + '%;background:' + m.color + '"></div></div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // ---- Auslastung der nächsten Wochen ----
    const baseAhead = weekIndexOf(new Date());
    const weeksAhead = [0, 1, 2, 3];
    const load = {};
    state.members.forEach((m) => { load[m.id] = { rooms: 0, tasks: 0 }; });
    weeksAhead.forEach((w) => {
      state.rooms.forEach((r) => {
        const a = assigneeFor(r.id, baseAhead + w);
        if (!a || !load[a]) return;
        load[a].rooms++;
        load[a].tasks += dueTasks(r, baseAhead + w).length;
      });
    });
    const maxLoad = Math.max(1, ...state.members.map((m) => load[m.id].tasks));
    html += '<div class="card"><div class="card__head"><h3>Auslastung</h3><span class="card__sub">nächste 4 Wochen</span></div>';
    state.members.slice().sort((a, b) => load[b.id].tasks - load[a.id].tasks).forEach((m) => {
      html += '<div style="margin-bottom:10px"><div style="display:flex;gap:9px;align-items:center">' +
        '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' +
        '<strong style="flex:1;font-size:14px">' + esc(m.name) + '</strong>' +
        '<span style="font-size:13px;color:var(--muted)">Räume · ' + load[m.id].rooms + ' · ' + plural(load[m.id].tasks, 'Aufgabe', 'Aufgaben') + '</span></div>' +
        '<div class="bar"><div class="bar__fill" style="width:' + Math.round((load[m.id].tasks / maxLoad) * 100) + '%;background:' + m.color + '"></div></div>' +
        '</div>';
    });
    html += '<p class="hint">Feste Räume zählen in jeder Woche – das ist gewollt, sie sind ja dauerhaft zugeteilt.</p></div>';

    html += '<div class="card"><div class="card__head"><h3>Diese Woche</h3><span class="card__sub">' + p.done + '/' + p.total + ' erledigt</span></div>';
    state.rooms.forEach((r) => {
      const a = assigneeFor(r.id, idx);
      const m = member(a);
      const tasks = dueTasks(r, idx);
      const d = tasks.filter((t) => doneEntry(r.id, t.id, idx)).length;
      html += '<div class="row"><div class="room__icon" style="background:' + r.color + '22;font-size:16px">' + esc(r.icon || '🧽') + '</div>' +
        '<div class="row__main"><strong>' + esc(r.name) + '</strong><span>' + (m ? m.emoji + ' ' + esc(m.name) : 'niemand') + ' · ' + d + '/' + tasks.length + '</span></div>' +
        (d === tasks.length && tasks.length ? '<span class="pill pill--ok">fertig</span>' : '<span class="pill">' + (tasks.length ? d + '/' + tasks.length : '–') + '</span>') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ---------- Mehr ---------- */
  function viewMore() {
    let html = '<div class="card"><div class="card__head"><h3>WG</h3></div>' +
      '<div class="field"><label>Name der WG</label><input class="input" id="wgname" value="' + esc(state.wgName) + '" placeholder="z. B. Sonnenblumen WG"></div>' +
      '<button class="btn btn--primary btn--block" data-action="save-name">Namen speichern</button></div>';

    html += '<div class="card"><div class="card__head"><h3>Erscheinungsbild</h3></div><div class="segmented">' +
      ['auto', 'light', 'dark'].map((t) => '<button data-action="theme" data-theme="' + t + '" class="' + (state.theme === t ? 'is-active' : '') + '">' +
        (t === 'auto' ? 'Automatisch' : t === 'light' ? 'Hell' : 'Dunkel') + '</button>').join('') + '</div></div>';

    // ---- Live-Sync (Cloudflare) ----
    const sc = syncCfg();
    html += '<div class="card"><div class="card__head"><h3>Live-Sync</h3>' +
      '<span class="pill ' + (sc.status === 'ok' ? 'pill--ok' : (sc.status === 'fehler' ? 'pill--danger' : '')) + '" id="syncbadge">' +
      (sc.status === 'ok' ? 'verbunden' : (sc.status === 'fehler' ? 'Fehler' : 'aus')) + '</span></div>' +
      '<p class="hint" style="margin:-2px 0 12px">Alle Geräte der WG teilen sich dann denselben Stand automatisch – ohne Code kopieren. ' +
      'Der WG-Schlüssel bleibt nur auf den Geräten; gespeichert wird verschlüsselt.</p>' +
      '<div class="field"><label>Server</label><input class="input" id="sync-url" value="' + esc(sc.url) + '" placeholder="' + SYNC_DEFAULT_URL + '"></div>' +
      '<div class="field"><label>WG-Schlüssel</label>' +
      '<div class="row" style="gap:8px;border:0;padding:0">' +
      '<input class="input" id="sync-key" type="password" value="' + esc(sc.key) + '" placeholder="z. B. XKQ7…" style="flex:1">' +
      '<button class="btn btn--sm" data-action="sync-genkey">Neu</button></div>' +
      '<p class="hint" style="margin-top:6px">Diesen Schlüssel den anderen WG-Mitgliedern geben – wer ihn hat, kommt an den Plan.</p></div>' +
      '<label class="switch"><input type="checkbox" id="sync-enc" ' + (sc.enc ? 'checked' : '') + '><span class="switch__ui"></span>' +
      '<span>Ende-zu-Ende-Verschlüsselung (empfohlen)</span></label>' +
      '<label class="switch"><input type="checkbox" id="sync-on" ' + (sc.enabled ? 'checked' : '') + '><span class="switch__ui"></span>' +
      '<span>Live-Sync aktiv</span></label>' +
      '<div id="syncstatus" class="syncstatus syncstatus--' + sc.status + '">' +
      (sc.status === 'fehler' && sc.error ? esc(sc.error) : (sc.lastSync ? 'Zuletzt synchronisiert: ' + new Date(sc.lastSync).toLocaleString('de-DE') : 'Noch nicht synchronisiert')) +
      '</div>' +
      '<div class="row" style="border:0;gap:8px;margin-top:10px">' +
      '<button class="btn" data-action="sync-test" style="flex:1">Verbindung testen</button>' +
      '<button class="btn btn--primary" data-action="sync-now" style="flex:1">Jetzt synchronisieren</button></div>' +
      '<p class="hint" style="margin-top:10px">Hinweis: Der Server liegt bei Cloudflare (R2). Kostenlos, aber pro WG ist der Schlüssel das einzige Zugangsmittel – verloren heißt: neu aufsetzen.</p>' +
      '</div>';

    // ---- Erinnerungen (Web-Push) ----
    const pc = pushCfg();
    let pushHtml = '<div class="card"><div class="card__head"><h3>Erinnerungen</h3>' +
      '<span class="pill ' + (pc.status === 'aktiv' ? 'pill--ok' : (pc.status === 'fehler' ? 'pill--danger' : '')) + '" id="pushbadge">' +
      (pc.status === 'aktiv' ? 'aktiv' : (pc.status === 'fehler' ? 'Fehler' : 'aus')) + '</span></div>';
    if (!pushSupported()) {
      pushHtml += '<p class="hint">Dieser Browser kann keine Push-Nachrichten senden. Der Plan bleibt trotzdem synchron.</p>';
    } else {
      pushHtml += '<p class="hint" style="margin:-2px 0 12px">Kurze Nachricht, wenn sich der Plan ändert oder deine Erinnerungszeit kommt. ' +
        'Die Nachricht enthält keine Details – der Server sieht nur Chiffretext.</p>';
      if (pushPermission() === 'denied') {
        pushHtml += '<div class="notice" style="background:#ffe4ea">Benachrichtigungen sind im Browser blockiert. Bitte in den Website-Einstellungen erlauben.</div>';
      }
      if (!isStandalone() && isIOS()) {
        pushHtml += '<div class="notice">Auf iPhone und iPad kommen Benachrichtigungen nur, wenn die App zum Home-Bildschirm hinzugefügt wurde.</div>';
      }
      pushHtml += '<div id="pushstatus" class="syncstatus syncstatus--' + pc.status + '">' +
        (pc.status === 'fehler' && pc.error ? esc(pc.error) :
          (pc.status === 'aktiv' ? 'Benachrichtigungen sind aktiv.' : 'Noch nicht aktiv.')) +
        '</div>';
      pushHtml += '<div class="row" style="border:0;gap:8px;margin-top:10px">' +
        (pc.enabled
          ? '<button class="btn" data-action="push-off" style="flex:1">Ausschalten</button>'
          : '<button class="btn btn--primary" data-action="push-on" style="flex:1">Aktivieren</button>') +
        '<button class="btn" data-action="push-test" style="flex:1">Testnachricht</button></div>';
      pushHtml += '<div class="field" style="margin-top:12px"><label>Tägliche Erinnerung</label>' +
        '<select class="input" id="push-hour">' +
        PUSH_HOURS.map(function (h) { return '<option value="' + h.v + '"' + (pc.hour === h.v ? ' selected' : '') + '>' + h.t + '</option>'; }).join('') +
        '</select><p class="hint" style="margin-top:6px">Eine Erinnerung am Tag reicht meistens – wer putzt, sieht sie ohnehin im Plan.</p></div>';
    }
    pushHtml += '</div>';
    html += pushHtml;

    html += '<div class="card"><div class="card__head"><h3>Daten teilen & sichern</h3></div>' +
      '<p class="hint">Ohne Konto: Der Stand liegt auf jedem Gerät. Mit einem Code bringst du ihn zu den anderen – oder per Datei auf den Rechner.</p>' +
      '<div class="row" style="border:0;padding-bottom:6px"><div class="row__actions" style="flex:1;flex-wrap:wrap">' +
      '<button class="btn btn--primary" data-action="share">Code erzeugen</button>' +
      '<button class="btn" data-action="import-open">Code einfügen</button></div></div>' +
      '<div class="row" style="border:0"><div class="row__actions" style="flex:1;flex-wrap:wrap">' +
      '<button class="btn" data-action="export-file">Als Datei sichern</button>' +
      '<button class="btn" data-action="import-file">Datei einlesen</button></div></div></div>';

    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    html += '<div class="card"><div class="card__head"><h3>Als App installieren</h3>' +
      (standalone ? '<span class="pill pill--ok">installiert</span>' : '') + '</div>';
    if (!standalone && installPrompt) {
      html += '<button class="btn btn--primary btn--block" data-action="install" style="margin-bottom:10px">App installieren</button>';
    }
    html += '<p class="hint"><strong>iPhone / iPad:</strong> Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.<br><br>' +
      '<strong>Android:</strong> Chrome öffnen → Drei-Punkte-Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</p></div>';

    html += '<div class="card"><div class="card__head"><h3>Info</h3></div>' +
      '<div class="row"><div class="row__main"><strong>WG-Putzplan</strong><span>Version 1.0 · offlinefähig</span></div></div>' +
      '<div class="row"><div class="row__main"><strong>Letzte Änderung</strong><span>' + new Date(state.updatedAt || Date.now()).toLocaleString('de-DE') + '</span></div></div>' +
      '<button class="btn btn--danger btn--block" style="margin-top:12px" data-action="reset">Alles zurücksetzen</button></div>';
    return html;
  }

  /* =========================================================
     Sheets (Bottom-Sheets)
     ========================================================= */
  function openSheet(title, bodyHtml, actionsHtml) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = bodyHtml;
    $('#sheet-actions').innerHTML = actionsHtml || '<button class="btn" data-action="close-sheet">Schließen</button>';
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- Person wählen ---------- */
  function sheetPickUser() {
    let body = '';
    state.members.forEach((m) => {
      body += '<button class="opt" data-action="set-user" data-member="' + m.id + '">' +
        '<span class="chip-avatar" style="background:' + m.color + '">' + m.emoji + '</span>' +
        '<span class="opt__main"><strong>' + esc(m.name) + '</strong><span>' + plural(pointsOf(m.id), 'Punkt', 'Punkte') + ' · ' + plural(tasksDoneBy(m.id), 'Aufgabe', 'Aufgaben') + '</span></span>' +
        (m.id === state.currentUser ? '<span class="pill pill--accent">Du</span>' : '') + '</button>';
    });
    body += '<button class="opt" data-action="add-member"><span class="opt__ico">➕</span><span class="opt__main"><strong>Person hinzufügen</strong></span></button>';
    openSheet('Wer bist du?', body, '<button class="btn" data-action="close-sheet">Schließen</button>');
  }

  /* ---------- Person bearbeiten ---------- */
  function sheetEditMember(id) {
    const m = member(id);
    if (!m) return;
    const body =
      '<div class="field"><label>Name</label><input class="input" id="m-name" value="' + esc(m.name) + '"></div>' +
      '<div class="field"><label>Symbol</label><div id="m-emoji">' +
      EMOJIS.map((e) => '<button class="chip' + (e === m.emoji ? ' chip--active' : '') + '" data-action="pick-emoji" data-emoji="' + e + '" style="font-size:19px">' + e + '</button>').join('') +
      '</div></div>' +
      '<div class="field"><label>Farbe</label><div id="m-color">' +
      MEMBER_COLORS.map((c) => '<button class="chip' + (c === m.color ? ' chip--active' : '') + '" data-action="pick-color" data-color="' + c + '" style="background:' + c + ';width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ' + (c === m.color ? 'var(--text)' : 'transparent') + '"></button>').join('') +
      '</div></div>';
    openSheet('Person bearbeiten', body,
      '<button class="btn" data-action="save-member" data-member="' + id + '">Speichern</button>' +
      '<button class="btn btn--danger" data-action="del-member" data-member="' + id + '">Löschen</button>');
  }

  function sheetAddMember() {
    const body =
      '<div class="field"><label>Name</label><input class="input" id="m-name" placeholder="z. B. Alex"></div>' +
      '<div class="field"><label>Symbol</label><div id="m-emoji">' +
      EMOJIS.map((e) => '<button class="chip' + (e === EMOJIS[0] ? ' chip--active' : '') + '" data-action="pick-emoji" data-emoji="' + e + '" style="font-size:19px">' + e + '</button>').join('') +
      '</div></div>' +
      '<div class="field"><label>Farbe</label><div id="m-color">' +
      MEMBER_COLORS.map((c, i) => '<button class="chip' + (i === state.members.length % MEMBER_COLORS.length ? ' chip--active' : '') + '" data-action="pick-color" data-color="' + c + '" style="background:' + c + ';width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ' + (i === state.members.length % MEMBER_COLORS.length ? 'var(--text)' : 'transparent') + '"></button>').join('') +
      '</div></div>';
    openSheet('Neue Person', body,
      '<button class="btn" data-action="save-member" data-new="1">Hinzufügen</button>' +
      '<button class="btn" data-action="close-sheet">Abbrechen</button>');
  }

  /* ---------- Raum bearbeiten ---------- */
  function sheetEditRoom(id) {
    const r = room(id);
    if (!r) return;
    let body =
      '<div class="field"><label>Name des Raums</label><input class="input" id="r-name" value="' + esc(r.name) + '"></div>' +
      '<div class="field"><label>Symbol (Emoji)</label><input class="input" id="r-icon" value="' + esc(r.icon || '') + '" maxlength="4"></div>' +
      '<div class="field"><label>Farbe</label><div id="r-color">' +
      MEMBER_COLORS.map((c) => '<button class="chip' + (c === r.color ? ' chip--active' : '') + '" data-action="pick-rcolor" data-color="' + c + '" style="background:' + c + ';width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ' + (c === r.color ? 'var(--text)' : 'transparent') + '"></button>').join('') +
      '</div></div>' +
      '<div class="field"><label>Zuordnung</label><div class="segmented" id="r-mode">' +
      '<button data-action="pick-mode" data-mode="rotation" class="' + (r.mode !== 'fixed' ? 'is-active' : '') + '">Wechselnd</button>' +
      '<button data-action="pick-mode" data-mode="fixed" class="' + (r.mode === 'fixed' ? 'is-active' : '') + '">Fest</button>' +
      '</div></div>';
    if (r.mode === 'fixed') {
      body += '<div class="field" id="fixedwrap"><label>Feste Person</label><div id="r-fixed">' +
        state.members.map((m) => '<button class="chip' + (r.fixedMember === m.id ? ' chip--active' : '') + '" data-action="pick-fixed" data-member="' + m.id + '">' +
          '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' + esc(m.name) + '</button>').join('') +
        '</div></div>';
    } else {
      body += '<div class="field" id="fixedwrap" style="display:none"><label>Feste Person</label><div id="r-fixed">' +
        state.members.map((m) => '<button class="chip" data-action="pick-fixed" data-member="' + m.id + '">' +
          '<span class="chip-avatar chip-avatar--sm" style="background:' + m.color + '">' + m.emoji + '</span>' + esc(m.name) + '</button>').join('') +
        '</div></div>';
    }
    body += '<p class="hint">Aufgaben des Raums findest du im Tab „Räume“ – tippe dort auf eine Aufgabe, um sie zu bearbeiten.</p>';
    openSheet('Raum bearbeiten', body,
      '<button class="btn" data-action="save-room" data-room="' + r.id + '">Speichern</button>' +
      '<button class="btn btn--danger" data-action="del-room" data-room="' + r.id + '">Löschen</button>');
  }

  /* ---------- Aufgabe erstellen / bearbeiten ---------- */
  function sheetTaskEditor(roomId, taskId) {
    const editing = !!taskId;
    if (!state.rooms.length) { toast('Erst einen Raum anlegen'); return; }
    let t = null, r0 = room(roomId) || state.rooms[0];
    if (editing) {
      state.rooms.forEach((rr) => rr.tasks.forEach((x) => { if (x.id === taskId) { t = x; r0 = rr; } }));
      if (!t) { toast('Aufgabe nicht gefunden'); return; }
    }
    const curRoom = r0;
    const curPts = t ? clampPoints(t.p) : 1;

    let body =
      '<div class="field"><label>Raum</label><select class="input" id="t-room">' +
      state.rooms.map((r) => '<option value="' + r.id + '"' + (r.id === curRoom.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Was ist zu tun?</label><input class="input" id="t-title" placeholder="z. B. Geschirr abwaschen" value="' + (t ? esc(t.title) : '') + '"></div>' +
      '<div class="field"><label>Wie oft?</label><select class="input" id="t-freq">' +
      ['w', '2w', 'm'].map((f) => '<option value="' + f + '"' + (t && t.freq === f ? ' selected' : '') + '>' + FREQ_LABEL[f] + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Punkte</label><div class="points" id="t-points">' +
      [1, 2, 3, 4].map((p) => '<button class="points__btn' + (p === curPts ? ' is-active' : '') + '" data-action="pick-points" data-p="' + p + '">' +
        '<strong>' + p + '</strong><span>P</span></button>').join('') +
      '</div><p class="hint" style="margin-top:6px">Wie viel die Aufgabe wert ist – z. B. 1 Punkt für Geschirr, 4 Punkte für Bad putzen.</p></div>';
    if (editing) {
      body += '<div class="field"><label>Erledigt in der Historie</label><p class="hint">Bereits erledigte Einträge bleiben bestehen – auch wenn du die Aufgabe änderst oder in einen anderen Raum verschiebst.</p></div>';
    }
    openSheet(editing ? 'Aufgabe bearbeiten' : 'Aufgabe erstellen', body,
      '<button class="btn btn--primary" data-action="save-task" data-task="' + (t ? t.id : '') + '" data-room="' + curRoom.id + '">' +
      (editing ? 'Speichern' : 'Anlegen') + '</button>' +
      (editing ? '<button class="btn btn--danger" data-action="del-task" data-room="' + curRoom.id + '" data-task="' + t.id + '">Löschen</button>'
        : '<button class="btn" data-action="close-sheet">Abbrechen</button>'));
  }

  function sheetAddRoom() {
    const body =
      '<div class="field"><label>Name des Raums</label><input class="input" id="r-name" placeholder="z. B. Flur"></div>' +
      '<div class="field"><label>Symbol (Emoji)</label><input class="input" id="r-icon" value="🧽" maxlength="4"></div>' +
      '<div class="field"><label>Farbe</label><div id="r-color">' +
      MEMBER_COLORS.map((c, i) => '<button class="chip' + (i === 0 ? ' chip--active' : '') + '" data-action="pick-rcolor" data-color="' + c + '" style="background:' + c + ';width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ' + (i === 0 ? 'var(--text)' : 'transparent') + '"></button>').join('') +
      '</div></div>' +
      '<div class="field"><label>Erste Aufgabe (optional)</label><input class="input" id="r-task-title" placeholder="z. B. Staubsaugen"></div>';
    openSheet('Neuer Raum', body,
      '<button class="btn" data-action="save-room" data-new="1">Anlegen</button>' +
      '<button class="btn" data-action="close-sheet">Abbrechen</button>');
  }

  /* ---------- Notiz ---------- */
  function sheetRoomNote(roomId) {
    const r = room(roomId);
    const idx = currentIndex();
    const wk = state.weeks[weekKey(idx)] || {};
    const note = (wk.notes && wk.notes[roomId]) || '';
    openSheet('Notiz · ' + r.name,
      '<div class="field"><textarea class="textarea" id="note-text" placeholder="z. B. Mülltonnen stehen noch draußen">' + esc(note) + '</textarea></div>',
      '<button class="btn btn--primary" data-action="save-note" data-room="' + roomId + '">Speichern</button>' +
      '<button class="btn" data-action="close-sheet">Abbrechen</button>');
  }

  /* ---------- Teilen / Import ---------- */
  function sheetShare() {
    const body =
      '<p class="hint" style="margin-bottom:10px">Dieser Code enthält den kompletten Stand (Mitglieder, Räume, Aufgaben, Erledigtes). Schicke ihn per WhatsApp, Signal oder Mail an die WG.</p>' +
      '<textarea class="textarea code" id="share-code" readonly></textarea>';
    openSheet('Plan teilen', body,
      '<button class="btn" data-action="copy-code">Kopieren</button>' +
      '<button class="btn btn--primary" data-action="native-share">Teilen</button>');
    buildShareCode();
  }

  async function buildShareCode() {
    const ta = $('#share-code');
    if (!ta) return;
    ta.value = 'Code wird erzeugt …';
    try {
      const slim = slimState();
      const code = await encodeState(slim);
      ta.value = code;
      ta.dataset.code = code;
    } catch (e) {
      ta.value = 'Fehler: ' + e.message;
    }
  }

  function slimState() {
    const s = JSON.parse(JSON.stringify(state));
    // ältere Wochen wegtrimmen, damit der Code kurz bleibt
    const base = weekIndexOf(new Date());
    Object.keys(s.weeks).forEach((k) => {
      const m = /^(\d{4})-W(\d{2})$/.exec(k);
      if (!m) return;
      const y = Number(m[1]), w = Number(m[2]);
      const jan4 = new Date(y, 0, 4);
      const idx = weekIndexOf(startOfWeek(jan4)) + (w - 1);
      if (idx < base - 12) delete s.weeks[k];
    });
    return s;
  }

  function sheetImport() {
    openSheet('Stand einfügen',
      '<p class="hint" style="margin-bottom:10px">Füge hier den Code ein, den dir ein WG-Mitglied geschickt hat.</p>' +
      '<textarea class="textarea code" id="import-code" placeholder="WGP1…"></textarea>' +
      '<div id="import-preview" style="margin-top:10px"></div>',
      '<button class="btn" data-action="import-check">Prüfen</button>' +
      '<button class="btn btn--primary" data-action="import-apply" data-mode="merge" disabled>Übernehmen</button>');
  }

  /* =========================================================
     Kodieren / Dekodieren (ohne Konto teilen)
     ========================================================= */
  function toB64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  async function encodeState(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const comp = new Uint8Array(await new Response(stream).arrayBuffer());
        return 'WGP1.Z' + toB64Url(comp);
      } catch (e) { /* Fallback unten */ }
    }
    return 'WGP1.P' + toB64Url(bytes);
  }
  async function decodeState(code) {
    let c = String(code).trim().replace(/\s+/g, '');
    // Auch komplette Links akzeptieren (…/#s=WGP1…)
    const linkMatch = /[#&]s=([^&]+)/.exec(c);
    if (linkMatch) c = decodeURIComponent(linkMatch[1]);
    let body = c, mode = 'P';
    if (c.startsWith('WGP1.')) {
      mode = c.slice(5, 6);
      body = c.slice(6);
    }
    let bytes = fromB64Url(body);
    if (mode === 'Z') {
      if (typeof DecompressionStream !== 'function') throw new Error('Dieser Browser kann den Code nicht lesen. Bitte den Code als Datei senden.');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || !Array.isArray(obj.members)) throw new Error('Ungültiger Code');
    return normalize(obj);
  }

  function mergeState(local, incoming) {
    const out = JSON.parse(JSON.stringify(local));
    // Ist der geteilte Stand neuer, übernimmt er Einstellungen (Zuordnung, Punkte).
    const incomingNewer = (incoming.updatedAt || 0) >= (local.updatedAt || 0);
    // Mitglieder
    incoming.members.forEach((m) => {
      if (!out.members.find((x) => x.id === m.id)) {
        out.members.push(m);
        out.order.push(m.id);
      }
    });
    // Räume
    incoming.rooms.forEach((r) => {
      const ex = out.rooms.find((x) => x.id === r.id);
      if (!ex) { out.rooms.push(r); return; }
      if (incomingNewer) {
        // Feste oder wechselnde Zuordnung mit übernehmen
        ex.mode = r.mode === 'fixed' ? 'fixed' : 'rotation';
        ex.fixedMember = r.mode === 'fixed' ? (r.fixedMember || null) : null;
        if (ex.mode === 'fixed' && !member(ex.fixedMember)) ex.mode = 'rotation';
        if (ex.mode === 'rotation') ex.fixedMember = null;
      }
      r.tasks.forEach((t) => {
        const et = ex.tasks.find((x) => x.id === t.id);
        if (!et) { ex.tasks.push(t); return; }
        if (incomingNewer) {
          et.title = t.title;
          et.freq = t.freq || 'w';
          et.p = clampPoints(t.p);
        }
      });
    });
    // Erledigtes vereinen (neuere gewinnt)
    Object.keys(incoming.weeks || {}).forEach(wk => {
      const src = incoming.weeks[wk];
      if (!src.done) return;
      if (!out.weeks[wk]) out.weeks[wk] = { done: {} };
      if (!out.weeks[wk].done) out.weeks[wk].done = {};
      Object.keys(src.done).forEach(roomId => {
        if (!out.weeks[wk].done[roomId]) out.weeks[wk].done[roomId] = {};
        Object.keys(src.done[roomId]).forEach(taskId => {
          const a = out.weeks[wk].done[roomId][taskId];
          const b = src.done[roomId][taskId];
          if (!a || (b.at && a.at && b.at > a.at)) out.weeks[wk].done[roomId][taskId] = b;
        });
      });
      if (src.notes) {
        out.weeks[wk].notes = Object.assign({}, out.weeks[wk].notes || {}, src.notes);
      }
    });
    // Gemeinsame Einstellungen des Plans: der neuere Stand gewinnt.
    // Ohne das wuerden zwei Geraete bei unterschiedlichen Werten (WG-Name,
    // Reihenfolge, Versatz) endlos denselben Stand hin- und herschieben.
    if (incomingNewer) {
      if (typeof incoming.wgName === 'string' && incoming.wgName) out.wgName = incoming.wgName;
      if (incoming.offsets && typeof incoming.offsets === 'object') out.offsets = Object.assign({}, incoming.offsets);
      if (Array.isArray(incoming.order) && incoming.order.length) {
        const order = incoming.order.filter(function (id) { return out.members.some(function (m) { return m.id === id; }); });
        const rest = out.order.filter(function (id) { return order.indexOf(id) === -1; });
        out.order = order.concat(rest);
      }
    }
    return out;
  }

  /* =========================================================
     Toast & Aktionen
     ========================================================= */
  /* Undo: merkt sich eine Rücknahme-Aktion, die der Toast anbietet */
  let undoFn = null;
  function setUndo(fn) { undoFn = fn; }
  function runUndo() {
    if (typeof undoFn === 'function') { const f = undoFn; undoFn = null; f(); }
    else toast('Nichts rückgängig zu machen');
  }

  function toast(msg, actionLabel, action) {
    const el = $('#toast');
    clearTimeout(toastTimer);
    el.innerHTML = '<span>' + esc(msg) + '</span>' +
      (actionLabel ? '<button class="btn btn--sm" style="background:transparent;color:var(--bg);border-color:currentColor" data-action="' + action.name + '" data-arg="' + (action.arg || '') + '">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5200 : 2200);
  }

  function toggleTask(roomId, taskId) {
    const idx = currentIndex();
    const entry = doneEntry(roomId, taskId);
    if (!entry) {
      setDone(roomId, taskId, state.currentUser);
      toast('Erledigt ✓', 'Rückgängig', { name: 'undo-task', arg: roomId + '|' + taskId });
    } else if (entry.by === state.currentUser) {
      setDone(roomId, taskId, null);
      toast('Als offen markiert');
    } else {
      const by = member(entry.by);
      openSheet('Aufgabe erledigt', '<p class="hint">Erledigt von <strong>' + (by ? esc(by.name) : 'jemand') + '</strong>.</p>' +
        '<button class="opt" data-action="claim-task" data-room="' + roomId + '" data-task="' + taskId + '">' +
        '<span class="opt__ico">🙋</span><span class="opt__main"><strong>Ich war’s</strong><span>Als von mir erledigt markieren</span></span></button>' +
        '<button class="opt" data-action="untoggle-task" data-room="' + roomId + '" data-task="' + taskId + '">' +
        '<span class="opt__ico">↩️</span><span class="opt__main"><strong>Wieder offen</strong><span>Erledigung entfernen</span></span></button>',
        '<button class="btn" data-action="close-sheet">Schließen</button>');
    }
  }

  function setDone(roomId, taskId, memberId) {
    const wk = weekKey(currentIndex());
    if (!state.weeks[wk]) state.weeks[wk] = { done: {} };
    if (!state.weeks[wk].done) state.weeks[wk].done = {};
    if (!state.weeks[wk].done[roomId]) state.weeks[wk].done[roomId] = {};
    if (memberId) state.weeks[wk].done[roomId][taskId] = { by: memberId, at: Date.now() };
    else delete state.weeks[wk].done[roomId][taskId];
    save();
    render();
  }

  /* =========================================================
     Event-Handling
     ========================================================= */
  document.addEventListener('click', function (ev) {
    const tab = ev.target.closest('.tab');
    if (tab) {
      ui.view = tab.dataset.view;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.member, roomId = el.dataset.room, taskId = el.dataset.task;

    switch (a) {
      case 'prev-week': ui.weekOffset--; render(); break;
      case 'next-week': ui.weekOffset++; render(); break;
      case 'this-week': ui.weekOffset = 0; render(); break;
      case 'task': toggleTask(roomId, taskId); break;
      case 'room-all': {
        const idx = currentIndex();
        const r = room(roomId);
        dueTasks(r, idx).forEach((t) => {
          if (!doneEntry(roomId, t.id, idx)) setDoneSilent(roomId, t.id, state.currentUser);
        });
        save(); render(); toast('Alles erledigt ✓');
        break;
      }
      case 'undo-last': runUndo(); break;
      case 'undo-task': {
        const p = (el.dataset.arg || '').split('|');
        if (p.length === 2) { setDone(p[0], p[1], null); toast('Rückgängig gemacht'); }
        break;
      }
      case 'claim-task': setDone(roomId, taskId, state.currentUser); closeSheet(); toast('Auf mich gebucht'); break;
      case 'untoggle-task': setDone(roomId, taskId, null); closeSheet(); toast('Als offen markiert'); break;
      case 'room-note': sheetRoomNote(roomId); break;
      case 'save-note': {
        const idx = currentIndex();
        const wk = weekKey(idx);
        if (!state.weeks[wk]) state.weeks[wk] = { done: {} };
        if (!state.weeks[wk].notes) state.weeks[wk].notes = {};
        const val = $('#note-text').value.trim();
        if (val) state.weeks[wk].notes[roomId] = val; else delete state.weeks[wk].notes[roomId];
        save(); closeSheet(); render(); toast('Notiz gespeichert');
        break;
      }
      case 'set-user':
        state.currentUser = id; save(); closeSheet(); render();
        toast('Angemeldet als ' + member(id).name);
        break;
      case 'edit-member': sheetEditMember(id); break;
      case 'add-member': sheetAddMember(); break;
      case 'pick-emoji': {
        const btn = document.getElementById('m-emoji');
        if (btn) {
          btn.querySelectorAll('.chip').forEach((c) => c.classList.remove('chip--active'));
          el.classList.add('chip--active');
        }
        break;
      }
      case 'pick-color': {
        const btn = document.getElementById('m-color');
        if (btn) {
          btn.querySelectorAll('.chip').forEach((c) => { c.classList.remove('chip--active'); c.style.borderColor = 'transparent'; });
          el.classList.add('chip--active'); el.style.borderColor = 'var(--text)';
        }
        break;
      }
      case 'pick-rcolor': {
        const btn = document.getElementById('r-color');
        if (btn) {
          btn.querySelectorAll('.chip').forEach((c) => { c.classList.remove('chip--active'); c.style.borderColor = 'transparent'; });
          el.classList.add('chip--active'); el.style.borderColor = 'var(--text)';
        }
        break;
      }
      case 'save-member': {
        const name = ($('#m-name').value || '').trim();
        if (!name) { toast('Bitte einen Namen eingeben'); break; }
        const emojiBtn = document.querySelector('#m-emoji .chip--active');
        const colorBtn = document.querySelector('#m-color .chip--active');
        if (el.dataset.new) {
          const m = { id: uid('m'), name, emoji: emojiBtn ? emojiBtn.dataset.emoji : '🧑', color: colorBtn ? colorBtn.dataset.color : MEMBER_COLORS[state.members.length % MEMBER_COLORS.length] };
          state.members.push(m); state.order.push(m.id);
        } else {
          const m = member(id);
          if (m) {
            m.name = name;
            if (emojiBtn) m.emoji = emojiBtn.dataset.emoji;
            if (colorBtn) m.color = colorBtn.dataset.color;
          }
        }
        save(); closeSheet(); render(); toast('Gespeichert');
        break;
      }
      case 'del-member': {
        const m = member(id);
        if (!m) break;
        const festRaeume = state.rooms.filter((r) => r.fixedMember === id).length;
        if (!confirm('„' + m.name + '“ wirklich entfernen? Die Aufgaben bleiben im Plan, nur die Person nicht mehr.' +
          (festRaeume ? '\n\n' + festRaeume + ' Raum/Räume waren dieser Person fest zugeordnet und wechseln zurück in den Turnus.' : ''))) break;
        state.members = state.members.filter((x) => x.id !== id);
        state.order = state.order.filter((x) => x !== id);
        if (state.currentUser === id) state.currentUser = state.members[0] ? state.members[0].id : null;
        // Räume, die nur dieser Person fest zugeordnet waren, wechseln zurück in den Turnus
        let reverted = 0;
        state.rooms.forEach((r) => {
          if (r.fixedMember === id) { r.fixedMember = null; r.mode = 'rotation'; reverted++; }
        });
        save(); closeSheet(); render();
        toast(reverted ? 'Person entfernt – ' + reverted + ' Raum/Räume wieder im Turnus' : 'Person entfernt');
        break;
      }
      case 'move-up': case 'move-down': {
        const order = state.order.filter((x) => !!member(x));
        const i = order.indexOf(id);
        const j = a === 'move-up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= order.length) break;
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        state.order = order.concat(state.order.filter((x) => !member(x)));
        save(); render();
        break;
      }
      case 'offset': {
        const delta = Number(el.dataset.delta);
        const cur = state.offsets[roomId] || 0;
        const n = Math.max(1, activeOrder().length);
        state.offsets[roomId] = ((cur + delta) % n + n) % n;
        save(); render();
        break;
      }
      case 'auto-balance': autoBalance(); break;
      case 'edit-room': sheetEditRoom(roomId); break;
      case 'add-room': sheetAddRoom(); break;
      case 'save-room': {
        const name = ($('#r-name').value || '').trim();
        if (!name) { toast('Bitte einen Namen eingeben'); break; }
        const icon = ($('#r-icon').value || '').trim() || '🧽';
        const colorBtn = document.querySelector('#r-color .chip--active');
        const color = colorBtn ? colorBtn.dataset.color : MEMBER_COLORS[0];
        const modeBtn = document.querySelector('#r-mode .is-active');
        const mode = modeBtn && modeBtn.dataset.mode === 'fixed' ? 'fixed' : 'rotation';
        const fixedBtn = document.querySelector('#r-fixed .chip--active');
        const fixedMember = mode === 'fixed' ? (fixedBtn ? fixedBtn.dataset.member : null) : null;
        let r;
        if (el.dataset.new) {
          r = { id: uid('r'), name, icon, color, mode, fixedMember, tasks: [] };
          state.rooms.push(r);
        } else {
          r = room(roomId);
          if (r) {
            r.name = name; r.icon = icon; r.color = color;
            r.mode = mode;
            r.fixedMember = mode === 'fixed' ? (fixedMember || r.fixedMember || (state.members[0] ? state.members[0].id : null)) : null;
            if (mode === 'fixed' && !r.fixedMember) r.mode = 'rotation';
          }
        }
        const tTitle = ($('#r-task-title').value || '').trim();
        if (r && tTitle) {
          r.tasks.push({ id: uid('t'), title: tTitle, freq: 'w', p: 1 });
        }
        if (r && el.dataset.new) {
          // Neuen Raum der Person geben, die diese Woche am wenigsten zu tun hat
          const order = activeOrder();
          const n = order.length;
          if (n) {
            const idx = weekIndexOf(new Date());
            const loads = new Array(n).fill(0);
            state.rooms.forEach((rr) => {
              if (rr.id === r.id) return;
              const bi = order.indexOf(assigneeFor(rr.id, idx));
              if (bi >= 0) loads[bi] += (rr.tasks || []).length;
            });
            let bi = 0;
            for (let i = 1; i < n; i++) if (loads[i] < loads[bi]) bi = i;
            state.offsets[r.id] = (((bi - idx) % n) + n) % n;
          }
        }
        save(); closeSheet(); render(); toast(el.dataset.new ? 'Raum angelegt' : 'Gespeichert');
        break;
      }
      /* ---------- Aufgaben ---------- */
      case 'task-new': {
        const preselect = roomId || (state.rooms[0] ? state.rooms[0].id : null);
        sheetTaskEditor(preselect, null);
        break;
      }
      case 'task-edit': sheetTaskEditor(roomId, taskId); break;
      case 'pick-points': {
        const box = document.getElementById('t-points');
        if (box) {
          box.querySelectorAll('.points__btn').forEach((c) => c.classList.remove('is-active'));
          el.classList.add('is-active');
        }
        break;
      }
      case 'save-task': {
        const title = ($('#t-title').value || '').trim();
        if (!title) { toast('Bitte eine Aufgabenbezeichnung eingeben'); break; }
        const targetRoomId = ($('#t-room') || {}).value || roomId;
        const freq = ($('#t-freq') || {}).value || 'w';
        const pts = clampPoints(document.querySelector('#t-points .is-active')
          ? document.querySelector('#t-points .is-active').dataset.p : 1);
        const editingId = el.dataset.task;
        const target = room(targetRoomId);
        if (!target) break;
        if (editingId) {
          // Aufgabe suchen (kann in einem anderen Raum liegen) und verschieben/bearbeiten
          let found = null, source = null;
          state.rooms.forEach((rr) => rr.tasks.forEach((t) => { if (t.id === editingId) { found = t; source = rr; } }));
          if (found) {
            found.title = title; found.freq = freq; found.p = pts;
            if (source.id !== target.id) {
              // In einen anderen Raum verschoben – Erledigungen wandern mit,
              // sonst gingen die Punkte der Aufgabe verloren.
              source.tasks = source.tasks.filter((t) => t.id !== editingId);
              target.tasks.push(found);
              Object.keys(state.weeks).forEach((wk) => {
                const done = state.weeks[wk] && state.weeks[wk].done;
                if (!done || !done[source.id] || !done[source.id][editingId]) return;
                if (!done[target.id]) done[target.id] = {};
                done[target.id][editingId] = done[source.id][editingId];
                delete done[source.id][editingId];
              });
            }
          }
          toast('Aufgabe gespeichert');
        } else {
          target.tasks.push({ id: uid('t'), title, freq, p: pts });
          toast('Aufgabe angelegt ✓');
        }
        // Standardwerte für die Schnellerfassung merken
        state.quickDefaults = { freq, p: pts };
        save(); closeSheet(); render();
        break;
      }
      case 'del-task': {
        const r = room(roomId);
        if (!r) break;
        const pos = r.tasks.findIndex((t) => t.id === taskId);
        if (pos < 0) break;
        const removed = r.tasks[pos];
        // Historie der Aufgabe sichern (für das Rückgängig-Machen)
        const hist = {};
        Object.keys(state.weeks).forEach((wk) => {
          const done = state.weeks[wk] && state.weeks[wk].done;
          if (done && done[r.id] && done[r.id][taskId]) {
            hist[wk] = { entry: done[r.id][taskId], note: (state.weeks[wk].notes || {})[r.id] || null };
            delete done[r.id][taskId];
          }
        });
        r.tasks.splice(pos, 1);
        setUndo(() => {
          const rr = room(r.id);
          if (!rr) return;
          rr.tasks.splice(Math.min(pos, rr.tasks.length), 0, removed);
          Object.keys(hist).forEach((wk) => {
            if (!state.weeks[wk]) state.weeks[wk] = { done: {} };
            if (!state.weeks[wk].done) state.weeks[wk].done = {};
            if (!state.weeks[wk].done[r.id]) state.weeks[wk].done[r.id] = {};
            state.weeks[wk].done[r.id][taskId] = hist[wk].entry;
          });
          save(); render(); toast('Aufgabe wiederhergestellt');
        });
        save(); closeSheet(); render();
        toast('Aufgabe gelöscht', 'Rückgängig', { name: 'undo-last' });
        break;
      }
      /* ---------- Raumzuordnung ---------- */
      case 'pick-mode': {
        const box = document.getElementById('r-mode');
        if (box) {
          box.querySelectorAll('button').forEach((c) => c.classList.remove('is-active'));
          el.classList.add('is-active');
          const wrap = document.getElementById('fixedwrap');
          if (wrap) wrap.style.display = el.dataset.mode === 'fixed' ? '' : 'none';
        }
        break;
      }
      case 'pick-fixed': {
        const box = document.getElementById('r-fixed');
        if (box) {
          box.querySelectorAll('.chip').forEach((c) => c.classList.remove('chip--active'));
          el.classList.add('is-active');
        }
        break;
      }
      case 'room-mode': {
        const r = room(roomId);
        if (!r) break;
        r.mode = el.dataset.mode === 'fixed' ? 'fixed' : 'rotation';
        if (r.mode === 'fixed') {
          if (!r.fixedMember || !member(r.fixedMember)) {
            const idx = weekIndexOf(new Date());
            r.fixedMember = assigneeFor(r.id, idx) || (state.members[0] ? state.members[0].id : null);
          }
        } else {
          r.fixedMember = null;
        }
        save(); render();
        toast(r.mode === 'fixed' ? 'Feste Zuordnung aktiv' : 'Wechselnder Turnus');
        break;
      }
      case 'room-fixed': {
        const r = room(roomId);
        if (!r) break;
        r.mode = 'fixed';
        r.fixedMember = id;
        save(); render();
        toast('Immer ' + member(id).name);
        break;
      }
      case 'del-room': {
        const r = room(roomId);
        if (!r) break;
        const pos = state.rooms.findIndex((x) => x.id === roomId);
        const offset = state.offsets[roomId];
        const weeks = JSON.parse(JSON.stringify(state.weeks));
        state.rooms.splice(pos, 1);
        delete state.offsets[roomId];
        setUndo(() => {
          state.rooms.splice(Math.min(pos, state.rooms.length), 0, r);
          if (offset !== undefined) state.offsets[roomId] = offset;
          state.weeks = weeks;
          save(); render(); toast('Raum wiederhergestellt');
        });
        save(); closeSheet(); render();
        toast('Raum „' + r.name + '“ gelöscht', 'Rückgängig', { name: 'undo-last' });
        break;
      }
      case 'week-filter': {
        ui.weekFilter = el.dataset.filter === 'mine' ? 'mine' : 'all';
        render();
        break;
      }
      case 'quick-add': {
        const title = ($('#qa-title').value || '').trim();
        if (!title) { toast('Bitte zuerst eine Aufgabe eintippen'); break; }
        const roomId2 = ($('#qa-room') || {}).value;
        const target = room(roomId2);
        if (!target) break;
        const def = state.quickDefaults || { freq: 'w', p: 1 };
        target.tasks.push({ id: uid('t'), title, freq: def.freq, p: clampPoints(def.p) });
        save(); render();
        const inp = $('#qa-title');
        if (inp) inp.value = '';
        toast('Aufgabe "' + title + '" angelegt ✓');
        break;
      }
      case 'ics-export': exportIcs(currentIndex()); break;
      /* ---------- Live-Sync ---------- */
      case 'sync-genkey': {
        const k = newWgKey();
        const inp = $('#sync-key');
        if (inp) { inp.value = k; inp.type = 'text'; }
        syncCfg().key = k;
        save();
        toast('Neuer WG-Schlüssel erzeugt – teile ihn mit der WG');
        break;
      }
      case 'sync-now': {
        const sc2 = syncCfg();
        sc2.url = ($('#sync-url') || {}).value || SYNC_DEFAULT_URL;
        sc2.key = (($('#sync-key') || {}).value || '').trim();
        sc2.enc = !!(($('#sync-enc') || {}).checked);
        save();
        if (!sc2.key) { toast('Kein WG-Schlüssel hinterlegt'); break; }
        setSyncStatus('arbeitet', 'Synchronisiere …');
        syncCycle(false, true);
        break;
      }
      case 'sync-test': {
        const sc2 = syncCfg();
        const url = (($('#sync-url') || {}).value || '').replace(/\/$/, '');
        if (!url) { toast('Keine Server-Adresse'); break; }
        setSyncStatus('arbeitet', 'Teste Verbindung …');
        fetch(url + '/health').then((r) => {
          if (r.ok) setSyncStatus('ok', 'Server erreichbar ✓');
          else setSyncStatus('fehler', 'Server antwortet mit ' + r.status);
        }).catch((e) => setSyncStatus('fehler', 'Nicht erreichbar: ' + e.message));
        break;
      }
      case 'push-on': pushEnable(); break;
      case 'push-off': pushDisable(); break;
      case 'push-test': pushTest(); break;
      case 'plan-tab': ui.planTab = el.dataset.tab; render(); break;
      case 'goto-members': ui.view = 'plan'; ui.planTab = 'members'; render(); break;
      case 'goto-rooms': ui.view = 'plan'; ui.planTab = 'rooms'; render(); break;
      case 'theme': state.theme = el.dataset.theme; save(); render(); break;
      case 'save-name': {
        const v = ($('#wgname').value || '').trim();
        state.wgName = v || 'WG-Putzplan';
        save(); render(); toast('Gespeichert');
        break;
      }
      case 'share': sheetShare(); break;
      case 'copy-code': {
        const code = ($('#share-code') || {}).value || '';
        copyText(code);
        break;
      }
      case 'native-share': {
        const code = ($('#share-code') || {}).value || '';
        const link = location.origin + location.pathname + '#s=' + encodeURIComponent(code);
        if (navigator.share) {
          navigator.share({ title: state.wgName + ' – Putzplan', text: 'Hier ist unser WG-Putzplan:\n' + code + '\n\n' + link }).catch(() => {});
        } else {
          copyText(code);
        }
        break;
      }
      case 'import-open': sheetImport(); break;
      case 'import-check': {
        const code = ($('#import-code').value || '').trim();
        const box = $('#import-preview');
        if (!code) { box.innerHTML = '<p class="hint">Bitte einen Code einfügen.</p>'; break; }
        decodeState(code).then((inc) => {
          window.__incoming = inc;
          const diff = compareStates(state, inc);
          box.innerHTML = '<div class="notice">Stand vom ' + new Date(inc.updatedAt || Date.now()).toLocaleString('de-DE') +
            '<br>' + inc.members.length + ' Mitglieder · ' + inc.rooms.length + ' Räume · ' + diff.newDone + ' neue Erledigungen</div>' +
            (diff.newPeople ? '<p class="hint" style="margin-top:8px">Enthält neue Personen: ' + esc(diff.newPeople) + '</p>' : '');
          const btn = document.querySelector('[data-action="import-apply"]');
          if (btn) btn.disabled = false;
          window.__diff = diff;
        }).catch((e) => {
          window.__incoming = null;
          box.innerHTML = '<div class="notice" style="background:#ffe4ea">' + esc(e.message) + '</div>';
        });
        break;
      }
      case 'import-apply': {
        const inc = window.__incoming;
        if (!inc) { toast('Erst den Code prüfen'); break; }
        if (el.dataset.mode === 'replace') {
          state = inc;
        } else {
          state = mergeState(state, inc);
        }
        save(); closeSheet(); render(); toast('Stand übernommen ✓');
        break;
      }
      case 'export-file': exportFile(); break;
      case 'import-file': importFile(); break;
      case 'install': {
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.then(() => { installPrompt = null; render(); });
        }
        break;
      }
      case 'reset': {
        if (!confirm('Alles löschen und mit der Beispieldaten neu starten?')) break;
        localStorage.removeItem(STORAGE_KEY);
        state = seed(); save(); ui.weekOffset = 0; render(); toast('Zurückgesetzt');
        break;
      }
      case 'close-sheet': closeSheet(); break;
    }
  });

  // Formular-Felder des Live-Sync sofort übernehmen (beim Tippen und beim Verlassen)
  function onSyncField(ev) {
    const el = ev.target;
    if (!el || !el.id) return;
    const sc = syncCfg();
    if (el.id === 'sync-url') { sc.url = el.value.trim() || SYNC_DEFAULT_URL; save(); }
    else if (el.id === 'sync-key') { sc.key = el.value.trim(); save(); }
    else if (el.id === 'sync-enc') { sc.enc = !!el.checked; save(); }
    else if (el.id === 'sync-on') {
      sc.enabled = !!el.checked;
      if (sc.enabled && !sc.key) {
        toast('Bitte zuerst einen WG-Schlüssel eintragen');
        sc.enabled = false;
        save(); render();
        return;
      }
      save(); render();
      if (sc.enabled) { setSyncStatus('arbeitet', 'Verbinde …'); syncCycle(false); }
    }
  }
  function onPushField(ev) {
    const el = ev.target;
    if (!el || el.id !== 'push-hour') return;
    const pc = pushCfg();
    pc.hour = parseInt(el.value, 10);
    if (isNaN(pc.hour)) pc.hour = DEFAULT_PUSH_HOUR;
    save();
    pushResubscribe();
  }
  document.addEventListener('input', onSyncField);
  document.addEventListener('change', onSyncField);
  document.addEventListener('change', onPushField);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#sheet').hidden) { closeSheet(); return; }
    // Enter in der Schnellerfassung legt die Aufgabe an
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'qa-title') {
      ev.preventDefault();
      const btn = document.querySelector('[data-action="quick-add"]');
      if (btn) btn.click();
    }
  });

  $('#userbtn').addEventListener('click', sheetPickUser);

  function setDoneSilent(roomId, taskId, memberId) {
    const wk = weekKey(currentIndex());
    if (!state.weeks[wk]) state.weeks[wk] = { done: {} };
    if (!state.weeks[wk].done) state.weeks[wk].done = {};
    if (!state.weeks[wk].done[roomId]) state.weeks[wk].done[roomId] = {};
    state.weeks[wk].done[roomId][taskId] = { by: memberId, at: Date.now() };
  }

  function compareStates(a, b) {
    let newDone = 0;
    const names = [];
    b.members.forEach((m) => { if (!a.members.find((x) => x.id === m.id)) names.push(m.name); });
    Object.keys(b.weeks || {}).forEach(wk => {
      const d = b.weeks[wk].done || {};
      Object.keys(d).forEach(roomId => Object.keys(d[roomId]).forEach(tid => {
        if (!a.weeks[wk] || !a.weeks[wk].done || !a.weeks[wk].done[roomId] || !a.weeks[wk].done[roomId][tid]) newDone++;
      }));
    });
    return { newDone, newPeople: names.join(', ') };
  }

  function copyText(text) {
    if (!text) { toast('Nichts zu kopieren'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Code kopiert ✓')).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Code kopiert ✓'); }
    catch (e) { toast('Bitte manuell markieren und kopieren'); }
    document.body.removeChild(ta);
  }

  function exportFile() {
    downloadFile((state.wgName || 'wg-putzplan').replace(/[^\w\-äöüÄÖÜß ]/g, '').replace(/\s+/g, '-') + '.json',
      JSON.stringify(state, null, 2), 'application/json');
    toast('Datei gespeichert ✓');
  }

  function importFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const inc = normalize(JSON.parse(reader.result));
          window.__incoming = inc;
          const diff = compareStates(state, inc);
          openSheet('Datei übernehmen',
            '<div class="notice">„' + esc(f.name) + '“<br>' + inc.members.length + ' Mitglieder · ' + inc.rooms.length + ' Räume · ' + diff.newDone + ' neue Erledigungen</div>',
            '<button class="btn" data-action="import-apply" data-mode="merge">Zusammenführen</button>' +
            '<button class="btn btn--primary" data-action="import-apply" data-mode="replace">Ersetzen</button>');
        } catch (e) { toast('Datei konnte nicht gelesen werden'); }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  /* ---------- Link mit Code (#s=…) ---------- */
  function applyHashCode() {
    const h = location.hash || '';
    const m = /[#&]s=([^&]+)/.exec(h);
    if (!m) return;
    decodeState(decodeURIComponent(m[1])).then((inc) => {
      openSheet('Plan übernehmen?',
        '<div class="notice">Du hast einen WG-Putzplan bekommen. Möchtest du ihn übernehmen?</div>' +
        '<p class="hint" style="margin-top:10px">' + inc.members.length + ' Mitglieder · ' + inc.rooms.length + ' Räume</p>',
        '<button class="btn" data-action="import-apply" data-mode="merge">Übernehmen</button>' +
        '<button class="btn" data-action="close-sheet">Nein</button>');
      window.__incoming = inc;
      history.replaceState(null, '', location.pathname + location.search);
    }).catch(() => { /* stiller Fehler */ });
  }

  /* ---------- Theme des Systems ---------- */
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (state.theme === 'auto') render(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- Service Worker ---------- */
  if ('serviceWorker' in navigator) {
    // Meldungen des Service Workers: Plan hat sich geaendert -> sofort abholen;
    // Abo wurde erneuert -> Zustand der Erinnerungen neu pruefen.
    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (!ev.data) return;
      if (ev.data.type === 'WG-PLAN-CHANGED') { syncCycle(false, true); }
      else if (ev.data.type === 'WG-PUSH-RESUBSCRIBED') { pushStartup(); }
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBar();
            }
          });
        });
      }).catch(function () { /* offline-Funktionen bleiben eingeschränkt */ });
    });
  }

  function showUpdateBar() {
    if (document.querySelector('.updatebar')) return;
    const bar = document.createElement('div');
    bar.className = 'updatebar';
    bar.innerHTML = '<p>Neue Version verfügbar</p><button class="btn btn--sm btn--primary" data-action="reload">Aktualisieren</button>';
    bar.querySelector('[data-action="reload"]').addEventListener('click', function () {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      });
      location.reload();
    });
    document.body.appendChild(bar);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    if (ui.view === 'more') render();
  });

  /* ---------- Start ---------- */
  render();
  applyHashCode();
  // Live-Sync: beim Start einmal abholen, danach regelmäßig
  if (syncReady()) { setTimeout(() => syncCycle(false), 800); }
  setTimeout(pushStartup, 900);
  setInterval(() => {
    if (syncReady() && document.visibilityState === 'visible') syncCycle(false);
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (syncReady() && document.visibilityState === 'visible') syncCycle(false);
  });

  window.addEventListener('storage', function (ev) {
    if (ev.key === STORAGE_KEY) { state = load(); render(); }
  });

  // Für Tests
  window.__app = {
    get state() { return state; },
    set state(v) { state = v; },
    weekIndexOf, isoWeek, taskDue, encodeState, decodeState, mergeState, save, render, pointsOf,
    assigneeFor, dueTasks, clampPoints
  };
})();
