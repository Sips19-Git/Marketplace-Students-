/* MyVossieMarketplace - seller side. Plain HTML/CSS/JS, hash routing (same pattern as buyer.js). */
const CONFIG = {
  API_BASE: '/api',   // TODO: backend. Every `store.*` call below maps to one endpoint (see comments).
  CURRENCY: 'R', LOW_STOCK: 3,
  FEE_RATE: 0,        // marketplace fee (0-1). Set to the real rate; the server must calculate payouts.
  OTP_TTL_H: 48, OTP_MAX_TRIES: 5,
  DEV: true,          // dev only: shows "Add test order" and reveals pickup OTPs. Set false in production.
  CAMPUSES: ['Potchefstroom', 'Pretoria', 'Johannesburg', 'Durban', 'Cape Town', 'Bloemfontein'],
  CATS: ['Books', 'Electronics', 'Clothing', 'Dorm', 'Stationery', 'Other'],
  BANKS: ['Capitec', 'FNB', 'Standard Bank', 'Absa', 'Nedbank', 'TymeBank', 'Discovery Bank', 'African Bank', 'Other']
};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => CONFIG.CURRENCY + Number(n || 0).toFixed(2);
const date = t => new Date(t).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + Math.random()).slice(0, 12);


/* ---------- data layer: Hybrid local + FastAPI backend ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast('Storage is full. Remove some photos and try again.'); return false; } },
  
  // Fetch live products from your FastAPI backend
  products: () => {
    // We maintain a local cache array for synchronous rendering, but kick off a background sync
    let cached = store.get('cm_seller_products', []);
    fetch('http://127.0.0.1:8000/api/products')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          store.set('cm_seller_products', data);
        }
      })
      .catch(err => console.log('Using local product cache'));
    return cached;
  },
  
  saveProducts: v => store.set('cm_seller_products', v),
  orders: () => store.get('cm_seller_orders', []),
  saveOrders: v => store.set('cm_seller_orders', v),
  profile: () => ({ ...store.get('cm_profile', {}), ...store.get('cm_seller_profile', {}) })
};


/* ---------- order workflow ---------- */
const LABEL = { pending: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for Collection', awaiting_courier: 'Waiting for Courier', courier_assigned: 'Courier Assigned', collected: 'Collected', delivered: 'Delivered', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' };
const NEXT = { pending: ['accepted', 'rejected'], accepted: ['preparing'], preparing: ['ready'], ready: ['awaiting_courier', 'completed'], awaiting_courier: [] };
const canMove = (o, to) => (NEXT[o.status] || []).includes(to) && !(to === 'awaiting_courier' && o.fulfilment !== 'delivery') && !(to === 'completed' && o.fulfilment !== 'pickup');
const chipClass = s => s === 'pending' ? 'new' : ['completed', 'delivered', 'courier_assigned'].includes(s) ? 'go' : ['rejected', 'cancelled'].includes(s) ? 'stop' : '';
const chip = s => `<span class="chip ${chipClass(s)}">${LABEL[s] || s}</span>`;
const inPickupQueue = o => o.fulfilment === 'pickup' || ['pending', 'accepted', 'preparing'].includes(o.status);
const inCourierQueue = o => o.fulfilment === 'delivery' && ['ready', 'awaiting_courier', 'courier_assigned', 'collected', 'delivered'].includes(o.status);
const earnings = () => store.orders().filter(o => o.paymentStatus === 'paid' && ['completed', 'delivered'].includes(o.status) && !o.refunded)
  .reduce((s, o) => s + o.total * (1 - CONFIG.FEE_RATE), 0);
const eligibleCount = () => store.orders().filter(o => o.paymentStatus === 'paid' && ['completed', 'delivered'].includes(o.status)).length;

const state = { route: 'overview', q: '', pst: 'all', ost: 'all', msg: {} };
const thumb = o => o.image ? `style="background-image:url('${esc(o.image)}')"` : '';

/* ---------- views ---------- */
function overview() {
  const P = store.products().filter(p => p.status !== 'archived'), O = store.orders();
  const act = P.filter(p => p.status === 'active' && p.stock > 0).length, pend = O.filter(o => o.status === 'pending').length;
  const recent = [...O].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4), S = store.profile();
  const ic = d => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></span>`;
  return `<div class="wrap"><section class="banner"><div><h1>Welcome back${S.name ? ', ' + esc(S.name.split(' ')[0]) : ''}.</h1><p>${pend ? `You have <strong>${pend} new order${pend > 1 ? 's' : ''}</strong> waiting for a response.` : 'Manage your listings and orders in one place.'}</p><a class="btn" href="${pend ? '#/orders' : '#/listings'}" ${pend ? '' : 'data-add'}>${pend ? 'Review new orders' : 'Add a listing'}</a></div></section>
  <div class="stats">
    <div class="stat">${ic('M4 7h16l-1 4H5zM5 11v9h14v-9M9 20v-5h6v5')}<div><b>${P.length}</b><small>Total listings</small></div></div>
    <div class="stat">${ic('M4 12l5 5L20 6')}<div><b>${act}</b><small>Active listings</small></div></div>
    <div class="stat">${ic('M8 4h8v3H8zM6 5H5v16h14V5h-1M9 12h6M9 16h6')}<div><b>${O.length}</b><small>Orders${pend ? ` · ${pend} pending` : ''}</small></div></div>
    <div class="stat">${ic('M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6')}<div><b>${money(earnings())}</b><small>${eligibleCount() ? 'Total earnings' : 'Earnings · none completed yet'}</small></div></div></div>
  <div class="panel"><div class="ph-row"><h2>Recent orders</h2><a href="#/orders">View all</a></div>
  ${recent.length ? recent.map(o => `<div class="row"><div class="thumb" ${thumb(o)}></div><div class="grow"><strong>${esc(o.name)}</strong><p class="muted">Order #${o.no} · Qty ${o.qty} · ${date(o.createdAt)}</p></div>${chip(o.status)}<a class="btn ghost sm" href="#/${inCourierQueue(o) ? 'courier' : 'orders'}">View</a></div>`).join('') : '<div class="empty">No orders yet. They appear here when buyers purchase your items.</div>'}</div>
  <a class="link-row" href="#/listings" data-add><span><strong>Add a listing</strong><br><span class="muted">Upload photos, set a price and select your campus.</span></span><span aria-hidden="true" class="arrow">›</span></a></div>`;
}

function listings() {
  const q = state.q.toLowerCase();
  const L = store.products().filter(p => p.status !== 'archived' && (state.pst === 'all' || (state.pst === 'unavailable' ? p.status === 'unavailable' : p.status === 'active')) && (!q || (p.name + p.category).toLowerCase().includes(q)));
  return `<div class="wrap"><div class="page-h"><h1>My Listings</h1><button class="btn" data-add>Add a product</button></div>
  <div class="toolbar" style="grid-template-columns:2fr 1fr"><input id="q" type="search" placeholder="Search your listings" aria-label="Search listings" value="${esc(state.q)}">
  <select id="pst" aria-label="Filter by status"><option value="all">All</option><option value="active" ${state.pst === 'active' ? 'selected' : ''}>Available</option><option value="unavailable" ${state.pst === 'unavailable' ? 'selected' : ''}>Unavailable</option></select></div>
  <div id="plist">${plist(L)}</div></div>`;
}
const plist = L => L.length ? `<div class="grid">${L.map(p => {
  const off = p.status === 'unavailable', t = off ? ['out', 'Unavailable'] : p.stock <= 0 ? ['out', 'Out of stock'] : p.stock <= CONFIG.LOW_STOCK ? ['low', 'Only ' + p.stock + ' left'] : ['in', p.stock + ' in stock'];
  return `<article class="prod"><div class="img" ${p.images?.[0] ? `style="background-image:url('${esc(p.images[0])}')"` : ''}>${p.images?.[0] ? '' : 'No photo'}<span class="tag ${t[0]} ov">${t[1]}</span></div><div class="body">
  <h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div><p class="muted">${esc(p.category)} · ${esc(p.campus)}</p><p class="muted">${esc(p.description).slice(0, 80)}</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px"><button class="btn ghost sm" data-edit="${p.id}">Edit</button><button class="btn ghost sm" data-toggle="${p.id}">${off ? 'Make available' : 'Make unavailable'}</button><button class="btn ghost sm" style="grid-column:1/-1" data-del="${p.id}">Delete</button></div></div></article>`;
}).join('')}</div>` : '<div class="empty">No listings found. Add a product to start selling.</div>';

function orderCard(o, mode) {
  const m = state.msg[o.id], a = [];
  if (canMove(o, 'accepted')) a.push(`<button class="btn sm" data-move="${o.id}:accepted">Accept order</button><button class="btn ghost sm" data-reject="${o.id}">Reject</button>`);
  if (canMove(o, 'preparing')) a.push(`<button class="btn sm" data-move="${o.id}:preparing">Mark as preparing</button>`);
  if (canMove(o, 'ready')) a.push(`<button class="btn sm" data-move="${o.id}:ready">Mark ready for collection</button>`);
  if (o.status === 'ready' && o.fulfilment === 'pickup') a.push(`<input class="otp" id="otp-${o.id}" inputmode="numeric" maxlength="6" placeholder="Buyer OTP" aria-label="Pickup OTP"><button class="btn sm" data-otp="${o.id}">Confirm handover</button>${CONFIG.DEV && o.otp ? `<span class="muted">Dev OTP: ${o.otp.code}</span>` : ''}`);
  if (mode === 'courier' && canMove(o, 'awaiting_courier')) a.push(`<button class="btn sm" data-move="${o.id}:awaiting_courier">Search for courier</button>`);
  const flow = ['ready', 'awaiting_courier', 'courier_assigned', 'collected', 'delivered'], at = flow.indexOf(o.status);
  return `<div class="order" data-s="${o.status}"><div class="head"><div><strong>Order #${o.no}</strong> <span class="muted">· ${date(o.createdAt)}</span></div>${chip(o.status)}</div>
  <div class="row" style="border:0;padding:0"><div class="thumb" ${thumb(o)}></div><div class="grow"><strong>${esc(o.name)}</strong><p class="muted">Qty ${o.qty} · ${money(o.total)} · ${o.fulfilment === 'pickup' ? 'Self-pickup / meetup' : 'Delivery'} · ${esc(o.campus)}</p>
  <p class="muted">Buyer: ${esc(o.buyer.name)}${o.buyer.phone ? ' · ' + esc(o.buyer.phone) : ''}${o.fulfilment === 'delivery' && o.address ? '<br>Deliver to: ' + esc(o.address) : ''}</p></div></div>
  ${mode === 'courier' ? `<div class="steps-t">${['Ready', 'Waiting for courier', 'Courier assigned', 'Collected', 'Delivered'].map((s, i) => `<span class="${i <= at ? 'done' : ''}">${s}</span>`).join('')}</div>
  <p class="muted" style="margin-top:8px">${o.courier ? `Courier: <strong>${esc(o.courier.name)}</strong>${o.courier.phone ? ' · ' + esc(o.courier.phone) : ''}` : o.status === 'awaiting_courier' ? 'Waiting for Courier. A courier on your campus has not accepted yet.' : o.status === 'ready' ? 'Ready. Search for a courier when the item is packed.' : ''}</p>` : ''}
  ${o.status === 'rejected' && o.rejectReason ? `<p class="muted">Reason: ${esc(o.rejectReason)}</p>` : ''}
  ${m ? `<p class="err">${esc(m)}</p>` : ''}<div class="acts">${a.join('')}</div></div>`;
}
function orders() {
  const base = store.orders().filter(inPickupQueue).sort((a, b) => b.createdAt - a.createdAt);
  const L = base.filter(o => state.ost === 'all' || o.status === state.ost);
  return `<div class="wrap"><div class="page-h"><div><h1>Manage Orders</h1><p class="muted">Accept, prepare and hand over orders. Delivery orders move to Courier Handover once they are ready.</p></div>${CONFIG.DEV ? '<button class="btn ghost sm" data-testorder>Add test order (dev)</button>' : ''}</div>
  <div class="chips">${['all', 'pending', 'accepted', 'preparing', 'ready', 'completed', 'rejected'].map(s => `<button class="${state.ost === s ? 'on' : ''}" data-ost="${s}">${s === 'all' ? 'All' : LABEL[s]}</button>`).join('')}</div>
  ${L.length ? L.map(o => orderCard(o, 'orders')).join('') : '<div class="empty">No orders here yet.</div>'}</div>`;
}
function courier() {
  const L = store.orders().filter(inCourierQueue).sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="wrap"><div class="page-h"><div><h1>Courier Handover</h1><p class="muted">Delivery orders that are ready for a courier. Courier acceptance comes from the courier dashboard.</p></div></div>
  ${L.length ? L.map(o => orderCard(o, 'courier')).join('') : '<div class="empty">No delivery orders are ready for handover.</div>'}</div>`;
}
function profile() {
  const P = store.profile(), nm = P.name || 'Seller', fld = (id, l, v, x = '') => `<div class="field"><label for="${id}">${l}</label><input id="${id}" value="${esc(v)}" ${x}></div>`;
  return `<div class="wrap"><div class="pf-head"><div class="avatar">${esc(nm[0].toUpperCase())}</div><div><h1 style="margin:0">${esc(nm)}</h1><span class="chip go">Seller account active</span></div></div>
  <div class="pf-grid"><form class="panel" id="pf" novalidate><h2>Contact details</h2>
  ${fld('pf-name', 'Full name', P.name, 'autocomplete="name"')}${fld('pf-sn', 'Student number', P.studentNo)}${fld('pf-email', 'Email', P.email, 'type="email" autocomplete="email" readonly')}${fld('pf-phone', 'Phone number', P.phone, 'type="tel" autocomplete="tel"')}
  <div class="field"><label for="pf-campus">Campus</label><select id="pf-campus">${CONFIG.CAMPUSES.map(c => `<option ${c === (P.campus || 'Potchefstroom') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
  <h3>Payout information</h3>
  <div class="field"><label for="pf-bank">Bank</label><select id="pf-bank"><option value="">Select a bank</option>${CONFIG.BANKS.map(b => `<option ${b === P.bank ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
  ${fld('pf-holder', 'Account holder', P.holder, 'autocomplete="off"')}<div class="two">${fld('pf-acc', 'Account number', P.acc, 'inputmode="numeric" autocomplete="off"')}${fld('pf-branch', 'Branch code', P.branch, 'inputmode="numeric" autocomplete="off"')}</div>
  <p class="err" id="pf-err"></p><button class="btn" type="submit">Save profile</button></form>
  <div><div class="panel"><h3>Student verification</h3><p><span class="chip go">Seller account active</span></p><p class="muted">Student no. ${esc(P.studentNo || 'not added yet')}<br>Keep your student number up to date so buyers and couriers can trust you.</p></div>
  <div class="panel pf-links" style="margin-top:16px"><h3>Shortcuts</h3><a href="#/listings">My Listings</a><a href="#/orders">Manage Orders</a><a href="Index.html#/home">Switch to Buyer</a><a href="#/profile" data-signout>Sign out</a></div></div></div></div>`;
}

/* ---------- router ---------- */
const VIEWS = { overview, listings, orders, courier, profile };
function render() {
  state.route = VIEWS[location.hash.replace('#/', '')] ? location.hash.replace('#/', '') : 'overview';
  $('#app').innerHTML = VIEWS[state.route]();
  $('#pend-count').textContent = store.orders().filter(o => o.status === 'pending').length;
  document.querySelectorAll('#links a').forEach(a => a.classList.toggle('on', a.dataset.route === state.route));
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- listing form (create / update) ---------- */
let photos = [];
const readImg = f => new Promise(res => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => { const s = Math.min(1, 800 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = i.width * s; c.height = i.height * s; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .75)); }; i.onerror = () => res(null); i.src = r.result; }; r.readAsDataURL(f); });
const paintPhotos = () => { $('#ph').innerHTML = photos.map(p => `<div style="background-image:url('${esc(p)}')"></div>`).join(''); };
function openForm(id) {
  const p = id ? store.products().find(x => x.id === id) : {}; photos = [...(p.images || [])];
  $('#dlg').innerHTML = `<form id="pform" data-id="${id || ''}" novalidate><h2>${id ? 'Edit product' : 'Add a product'}</h2>
  <div class="field"><label for="f-name">Product name</label><input id="f-name" maxlength="80" value="${esc(p.name)}"></div>
  <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" rows="3" maxlength="400">${esc(p.description)}</textarea></div>
  <div class="two"><div class="field"><label for="f-price">Price (ZAR)</label><input id="f-price" type="number" min="1" step="0.01" value="${p.price ?? ''}"></div>
  <div class="field"><label for="f-stock">Stock quantity</label><input id="f-stock" type="number" min="0" step="1" value="${p.stock ?? 1}"></div></div>
  <div class="two"><div class="field"><label for="f-cat">Category</label><select id="f-cat">${CONFIG.CATS.map(c => `<option ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
  <div class="field"><label for="f-campus">Campus</label><select id="f-campus">${CONFIG.CAMPUSES.map(c => `<option ${c === (p.campus || store.profile().campus || 'Potchefstroom') ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
  <div class="field"><label for="f-img">Photos (up to 4)</label><input id="f-img" type="file" accept="image/*" multiple><div class="photos" id="ph"></div></div>
  <p class="err" id="f-err"></p><div class="foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save product</button></div></form>`;
  $('#dlg').showModal(); paintPhotos();
}
async function saveProduct(e) {
  e.preventDefault(); 
  const v = k => $('#f-' + k).value.trim();
  const er = $('#f-err');
  const price = parseFloat(v('price'));
  const stock = parseInt(v('stock'), 10);

  // 1. Validation
  if (!v('name')) return er.textContent = 'Enter a product name.';
  if (!(price > 0)) return er.textContent = 'Enter a price greater than R0.';
  if (!Number.isInteger(stock) || stock < 0) return er.textContent = 'Stock must be a whole number, 0 or more.';

  // 2. Package data for FastAPI using FormData
  const formData = new FormData();
  formData.append('name', v('name'));
  formData.append('price', price);
  formData.append('stock', stock);
  formData.append('category', v('cat'));
  formData.append('campus', v('campus'));
  formData.append('description', v('desc'));

  // 3. Grab the actual file (FIXED: matching 'f-img' from your HTML)
  const fileInput = document.getElementById('f-img'); 
  if (fileInput && fileInput.files.length > 0) {
      formData.append('image', fileInput.files[0]);
  }

  // 4. Send to backend
  const token = localStorage.getItem('access_token');
  const btn = e.target.querySelector('button[type="submit"]') || document.getElementById('save-btn');
  if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }
  er.textContent = ''; 

  try {
      const response = await fetch('http://127.0.0.1:8000/api/products', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
      });

      if (response.ok) {
          toast('Product successfully listed!'); // Using your built-in toast instead of alert
          $('#dlg').close(); // FIXED: Close the form modal
          location.hash = '#/listings'; // FIXED: Route to the correct view
          
          // Note: To see the new product on the screen immediately, you will eventually 
          // need to update store.products() to fetch from GET /api/products instead of local storage.
      } else {
          const err = await response.json();
          er.textContent = 'Upload failed: ' + (err.detail || 'Check server logs');
      }
  } catch (error) {
      console.error(error);
      er.textContent = 'Server connection error.';
  } finally {
      if (btn) { btn.textContent = 'Save product'; btn.disabled = false; }
  }
}
/* ---------- actions ---------- */
function move(id, to, extra = {}) {
  const all = store.orders(), o = all.find(x => x.id === id);
  if (!o || !canMove(o, to)) { toast('That change is not allowed for this order.'); return render(); }
  Object.assign(o, extra, { status: to, [to + 'At']: Date.now() });
  if (to === 'ready' && o.fulfilment === 'pickup') o.otp = { code: String(Math.floor(100000 + Math.random() * 900000)), expires: Date.now() + CONFIG.OTP_TTL_H * 36e5, tries: 0 }; // prototype only: generate + verify on the server
  store.saveOrders(all); delete state.msg[id]; toast(LABEL[to]); render();
}
function confirmOtp(id) {
  const all = store.orders(), o = all.find(x => x.id === id), code = ($('#otp-' + id).value || '').trim();
  const fail = m => { state.msg[id] = m; store.saveOrders(all); render(); };
  if (!o || o.status !== 'ready' || o.fulfilment !== 'pickup' || !o.otp) return fail('This order cannot be confirmed.');
  if (o.otp.tries >= CONFIG.OTP_MAX_TRIES) return fail('Too many incorrect attempts. Ask the buyer to request a new code.');
  if (Date.now() > o.otp.expires) return fail('This code has expired. Ask the buyer to request a new code.');
  if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from the buyer.');
  if (code !== o.otp.code) { o.otp.tries++; return fail(`Incorrect code. ${CONFIG.OTP_MAX_TRIES - o.otp.tries} attempts left.`); }
  o.status = 'completed'; o.completedAt = Date.now(); delete o.otp; store.saveOrders(all); toast('Handover confirmed. Order completed.'); render();
}
function addTestOrder() {
  const P = store.products().filter(p => p.status === 'active' && p.stock > 0); if (!P.length) return toast('Add an active product first.');
  const all = store.orders(), p = P[all.length % P.length], pick = all.length % 2 === 0;
  all.unshift({ id: uid(), no: 1000 + all.length + 1, productId: p.id, name: p.name, image: p.images?.[0] || '', qty: 1, total: p.price, fulfilment: pick ? 'pickup' : 'delivery', buyer: { name: 'Test buyer', phone: '0710000000' }, address: pick ? '' : 'Test residence, room 12', campus: p.campus, status: 'pending', paymentStatus: 'paid', createdAt: Date.now() });
  store.saveOrders(all); toast('Test order added'); render();
}
function rejectDlg(id) {
  $('#dlg').innerHTML = `<form id="rform" data-id="${id}" novalidate><h2>Reject this order?</h2><div class="field"><label for="r-why">Reason for the buyer</label><textarea id="r-why" rows="3" maxlength="200"></textarea></div><p class="err" id="r-err"></p><div class="foot"><button type="button" class="btn ghost" data-close>Keep order</button><button class="btn bad" type="submit">Reject order</button></div></form>`; $('#dlg').showModal();
}
function delDlg(id) {
  const p = store.products().find(x => x.id === id);
  $('#dlg').innerHTML = `<form id="dform" data-id="${id}"><h2>Delete this listing?</h2><p class="muted">“${esc(p.name)}” will be removed from the Marketplace. Past orders keep their record.</p><div class="foot"><button type="button" class="btn ghost" data-close>Keep it</button><button class="btn bad" type="submit">Delete listing</button></div></form>`; $('#dlg').showModal();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, a'); if (!t) return; const d = t.dataset;
  if ('signout' in d) { e.preventDefault(); Auth.logout('seller'); location.href = 'Index.html#/signin-seller'; return; }
  if ('add' in d) { if (t.tagName === 'A') location.hash = '#/listings'; return openForm(); }
  if (d.edit) return openForm(d.edit);
  if (d.del) return delDlg(d.del);
  if (d.toggle) { const all = store.products(), p = all.find(x => x.id === d.toggle); p.status = p.status === 'active' ? 'unavailable' : 'active'; store.saveProducts(all); toast(p.status === 'active' ? 'Listing is available' : 'Listing hidden from buyers'); return render(); }
  if ('close' in d) return $('#dlg').close();
  if (d.move) return move(...d.move.split(':'));
  if (d.reject) return rejectDlg(d.reject);
  if (d.otp) return confirmOtp(d.otp);
  if (d.ost) { state.ost = d.ost; return render(); }
  if ('testorder' in d) return addTestOrder();
});
document.addEventListener('submit', async e => {
  const f = e.target.id; if (!['pform', 'rform', 'dform', 'pf'].includes(f)) return; e.preventDefault();
  if (f === 'pform') return saveProduct(e);
  if (f === 'rform') { const why = $('#r-why').value.trim(); if (!why) return $('#r-err').textContent = 'Give the buyer a short reason.'; $('#dlg').close(); return move(e.target.dataset.id, 'rejected', { rejectReason: why }); }
  if (f === 'dform') { const all = store.products(), p = all.find(x => x.id === e.target.dataset.id); p.status = 'archived'; store.saveProducts(all); $('#dlg').close(); toast('Listing deleted'); return render(); } // soft delete keeps order history
  if (f === 'pf') { const v = k => $('#pf-' + k).value.trim(), er = m => { $('#pf-err').textContent = m; };
    if (!v('name')) return er('Enter your name.');
    if (!v('sn')) return er('Enter your student number.');
    if (!/^(\+27|0)\d{9}$/.test(v('phone').replace(/\s/g, ''))) return er('Enter a valid South African phone number.');
    if (!v('bank')) return er('Choose your bank.');
    if (!v('holder')) return er('Enter the account holder name.');
    if (!/^\d{6,16}$/.test(v('acc'))) return er('Account number should be 6 to 16 digits.');
    if (!/^\d{4,6}$/.test(v('branch'))) return er('Branch code should be 4 to 6 digits.');
    Auth.update('seller', { name: v('name'), studentNo: v('sn'), phone: v('phone'), campus: v('campus'), bank: v('bank'), holder: v('holder'), acc: v('acc'), branch: v('branch') }); toast('Profile saved'); render(); }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'pst') { state.pst = e.target.value; render(); }
  if (e.target.id === 'f-img') { const fs = [...e.target.files].slice(0, 4 - photos.length); for (const f of fs) { const d = await readImg(f); if (d) photos.push(d); } photos = photos.slice(0, 4); paintPhotos(); }
});
document.addEventListener('input', e => { if (e.target.id === 'q') { state.q = e.target.value; $('#plist').innerHTML = plist(store.products().filter(p => p.status !== 'archived' && (state.pst === 'all' || (state.pst === 'unavailable' ? p.status === 'unavailable' : p.status === 'active')) && (!state.q || (p.name + p.category).toLowerCase().includes(state.q.toLowerCase())))); } });
window.addEventListener('storage', render);   // courier/buyer tabs updating the same orders refresh this view
render();