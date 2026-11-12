/* Campus Market - buyer side. Plain HTML/CSS/JS, hash routing. */
const CONFIG = {
  API_BASE: 'http://127.0.0.1:8000/api',                  // TODO: point at your backend
  ENDPOINTS: { products: '/products', orders: '/orders', payments: '/payment-methods' },
  USE_SAMPLE_FALLBACK: true,         // dev only: used when the API is unreachable. Set false in production.
  CURRENCY: 'R',
  DELIVERY_FEE: 25,                  // display estimate only; the server must calculate the real fee
  LOW_STOCK: 3,
  CAMPUSES: ['Potchefstroom'],
  ADMIN_PAGE: 'admin/admin.html', // where the admin dashboard lives relative to Index.html
  ALL_CAMPUSES: ['Potchefstroom', 'Pretoria', 'Johannesburg', 'Durban', 'Cape Town', 'Bloemfontein'],
  BANKS: ['Capitec', 'FNB', 'Standard Bank', 'Absa', 'Nedbank', 'TymeBank', 'Discovery Bank', 'African Bank', 'Other'],
  SELLER_PRODUCTS: ['Food', 'Electronics', 'Books', 'Clothing', 'Other'],
  COURIER_VEHICLES: ['Car', 'Motorbike', 'Bicycle', 'Scooter', 'By feet'],
  SELLER_DAYS: ['Any day of the week', 'Weekdays after lectures', 'Weekdays']
};

const SOON = {
  returns: ['Returns', 'Return requests for your purchases will appear here once returns are connected to the backend.'],
  terms: ['Terms & Conditions', 'The terms for using MyVossieMarketplace will be published here before launch.'],
  privacy: ['Privacy Policy', 'How we handle your personal details will be published here before launch.'],
  refunds: ['Returns & Refunds', 'Our returns and refunds policy will be published here before launch.'],
};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => CONFIG.CURRENCY + Number(n).toFixed(2);
const state = { products: [], status: 'loading', sample: false, cart: load('cm_cart', []), q: '', cat: 'all', campus: 'Potchefstroom', sort: 'new', fulfil: 'delivery', form: {}, user: null, profile: {}, next: '', checkoutMsg: null };
function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function save() { try { localStorage.setItem('cm_cart', JSON.stringify(state.cart)); } catch {} }
function syncUser() { state.user = Auth.current('buyer'); if (state.user) Auth.sync('buyer'); state.profile = state.user ? load('cm_profile', {}) : {}; }
syncUser();
function needSignIn() { state.next = location.hash || '#/marketplace'; toast('Sign in or sign up to add items to your cart'); location.hash = '#/signin'; }

/* ---------- data ---------- */
async function api(path, opts) {
  // Grab the token (assuming you save it as 'access_token' when logging in)
  const token = localStorage.getItem('access_token'); 
  const headers = { 'Content-Type': 'application/json' };
  
  // If the user has a token, attach it to the request
  if (token) headers['Authorization'] = `Bearer ${token}`; 

  const r = await fetch(CONFIG.API_BASE + path, { headers, ...opts });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function loadProducts() {
  state.status = 'loading'; render();
  try { 
    state.products = await api(CONFIG.ENDPOINTS.products); 
    state.sample = false; 
    state.status = 'ready'; 
  } catch {
    if (CONFIG.USE_SAMPLE_FALLBACK) {
      try { 
        state.products = await (await fetch('products.sample.json')).json(); 
        state.sample = true; 
        state.status = 'ready'; 
      } catch { state.status = 'error'; }
    } else state.status = 'error';
  }
  syncCart(); render();
}

const find = id => state.products.find(p => String(p.id) === String(id));
function syncCart() { // drop unavailable items, cap quantities to stock
  state.cart = state.cart.filter(i => { const p = find(i.id); if (!p || p.stock < 1) return false; i.qty = Math.min(i.qty, p.stock); return true; });
  save(); updateCount();
}

/* ---------- cart ---------- */
function addToCart(id) {
  if (!state.user) return needSignIn();
  const p = find(id); if (!p || p.stock < 1) return toast('This item is out of stock');
  const line = state.cart.find(i => String(i.id) === String(id));
  if (line) { if (line.qty >= p.stock) return toast(`Only ${p.stock} in stock`); line.qty++; }
  else state.cart.push({ id: p.id, qty: 1 });
  save(); updateCount(); toast(`Added “${p.name}” to cart`); if (!$('#drawer').hidden) renderDrawer();
}
function setQty(id, d) {
  const line = state.cart.find(i => String(i.id) === String(id)), p = find(id); if (!line) return;
  const n = line.qty + d;
  if (n > p.stock) return toast(`Only ${p.stock} in stock`);
  if (n < 1) return removeItem(id);
  line.qty = n; save(); updateCount(); renderDrawer(); if (location.hash === '#/checkout') render();
}
function removeItem(id) {
  const p = find(id); state.cart = state.cart.filter(i => String(i.id) !== String(id));
  save(); updateCount(); renderDrawer(); toast(`Removed “${p?.name ?? 'item'}”`); if (location.hash === '#/checkout') render();
}
const lines = () => state.cart.map(i => ({ ...find(i.id), qty: i.qty })).filter(l => l.id !== undefined);
function totals() { const sub = lines().reduce((s, l) => s + l.price * l.qty, 0); const fee = sub && state.fulfil !== 'pickup' ? CONFIG.DELIVERY_FEE : 0; return { sub, fee, total: sub + fee }; }
function updateCount() { $('#cart-count').textContent = state.cart.reduce((s, i) => s + i.qty, 0); }

/* ---------- ui helpers ---------- */
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2200); }
const avail = p => p.stock < 1 ? '<span class="tag out">Out of stock</span>' : p.stock <= CONFIG.LOW_STOCK ? `<span class="tag low">Only ${p.stock} left</span>` : '<span class="tag in">In stock</span>';
const img = p => p.image ? `style="background-image:url('${esc(p.image)}')"` : '';
function card(p) {
  return `<article class="prod">
    <div class="img" ${img(p)} data-open="${esc(p.id)}">${p.image ? '' : 'No image'}</div>
    <div class="body"><h3 data-open="${esc(p.id)}">${esc(p.name)}</h3>
    <div class="price">${money(p.price)}</div>${avail(p)}
    <p class="muted">${esc((p.description || '').slice(0, 80))}</p>
    <p class="muted">Sold by ${esc(p.seller?.name || 'Unknown seller')}</p>
    <button class="btn" data-add="${esc(p.id)}" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Unavailable' : 'Add to Cart'}</button></div></article>`;
}
const stateBlock = () => state.status === 'loading' ? '<div class="grid">' + '<div class="skel"></div>'.repeat(4) + '</div>'
  : state.status === 'error' ? '<div class="notice err">We couldn’t load products. Check your connection and <button class="btn sm" data-reload>try again</button>. (Backend integration: GET ' + esc(CONFIG.API_BASE + CONFIG.ENDPOINTS.products) + ')</div>' : '';
const sampleNote = () => state.sample ? '<div class="notice warn">Showing sample data because the products API is not connected yet.</div>' : '';

/* ---------- views ---------- */
function home() {
  const recent = [...state.products].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  return `<section class="hero"><img class="hero-img" src="hero.png" alt="Students studying together outside the Eduvos campus"><div class="hero-tint"></div><div class="wrap hero-in">
    <h1>Find what you need.<br><em>Sell what you don’t.</em><br><span class="l3">Get it delivered. Or pick it up yourself.</span></h1>
    <p>Find textbooks, electronics, clothing and more from fellow students at your university. Choose convenient student delivery or pick up your items yourself.</p>
    <a class="btn gold" href="#/marketplace">Explore Marketplace</a></div></section>
  <div class="wrap"><section class="block" id="how"><h2>How it works</h2><div class="steps">
    <div class="step"><h3>Buy</h3><p class="muted">Browse listings, add items to your cart, then choose student delivery or self-pickup at checkout.</p></div>
    <div class="step"><h3>Sell</h3><p class="muted">Registered sellers list items, set prices and manage their stock.</p></div>
    <div class="step"><h3>Deliver</h3><p class="muted">Student couriers accept delivery jobs and update the status until it arrives.</p></div></div></section>
  <section class="block" style="padding-top:0"><h2>Recently listed</h2>${state.status === 'ready' ? (recent.length ? `<div class="grid">${recent.map(card).join('')}</div>` : '<div class="empty">No products have been listed yet.</div>') : stateBlock()}</section>
  <section class="block" style="padding-top:0"><div class="cta-row">
    <div class="panel"><h3>Have something to sell?</h3><p class="muted">Turn your old textbooks and gear into cash.</p><br><a class="btn" href="${$('#seller-link').getAttribute('href')}">Become a Seller</a></div>
    <div class="panel"><h3>Want to earn between classes?</h3><p class="muted">Deliver orders to students near you.</p><br><a class="btn" href="${$('#courier-link').getAttribute('href')}">Become a Courier</a></div></div></section></div>`;
}
/* Campus: products should carry a `campus` field (e.g. "Potchefstroom"). MVP offers only Potchefstroom and All Campuses. */
const sorters = { new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt), low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, name: (a, b) => a.name.localeCompare(b.name) };
function visible() {
  return state.products.filter(p => (state.campus === 'all' || (p.campus || '').toLowerCase() === state.campus.toLowerCase())
    && (state.cat === 'all' || p.category === state.cat)
    && (p.name + ' ' + (p.description || '')).toLowerCase().includes(state.q.toLowerCase())).sort(sorters[state.sort]);
}
function market() {
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  const sel = (v, cur) => v === cur ? 'selected' : '';
  return `<div class="wrap"><h1 style="margin-top:28px">Marketplace</h1>${sampleNote()}
  <div class="toolbar"><input id="q" type="search" placeholder="Search products" aria-label="Search products" value="${esc(state.q)}">
  <select id="campus" class="campus" aria-label="Campus"><option value="Potchefstroom" ${sel('Potchefstroom', state.campus)}>Potchefstroom</option><option value="all" ${sel('all', state.campus)}>All Campuses</option></select>
  <select id="cat" aria-label="Category"><option value="all">All categories</option>${cats.map(c => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select id="sort" aria-label="Sort"><option value="new" ${sel('new', state.sort)}>Newest</option><option value="low" ${sel('low', state.sort)}>Price: low to high</option><option value="high" ${sel('high', state.sort)}>Price: high to low</option><option value="name" ${sel('name', state.sort)}>Name</option></select></div>
  <div id="results">${resultsHtml(visible())}</div></div>`;
}
const resultsHtml = list => state.status !== 'ready' ? stateBlock() : list.length ? `<div class="grid">${list.map(card).join('')}</div>`
  : `<div class="empty"><h3>No products found</h3><p>${state.campus === 'all' ? 'No products match your search or category.' : 'No products are available for ' + esc(state.campus) + ' with these filters. Try All Campuses or change your search.'}</p></div>`;
function orders() {
  return `<div class="wrap"><h1 style="margin-top:28px">My Orders</h1><div class="empty"><h3>No orders to show</h3>
  <p>Your purchases and their statuses will appear here once order history is connected to the backend (GET ${esc(CONFIG.API_BASE + CONFIG.ENDPOINTS.orders)}).</p><a class="btn" href="#/marketplace">Browse Marketplace</a></div></div>`;
}


function soon(k) { const [t, m] = SOON[k]; return `<div class="wrap"><h1 style="margin-top:28px">${t}</h1><div class="empty"><h3>Nothing here yet</h3><p>${m}</p><a class="btn" href="#/marketplace">Browse Marketplace</a></div></div>`; }
/* ---------- sign in / sign up ---------- */
const val = id => ($('#' + id)?.value || '').trim();
const EMAIL = /^\S+@\S+\.\S+$/, PHONE = /^(\+27|0)\d{9}$/;
const showErr = (id, m) => { const er = $('#' + id); er.textContent = m; er.hidden = false; };
const AUTH = {
  buyer: { h: 'Sign in', p: 'Use your student email and password. You need an account to add items to your cart.', lab: 'Student email', up: '#/signup', upTxt: 'Sign up' },
  seller: { h: 'Sign in to Seller Account', p: 'Use the email and password you signed up as a seller with.', lab: 'Email', up: '#/become-seller', upTxt: 'Sign up as a seller' },
  admin: { h: 'Admin sign in', p: 'Administrators only. Use your admin email and password.', lab: 'Admin email', up: '' },
  courier: { h: 'Sign in to Courier Account', p: 'Use the email and password you signed up as a courier with.', lab: 'Email', up: '#/become-courier', upTxt: 'Sign up as a courier' }
};
function signinView(role = 'buyer') {
  const A = AUTH[role];
  return `<div class="wrap"><div class="auth"><form class="panel" id="si" data-role="${role}" novalidate><h1>${A.h}</h1><p class="muted">${A.p}</p>
  <div class="field"><label for="si-email">${A.lab}</label><input id="si-email" type="email" autocomplete="username"></div>
  <div class="field"><label for="si-pw">Password</label><input id="si-pw" type="password" autocomplete="current-password"></div>
  <p class="notice err" id="si-err" hidden></p><button class="btn" type="submit" style="width:100%">Sign in</button>
  ${A.up ? `<div class="auth-alt"><p class="muted">Don’t have an account yet?</p><a class="btn ghost" href="${A.up}" style="width:100%">${A.upTxt}</a></div>` : ''}</form></div></div>`;
}
function signupView() {
  return `<div class="wrap"><div class="auth"><form class="panel" id="su" novalidate><h1>Create your account</h1><p class="muted">Sign up with your student details. They fill in your profile and checkout for you.</p>
  <div class="field"><label for="su-name">Full name</label><input id="su-name" autocomplete="name"></div>
  <div class="field"><label for="su-sn">Student number</label><input id="su-sn" inputmode="numeric"></div>
  <div class="field"><label for="su-email">Student email</label><input id="su-email" type="email" autocomplete="email"></div>
  <div class="field"><label for="su-phone">Phone number</label><input id="su-phone" type="tel" autocomplete="tel"></div>
  <div class="field"><label for="su-campus">Campus</label><select id="su-campus">${CONFIG.CAMPUSES.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
  <div class="field"><label for="su-addr">Default delivery address</label><textarea id="su-addr" rows="3" placeholder="Residence, room or campus location"></textarea></div>
  <div class="field"><label for="su-pw">Password</label><input id="su-pw" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
  <div class="field"><label for="su-pw2">Confirm password</label><input id="su-pw2" type="password" autocomplete="new-password"></div>
  <p class="notice err" id="su-err" hidden></p><button class="btn" type="submit" style="width:100%">Sign up</button>
  <div class="auth-alt"><p class="muted">Already have an account?</p><a class="btn ghost" href="#/signin" style="width:100%">Sign in</a></div></form></div></div>`;
}
const bankFields = p => `<h3 style="margin:6px 0 4px">Banking details</h3><p class="muted" style="margin:0 0 10px">This is where we pay you. The details go to the MyVossieMarketplace admin team.</p>
  <div class="field"><label for="${p}-bank">Bank</label><select id="${p}-bank"><option value="">Select a bank</option>${CONFIG.BANKS.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
  <div class="field"><label for="${p}-holder">Account holder</label><input id="${p}-holder" autocomplete="off"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label for="${p}-acc">Account number</label><input id="${p}-acc" inputmode="numeric" autocomplete="off"></div>
  <div class="field"><label for="${p}-branch">Branch code</label><input id="${p}-branch" inputmode="numeric" autocomplete="off"></div></div>`;
const bankData = p => ({ bank: val(p + '-bank'), holder: val(p + '-holder'), acc: val(p + '-acc'), branch: val(p + '-branch') });
function bankErr(p) {
  if (!val(p + '-bank')) return 'Choose your bank.';
  if (!val(p + '-holder')) return 'Enter the account holder name.';
  if (!/^\d{6,16}$/.test(val(p + '-acc'))) return 'Account number should be 6 to 16 digits.';
  if (!/^\d{4,6}$/.test(val(p + '-branch'))) return 'Branch code should be 4 to 6 digits.';
  return '';
}
function finishAuth() { syncUser(); const to = state.next || '#/profile'; state.next = ''; if (location.hash === to) render(); else location.hash = to; }

function profile() {
  const P = state.profile, name = P.name || 'Student', ini = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'S';
  return `<div class="wrap"><div class="pf-head"><div class="avatar" aria-hidden="true">${esc(ini)}</div><div><h1 style="margin:0">${esc(name)}</h1><p class="muted">${esc(P.email || 'Add your details below')}</p></div></div>
  <div class="notice warn">Sign-in is not connected to a server yet, so your account and these details are saved on this device only. They pre-fill checkout.</div>
  <div class="pf-grid"><form class="panel" id="pf" novalidate><h3>Personal details</h3>
    <div class="field"><label for="pf-name">Full name</label><input id="pf-name" autocomplete="name" value="${esc(P.name)}"></div>
    <div class="field"><label for="pf-sn">Student number</label><input id="pf-sn" value="${esc(P.studentNo)}"></div>
    <div class="field"><label for="pf-email">Email</label><input id="pf-email" type="email" autocomplete="email" value="${esc(P.email)}" readonly></div>
    <div class="field"><label for="pf-phone">Phone number</label><input id="pf-phone" type="tel" autocomplete="tel" value="${esc(P.phone)}"></div>
    <div class="field"><label for="pf-campus">Campus</label><select id="pf-campus">${CONFIG.CAMPUSES.map(c => `<option ${c === (P.campus || 'Potchefstroom') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field"><label for="pf-addr">Default delivery address</label><textarea id="pf-addr" rows="3">${esc(P.addr)}</textarea></div>
    <h3>Notifications</h3>
    <label class="chk"><input type="checkbox" id="pf-n1" ${P.notifyOrders === false ? '' : 'checked'}> Order and delivery updates</label>
    <label class="chk"><input type="checkbox" id="pf-n2" ${P.notifyNews ? 'checked' : ''}> New listings and news</label>
    <p class="notice err" id="pf-err" hidden></p><button class="btn" type="submit">Save changes</button></form>
  <div><div class="panel pf-links"><h3>My account</h3><a href="#/orders">My Orders</a><a href="#/marketplace">Browse Marketplace</a>
    <a href="#/signin-seller">Sign in to Seller Account</a><a href="#/signin-courier">Sign in to Courier Account</a></div>
  <div class="panel" style="margin-top:16px"><button class="btn ghost" style="width:100%" data-logout>Sign out</button></div></div></div></div>`;
}
function detail(id) {
  const p = find(id);
  if (state.status !== 'ready') return `<div class="wrap">${stateBlock()}</div>`;
  if (!p) return '<div class="wrap empty"><h3>Product not found</h3><a href="#/marketplace">Back to Marketplace</a></div>';
  return `<div class="wrap"><p><a href="#/marketplace">← Back to Marketplace</a></p><div class="detail"><div class="img" ${img(p)}></div><div>
    <h1>${esc(p.name)}</h1><div class="price" style="font-size:1.6rem">${money(p.price)}</div><p>${avail(p)}</p><p>${esc(p.description)}</p>
    <p class="muted">Category: ${esc(p.category || 'Uncategorised')}<br>Sold by ${esc(p.seller?.name || 'Unknown seller')}</p>
    <button class="btn" data-add="${esc(p.id)}" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Unavailable' : 'Add to Cart'}</button></div></div></div>`;
}
function checkout() {
  const L = lines(), t = totals(), F = { name: state.profile.name, phone: state.profile.phone, addr: state.profile.addr, note: '', ...state.form }, pick = state.fulfil === 'pickup';
  if (!L.length) return '<div class="wrap empty"><h2>Your cart is empty</h2><p>Add a few items to get started.</p><a class="btn" href="#/marketplace">Browse Marketplace</a></div>';
  const m = state.checkoutMsg;
  return `<div class="wrap"><h1 style="margin-top:28px">Checkout</h1>${m ? `<div class="notice ${m.type}">${esc(m.text)}</div>` : ''}
  <form class="checkout" id="co" novalidate><div class="panel"><h3>How do you want to get it?</h3>
    <label class="pay"><input type="radio" name="fulfil" value="delivery" ${pick ? '' : 'checked'}> Student delivery (delivery fee applies)</label>
    <label class="pay"><input type="radio" name="fulfil" value="pickup" ${pick ? 'checked' : ''}> Self-pickup (no delivery fee)</label>
    ${pick ? '<p class="muted">Pickup arrangements with the seller still need backend support.</p>' : ''}
    <h3 style="margin-top:18px">Your details</h3>
    <div class="field"><label for="name">Full name</label><input id="name" required autocomplete="name" value="${esc(F.name)}"></div>
    <div class="field"><label for="phone">Phone number</label><input id="phone" type="tel" required autocomplete="tel" value="${esc(F.phone)}"></div>
    ${pick ? '' : `<div class="field"><label for="addr">Delivery address (residence, room or campus location)</label><textarea id="addr" rows="3" required>${esc(F.addr)}</textarea></div>
    <div class="field"><label for="note">Note for the courier (optional)</label><input id="note" value="${esc(F.note)}"></div>`}
    <h3>Payment method</h3><div id="pay" class="muted">Loading payment methods…</div></div>
  <div class="panel"><h3>Order summary</h3>${L.map(l => `<div class="line"><div class="thumb" ${img(l)}></div><div style="flex:1;min-width:0"><strong>${esc(l.name)}</strong><div class="muted">${money(l.price)} × ${l.qty}</div></div><strong>${money(l.price * l.qty)}</strong></div>`).join('')}
    <div class="sum"><span>Subtotal</span><span>${money(t.sub)}</span></div><div class="sum"><span>${pick ? 'Delivery (pickup)' : 'Delivery (estimate)'}</span><span>${money(t.fee)}</span></div>
    <div class="sum total"><span>Total</span><span>${money(t.total)}</span></div>
    <button class="btn" id="place" style="width:100%;margin-top:14px" disabled>Place order</button></div></form></div>`;
}
async function initCheckout() {
  const box = $('#pay'); if (!box) return;
  let methods = [];
  try { methods = await api(CONFIG.ENDPOINTS.payments); } catch {}
  if (!methods.length) { box.innerHTML = '<div class="notice warn">No payment method is available yet. Payment integration is still needed, so orders can’t be placed.</div>'; return; }
  box.innerHTML = methods.map((m, i) => `<label class="pay"><input type="radio" name="pm" value="${esc(m.id)}" ${i ? '' : 'checked'}> ${esc(m.label)}</label>`).join('');
  $('#place').disabled = false;
}
async function placeOrder(e) {
  e.preventDefault();
  const f = id => ($('#' + id)?.value || '').trim(); 
  const pick = state.fulfil === 'pickup';
  if (!f('name') || !f('phone') || (!pick && !f('addr'))) { state.checkoutMsg = { type: 'err', text: pick ? 'Please fill in your name and phone number.' : 'Please fill in your name, phone number and delivery address.' }; return render(); }
  const btn = $('#place'); btn.disabled = true; btn.textContent = 'Placing order…';
  try {
    const res = await api(CONFIG.ENDPOINTS.orders, { method: 'POST', body: JSON.stringify({
      items: state.cart.map(i => ({ productId: i.id, quantity: i.qty })),
      fulfilment: state.fulfil, delivery: { name: f('name'), phone: f('phone'), address: f('addr'), note: f('note') },
      paymentMethod: ($('input[name=pm]:checked') || {}).value }) });
    // Only treat as paid if the backend confirms it.
    if (res.paymentStatus === 'paid') { state.cart = []; save(); updateCount(); state.checkoutMsg = null; $('#app').innerHTML = `<div class="wrap empty"><div class="notice ok">Payment confirmed. Order ${esc(res.orderId || '')} has been placed.</div><a class="btn" href="#/marketplace">Keep shopping</a></div>`; }
    else { state.checkoutMsg = { type: 'warn', text: `Order received but payment is "${res.paymentStatus || 'unconfirmed'}". Your order is not paid yet.` }; render(); }
  } catch { state.checkoutMsg = { type: 'err', text: 'Your order was not placed. We couldn’t reach the server, so nothing was saved or charged. Please try again.' }; render(); }
}

/* ---------- become a seller ---------- */
function becomeSeller() {
  const P = state.profile, opts = (a, sel) => a.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const card = (t, d, p) => `<div class="bs-card"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${p}"/></svg></span><div><strong>${t}</strong><p class="muted">${d}</p></div></div>`;
  return `<div class="wrap"><div class="bs"><div class="bs-info"><span class="eyebrow">Become a seller</span><h1>Entrepreneur Incubation Hub</h1>
  <p class="muted">Eduvos has partnered with Suitable Focus to help empower students to think innovatively and unlock their entrepreneurial potential.</p>
  <p class="muted">Through this initiative, students will gain hands-on experience, mentorship and the tools needed to turn their ideas into impactful business ventures.</p>
  ${card('Shape your idea', 'Turn an early concept into a practical business opportunity.', 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z')}
  ${card('Build real experience', 'Develop hands-on selling, communication and business skills.', 'M5 19c0-5 4-11 14-14 0 10-6 14-11 14zM5 19l4-4M14 9a1 1 0 100 .01')}
  ${card('Develop your business at campus', 'Turn your skills, products and ideas into a real business right where you study. Sell to fellow Eduvos students, learn as you go and grow at your own pace.', 'M4 7h16l-1 4H5zM5 11v9h14v-9M9 20v-5h6v5')}</div>
  <div class="bs-form"><img src="Becomeseller.png" alt="Entrepreneur Incubation Hub, Suitable Focus x Eduvos"><form id="bs" novalidate><h2>Seller sign-up</h2>
  <div class="field"><label for="bs-name">Full name</label><input id="bs-name" autocomplete="name" value="${esc(P.name)}"></div>
  <div class="field"><label for="bs-sn">Student number</label><input id="bs-sn" inputmode="numeric" value="${esc(P.studentNo)}"></div>
  <div class="field"><label for="bs-email">Email</label><input id="bs-email" type="email" autocomplete="email" value="${esc(P.email)}"></div>
  <div class="field"><label for="bs-phone">Phone</label><input id="bs-phone" type="tel" autocomplete="tel" value="${esc(P.phone)}"></div>
  <div class="field"><label for="bs-pw">Password</label><input id="bs-pw" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
  <div class="field"><label for="bs-campus">Which campus?</label><select id="bs-campus">${opts(CONFIG.ALL_CAMPUSES, P.campus || 'Potchefstroom')}</select></div>
  <div class="field"><label for="bs-prod">Which products would you be selling?</label><select id="bs-prod"><option value="">Select products</option>${opts(CONFIG.SELLER_PRODUCTS)}</select></div>
  <div class="field" id="bs-other-f" hidden><label for="bs-other">What will you sell?</label><input id="bs-other" maxlength="60"></div>
  <div class="field"><label for="bs-days">Days for orders to be placed</label><select id="bs-days">${opts(CONFIG.SELLER_DAYS)}</select></div>
  ${bankFields('bs')}
  <p class="notice err" id="bs-err" hidden></p><button class="btn" type="submit" style="width:100%">Sign up as seller</button>
  <p class="muted" style="margin-top:10px">Already a seller? <a href="#/signin-seller">Sign in to your seller account</a>. Sign-in is not connected to a server yet, so your details are saved on this device only.</p></form></div></div></div>`;
}

/* ---------- become a courier ---------- */
function becomeCourier() {
  const P = state.profile, opts = (a, sel) => a.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const card = (t, d, p) => `<div class="bs-card"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${p}"/></svg></span><div><strong>${t}</strong><p class="muted">${d}</p></div></div>`;
  return `<div class="wrap"><div class="bs"><div class="bs-info"><span class="eyebrow">Student delivery</span><h1>Earn as a Courier</h1>
  <p class="muted">Deliver items sold on MyVossieMarketplace to students on your campus. Choose your own hours and get paid for every delivery.</p>
  ${card('Earn per delivery', 'Get paid for every completed drop-off.', 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H3zM3 7l12-3v3M16 13.5h2')}
  ${card('Flexible hours', 'Work between lectures or on weekends.', 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2')}
  ${card('Stay on campus', 'Short trips around your own campus.', 'M6 19a3 3 0 100-6 3 3 0 000 6zM18 19a3 3 0 100-6 3 3 0 000 6zM6 16l4-8h5l3 8M9 8L8 5H6')}</div>
  <div class="bs-form"><img src="Becomecourier.png" alt="Courier carrying two parcels"><form id="bc" novalidate><h2>Courier sign-up</h2>
  <div class="field"><label for="bc-name">Full name</label><input id="bc-name" autocomplete="name" value="${esc(P.name)}"></div>
  <div class="field"><label for="bc-sn">Student number</label><input id="bc-sn" inputmode="numeric" value="${esc(P.studentNo)}"></div>
  <div class="field"><label for="bc-email">Email</label><input id="bc-email" type="email" autocomplete="email" value="${esc(P.email)}"></div>
  <div class="field"><label for="bc-phone">Phone number</label><input id="bc-phone" type="tel" autocomplete="tel" value="${esc(P.phone)}"></div>
  <div class="field"><label for="bc-campus">Campus</label><select id="bc-campus">${opts(CONFIG.ALL_CAMPUSES, P.campus || 'Potchefstroom')}</select></div>
  <div class="field"><label for="bc-pw">Password</label><input id="bc-pw" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
  <div class="field"><label for="bc-veh">What would you be using to deliver?</label><select id="bc-veh"><option value="">Select how you will deliver</option>${opts(CONFIG.COURIER_VEHICLES)}</select></div>
  <div class="field"><label for="bc-days">When are you available to deliver?</label><select id="bc-days">${opts(CONFIG.SELLER_DAYS)}</select></div>
  ${bankFields('bc')}
  <p class="notice err" id="bc-err" hidden></p><button class="btn" type="submit" style="width:100%">Sign up as courier</button>
  <p class="muted" style="margin-top:10px">Already a courier? <a href="#/signin-courier">Sign in to your courier account</a>. Sign-in is not connected to a server yet, so your details are saved on this device only.</p></form></div></div></div>`;
}

/* ---------- drawer ---------- */
function renderDrawer() {
  const L = lines(), t = totals();
  $('#drawer').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Your cart</h2><button class="btn ghost sm" data-close>Close</button></div>
  <div class="items">${L.length ? L.map(l => `<div class="line"><div class="thumb" ${img(l)}></div><div style="flex:1"><strong>${esc(l.name)}</strong><div class="muted">${money(l.price)}</div>
    <div style="margin-top:6px"><span class="qty"><button data-dec="${esc(l.id)}" aria-label="Decrease">−</button><span style="min-width:24px;text-align:center">${l.qty}</span><button data-inc="${esc(l.id)}" aria-label="Increase">+</button></span><button class="link-btn" data-rm="${esc(l.id)}">Remove</button></div></div></div>`).join('')
    : '<div class="empty"><h3>Your cart is empty</h3><p>Browse the marketplace to find something you like.</p></div>'}</div>
  <div><div class="sum"><span>Subtotal</span><span>${money(t.sub)}</span></div><div class="sum"><span>Delivery (estimate)</span><span>${money(t.fee)}</span></div><div class="sum total"><span>Total</span><span>${money(t.total)}</span></div>
  <button class="btn" data-close style="width:100%;margin:10px 0 6px;background:transparent;color:var(--ink);border:1px solid var(--line)">Continue shopping</button>
  <a class="btn" href="#/checkout" data-close style="width:100%;text-align:center;${L.length ? '' : 'pointer-events:none;opacity:.5'}">Checkout</a></div>`;
}
function openDrawer(open) { renderDrawer(); $('#drawer').hidden = !open; $('#scrim').hidden = !open; }

/* ---------- router ---------- */
function updateNav() {
  const btn = $('#profile-btn'), on = !!state.user;
  btn.classList.toggle('nochev', !on);
  if (on) { btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', String(!$('#pmenu').hidden)); }
  else { btn.removeAttribute('aria-haspopup'); btn.removeAttribute('aria-expanded'); $('#pmenu').hidden = true; }
}
function render() {
  const [, route = 'home', arg] = location.hash.split('/');
  const app = $('#app');
  if (route === 'signin-seller' && Auth.current('seller')) return location.replace('seller.html');
  if (route === 'signin-courier' && Auth.current('courier')) return location.replace('courier.html');
  if (route === 'signin-admin' && Auth.current('admin')) return location.replace(CONFIG.ADMIN_PAGE);
  if (state.user && (route === 'signin' || route === 'signup')) return location.replace('#/profile');
  const gated = !state.user && (route === 'profile' || route === 'checkout');
  if (gated) state.next = '#/' + route;
  app.innerHTML = gated || route === 'signin' ? signinView('buyer') : route === 'signup' ? signupView() : route === 'signin-seller' ? signinView('seller') : route === 'signin-courier' ? signinView('courier') : route === 'signin-admin' ? signinView('admin')
    : route === 'marketplace' ? market() : route === 'product' ? detail(arg) : route === 'checkout' ? checkout() : route === 'orders' ? orders() : route === 'profile' ? profile() : route === 'become-seller' ? becomeSeller() : route === 'become-courier' ? becomeCourier() : SOON[route] ? soon(route) : home();
  const grp = route === 'product' ? 'marketplace' : (['profile', 'signin', 'signup', 'signin-seller', 'signin-courier', 'returns'].includes(route)) ? 'profile' : route;
  document.querySelectorAll('.links [data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === grp));
  updateNav();
  if (route === 'checkout' && !gated) initCheckout();
}
function refreshResults() { $('#results').innerHTML = resultsHtml(visible()); } // keeps search box focus
window.addEventListener('hashchange', () => { state.checkoutMsg = null; render(); window.scrollTo(0, 0);  });
const menu = open => { $('#pmenu').hidden = !open; $('#profile-btn').setAttribute('aria-expanded', open); };
document.addEventListener('click', e => {
  if (e.target.closest('#profile-btn')) { if (!state.user) { state.next = ''; location.hash = '#/signin'; return; } return menu($('#pmenu').hidden); }
  if (e.target.closest('[data-opencart]')) { menu(false); return openDrawer(true); }
  if (e.target.closest('[data-logout]')) { menu(false); Auth.logout('buyer'); syncUser(); state.form = {}; toast('Signed out'); if (location.hash === '#/home') return render(); location.hash = '#/home'; return; }
  menu(false);
  if (e.target.closest('[data-how]')) { e.preventDefault(); const go = () => $('#how')?.scrollIntoView({ behavior: 'smooth' }); if (location.hash === '#/home') go(); else { location.hash = '#/home'; setTimeout(go, 200); } return; }
  const t = e.target.closest('[data-add],[data-open],[data-inc],[data-dec],[data-rm],[data-close],[data-reload]'); 
  if (e.target.closest('#cart-btn')) return openDrawer(true);
  if (e.target.id === 'scrim') return openDrawer(false);
  if (!t) return; const d = t.dataset;
  if (d.add) addToCart(d.add); else if (d.open) location.hash = '#/product/' + d.open;
  else if (d.inc) setQty(d.inc, 1); else if (d.dec) setQty(d.dec, -1); else if (d.rm) removeItem(d.rm);
  else if ('close' in d) openDrawer(false); else if ('reload' in d) loadProducts();
});
document.addEventListener('input', e => { if (e.target.id === 'q') { state.q = e.target.value; refreshResults(); } if (e.target.closest('#co') && e.target.id) state.form[e.target.id] = e.target.value; });
document.addEventListener('change', e => { if (e.target.id === 'bs-prod') $('#bs-other-f').hidden = e.target.value !== 'Other'; if (e.target.id === 'campus') { state.campus = e.target.value; refreshResults(); } if (e.target.name === 'fulfil') { state.fulfil = e.target.value; render(); } if (e.target.id === 'cat') { state.cat = e.target.value; refreshResults(); } if (e.target.id === 'sort') { state.sort = e.target.value; refreshResults(); } });
document.addEventListener('submit', async e => {
  const id = e.target.id; e.preventDefault();
  if (id === 'co') return placeOrder(e);
  if (id === 'si') {
    const role = e.target.dataset.role, pw = $('#si-pw').value;
    if (!EMAIL.test(val('si-email'))) return showErr('si-err', 'Enter your email address.');
    if (!pw) return showErr('si-err', 'Enter your password.');
    const r = await Auth.login(role, val('si-email'), pw);
    if (r.error) return showErr('si-err', r.error);
    if (role === 'buyer') { toast('Signed in'); return finishAuth(); }
    location.href = role === 'admin' ? CONFIG.ADMIN_PAGE : role + '.html';
  }
  if (id === 'su') {
    const er = 'su-err', pw = $('#su-pw').value;
    if (!val('su-name')) return showErr(er, 'Enter your full name.');
    if (!val('su-sn')) return showErr(er, 'Enter your student number.');
    if (!EMAIL.test(val('su-email'))) return showErr(er, 'Enter a valid student email address.');
    if (!PHONE.test(val('su-phone').replace(/\s/g, ''))) return showErr(er, 'Enter a valid South African phone number.');
    if (pw.length < 8) return showErr(er, 'Your password needs at least 8 characters.');
    if (pw !== $('#su-pw2').value) return showErr(er, 'The two passwords do not match.');
    const r = await Auth.register('buyer', { name: val('su-name'), studentNo: val('su-sn'), email: val('su-email'), phone: val('su-phone'), campus: val('su-campus'), addr: val('su-addr'), notifyOrders: true, notifyNews: false }, pw);
    if (r.error) return showErr(er, r.error);
    toast('Account created'); return finishAuth();
  }
  if (id === 'bc') {
    const er = 'bc-err', pw = $('#bc-pw').value;
    if (!val('bc-name')) return showErr(er, 'Enter your full name.');
    if (!val('bc-sn')) return showErr(er, 'Enter your student number.');
    if (!EMAIL.test(val('bc-email'))) return showErr(er, 'Enter a valid email address.');
    if (!PHONE.test(val('bc-phone').replace(/\s/g, ''))) return showErr(er, 'Enter a valid South African phone number.');
    if (pw.length < 8) return showErr(er, 'Your password needs at least 8 characters.');
    if (!val('bc-veh')) return showErr(er, 'Choose what you would use to deliver.');
    const be = bankErr('bc'); if (be) return showErr(er, be);
    const r = await Auth.register('courier', { name: val('bc-name'), studentNo: val('bc-sn'), email: val('bc-email'), phone: val('bc-phone'), campus: val('bc-campus'), vehicle: val('bc-veh'), availability: val('bc-days'), ...bankData('bc') }, pw); // password goes to the backend only (TODO)
    if (r.error) return showErr(er, r.error);
    $('#bc').innerHTML = `<h2>You’re signed up</h2><div class="notice ok">Welcome aboard, ${esc(val('bc-name') || 'courier')}! Delivery jobs on ${esc(val('bc-campus'))} campus will appear in your courier dashboard.</div><a class="btn" href="courier.html" style="width:100%">Go to Courier Dashboard</a>`;
  }
  if (id === 'bs') {
    const er = 'bs-err', pw = $('#bs-pw').value;
    if (!val('bs-name')) return showErr(er, 'Enter your full name.');
    if (!val('bs-sn')) return showErr(er, 'Enter your student number.');
    if (!EMAIL.test(val('bs-email'))) return showErr(er, 'Enter a valid email address.');
    if (!PHONE.test(val('bs-phone').replace(/\s/g, ''))) return showErr(er, 'Enter a valid South African phone number.');
    if (pw.length < 8) return showErr(er, 'Your password needs at least 8 characters.');
    if (!val('bs-prod')) return showErr(er, 'Choose which products you would be selling.');
    if (val('bs-prod') === 'Other' && !val('bs-other')) return showErr(er, 'Tell us what you will be selling.');
    const be = bankErr('bs'); if (be) return showErr(er, be);
    const products = val('bs-prod') === 'Other' ? val('bs-other') : val('bs-prod');
    const r = await Auth.register('seller', { name: val('bs-name'), studentNo: val('bs-sn'), email: val('bs-email'), phone: val('bs-phone'), campus: val('bs-campus'), products, days: val('bs-days'), ...bankData('bs') }, pw); // password goes to the backend only (TODO)
    if (r.error) return showErr(er, r.error);
    try { localStorage.setItem('cm_seller_signup', JSON.stringify({ email: val('bs-email'), campus: val('bs-campus'), products, days: val('bs-days'), at: Date.now() })); } catch {}
    $('#bs').innerHTML = `<h2>You’re signed up</h2><div class="notice ok">Welcome aboard, ${esc(val('bs-name') || 'seller')}! Your seller account is ready for ${esc(val('bs-campus'))}.</div><a class="btn" href="seller.html" style="width:100%">Go to Seller Dashboard</a>`;
  }
  if (id === 'pf') {
    if (!val('pf-name')) return showErr('pf-err', 'Enter your full name.');
    if (val('pf-phone') && !PHONE.test(val('pf-phone').replace(/\s/g, ''))) return showErr('pf-err', 'Enter a valid South African phone number.');
    Auth.update('buyer', { name: val('pf-name'), studentNo: val('pf-sn'), phone: val('pf-phone'), campus: val('pf-campus'), addr: val('pf-addr'), notifyOrders: $('#pf-n1').checked, notifyNews: $('#pf-n2').checked });
    syncUser(); state.form = {}; toast('Profile saved'); render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { openDrawer(false); menu(false); } });
updateCount(); if (!location.hash) location.hash = '#/home'; loadProducts();