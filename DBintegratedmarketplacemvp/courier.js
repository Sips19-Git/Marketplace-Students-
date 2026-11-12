/* MyVossieMarketplace - courier side. Plain HTML/CSS/JS, hash routing (same pattern as seller.js / buyer.js).
   Shares the order list with the seller (localStorage key cm_seller_orders) so statuses stay in sync across dashboards. */
const CONFIG = {
  API_BASE: '/api',
  SUPABASE: { url: '', key: '', table: 'orders' }, // fill in (and load supabase-js in courier.html) to refresh on Realtime changes
  CURRENCY: 'R', DELIVERY_FEE: 25, COURIER_CUT: 0.2, // display only: the server must calculate fees and payouts
  MIN_PAYOUT: 50, MAX_ACTIVE: 3, OTP_TTL_H: 48, OTP_MAX_TRIES: 5, POLL_MS: 4000,
  DEV: true, // dev only: shows "Approve me", "Add test job" and reveals delivery OTPs. Set false in production.
  CAMPUSES: ['Potchefstroom', 'Pretoria', 'Johannesburg', 'Durban', 'Cape Town', 'Bloemfontein'],
  BANKS: ['Capitec', 'FNB', 'Standard Bank', 'Absa', 'Nedbank', 'TymeBank', 'Discovery Bank', 'African Bank', 'Other'],
  ISSUES: ['Buyer not reachable', 'Wrong or unclear address', 'Seller not available', 'Item damaged or not as described', 'Safety concern', 'Other']
};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => CONFIG.CURRENCY + Number(n || 0).toFixed(2);
const date = t => new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : date(t); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + Math.random()).slice(0, 12);

/* ---------- data layer: localStorage now. Each call maps to a Supabase query / endpoint ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('Storage is full.'); return false; } },
  orders: () => store.get('cm_seller_orders', []),     // select from orders (RLS: awaiting_courier on my campus + my own jobs)
  saveOrders: v => store.set('cm_seller_orders', v),
  profile: () => { let p = store.get('cm_courier', null); if (!p) { const b = store.get('cm_profile', {}); p = { id: uid(), name: b.name || 'Courier', email: b.email || '', phone: b.phone || '', studentNo: b.studentNo || '', campus: b.campus || 'Potchefstroom', status: 'approved' }; store.set('cm_courier', p); } return p; }, // couriers table
  saveProfile: v => { const ok = store.set('cm_courier', v); if (window.Auth) Auth.update('courier', v); return ok; },
  notes: () => store.get('cm_courier_notes', []),      // notifications table (Realtime channel per courier)
  payouts: () => store.get('cm_courier_payouts', []),
  issues: () => store.get('cm_courier_issues', [])
};

/* ---------- delivery workflow ----------
   Courier stages map onto the seller's existing statuses so the seller dashboard keeps working untouched. */
const SL = { accepted: 'Accepted', ready: 'Ready for Collection', collected: 'Collected', transit: 'In Transit', completed: 'Completed' };
const STAGES = Object.keys(SL);
const STATUS = { accepted: 'courier_assigned', ready: 'courier_assigned', collected: 'collected', transit: 'collected', completed: 'delivered' };
const NEXT = { accepted: 'ready', ready: 'collected', collected: 'transit' };
const stageOf = o => o.courierStage || ({ courier_assigned: 'accepted', collected: 'collected', delivered: 'completed', completed: 'completed' })[o.status];
const P = () => store.profile(), approved = () => true; // no registration step: every courier can see and accept jobs
const mine = o => o.courier && P() && o.courier.id === P().id;
const myOrders = () => store.orders().filter(o => mine(o) && stageOf(o));
const active = () => myOrders().filter(o => stageOf(o) !== 'completed' && !['cancelled', 'rejected'].includes(o.status));
const done = () => myOrders().filter(o => stageOf(o) === 'completed');
// paid delivery orders the seller has released, unclaimed, on the courier's campus.
const jobs = () => approved() ? store.orders().filter(o => o.status === 'awaiting_courier' && !o.courier && o.fulfilment === 'delivery' && o.paymentStatus === 'paid' && (o.campus || '') === P().campus).sort((a, b) => b.createdAt - a.createdAt) : [];
const fee = o => o.deliveryFee ?? CONFIG.DELIVERY_FEE;
const pay = o => o.courierPayout ?? +(fee(o) * (1 - CONFIG.COURIER_CUT)).toFixed(2);
const km = o => o.distanceKm ?? 0.4 + ([...String(o.id)].reduce((s, c) => s + c.charCodeAt(0), 0) % 22) / 10; // estimate until a maps API is connected
function earn() {
  const d = done(), sum = a => a.reduce((s, o) => s + pay(o), 0), at = o => o.deliveredAt || o.courierUpdatedAt || 0;
  const w = new Date(); w.setHours(0, 0, 0, 0); w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
  const m = new Date(); m.setHours(0, 0, 0, 0); m.setDate(1);
  const total = sum(d), out = store.payouts().reduce((s, p) => s + p.amount, 0);
  return { total, week: sum(d.filter(o => at(o) >= +w)), month: sum(d.filter(o => at(o) >= +m)), pending: sum(active()), balance: total - out, count: d.length };
}
function note(text, orderId) { const n = store.notes(); n.unshift({ id: uid(), text, orderId, at: Date.now(), read: false }); store.set('cm_courier_notes', n.slice(0, 50)); }

const state = { dst: 'all', msg: {} };

/* ---------- views ---------- */
const ic = d => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></span>`;
const vchip = s => `<span class="chip go">Courier account active</span>`;
const kv = (k, v) => `<div class="kv"><small>${k}</small><span>${v}</span></div>`;

function overview() {
  const p = P(), E = earn(), J = jobs(), A = active();
  const recent = myOrders().sort((a, b) => (b.courierUpdatedAt || 0) - (a.courierUpdatedAt || 0)).slice(0, 4);
  return `<div class="wrap"><section class="banner"><div><h1>Welcome back, ${esc(p.name.split(' ')[0])}.</h1><p>${A.length ? `You have <strong>${A.length} active deliver${A.length > 1 ? 'ies' : 'y'}</strong> in progress.` : J.length ? `<strong>${J.length} delivery job${J.length > 1 ? 's' : ''}</strong> available on ${esc(p.campus)} right now.` : 'New jobs appear here automatically. You never need to go online.'}</p><a class="btn" href="${A.length ? '#/deliveries' : '#/jobs'}">${A.length ? 'Continue delivery' : 'View available jobs'}</a></div></section>
  <div class="stats">
    <div class="stat">${ic('M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6')}<div><b>${money(E.total)}</b><small>Total earnings</small></div></div>
    <div class="stat">${ic('M4 12l5 5L20 6')}<div><b>${E.count}</b><small>Deliveries completed</small></div></div>
    <div class="stat">${ic('M4 8h16v12H4zM9 8V4h6v4')}<div><b>${J.length}</b><small>Available jobs</small></div></div>
    <div class="stat">${ic('M2 6h12v10H2zM14 9h4l4 4v3h-8z')}<div><b>${A.length}</b><small>Active deliveries</small></div></div></div>
  <div class="panel"><div class="ph-row"><h2>Current active delivery</h2><a href="#/deliveries">View all</a></div>
  ${A.length ? delCard(A[0], true) : '<div class="empty">No active delivery. Accept a job to get started.</div>'}</div>
  <div class="pf-grid" style="margin-top:16px"><div class="panel"><div class="ph-row"><h2>Recent delivery activity</h2></div>
  ${recent.length ? recent.map(o => `<div class="row"><div class="grow"><strong>${esc(o.name)}</strong><p class="muted">Order #${o.no} · ${ago(o.courierUpdatedAt || o.createdAt)}</p></div><span class="chip ${stageOf(o) === 'completed' ? 'go' : ''}">${SL[stageOf(o)]}</span></div>`).join('') : '<div class="empty">Nothing yet. Your deliveries will be listed here.</div>'}</div>
  <div class="panel"><h2>Account</h2><p>${vchip(p.status)}</p><p class="muted">${esc(p.campus)} campus<br>Student no. ${esc(p.studentNo)}</p><a href="#/profile">Manage profile</a></div></div></div>`;
}

function jobCard(o) {
  const full = active().length >= CONFIG.MAX_ACTIVE;
  return `<div class="order" data-s="new"><div class="head"><div><strong>Order #${o.no}</strong> <span class="muted">· ${ago(o.awaiting_courierAt || o.createdAt)}</span></div><span class="chip new">New job</span></div>
  <div class="kvs">${kv('Collect from', esc(o.pickup || o.campus + ' campus (seller shares the exact spot)'))}${kv('Deliver to', esc(o.address || 'Campus location') + ' · ' + esc(o.campus))}${kv('Package', esc(o.name) + ' × ' + o.qty)}${kv('Estimated distance', '≈ ' + km(o).toFixed(1) + ' km')}${kv('Delivery fee', money(fee(o)))}${kv('Your payout', `<strong class="price">${money(pay(o))}</strong>`)}</div>
  <div class="acts"><button class="btn sm" data-accept="${o.id}" ${full ? 'disabled' : ''}>Accept job</button>${full ? `<span class="muted">Finish a current delivery first (max ${CONFIG.MAX_ACTIVE}).</span>` : ''}</div></div>`;
}
function jobsView() {
  const L = jobs();
  return `<div class="wrap"><div class="page-h"><div><h1>Available Jobs</h1><p class="muted">Delivery orders on ${esc(P().campus)} that sellers have released. Nothing is assigned to you until you accept it.</p></div>${CONFIG.DEV ? '<button class="btn ghost sm" data-testjob>Add test job (dev)</button>' : ''}</div>
  ${L.length ? L.map(jobCard).join('') : '<div class="empty">No jobs right now. New ones show up here automatically.</div>'}</div>`;
}

function delCard(o, compact) {
  const s = stageOf(o), at = STAGES.indexOf(s), m = state.msg[o.id], a = [];
  if (s === 'accepted') a.push(`<button class="btn sm" data-adv="${o.id}:ready">Arrived at pickup</button>`);
  if (s === 'ready') a.push(`<button class="btn sm" data-adv="${o.id}:collected">Confirm item collected</button>`);
  if (s === 'collected') a.push(`<button class="btn sm" data-adv="${o.id}:transit">Start delivery</button>`);
  if (s === 'transit') a.push(`<input class="otp" id="otp-${o.id}" inputmode="numeric" maxlength="6" placeholder="Buyer OTP" aria-label="Delivery OTP"><button class="btn sm" data-otp="${o.id}">Confirm delivery</button>${CONFIG.DEV && o.deliveryOtp ? `<span class="muted">Dev OTP: ${o.deliveryOtp.code}</span>` : ''}`);
  if (s !== 'completed') a.push(`<button class="btn ghost sm" data-issue="${o.id}">Report a problem</button>`);
  return `<div class="order" data-s="${s === 'completed' ? 'completed' : 'courier_assigned'}"><div class="head"><div><strong>Order #${o.no}</strong> <span class="muted">· ${date(o.createdAt)}</span></div><span class="chip ${s === 'completed' ? 'go' : ''}">${SL[s]}</span></div>
  <div class="kvs">${kv('Package', esc(o.name) + ' × ' + o.qty)}${kv('Payout', `<strong class="price">${money(pay(o))}</strong>`)}${kv('Collect from', esc(o.pickup || o.campus + ' campus') + (o.seller?.name ? '<br>' + esc(o.seller.name) : ''))}${kv('Deliver to', esc(o.address || 'Campus location') + ' · ' + esc(o.campus) + '<br>' + esc(o.buyer?.name || '') + (o.buyer?.phone ? ` · <a href="tel:${esc(o.buyer.phone)}">${esc(o.buyer.phone)}</a>` : ''))}</div>
  <div class="steps-t">${STAGES.map((x, i) => `<span class="${i <= at ? 'done' : ''}">${SL[x]}</span>`).join('')}</div>
  ${m ? `<p class="err">${esc(m)}</p>` : ''}<div class="acts">${a.join('')}</div></div>`;
}
function deliveries() {
  const L = myOrders(), by = s => L.filter(o => stageOf(o) === s).sort((a, b) => (b.courierUpdatedAt || 0) - (a.courierUpdatedAt || 0)), show = state.dst === 'all' ? STAGES : [state.dst];
  return `<div class="wrap"><div class="page-h"><div><h1>My Deliveries</h1><p class="muted">Jobs you accepted, by stage. Delivery needs the buyer's OTP before it counts as completed.</p></div></div>
  <div class="chips"><button class="${state.dst === 'all' ? 'on' : ''}" data-dst="all">All (${L.length})</button>${STAGES.map(s => `<button class="${state.dst === s ? 'on' : ''}" data-dst="${s}">${SL[s]} (${by(s).length})</button>`).join('')}</div>
  ${L.length ? show.map(s => by(s).length ? `<div class="sec-h"><h2>${SL[s]}</h2><span class="chip">${by(s).length}</span></div>${by(s).map(o => delCard(o)).join('')}` : '').join('') || '<div class="empty">Nothing in this stage.</div>' : '<div class="empty">No deliveries yet. Accept a job from Available Jobs.</div>'}</div>`;
}

function earnings() {
  const E = earn(), out = [...store.payouts()].sort((a, b) => b.at - a.at), card = (d, v, l) => `<div class="stat">${ic(d)}<div><b>${money(v)}</b><small>${l}</small></div></div>`, c = 'M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6';
  return `<div class="wrap"><div class="page-h"><div><h1>Earnings</h1><p class="muted">Completed deliveries only. Pending earnings are paid out once the buyer confirms delivery.</p></div></div>
  <div class="stats">${card(c, E.total, 'Total earnings')}${card(c, E.week, 'This week')}${card(c, E.month, 'This month')}${card(c, E.pending, 'Pending earnings')}</div>
  <div class="panel"><div class="ph-row"><div><h2>Available balance</h2><b class="price" style="font-size:1.6rem">${money(E.balance)}</b><p class="muted">Minimum payout ${money(CONFIG.MIN_PAYOUT)}. Paid to your bank account in Profile.</p></div><button class="btn" data-payout ${E.balance < CONFIG.MIN_PAYOUT ? 'disabled' : ''}>Request payout</button></div></div>
  <div class="panel" style="margin-top:16px"><h2>Payout history</h2>${out.length ? out.map(p => `<div class="row"><div class="grow"><strong>${money(p.amount)}</strong><p class="muted">${date(p.at)} · ${esc(p.to)}</p></div><span class="chip ${p.status === 'paid' ? 'go' : 'new'}">${p.status === 'paid' ? 'Paid' : 'Processing'}</span>${CONFIG.DEV && p.status !== 'paid' ? `<button class="btn ghost sm" data-paid="${p.id}">Mark paid (dev)</button>` : ''}</div>`).join('') : '<div class="empty">No payouts yet.</div>'}</div></div>`;
}

function notifications() {
  const N = store.notes();
  return `<div class="wrap"><div class="page-h"><div><h1>Notifications</h1><p class="muted">New jobs, delivery updates and completed orders appear here as they happen.</p></div></div>
  <div class="panel">${N.length ? N.map(n => `<div class="row ${n.read ? '' : 'unread'}">${n.read ? '' : '<span class="dot"></span>'}<div class="grow"><strong>${esc(n.text)}</strong><p class="muted">${ago(n.at)}</p></div></div>`).join('') : '<div class="empty">No notifications yet.</div>'}</div></div>`;
}

const fld = (id, label, val, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${extra}></div>`;
function payFields(p = {}) {
  return `<h3>Payout information</h3><div class="field"><label for="pf-bank">Bank</label><select id="pf-bank"><option value="">Select a bank</option>${CONFIG.BANKS.map(b => `<option ${b === p.bank ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
  ${fld('pf-holder', 'Account holder', p.holder)}<div class="two">${fld('pf-acc', 'Account number', p.acc, 'inputmode="numeric"')}${fld('pf-branch', 'Branch code', p.branch, 'inputmode="numeric"')}</div>`;
}
const campusSel = c => `<div class="field"><label for="pf-campus">Campus</label><select id="pf-campus">${CONFIG.CAMPUSES.map(x => `<option ${x === (c || 'Potchefstroom') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
function profile() {
  const p = P(), iss = store.issues().sort((a, b) => b.at - a.at);
  return `<div class="wrap"><div class="pf-head"><div class="avatar">${esc(p.name[0].toUpperCase())}</div><div><h1 style="margin:0">${esc(p.name)}</h1><p class="muted" style="margin:2px 0 6px">Courier Profile</p>${vchip(p.status)}</div></div>
  <div class="pf-grid"><form class="panel" id="pf" novalidate><h2>Contact details</h2>${fld('pf-name', 'Full name', p.name, 'autocomplete="name"')}${fld('pf-sn', 'Student number', p.studentNo)}${fld('pf-email', 'Email', p.email, 'type="email" readonly')}${fld('pf-phone', 'Phone number', p.phone, 'type="tel"')}${campusSel(p.campus)}${payFields(p)}<p class="err" id="pf-err"></p><button class="btn" type="submit">Save profile</button></form>
  <div><div class="panel"><h3>Student verification</h3><p>${vchip(p.status)}</p><p class="muted">Student no. ${esc(p.studentNo || "not added yet")}<br>Keep your student number up to date so buyers and sellers can trust you.</p></div>
  <div class="panel" style="margin-top:16px"><h3>Delivery issues</h3><button class="btn ghost" style="width:100%" data-issue="">Report a delivery issue</button>${iss.slice(0, 4).map(i => `<div class="row"><div class="grow"><strong>${esc(i.type)}</strong><p class="muted">${i.orderNo ? 'Order #' + i.orderNo + ' · ' : ''}${ago(i.at)}</p></div><span class="chip new">Open</span></div>`).join('')}</div>
  <div class="panel pf-links" style="margin-top:16px"><h3>Shortcuts</h3><a href="#/deliveries">My Deliveries</a><a href="#/earnings">Earnings</a><a href="Index.html#/home">Switch to Buyer</a><a href="#/profile" data-signout>Sign out</a></div></div></div></div>`;
}

/* ---------- router ---------- */
const VIEWS = { overview, jobs: jobsView, deliveries, earnings, profile, notifications };
function render() {
  const r = location.hash.replace('#/', ''), route = VIEWS[r] ? r : 'overview';
  $('#app').innerHTML = VIEWS[route]();
  $('#note-count').textContent = store.notes().filter(n => !n.read).length;
  document.querySelectorAll('#links a').forEach(a => a.classList.toggle('on', a.dataset.route === route));
  if (route === 'notifications') { const N = store.notes(); if (N.some(n => !n.read)) { N.forEach(n => n.read = true); store.set('cm_courier_notes', N); setTimeout(() => $('#note-count').textContent = 0, 0); } }
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- actions ---------- */
function claim(id) { // server rule: UPDATE orders SET courier_id=me, status='courier_assigned' WHERE id=$1 AND status='awaiting_courier' AND courier_id IS NULL RETURNING *. Zero rows = someone else got it.
    const all = store.orders(), o = all.find(x => x.id === id), p = P();   // fresh read, not the rendered list
  if (!o || o.status !== 'awaiting_courier' || o.courier || o.campus !== p.campus) { toast('This job was just taken by another courier.'); return render(); }
  if (active().length >= CONFIG.MAX_ACTIVE) return toast('Finish a current delivery before accepting another.');
  Object.assign(o, { courier: { id: p.id, name: p.name, phone: p.phone }, status: 'courier_assigned', courierStage: 'accepted', courier_assignedAt: Date.now(), courierUpdatedAt: Date.now() });
  store.saveOrders(all); note(`You accepted Order #${o.no}. Head to the seller to collect it.`, o.id); toast('Job accepted'); location.hash = '#/deliveries'; render();
}
function advance(id, to) {
  const all = store.orders(), o = all.find(x => x.id === id);
  if (!o || !mine(o) || NEXT[stageOf(o)] !== to) { toast('That update is not allowed.'); return render(); }
  Object.assign(o, { courierStage: to, status: STATUS[to], courierUpdatedAt: Date.now() }); o[o.status + 'At'] = Date.now();
  if (to === 'transit' && !o.deliveryOtp) o.deliveryOtp = { code: String(Math.floor(100000 + Math.random() * 900000)), expires: Date.now() + CONFIG.OTP_TTL_H * 36e5, tries: 0 }; // prototype only: generate + verify on the server, show it to the buyer
  store.saveOrders(all);
  note({ ready: `Order #${o.no} is ready for collection. Hand-over at the seller.`, collected: `Order #${o.no} collected.`, transit: `Order #${o.no} is on its way to the buyer.` }[to], o.id);
  toast(SL[to]); render();
}
function confirmDelivery(id) {
  const all = store.orders(), o = all.find(x => x.id === id), code = ($('#otp-' + id).value || '').trim(), fail = m => { state.msg[id] = m; store.saveOrders(all); render(); };
  if (!o || !mine(o) || stageOf(o) !== 'transit' || !o.deliveryOtp) return fail('This delivery cannot be confirmed yet.');
  if (o.deliveryOtp.tries >= CONFIG.OTP_MAX_TRIES) return fail('Too many incorrect attempts. Ask the buyer for a new code or report a problem.');
  if (Date.now() > o.deliveryOtp.expires) return fail('This code has expired. Ask the buyer for a new code.');
  if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from the buyer.');
  if (code !== o.deliveryOtp.code) { o.deliveryOtp.tries++; return fail(`Incorrect code. ${CONFIG.OTP_MAX_TRIES - o.deliveryOtp.tries} attempts left.`); }
  Object.assign(o, { courierStage: 'completed', status: 'delivered', deliveredAt: Date.now(), courierUpdatedAt: Date.now(), courierPayout: pay(o) }); delete o.deliveryOtp;
  store.saveOrders(all); delete state.msg[id]; note(`Order #${o.no} delivered. You earned ${money(pay(o))}.`, o.id); toast('Delivery confirmed. Well done!'); render();
}
function addTestJob() {
  const all = store.orders(), n = 2000 + all.length + 1;
  all.unshift({ id: uid(), no: n, name: ['Calculus textbook', 'Desk lamp', 'Scientific calculator'][n % 3], qty: 1, total: 120, fulfilment: 'delivery', paymentStatus: 'paid', status: 'awaiting_courier', campus: P().campus, buyer: { name: 'Test buyer', phone: '0710000000' }, seller: { name: 'Test seller' }, pickup: 'Library entrance', address: 'Test residence, room 12', createdAt: Date.now(), awaiting_courierAt: Date.now() });
  store.saveOrders(all); toast('Test job added'); sync(); render();
}
function issueDlg(orderId) {
  const L = myOrders();
  $('#dlg').innerHTML = `<form id="iform" novalidate><h2>Report a delivery issue</h2><div class="field"><label for="i-order">Order</label><select id="i-order"><option value="">General / not about one order</option>${L.map(o => `<option value="${o.id}" ${o.id === orderId ? 'selected' : ''}>#${o.no} · ${esc(o.name)}</option>`).join('')}</select></div>
  <div class="field"><label for="i-type">What happened?</label><select id="i-type">${CONFIG.ISSUES.map(i => `<option>${i}</option>`).join('')}</select></div><div class="field"><label for="i-text">Details</label><textarea id="i-text" rows="3" maxlength="400"></textarea></div>
  <p class="err" id="i-err"></p><div class="foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Send report</button></div></form>`; $('#dlg').showModal();
}
const val = k => ($('#pf-' + k)?.value || '').trim();
const payData = () => ({ bank: val('bank'), holder: val('holder'), acc: val('acc'), branch: val('branch') });
function checkProfile() {
  if (!val('name')) return 'Enter your full name.';
  if (val('email') && !/^\S+@\S+\.\S+$/.test(val('email'))) return 'Enter a valid email address.';
  if (val('phone') && !/^(\+27|0)\d{9}$/.test(val('phone').replace(/\s/g, ''))) return 'Enter a valid South African phone number.';
  if (!val('phone')) return 'Enter your phone number.';
  if (!payData().bank) return 'Choose your bank.';
  if (!payData().holder) return 'Enter the account holder name.';
  if (!/^\d{6,16}$/.test(payData().acc)) return 'Account number should be 6 to 16 digits.';
  if (!/^\d{4,6}$/.test(payData().branch)) return 'Branch code should be 4 to 6 digits.';
  return '';
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('[data-signout]')) { e.preventDefault(); Auth.logout('courier'); location.href = 'Index.html#/signin-courier'; return; }
  const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
  if (d.accept) return claim(d.accept);
  if (d.adv) return advance(...d.adv.split(':'));
  if (d.otp) return confirmDelivery(d.otp);
  if (d.dst) { state.dst = d.dst; return render(); }
  if ('issue' in d) return issueDlg(d.issue);
  if ('close' in d) return $('#dlg').close();
  if ('testjob' in d) return addTestJob();
  if ('payout' in d) { const E = earn(), p = P(); if (E.balance < CONFIG.MIN_PAYOUT) return; if (!p.acc) { toast('Add your bank details in Profile first.'); return; }
    const L = store.payouts(); L.unshift({ id: uid(), amount: +E.balance.toFixed(2), at: Date.now(), status: 'processing', to: `${p.bank} ••••${p.acc.slice(-4)}` }); store.set('cm_courier_payouts', L); toast('Payout requested'); return render(); }
  if (d.paid) { const L = store.payouts(); L.find(x => x.id === d.paid).status = 'paid'; store.set('cm_courier_payouts', L); return render(); }
});
document.addEventListener('submit', e => {
  const f = e.target.id; if (!['pf', 'iform'].includes(f)) return; e.preventDefault();
  if (f === 'iform') { const L = store.issues(), o = store.orders().find(x => x.id === $('#i-order').value); if (!$('#i-text').value.trim()) return $('#i-err').textContent = 'Add a few details so support can help.';
    L.unshift({ id: uid(), orderId: o?.id || '', orderNo: o?.no || '', type: $('#i-type').value, text: $('#i-text').value.trim(), courier: P().id, at: Date.now() }); store.set('cm_courier_issues', L); $('#dlg').close(); toast('Report sent to support'); return render(); }
  const er = checkProfile(); if (er) return $('#pf-err').textContent = er;
  store.saveProfile({ ...P(), name: val('name'), studentNo: val('sn'), email: val('email'), phone: val('phone'), campus: val('campus'), ...payData() }); toast('Profile saved');
  render();
});

/* ---------- live sync: other dashboards change the same orders; refresh without disturbing typing ---------- */
function sync() { // raise notifications for new jobs and for my jobs cancelled elsewhere
  const seen = store.get('cm_courier_seen', null) || { jobs: null, cx: [] }, J = jobs();
  if (seen.jobs) J.filter(o => !seen.jobs.includes(o.id)).forEach(o => note(`New delivery job: Order #${o.no}, earn ${money(pay(o))}.`, o.id));
  store.orders().filter(o => mine(o) && ['cancelled', 'rejected'].includes(o.status) && !seen.cx.includes(o.id)).forEach(o => { seen.cx.push(o.id); note(`Order #${o.no} was cancelled. You do not need to deliver it.`, o.id); });
  seen.jobs = [...new Set([...(seen.jobs || []), ...J.map(o => o.id)])]; store.set('cm_courier_seen', seen);
}
const snap = () => ['cm_seller_orders', 'cm_courier', 'cm_courier_notes'].map(k => localStorage.getItem(k)).join('|');
let last = '';
function refresh() {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || $('#dlg').open;
  sync(); const s = snap(); if (s === last) return; last = s;
  if (typing) { $('#note-count').textContent = store.notes().filter(n => !n.read).length; return; }
  render();
}
window.addEventListener('storage', refresh);
setInterval(refresh, CONFIG.POLL_MS);
(() => { const S = CONFIG.SUPABASE; if (S.url && S.key && window.supabase) window.supabase.createClient(S.url, S.key).channel('courier-orders').on('postgres_changes', { event: '*', schema: 'public', table: S.table }, refresh).subscribe(); })();
sync(); last = snap(); render();