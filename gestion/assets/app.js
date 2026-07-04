/* Rituel Barber — Gestion · SPA */
'use strict';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const S = {
  user: null,          // {name, role}
  services: [],
  today: { count: 0, entries: [] },   // journal barbier
  barberView: 'new',                  // 'new' | 'journal'
  ownerView: 'dash',                  // 'dash' | 'settings'
  ownerPeriod: 'day',                 // 'day' | 'week' | 'month'
  ownerDate: isoToday(),
  stats: null,
  barbers: [],
};

/* ================================================================ utils */

function isoToday() { return toISO(new Date()); }
function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + n); return toISO(d); }

const DAY_L = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const DAY_S = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTH_L = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function dateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return DAY_L[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_L[d.getMonth()];
}
function euro(v) {
  const opts = Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return v.toLocaleString('fr-FR', opts) + ' €';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, { error = false, action = null, onAction = null, ms = 5000 } = {}) {
  clearTimeout(toastTimer);
  toastEl.className = error ? 'err' : '';
  toastEl.innerHTML = '<span>' + msg + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
  toastEl.hidden = false;
  if (action && onAction) {
    toastEl.querySelector('button').onclick = () => { toastEl.hidden = true; onAction(); };
  }
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

async function api(action, body = null) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const res = await fetch('api.php?action=' + action, opts);
  const data = await res.json().catch(() => ({ ok: false, error: 'Réponse illisible du serveur.' }));
  if (res.status === 401 && action !== 'bootstrap' && action !== 'login') {
    S.user = null;
    renderLogin();
    throw new Error(data.error || 'Session expirée');
  }
  if (!data.ok && action !== 'bootstrap') {
    throw new Error(data.error || 'Erreur inconnue');
  }
  return data;
}

/* ===================================================== file hors-ligne */

function queueGet() { try { return JSON.parse(localStorage.rbQueue || '[]'); } catch { return []; } }
function queueSet(q) { localStorage.rbQueue = JSON.stringify(q); }

async function flushQueue() {
  let q = queueGet();
  if (!q.length || !S.user) return;
  while (q.length) {
    try {
      await api('add_entry', q[0]);
      q.shift();
      queueSet(q);
    } catch (e) {
      break; // toujours hors-ligne ou erreur : on retentera
    }
  }
  if (!queueGet().length && S.user) {
    if (S.user.role === 'barber') refreshBarber();
    updateOfflineBadge();
  }
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 20000);

function updateOfflineBadge() {
  const el = document.getElementById('offbadge');
  if (!el) return;
  const n = queueGet().length;
  el.hidden = n === 0;
  el.textContent = n + ' en attente de réseau';
}

/* ============================================================== démarrage */

async function boot() {
  try {
    const b = await api('bootstrap');
    if (b.setup_required) return renderSetup();
    if (b.user) { S.user = b.user; return enter(); }
    renderLogin();
  } catch (e) {
    app.className = 'centered';
    app.innerHTML = '<div class="card"><p>Impossible de joindre le serveur.</p>' +
      '<button class="btn" id="retry">Réessayer</button></div>';
    document.getElementById('retry').onclick = boot;
  }
}

function enter() {
  if (S.user.role === 'owner') { S.ownerView = 'dash'; renderOwner(); loadStats(); }
  else { refreshBarber(); }
  flushQueue();
}

/* ================================================================= setup */

function renderSetup() {
  app.className = 'centered';
  app.innerHTML = `
    <div class="login-brand"><div class="brand">Rituel Barber<small>Première configuration</small></div></div>
    <div class="card">
      <div class="field">
        <label for="su-pass">Ton mot de passe gérant</label>
        <input id="su-pass" type="password" autocomplete="new-password" placeholder="8 caractères minimum">
      </div>
      <div class="field">
        <label for="su-pass2">Confirme le mot de passe</label>
        <input id="su-pass2" type="password" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="su-name">Prénom du barbier</label>
        <input id="su-name" type="text" placeholder="ex. Sofiane">
      </div>
      <div class="field">
        <label for="su-pin">Son code PIN (4 à 6 chiffres)</label>
        <input id="su-pin" type="tel" inputmode="numeric" maxlength="6" placeholder="ex. 2580">
        <span class="hint">C'est ce code qu'il tapera pour ouvrir l'app. Tu pourras le changer.</span>
      </div>
      <button class="btn" id="su-go">Créer l'application</button>
    </div>`;
  document.getElementById('su-go').onclick = async () => {
    const pass = document.getElementById('su-pass').value;
    if (pass !== document.getElementById('su-pass2').value) {
      return toast('Les deux mots de passe ne correspondent pas.', { error: true });
    }
    try {
      const r = await api('setup', {
        owner_password: pass,
        barber_name: document.getElementById('su-name').value,
        barber_pin: document.getElementById('su-pin').value,
      });
      S.user = r.user;
      toast('Application configurée ✓');
      enter();
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
}

/* ================================================================= login */

function renderLogin(ownerMode = false) {
  app.className = 'centered';
  if (!ownerMode) {
    let pin = '';
    app.innerHTML = `
      <div class="login-brand"><div class="brand">Rituel Barber<small>Gestion du salon</small></div></div>
      <div class="pinwrap">
        <div class="dots" id="dots"></div>
        <div class="pad" id="pad"></div>
      </div>
      <div class="mlink">Gérant ? <b id="tomgr">Se connecter avec le mot de passe →</b></div>`;
    const dots = document.getElementById('dots');
    const pad = document.getElementById('pad');
    const drawDots = () => {
      dots.innerHTML = Array.from({ length: Math.max(4, pin.length) },
        (_, i) => `<span class="dot${i < pin.length ? ' on' : ''}"></span>`).join('');
    };
    const submit = async () => {
      if (pin.length < 4) return;
      try {
        const r = await api('login', { mode: 'pin', pin });
        S.user = r.user; enter();
      } catch (e) { pin = ''; drawDots(); toast(esc(e.message), { error: true }); }
    };
    ['1','2','3','4','5','6','7','8','9','del','0','go'].forEach(k => {
      const b = document.createElement('button');
      b.type = 'button';
      if (k === 'del') { b.className = 'key ghost'; b.textContent = '⌫'; b.onclick = () => { pin = pin.slice(0, -1); drawDots(); }; }
      else if (k === 'go') { b.className = 'key go'; b.textContent = '✓'; b.onclick = submit; }
      else { b.className = 'key'; b.textContent = k; b.onclick = () => { if (pin.length < 6) { pin += k; drawDots(); if (pin.length === 6) submit(); } }; }
      pad.appendChild(b);
    });
    drawDots();
    document.getElementById('tomgr').onclick = () => renderLogin(true);
  } else {
    app.innerHTML = `
      <div class="login-brand"><div class="brand">Rituel Barber<small>Espace gérant</small></div></div>
      <div class="card">
        <div class="field">
          <label for="lg-pass">Mot de passe</label>
          <input id="lg-pass" type="password" autocomplete="current-password">
        </div>
        <button class="btn" id="lg-go">Se connecter</button>
      </div>
      <div class="mlink"><b id="topin">← Retour au code PIN</b></div>`;
    const go = async () => {
      try {
        const r = await api('login', { mode: 'password', password: document.getElementById('lg-pass').value });
        S.user = r.user; enter();
      } catch (e) { toast(esc(e.message), { error: true }); }
    };
    document.getElementById('lg-go').onclick = go;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    document.getElementById('topin').onclick = () => renderLogin(false);
    document.getElementById('lg-pass').focus();
  }
}

async function logout() {
  try { await api('logout', {}); } catch {}
  S.user = null;
  renderLogin();
}

/* ======================================================== côté barbier */

async function refreshBarber() {
  try {
    const r = await api('state');
    S.user = r.user; S.services = r.services; S.today = r.today;
    renderBarber();
  } catch (e) { /* renderLogin déjà géré par api() en 401 */ }
}

function barberShell(content) {
  app.className = '';
  app.innerHTML = `
    <div class="hdr">
      <div class="brand">Rituel Barber<small>Gestion</small></div>
      <div class="who">
        <span>${esc(S.user.name)}</span>
        <button class="iconbtn" id="out" title="Se déconnecter" aria-label="Se déconnecter">⏻</button>
      </div>
    </div>
    <div class="badge-off" id="offbadge" hidden></div>
    <div id="content">${content}</div>
    <nav class="bottomnav">
      <button id="nav-new" class="${S.barberView === 'new' ? 'on' : ''}"><span class="ic">✂︎</span>Nouvelle presta</button>
      <button id="nav-journal" class="${S.barberView === 'journal' ? 'on' : ''}"><span class="ic">☰</span>Ma journée</button>
    </nav>`;
  document.getElementById('out').onclick = logout;
  document.getElementById('nav-new').onclick = () => { S.barberView = 'new'; renderBarber(); };
  document.getElementById('nav-journal').onclick = () => { S.barberView = 'journal'; renderBarber(); };
  updateOfflineBadge();
}

function renderBarber() {
  if (S.barberView === 'new') {
    const tiles = S.services.map(s => `
      <button class="svc" data-id="${s.id}">
        <span class="name">${esc(s.name)}</span>
        <span class="price num">${euro(s.price_cents / 100)}</span>
      </button>`).join('');
    barberShell(`
      <div class="pagehead"><span class="h1">Nouvelle presta</span><span class="date">${dateLabel(isoToday())}</span></div>
      <div class="svc-grid">
        ${tiles}
        <button class="svc free" data-id="0">
          <span class="name">Autre</span>
          <span class="price">Montant libre</span>
        </button>
      </div>`);
    document.querySelectorAll('.svc').forEach(el => {
      el.onclick = () => {
        const id = Number(el.dataset.id);
        const svc = S.services.find(s => s.id === id) || { id: 0, name: 'Autre', price_cents: 0 };
        openEntrySheet(svc);
      };
    });
  } else {
    const rows = S.today.entries.map(e => `
      <div class="row">
        <span class="t num">${e.time}</span>
        <span class="s">${esc(e.service)}</span>
        ${e.can_undo ? `<button class="link" data-undo="${e.id}">Annuler</button>` : ''}
      </div>`).join('');
    barberShell(`
      <div class="pagehead"><span class="h1">Ma journée</span><span class="date">${dateLabel(isoToday())}</span></div>
      <div class="stack">
        <div class="count"><b class="num">${S.today.count}</b> client${S.today.count > 1 ? 's' : ''} aujourd'hui</div>
        <div class="card feed">${rows || '<div class="empty">Aucune prestation enregistrée pour l\'instant.</div>'}</div>
      </div>`);
    document.querySelectorAll('[data-undo]').forEach(b => {
      b.onclick = async () => {
        try { await api('undo_entry', { id: Number(b.dataset.undo) }); toast('Saisie annulée.'); refreshBarber(); }
        catch (e) { toast(esc(e.message), { error: true }); }
      };
    });
  }
}

/* ------------------------- sheet de saisie (barbier & montant libre) */

function closeSheet() {
  document.querySelectorAll('.dim, .sheet').forEach(el => el.remove());
}

function openEntrySheet(svc) {
  closeSheet();
  const base = svc.price_cents;
  const isFree = svc.id === 0;
  let price = base;
  let payment = 'card';

  const chipVals = isFree ? [] : [...new Set([base - 500, base, base + 500].filter(v => v > 0))];
  const dim = document.createElement('div'); dim.className = 'dim'; dim.onclick = closeSheet;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="grab"></div>
    <h4>${esc(svc.name)} <span class="sp num" id="sh-price">${euro(price / 100)}</span></h4>
    <div>
      <div class="lbl">Prix</div>
      <div class="chips-row" id="sh-chips">
        ${chipVals.map(v => `<button class="pchip num${v === base ? ' on' : ''}" data-v="${v}">${euro(v / 100)}</button>`).join('')}
        <button class="pchip${isFree ? ' on' : ''}" id="sh-other">Autre…</button>
      </div>
      <div class="field" id="sh-custom" ${isFree ? '' : 'hidden'} style="margin:12px 0 0">
        <input type="number" inputmode="decimal" min="0" max="500" step="0.5" placeholder="Montant en €" id="sh-input">
      </div>
    </div>
    <div>
      <div class="lbl">Paiement</div>
      <div class="seg">
        <button id="pay-cash">Espèces</button>
        <button id="pay-card" class="on">Carte</button>
      </div>
    </div>
    <button class="btn" id="sh-save">Enregistrer ✓</button>`;
  document.body.append(dim, sheet);

  const priceEl = sheet.querySelector('#sh-price');
  const customBox = sheet.querySelector('#sh-custom');
  const customIn = sheet.querySelector('#sh-input');
  const setPrice = v => { price = v; priceEl.textContent = euro(v / 100); };

  sheet.querySelectorAll('#sh-chips .pchip[data-v]').forEach(c => {
    c.onclick = () => {
      sheet.querySelectorAll('#sh-chips .pchip').forEach(x => x.classList.remove('on'));
      c.classList.add('on'); customBox.hidden = true;
      setPrice(Number(c.dataset.v));
    };
  });
  sheet.querySelector('#sh-other').onclick = () => {
    sheet.querySelectorAll('#sh-chips .pchip').forEach(x => x.classList.remove('on'));
    sheet.querySelector('#sh-other').classList.add('on');
    customBox.hidden = false; customIn.focus();
  };
  customIn.oninput = () => {
    const v = Math.round(parseFloat(customIn.value || '0') * 100);
    if (v >= 0) setPrice(v);
  };
  const payCash = sheet.querySelector('#pay-cash'), payCard = sheet.querySelector('#pay-card');
  payCash.onclick = () => { payment = 'cash'; payCash.classList.add('on'); payCard.classList.remove('on'); };
  payCard.onclick = () => { payment = 'card'; payCard.classList.add('on'); payCash.classList.remove('on'); };
  if (isFree) customIn.focus();

  sheet.querySelector('#sh-save').onclick = async () => {
    if (price <= 0) return toast('Indique un montant.', { error: true });
    const payload = { service_id: svc.id, service_name: svc.name, price_cents: price, payment };
    closeSheet();
    try {
      const r = await api('add_entry', payload);
      toast(`<b>Enregistré ✓</b>&nbsp; ${esc(r.entry.service)} · ${r.entry.time}`, {
        action: 'Annuler',
        onAction: async () => {
          try { await api('undo_entry', { id: r.entry.id }); toast('Saisie annulée.'); refreshBarber(); }
          catch (e) { toast(esc(e.message), { error: true }); }
        },
      });
      if (S.user.role === 'barber') refreshBarber(); else loadStats();
    } catch (e) {
      if (e instanceof TypeError) { // panne réseau : file d'attente locale
        payload.client_time = new Date().toISOString();
        const q = queueGet(); q.push(payload); queueSet(q);
        updateOfflineBadge();
        toast('Pas de réseau — saisie gardée, elle partira toute seule.', { ms: 6000 });
      } else {
        toast(esc(e.message), { error: true });
      }
    }
  };
}

/* ========================================================= côté gérant */

function ownerShell(content) {
  app.className = '';
  app.innerHTML = `
    <div class="hdr">
      <div class="brand">Rituel Barber<small>Espace gérant</small></div>
      <div class="who">
        <button class="iconbtn" id="out" title="Se déconnecter" aria-label="Se déconnecter">⏻</button>
      </div>
    </div>
    <div id="content">${content}</div>
    <nav class="bottomnav">
      <button id="nav-dash" class="${S.ownerView === 'dash' ? 'on' : ''}"><span class="ic">▦</span>Tableau</button>
      <button id="nav-set" class="${S.ownerView === 'settings' ? 'on' : ''}"><span class="ic">⚙︎</span>Réglages</button>
    </nav>`;
  document.getElementById('out').onclick = logout;
  document.getElementById('nav-dash').onclick = () => { S.ownerView = 'dash'; renderOwner(); loadStats(); };
  document.getElementById('nav-set').onclick = () => { S.ownerView = 'settings'; loadSettings(); };
}

function renderOwner() {
  if (S.ownerView !== 'dash') return;
  ownerShell(`
    <div class="tabs" id="ptabs">
      <button data-p="day" class="${S.ownerPeriod === 'day' ? 'on' : ''}">Jour</button>
      <button data-p="week" class="${S.ownerPeriod === 'week' ? 'on' : ''}">Semaine</button>
      <button data-p="month" class="${S.ownerPeriod === 'month' ? 'on' : ''}">Mois</button>
    </div>
    <div class="datenav">
      <button class="iconbtn" id="dprev" aria-label="Période précédente">‹</button>
      <span class="cur" id="dlabel"></span>
      <button class="iconbtn" id="dnext" aria-label="Période suivante">›</button>
    </div>
    <div id="statzone"><div class="empty">Chargement…</div></div>`);
  document.querySelectorAll('#ptabs button').forEach(b => {
    b.onclick = () => { S.ownerPeriod = b.dataset.p; S.ownerDate = isoToday(); renderOwner(); loadStats(); };
  });
  const step = S.ownerPeriod === 'day' ? d => addDays(d, 1) : S.ownerPeriod === 'week' ? d => addDays(d, 7) : d => addMonths(d, 1);
  const back = S.ownerPeriod === 'day' ? d => addDays(d, -1) : S.ownerPeriod === 'week' ? d => addDays(d, -7) : d => addMonths(d, -1);
  document.getElementById('dprev').onclick = () => { S.ownerDate = back(S.ownerDate); loadStats(); };
  document.getElementById('dnext').onclick = () => { S.ownerDate = step(S.ownerDate); loadStats(); };
}

async function loadStats() {
  try {
    const r = await api('stats', { period: S.ownerPeriod, date: S.ownerDate });
    S.stats = r;
    drawStats();
  } catch (e) { toast(esc(e.message), { error: true }); }
}

function periodLabel() {
  const st = S.stats;
  if (st.period === 'day') return dateLabel(st.from);
  if (st.period === 'week') {
    const a = new Date(st.from + 'T12:00:00'), b = new Date(st.to + 'T12:00:00');
    return 'Semaine du ' + a.getDate() + ' ' + MONTH_L[a.getMonth()] + ' au ' + b.getDate() + ' ' + MONTH_L[b.getMonth()];
  }
  const d = new Date(st.from + 'T12:00:00');
  return MONTH_L[d.getMonth()] + ' ' + d.getFullYear();
}

function drawStats() {
  const st = S.stats;
  const label = document.getElementById('dlabel');
  if (!label) return;
  const notNow = !(st.from <= isoToday() && isoToday() <= st.to);
  label.innerHTML = esc(periodLabel()) + (notNow ? '<small id="goToday">↩ revenir à aujourd\'hui</small>' : '');
  if (notNow) label.querySelector('#goToday').onclick = () => { S.ownerDate = isoToday(); loadStats(); };

  const deltaTxt = st.delta_pct === null ? '' :
    ` · <span class="${st.delta_pct >= 0 ? 'delta-up' : 'delta-down'}">${st.delta_pct >= 0 ? '+' : ''}${st.delta_pct} % vs ${st.period === 'day' ? 'même jour sem. passée' : st.period === 'week' ? 'sem. précédente' : 'mois précédent'}</span>`;

  let body = `
    <div class="hero-num">
      <div class="v num">${st.total.toLocaleString('fr-FR')}<small> €</small></div>
      <div class="cap">${esc(periodLabel())}${deltaTxt}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k">Clients</div><div class="x num">${st.count}</div></div>
      <div class="kpi"><div class="k">Ticket moyen</div><div class="x num">${st.count ? euro(st.avg) : '—'}</div></div>
      <div class="kpi"><div class="k">Carte / Esp.</div><div class="x num">${st.card_pct === null ? '—' : st.card_pct + '/' + (100 - st.card_pct)}</div></div>
    </div>`;

  if (st.period === 'day') {
    const rows = (st.entries || []).map(e => `
      <div class="row tap" data-id="${e.id}" data-price="${e.price}" data-pay="${e.payment}" data-svc="${esc(e.service)}">
        <span class="t num">${e.time}</span>
        <span class="s">${esc(e.service)}<small>${esc(e.barber)}</small></span>
        <span class="pay">${e.payment === 'card' ? 'CB' : 'ESP'}</span>
        <span class="amt num">${euro(e.price)}</span>
      </div>`).join('');
    body += `<div class="card feed">${rows || '<div class="empty">Aucune prestation ce jour-là.</div>'}</div>`;
  } else {
    body += chartHTML(st) + splitHTML(st);
  }

  document.getElementById('statzone').innerHTML = body;
  document.querySelectorAll('.row.tap').forEach(el => { el.onclick = () => openOwnerEntrySheet(el.dataset); });
}

function chartHTML(st) {
  const series = st.series || [];
  const max = Math.max(...series.map(s => s.total), 1);
  const today = isoToday();
  const maxIdx = series.reduce((mi, s, i) => (s.total > series[mi].total ? i : mi), 0);
  const isMonth = st.period === 'month';
  const cols = series.map((s, i) => {
    const d = new Date(s.date + 'T12:00:00');
    const lbl = isMonth ? (d.getDate() === 1 || d.getDate() % 5 === 0 ? d.getDate() : '') : DAY_S[d.getDay()];
    const hot = s.date === today;
    const showVal = s.total > 0 && (hot || i === maxIdx) && !isMonth;
    return `<div class="bcol" title="${dateLabel(s.date)} : ${euro(s.total)}">
      ${showVal ? `<span class="bv num">${Math.round(s.total)}</span>` : ''}
      <div class="bar${hot ? ' hot' : ''}" style="height:${Math.max(2, Math.round(s.total * 88 / max))}px"></div>
      <span class="bl">${lbl}</span>
    </div>`;
  }).join('');
  return `<div class="card chart-card" style="margin-bottom:12px"><h5>Recette par jour</h5><div class="bars">${cols}</div></div>`;
}

function splitHTML(st) {
  if (!st.split.length) return '';
  const rows = st.split.map(s => `
    <div class="srow">
      <span class="sl" title="${esc(s.name)}">${esc(s.name)}</span>
      <div class="track"><div class="fill" style="width:${s.share}%"></div></div>
      <span class="pv num">${s.share}%</span>
    </div>`).join('');
  return `<div class="card chart-card"><h5>Répartition par prestation</h5><div class="split">${rows}</div></div>`;
}

/* ------------------------------------ édition d'une saisie (gérant) */

function openOwnerEntrySheet(ds) {
  closeSheet();
  const id = Number(ds.id);
  let payment = ds.pay;
  const dim = document.createElement('div'); dim.className = 'dim'; dim.onclick = closeSheet;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="grab"></div>
    <h4>${esc(ds.svc)}</h4>
    <div class="field">
      <label>Prix (€)</label>
      <input type="number" inputmode="decimal" min="0" step="0.5" id="oe-price" value="${ds.price}">
    </div>
    <div>
      <div class="lbl">Paiement</div>
      <div class="seg">
        <button id="oe-cash" class="${payment === 'cash' ? 'on' : ''}">Espèces</button>
        <button id="oe-card" class="${payment === 'card' ? 'on' : ''}">Carte</button>
      </div>
    </div>
    <button class="btn" id="oe-save">Enregistrer la modification</button>
    <button class="btn danger" id="oe-del">Supprimer cette saisie</button>`;
  document.body.append(dim, sheet);
  const cash = sheet.querySelector('#oe-cash'), card = sheet.querySelector('#oe-card');
  cash.onclick = () => { payment = 'cash'; cash.classList.add('on'); card.classList.remove('on'); };
  card.onclick = () => { payment = 'card'; card.classList.add('on'); cash.classList.remove('on'); };
  sheet.querySelector('#oe-save').onclick = async () => {
    const cents = Math.round(parseFloat(sheet.querySelector('#oe-price').value || '0') * 100);
    closeSheet();
    try { await api('entry_update', { id, price_cents: cents, payment }); toast('Saisie modifiée ✓'); loadStats(); }
    catch (e) { toast(esc(e.message), { error: true }); }
  };
  sheet.querySelector('#oe-del').onclick = async () => {
    if (!confirm('Supprimer définitivement cette saisie ?')) return;
    closeSheet();
    try { await api('undo_entry', { id }); toast('Saisie supprimée.'); loadStats(); }
    catch (e) { toast(esc(e.message), { error: true }); }
  };
}

/* ============================================================= réglages */

async function loadSettings() {
  try {
    const [st, br] = await Promise.all([api('state'), api('barbers')]);
    S.services = st.services; S.barbers = br.barbers;
    renderSettings();
  } catch (e) { toast(esc(e.message), { error: true }); }
}

function renderSettings() {
  const svcRows = S.services.map(s => `
    <div class="row tap" data-svc="${s.id}">
      <span class="s">${esc(s.name)}</span>
      <span class="amt num">${euro(s.price_cents / 100)}</span>
      <span class="link">Modifier</span>
    </div>`).join('');
  const brbRows = S.barbers.map(b => `
    <div class="row tap" data-brb="${b.id}">
      <span class="s">${esc(b.name)}${b.active ? '' : ' <small>(désactivé)</small>'}<small>PIN : ••••</small></span>
      <span class="link">Modifier</span>
    </div>`).join('');
  const monthStart = isoToday().slice(0, 8) + '01';

  ownerShell(`
    <div class="pagehead"><span class="h1">Réglages</span></div>
    <div class="lbl">Prestations &amp; tarifs</div>
    <div class="card feed">
      ${svcRows}
      <button class="addlink" id="svc-add">+ Ajouter une prestation</button>
    </div>
    <div class="lbl">Équipe</div>
    <div class="card feed">
      ${brbRows}
      <button class="addlink" id="brb-add">+ Ajouter un barbier</button>
    </div>
    <div class="lbl">Export comptable</div>
    <div class="card">
      <div class="export-row">
        <input type="date" id="ex-from" value="${monthStart}">
        <input type="date" id="ex-to" value="${isoToday()}">
        <button class="btn sm" id="ex-go">Exporter CSV</button>
      </div>
    </div>
    <div class="lbl">Sécurité</div>
    <div class="card">
      <div class="field"><label>Mot de passe actuel</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div class="field"><label>Nouveau mot de passe</label><input type="password" id="pw-new" autocomplete="new-password" placeholder="8 caractères minimum"></div>
      <button class="btn ghost" id="pw-go">Changer le mot de passe</button>
    </div>
    <div class="note" style="margin-top:16px"><b>Rappel :</b> les comptes barbiers ne voient jamais les montants ni les totaux. Seul ton compte gérant accède au tableau et à ces réglages.</div>`);

  document.querySelectorAll('[data-svc]').forEach(el => {
    el.onclick = () => openServiceSheet(S.services.find(s => s.id === Number(el.dataset.svc)));
  });
  document.getElementById('svc-add').onclick = () => openServiceSheet(null);
  document.querySelectorAll('[data-brb]').forEach(el => {
    el.onclick = () => openBarberSheet(S.barbers.find(b => b.id === Number(el.dataset.brb)));
  });
  document.getElementById('brb-add').onclick = () => openBarberSheet(null);
  document.getElementById('ex-go').onclick = () => {
    const f = document.getElementById('ex-from').value, t = document.getElementById('ex-to').value;
    window.location.href = 'api.php?action=export&from=' + f + '&to=' + t;
  };
  document.getElementById('pw-go').onclick = async () => {
    try {
      await api('owner_password', {
        current: document.getElementById('pw-cur').value,
        new: document.getElementById('pw-new').value,
      });
      toast('Mot de passe changé ✓');
      document.getElementById('pw-cur').value = document.getElementById('pw-new').value = '';
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
}

function openServiceSheet(svc) {
  closeSheet();
  const dim = document.createElement('div'); dim.className = 'dim'; dim.onclick = closeSheet;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="grab"></div>
    <h4>${svc ? 'Modifier la prestation' : 'Nouvelle prestation'}</h4>
    <div class="field"><label>Nom</label><input type="text" id="sv-name" value="${svc ? esc(svc.name) : ''}" placeholder="ex. Coupe Enfant"></div>
    <div class="field"><label>Prix (€)</label><input type="number" inputmode="decimal" min="0" step="0.5" id="sv-price" value="${svc ? svc.price_cents / 100 : ''}"></div>
    <button class="btn" id="sv-save">Enregistrer</button>
    ${svc ? '<button class="btn danger" id="sv-del">Retirer cette prestation</button>' : ''}`;
  document.body.append(dim, sheet);
  sheet.querySelector('#sv-save').onclick = async () => {
    const name = sheet.querySelector('#sv-name').value;
    const cents = Math.round(parseFloat(sheet.querySelector('#sv-price').value || '0') * 100);
    closeSheet();
    try {
      const r = await api('service_save', { id: svc ? svc.id : 0, name, price_cents: cents });
      S.services = r.services; toast('Prestation enregistrée ✓'); renderSettings();
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
  const del = sheet.querySelector('#sv-del');
  if (del) del.onclick = async () => {
    closeSheet();
    try {
      const r = await api('service_delete', { id: svc.id });
      S.services = r.services; toast('Prestation retirée. L\'historique est conservé.'); renderSettings();
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
}

function openBarberSheet(brb) {
  closeSheet();
  const dim = document.createElement('div'); dim.className = 'dim'; dim.onclick = closeSheet;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="grab"></div>
    <h4>${brb ? 'Modifier ' + esc(brb.name) : 'Nouveau barbier'}</h4>
    <div class="field"><label>Prénom</label><input type="text" id="bb-name" value="${brb ? esc(brb.name) : ''}"></div>
    <div class="field">
      <label>${brb ? 'Nouveau PIN (laisser vide pour ne pas changer)' : 'Code PIN (4 à 6 chiffres)'}</label>
      <input type="tel" inputmode="numeric" maxlength="6" id="bb-pin" placeholder="ex. 2580">
    </div>
    <button class="btn" id="bb-save">Enregistrer</button>
    ${brb ? `<button class="btn ghost" id="bb-toggle">${brb.active ? 'Désactiver ce compte' : 'Réactiver ce compte'}</button>` : ''}`;
  document.body.append(dim, sheet);
  sheet.querySelector('#bb-save').onclick = async () => {
    const name = sheet.querySelector('#bb-name').value;
    const pin = sheet.querySelector('#bb-pin').value;
    closeSheet();
    try {
      const r = await api('barber_save', { id: brb ? brb.id : 0, name, pin });
      S.barbers = r.barbers; toast('Enregistré ✓'); renderSettings();
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
  const tg = sheet.querySelector('#bb-toggle');
  if (tg) tg.onclick = async () => {
    closeSheet();
    try {
      const r = await api('barber_toggle', { id: brb.id });
      S.barbers = r.barbers; renderSettings();
    } catch (e) { toast(esc(e.message), { error: true }); }
  };
}

/* ============================================================== PWA */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

boot();
