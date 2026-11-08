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
  let ui = { view: 'week', weekOffset: 0, planTab: 'weeks', weekIndex: null };
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
        id: 'r1', name: 'Küche', icon: '🍳', color: MEMBER_COLORS[0], tasks: [
          { id: 't1', title: 'Geschirr abwaschen & einräumen', p: 1, freq: 'w' },
          { id: 't2', title: 'Arbeitsfläche & Herd abwischen', p: 1, freq: 'w' },
          { id: 't3', title: 'Spüle & Wasserhahn reinigen', p: 1, freq: '2w' },
          { id: 't4', title: 'Müll rausbringen', p: 1, freq: 'w' },
          { id: 't5', title: 'Kühlschrank auswischen', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r2', name: 'Bad', icon: '🚿', color: MEMBER_COLORS[1], tasks: [
          { id: 't6', title: 'Bad & Spiegel putzen', p: 1, freq: 'w' },
          { id: 't7', title: 'Toilette reinigen', p: 1, freq: 'w' },
          { id: 't8', title: 'Handtücher wechseln', p: 1, freq: '2w' },
          { id: 't9', title: 'Fliesen & Fugen', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r3', name: 'Flur & Wohnzimmer', icon: '🛋️', color: MEMBER_COLORS[2], tasks: [
          { id: 't10', title: 'Staubsaugen', p: 1, freq: 'w' },
          { id: 't11', title: 'Flur wischen', p: 1, freq: '2w' },
          { id: 't12', title: 'Sofa & Polster abstauben', p: 2, freq: 'm' }
        ]
      },
      {
        id: 'r4', name: 'Müll & Recycling', icon: '🗑️', color: MEMBER_COLORS[3], tasks: [
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
    s.rooms.forEach((r) => { r.tasks = Array.isArray(r.tasks) ? r.tasks : []; r.tasks.forEach((t) => { if (!t.freq) t.freq = 'w'; if (!t.p) t.p = 1; }); });
    return s;
  }

  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Speichern nicht möglich'); }
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
    return t ? (t.p || 1) : 1;
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

  /* Verteilt die Räume so auf die Mitglieder, dass die Arbeitslast möglichst
     gleichmäßig ist. Ergebnis wird als fester Versatz je Raum gespeichert,
     damit der Turnus von Woche zu Woche weiterläuft. */
  function computeBalanced(rooms, order, idx) {
    const n = order.length;
    const off = {};
    if (!n) return off;
    const loads = new Array(n).fill(0);
    rooms.slice().sort((a, b) => (b.tasks || []).length - (a.tasks || []).length).forEach((r) => {
      let bi = 0;
      for (let i = 1; i < n; i++) if (loads[i] < loads[bi]) bi = i;
      loads[bi] += (r.tasks || []).length;
      off[r.id] = (((bi - idx) % n) + n) % n;
    });
    return off;
  }
  function autoBalance() {
    const off = computeBalanced(state.rooms, activeOrder(), weekIndexOf(new Date()));
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
    if (ui.view === 'week') main.innerHTML = viewWeek();
    else if (ui.view === 'plan') main.innerHTML = viewPlan();
    else if (ui.view === 'stats') main.innerHTML = viewStats();
    else main.innerHTML = viewMore();
    updateHeader();
    window.scrollTo(0, ui.view === 'week' ? 0 : window.scrollY);
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

    if (state.rooms.length === 0) {
      html += '<div class="empty"><div class="empty__ico">🧽</div><h3>Noch keine Räume</h3>' +
        '<p>Lege im Tab <strong>Turnus → Räume</strong> die Bereiche fest, die geputzt werden.</p>' +
        '<p style="margin-top:14px"><button class="btn btn--primary" data-action="goto-rooms">Räume anlegen</button></p></div>';
      return html;
    }

    sorted.forEach((r) => { html += roomCard(r, idx, done); });
    return html;
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
      '<div class="room__meta"><h3>' + esc(r.name) + (mine ? ' <span class="pill pill--accent">Du</span>' : '') + '</h3>' +
      '<p>' + (who ? who.emoji + ' ' + esc(who.name) : 'Niemand') + ' ist dran' + (later > 0 ? ' · ' + later + ' später' : '') + '</p></div>' +
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
        '<div class="task__pts">' + (t.p || 1) + ' P</div>' +
        '</div>';
    });

    html += '<div class="room__foot">' +
      '<button class="btn btn--sm" data-action="room-note" data-room="' + r.id + '">📝 ' + (note ? 'Notiz ansehen' : 'Notiz') + '</button>' +
      (doneCount < tasks.length ? '<button class="btn btn--sm btn--primary" data-action="room-all" data-room="' + r.id + '">Alles erledigt</button>' : '<span class="pill pill--ok" style="align-self:center">✓ fertig</span>') +
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
      html += '<tr><td>' + esc(r.icon || '') + ' ' + esc(r.name) + '</td>';
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

    html += '<div class="card"><div class="card__head"><h3>Versatz je Raum</h3>' +
      '<button class="btn btn--sm" data-action="auto-balance">⚖️ Automatisch verteilen</button></div>' +
      '<p class="card__sub" style="margin:-4px 0 8px">Damit nicht immer dieselbe Person zuerst drankommt</p>';
    state.rooms.forEach((r) => {
      const off = state.offsets[r.id] || 0;
      html += '<div class="row"><div class="row__main"><strong>' + esc(r.icon || '') + ' ' + esc(r.name) + '</strong>' +
        '<span>' + (off === 0 ? 'Startet bei Position 1' : 'Startet bei Position ' + (off + 1)) + '</span></div>' +
        '<div class="row__actions">' +
        '<button class="btn btn--sm btn--icon" data-action="offset" data-room="' + r.id + '" data-delta="-1">−</button>' +
        '<button class="btn btn--sm btn--icon" data-action="offset" data-room="' + r.id + '" data-delta="1">+</button>' +
        '</div></div>';
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
        '<span>' + p + ' Punkte · ' + tasksDoneBy(m.id) + ' Aufgaben</span></div>' +
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
    let html = '<div class="card"><div class="card__head"><h3>Räume & Aufgaben</h3></div>';
    state.rooms.forEach((r) => {
      const w = dueTasks(r, weekIndexOf(new Date())).length;
      html += '<div class="row"><div class="room__icon" style="background:' + r.color + '22">' + esc(r.icon || '🧽') + '</div>' +
        '<div class="row__main"><strong>' + esc(r.name) + '</strong>' +
        '<span>' + r.tasks.length + ' Aufgaben · ' + w + ' diese Woche fällig</span></div>' +
        '<div class="row__actions"><button class="btn btn--sm" data-action="edit-room" data-room="' + r.id + '">✎</button>' +
        '<button class="btn btn--sm btn--danger" data-action="del-room" data-room="' + r.id + '">✕</button></div></div>';
    });
    html += '<button class="btn btn--block btn--primary" style="margin-top:12px" data-action="add-room">+ Raum hinzufügen</button></div>';
    if (!state.rooms.length) html += '<div class="empty"><div class="empty__ico">🧽</div><h3>Keine Räume</h3><p>Lege Küche, Bad, Flur … an und packe pro Raum Aufgaben hinein.</p></div>';
    return html;
  }

  /* ---------- Statistik ---------- */
  function viewStats() {
    const idx = currentIndex();
    const p = weekProgress(idx);
    const pts = state.members.map((m) => ({ m, p: pointsOf(m.id), n: tasksDoneBy(m.id) }));
    const max = Math.max(1, ...pts.map((x) => x.p));
    const sum = pts.reduce((a, b) => a + b.p, 0);

    let html = '<div class="card"><div class="card__head"><h3>Punkte</h3><span class="card__sub">gesamt ' + sum + ' Punkte</span></div>';
    if (!pts.length) html += '<p class="hint">Noch keine Punkte vergeben.</p>';
    pts.sort((a, b) => b.p - a.p).forEach((x) => {
      html += '<div style="margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:9px">' +
        '<span class="chip-avatar chip-avatar--sm" style="background:' + x.m.color + '">' + x.m.emoji + '</span>' +
        '<strong style="flex:1;font-size:14.5px">' + esc(x.m.name) + '</strong>' +
        '<span style="font-weight:750;font-size:14px">' + x.p + ' P</span></div>' +
        '<div class="bar"><div class="bar__fill" style="width:' + Math.round((x.p / max) * 100) + '%;background:' + x.m.color + '"></div></div>' +
        '<div class="hint" style="margin-top:4px">' + x.n + ' Aufgaben erledigt' + (x.m.id === state.currentUser ? ' · das bist du' : '') + '</div>' +
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
        '<span class="opt__main"><strong>' + esc(m.name) + '</strong><span>' + pointsOf(m.id) + ' Punkte · ' + tasksDoneBy(m.id) + ' Aufgaben</span></span>' +
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
      '<div class="field"><label>Aufgaben</label><div id="r-tasks">';
    r.tasks.forEach((t) => {
      body += '<div class="row" style="padding:9px 0"><div class="row__main"><strong style="font-size:14px">' + esc(t.title) + '</strong>' +
        '<span>' + FREQ_LABEL[t.freq] + ' · ' + t.p + ' Punkt' + (t.p > 1 ? 'e' : '') + '</span></div>' +
        '<div class="row__actions"><button class="btn btn--sm btn--danger" data-action="del-task" data-room="' + r.id + '" data-task="' + t.id + '">✕</button></div></div>';
    });
    body += '</div></div>' +
      '<div class="field"><label>Neue Aufgabe</label><input class="input" id="r-task-title" placeholder="z. B. Wäsche aufhängen"></div>' +
      '<div class="row" style="border:0;gap:8px">' +
      '<select class="input" id="r-task-freq" style="flex:1"><option value="w">wöchentlich</option><option value="2w">alle 2 Wochen</option><option value="m">monatlich</option></select>' +
      '<select class="input" id="r-task-p" style="width:96px"><option value="1">1 P</option><option value="2">2 P</option><option value="3">3 P</option></select>' +
      '<button class="btn btn--primary" data-action="add-task" data-room="' + r.id + '">+</button></div>';
    openSheet('Raum bearbeiten', body,
      '<button class="btn" data-action="save-room" data-room="' + r.id + '">Speichern</button>' +
      '<button class="btn btn--danger" data-action="del-room" data-room="' + r.id + '">Löschen</button>');
  }

  function sheetAddRoom() {
    const body =
      '<div class="field"><label>Name des Raums</label><input class="input" id="r-name" placeholder="z. B. Flur"></div>' +
      '<div class="field"><label>Symbol (Emoji)</label><input class="input" id="r-icon" value="🧽" maxlength="4"></div>' +
      '<div class="field"><label>Farbe</label><div id="r-color">' +
      MEMBER_COLORS.map((c, i) => '<button class="chip' + (i === 0 ? ' chip--active' : '') + '" data-action="pick-rcolor" data-color="' + c + '" style="background:' + c + ';width:32px;height:32px;padding:0;border-radius:50%;border:2px solid ' + (i === 0 ? 'var(--text)' : 'transparent') + '"></button>').join('') +
      '</div></div>' +
      '<div class="field"><label>Aufgabe (optional)</label><input class="input" id="r-task-title" placeholder="z. B. Staubsaugen"></div>';
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
      r.tasks.forEach((t) => { if (!ex.tasks.find((x) => x.id === t.id)) ex.tasks.push(t); });
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
    return out;
  }

  /* =========================================================
     Toast & Aktionen
     ========================================================= */
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
        if (!confirm('„' + m.name + '“ wirklich entfernen? Die Aufgaben bleiben im Plan, nur die Person nicht mehr.')) break;
        state.members = state.members.filter((x) => x.id !== id);
        state.order = state.order.filter((x) => x !== id);
        if (state.currentUser === id) state.currentUser = state.members[0] ? state.members[0].id : null;
        save(); closeSheet(); render(); toast('Person entfernt');
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
        let r;
        if (el.dataset.new) {
          r = { id: uid('r'), name, icon, color, tasks: [] };
          state.rooms.push(r);
        } else {
          r = room(roomId);
          if (r) { r.name = name; r.icon = icon; r.color = color; }
        }
        const tTitle = ($('#r-task-title').value || '').trim();
        if (r && tTitle) {
          r.tasks.push({ id: uid('t'), title: tTitle, freq: ($('#r-task-freq') || {}).value || 'w', p: Number(($('#r-task-p') || {}).value || 1) });
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
      case 'add-task': {
        const r = room(roomId);
        const title = ($('#r-task-title').value || '').trim();
        if (!r || !title) { toast('Bitte eine Aufgabe eingeben'); break; }
        r.tasks.push({ id: uid('t'), title, freq: ($('#r-task-freq') || {}).value || 'w', p: Number(($('#r-task-p') || {}).value || 1) });
        save(); render(); sheetEditRoom(roomId);
        $('#r-task-title').value = '';
        toast('Aufgabe hinzugefügt');
        break;
      }
      case 'del-task': {
        const r = room(roomId);
        if (!r) break;
        r.tasks = r.tasks.filter((t) => t.id !== taskId);
        save(); render(); sheetEditRoom(roomId);
        break;
      }
      case 'del-room': {
        const r = room(roomId);
        if (!r) break;
        if (!confirm('Raum „' + r.name + '“ löschen?')) break;
        state.rooms = state.rooms.filter((x) => x.id !== roomId);
        delete state.offsets[roomId];
        save(); closeSheet(); render(); toast('Raum gelöscht');
        break;
      }
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

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
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
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.wgName || 'wg-putzplan').replace(/[^\w\-äöüÄÖÜß ]/g, '').replace(/\s+/g, '-') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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

  window.addEventListener('storage', function (ev) {
    if (ev.key === STORAGE_KEY) { state = load(); render(); }
  });

  // Für Tests
  window.__app = {
    get state() { return state; },
    set state(v) { state = v; },
    weekIndexOf, isoWeek, taskDue, encodeState, decodeState, mergeState, save, render, pointsOf
  };
})();
