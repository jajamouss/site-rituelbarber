const $ = (s, r=document) => r.querySelector(s);
const app = $('#app');
let csrf = window.RIT_DB.csrf;
let state = { user: window.RIT_DB.user, services: [], selected: null, payment: 'card', price: 0, pin: '', date: today() };

function today(){ return new Date().toISOString().slice(0,10); }
function euro(v){ return `${Number(v||0).toLocaleString('fr-FR')} €`; }
function time(s){ return String(s||'').slice(11,16); }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

async function api(action, data=null, opts={}){
  const init = data ? {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)} : {};
  const res = await fetch(`api.php?action=${encodeURIComponent(action)}${opts.qs||''}`, init);
  if(action === 'export_csv') return res;
  const json = await res.json();
  if(json.csrf) csrf = json.csrf;
  if(!json.ok) throw new Error(json.error || 'Erreur');
  return json;
}

function toast(msg){
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className='toast';
  el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),2600);
}

function shell(inner, tab='cashier'){
  const admin = state.user?.role === 'admin';
  document.body.classList.toggle('is-admin', admin);
  app.innerHTML = `
    <header class="top">
      <div><small>Rituel Barber · Viry-Châtillon</small><h1>${admin?'Gestion gérant':'Caisse barbier'}</h1></div>
      <button class="pill" id="logout">${esc(state.user?.name||'Session')} · sortir</button>
    </header>
    ${inner}
    <nav class="tabs">
      <button data-tab="cashier" class="${tab==='cashier'?'on':''}">Saisie</button>
      <button data-tab="day" class="${tab==='day'?'on':''}">Journée</button>
      <button data-tab="stats" class="${tab==='stats'?'on':''} admin-only">Stats</button>
      <button data-tab="settings" class="${tab==='settings'?'on':''} admin-only">Réglages</button>
    </nav>`;
  $('#logout').onclick=async()=>{await api('logout',{}).catch(()=>{});state.user=null;renderLogin();};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>render(b.dataset.tab));
}

function renderSetup(){
  app.innerHTML = `<section class="card login-card">
    <div class="brand-mark">RB</div><h2>Installation privée</h2>
    <p>Crée le compte gérant et le PIN du premier barbier. Cette étape ne s'affiche qu'une fois.</p>
    <label>Nom gérant</label><input id="admin-name" value="Gérant">
    <label>Mot de passe gérant</label><input id="admin-pass" type="password" autocomplete="new-password" placeholder="8 caractères minimum">
    <label>Nom barbier</label><input id="barber-name" value="Barbier — Fauteuil 1">
    <label>PIN barbier</label><input id="barber-pin" inputmode="numeric" maxlength="4" placeholder="4 chiffres">
    <div class="setup-actions"><button class="btn primary" id="setup">Créer l'application</button></div>
  </section>`;
  $('#setup').onclick=async()=>{
    try{
      const r=await api('setup',{admin_name:$('#admin-name').value,password:$('#admin-pass').value,barber_name:$('#barber-name').value,pin:$('#barber-pin').value});
      state.user=r.user; toast('Application initialisée'); await loadBase(); render('cashier');
    }catch(e){toast(e.message)}
  };
}

function renderLogin(mode='pin'){
  app.innerHTML = `<section class="card login-card">
    <div class="brand-mark">RB</div><h2>${mode==='admin'?'Connexion gérant':'PIN barbier'}</h2>
    <p>${mode==='admin'?'Accès complet aux totaux, exports et réglages.':'Saisie rapide, sans montants cumulés.'}</p>
    ${mode==='admin'
      ? `<label>Mot de passe</label><input id="admin-password" type="password" autofocus><button class="btn primary" id="admin-login">Entrer</button>`
      : `<div class="pin-dots">${[0,1,2,3].map(i=>`<span class="${state.pin.length>i?'on':''}"></span>`).join('')}</div><div class="keypad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(n=>`<button data-key="${n}">${n}</button>`).join('')}</div>`}
    <div class="setup-actions"><button class="btn ghost" id="switch">${mode==='admin'?'Utiliser PIN barbier':'Gérant ? Mot de passe'}</button></div>
  </section>`;
  $('#switch').onclick=()=>{state.pin='';renderLogin(mode==='admin'?'pin':'admin')};
  if(mode==='admin'){
    $('#admin-login').onclick=async()=>loginAdmin();
    $('#admin-password').onkeydown=e=>{if(e.key==='Enter')loginAdmin()};
  }else{
    document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>pinKey(b.dataset.key));
  }
}

async function loginAdmin(){
  try{const r=await api('login',{mode:'admin',password:$('#admin-password').value});state.user=r.user;await loadBase();render('cashier');}
  catch(e){toast(e.message)}
}
async function pinKey(k){
  if(k==='⌫') state.pin=state.pin.slice(0,-1);
  else if(/\d/.test(k) && state.pin.length<4) state.pin+=k;
  renderLogin('pin');
  if(state.pin.length===4){
    try{const r=await api('login',{mode:'pin',pin:state.pin});state.user=r.user;state.pin='';await loadBase();render('cashier');}
    catch(e){state.pin='';toast(e.message);setTimeout(()=>renderLogin('pin'),400)}
  }
}

async function loadBase(){
  const r = await api('services');
  state.services = r.services;
  state.selected = state.services.find(s=>Number(s.active)) || null;
  state.price = state.selected ? Number(state.selected.price) : 0;
}

function render(tab='cashier'){
  if(!window.RIT_DB.hasUsers && !state.user) return renderSetup();
  if(!state.user) return renderLogin();
  if(tab==='day') return renderDay();
  if(tab==='stats') return renderStats();
  if(tab==='settings') return renderSettings();
  return renderCashier();
}

function renderCashier(){
  const services = state.services.filter(s=>Number(s.active));
  shell(`<section class="grid two">
    <div class="card">
      <h2>Nouvelle prestation</h2>
      <div class="services">${services.map(s=>`<button class="service ${state.selected?.id==s.id?'active':''}" data-service="${s.id}"><strong>${esc(s.name)}</strong><span>${euro(s.price)}</span></button>`).join('')}</div>
    </div>
    <div class="card">
      <h2>${esc(state.selected?.name||'Prestation')}</h2>
      <label>Prix</label>
      <div class="price-row">${[state.price-5,state.price,state.price+5].filter(v=>v>0).map(v=>`<button class="chip ${v===state.price?'active':''}" data-price="${v}">${euro(v)}</button>`).join('')}<input id="custom-price" inputmode="numeric" placeholder="Autre prix"></div>
      <label>Paiement</label><div class="pay"><button data-pay="card" class="${state.payment==='card'?'active':''}">Carte</button><button data-pay="cash" class="${state.payment==='cash'?'active':''}">Espèces</button></div>
      <div class="setup-actions"><button class="btn good" id="save-entry">Enregistrer ✓</button><button class="btn ghost" id="undo">Annuler dernière</button></div>
    </div>
  </section>`, 'cashier');
  document.querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>{state.selected=state.services.find(s=>s.id==b.dataset.service);state.price=Number(state.selected.price);renderCashier();});
  document.querySelectorAll('[data-price]').forEach(b=>b.onclick=()=>{state.price=Number(b.dataset.price);renderCashier();});
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{state.payment=b.dataset.pay;renderCashier();});
  $('#save-entry').onclick=saveEntry;
  $('#undo').onclick=async()=>{try{await api('entry_undo',{});toast('Dernière saisie annulée');}catch(e){toast(e.message)}};
}

async function saveEntry(){
  if(!state.selected) return toast('Choisis une prestation');
  const custom = Number($('#custom-price')?.value || 0);
  try{
    await api('entry_create',{service_id:state.selected.id,price:custom||state.price,payment:state.payment});
    toast('Prestation enregistrée');
    queueFlush();
  }catch(e){
    queueOffline({service_id:state.selected.id,price:custom||state.price,payment:state.payment});
    toast('Hors ligne : saisie gardée sur ce téléphone');
  }
}

function queueOffline(row){
  const rows=JSON.parse(localStorage.getItem('rituel_pending')||'[]'); rows.push(row);
  localStorage.setItem('rituel_pending',JSON.stringify(rows));
}
async function queueFlush(){
  const rows=JSON.parse(localStorage.getItem('rituel_pending')||'[]'); if(!rows.length)return;
  const rest=[]; for(const row of rows){try{await api('entry_create',row)}catch(e){rest.push(row)}}
  localStorage.setItem('rituel_pending',JSON.stringify(rest));
}

async function renderDay(){
  const r=await api('dashboard',null,{qs:`&date=${state.date}`});
  const s=r.summary, admin=r.role==='admin';
  shell(`<section class="grid">
    <div class="card"><label>Date</label><input type="date" id="date" value="${esc(state.date)}"></div>
    <div class="stats">
      ${admin?`<div class="stat"><b>${esc(s.total_label)}</b><span>Total jour</span></div><div class="stat"><b>${s.clients}</b><span>Clients</span></div><div class="stat"><b>${esc(s.avg_label)}</b><span>Ticket moyen</span></div><div class="stat"><b>${euro(s.card)} / ${euro(s.cash)}</b><span>Carte / espèces</span></div>`:`<div class="stat"><b>${s.clients}</b><span>Clients aujourd'hui</span></div>`}
    </div>
    <div class="card"><h2>Journal</h2><div class="entries">${r.entries.map(entryHtml).join('')||'<p>Aucune prestation.</p>'}</div></div>
  </section>`, 'day');
  $('#date').onchange=e=>{state.date=e.target.value;renderDay()};
  document.querySelectorAll('[data-void]').forEach(b=>b.onclick=async()=>{if(confirm('Annuler cette ligne ?')){await api('entry_void',{id:b.dataset.void});renderDay();}});
}

function entryHtml(e){
  const admin=state.user.role==='admin';
  return `<div class="entry ${Number(e.voided)?'void':''}">
    <span class="time">${time(e.created_at)}</span><strong>${esc(e.service_name)}</strong>
    ${admin?`<span class="tag ${e.payment==='cash'?'cash':'card'}">${e.payment==='cash'?'ESP':'CB'}</span><b>${euro(e.price)}</b>`:''}
    ${admin && !Number(e.voided)?`<div class="entry-actions"><button class="btn ghost" data-void="${e.id}">Annuler</button></div>`:''}
  </div>`;
}

async function renderStats(){
  const r=await api('dashboard',null,{qs:`&date=${state.date}`}); const s=r.summary;
  shell(`<section class="grid">
    <div class="stats"><div class="stat"><b>${s.week.total_label}</b><span>Semaine</span></div><div class="stat"><b>${s.week.clients}</b><span>Clients semaine</span></div><div class="stat"><b>${s.month.total_label}</b><span>Mois</span></div><div class="stat"><b>${s.month.clients}</b><span>Clients mois</span></div></div>
    <div class="card"><h2>Prestations du jour</h2><table class="table"><tbody>${(s.by_service||[]).map(x=>`<tr><td>${esc(x.service_name)}</td><td>${x.qty}</td><td>${euro(x.total)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h2>Export</h2><div class="setup-actions"><input id="from" type="date" value="${today().slice(0,8)}01"><input id="to" type="date" value="${today()}"><button class="btn primary" id="export">Exporter CSV</button></div></div>
  </section>`, 'stats');
  $('#export').onclick=()=>{location.href=`api.php?action=export_csv&from=${$('#from').value}&to=${$('#to').value}`};
}

function renderSettings(){
  shell(`<section class="grid two">
    <div class="card"><h2>Prestations & tarifs</h2><div class="entries">${state.services.map(serviceForm).join('')}</div><button class="btn primary" id="add-service">+ Ajouter</button></div>
    <div class="card"><h2>Équipe</h2><p>Ajoute un barbier avec son PIN personnel.</p><label>Nom</label><input id="new-user-name" placeholder="Barbier — Fauteuil 2"><label>PIN</label><input id="new-user-pin" maxlength="4" inputmode="numeric"><button class="btn primary" id="add-user">Ajouter barbier</button><p class="muted">Les barbiers ne voient jamais les montants cumulés.</p></div>
  </section>`, 'settings');
  document.querySelectorAll('[data-save-service]').forEach(b=>b.onclick=async()=>saveService(b.dataset.saveService));
  $('#add-service').onclick=()=>saveService('');
  $('#add-user').onclick=async()=>{try{await api('user_save',{name:$('#new-user-name').value,pin:$('#new-user-pin').value});toast('Barbier ajouté');}catch(e){toast(e.message)}};
}

function serviceForm(s){
  return `<div class="entry"><input id="sn-${s.id}" value="${esc(s.name)}"><input id="sp-${s.id}" value="${Number(s.price)}" inputmode="numeric"><label><input id="sa-${s.id}" type="checkbox" ${Number(s.active)?'checked':''}> actif</label><button class="btn ghost" data-save-service="${s.id}">OK</button></div>`;
}
async function saveService(id){
  const name = id ? $(`#sn-${id}`).value : prompt('Nom de la prestation');
  const price = id ? $(`#sp-${id}`).value : prompt('Prix en euros');
  const active = id ? $(`#sa-${id}`).checked : true;
  if(!name||!price)return;
  try{await api('service_save',{id,name,price:Number(price),active});await loadBase();renderSettings();toast('Prestation sauvegardée');}catch(e){toast(e.message)}
}

window.addEventListener('online', queueFlush);
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
render();
