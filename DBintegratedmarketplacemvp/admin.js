/* MyVossieMarketplace Admin (frontend-only MVP).
   No sample data is bundled: every screen starts empty. Connect real data with window.MVMAdmin.setData({users, listings, orders}).
   Changes are kept in localStorage, which is NOT suitable for real financial records or secure admin access.
   Marking a payout as paid only updates this browser's data; it never moves money. */
(function () {
'use strict';

/* ================= CONFIG ================= */
const STORAGE_KEY = 'mvm_admin_v2';
try { localStorage.removeItem('mvm_admin_demo_v1'); } catch (e) { } // clears the sample data saved by the earlier demo version
const FEE_RATE = 0.10;          // marketplace commission on the item subtotal (seller side)
                                // Couriers receive 100% of the delivery fee. Self-pickup orders have no courier payout.

/* ================= HELPERS ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = a => r2(a.reduce((t, x) => t + x, 0));
const money = n => 'R' + r2(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = iso => { const d = new Date(iso); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const ftime = iso => { const d = new Date(iso); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const slug = s => String(s).toLowerCase().replace(/\s+/g, '-');
const chip = s => '<span class="chip ' + slug(s) + '">' + esc(s) + '</span>';
const typeChip = t => '<span class="chip t-' + t.toLowerCase() + '">' + esc(t) + '</span>';

const ICON = {
  dashboard: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 14h8v7H3z"/>',
  payments: '<path d="M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2"/>',
  orders: '<path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10"/>',
  listings: '<path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2.4.6 4 2.2 4 5.2"/>',
  sales: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  revenue: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  truck: '<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  alert: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'
};
const ic = n => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>';

/* Creates one payout per eligible order and recipient. Never creates a second one for the same order + type (duplicate prevention).
   Eligible = order Completed AND buyer payment Paid. Courier payouts only for Delivery orders that have a courier. */
function ensurePayouts(st) {
  const have = new Set(st.payouts.map(p => p.orderId + ':' + p.type));
  st.orders.forEach(o => {
    if (o.status !== 'Completed' || o.pay !== 'Paid') return;
    const add = (type, recipientId, amount) => {
      if (have.has(o.id + ':' + type)) return;
      have.add(o.id + ':' + type);
      st.payouts.push({
        id: 'PO-' + o.id.slice(3) + '-' + type[0], orderId: o.id, type, recipientId, amount: r2(amount),
        status: 'Pending', ref: '', date: o.date, paidAt: null,
        history: [{ at: o.date + 'T08:00:00.000Z', text: 'Payout created when the order was completed' }]
      });
    };
    add('Seller', o.sellerId, o.subtotal - o.fee);
    if (o.fulfilment === 'Delivery' && o.courierId) add('Courier', o.courierId, o.deliveryFee);
  });
}

/* ================= STATE ================= */
function load() { try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && s.v === 1 && s.orders) return s; } catch (e) { } return null; }
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { } }
let S = load() || { v: 1, users: [], listings: [], orders: [], payouts: [] };
ensurePayouts(S); save();

const F = { // filter state per page
  pay: { q: '', type: 'all', status: 'outstanding', sort: 'date', dir: 'desc' },
  ord: { q: '', status: 'all', pay: 'all', ful: 'all' },
  lst: { q: '', status: 'all' },
  usr: { q: '', role: 'all' }
};
const user = id => S.users.find(u => u.id === id) || { name: '—', email: '', roles: [] };
const order = id => S.orders.find(o => o.id === id);
const payout = id => S.payouts.find(p => p.id === id);
const unpaid = p => p.status !== 'Paid';

function metrics() {
  const done = S.orders.filter(o => o.status === 'Completed');
  const P = S.payouts, sel = P.filter(p => p.type === 'Seller'), cou = P.filter(p => p.type === 'Courier');
  return {
    sales: sum(done.map(o => o.total)), revenue: sum(done.map(o => o.fee)), completed: done.length,
    sellerOut: sum(sel.filter(unpaid).map(p => p.amount)), sellerN: sel.filter(unpaid).length,
    courierOut: sum(cou.filter(unpaid).map(p => p.amount)), courierN: cou.filter(unpaid).length,
    outstanding: sum(P.filter(unpaid).map(p => p.amount)), outN: P.filter(unpaid).length,
    paid: sum(P.filter(p => !unpaid(p)).map(p => p.amount)), paidN: P.filter(p => !unpaid(p)).length,
    sellerTotal: sum(sel.map(p => p.amount)), courierTotal: sum(cou.map(p => p.amount)),
    buyers: S.users.filter(u => u.roles.includes('B')).length, sellers: S.users.filter(u => u.roles.includes('S')).length,
    couriers: S.users.filter(u => u.roles.includes('C')).length,
    listings: S.listings.filter(l => l.status === 'Active' && l.stock > 0).length,
    pending: S.orders.filter(o => ['Pending', 'Confirmed', 'Out for delivery'].includes(o.status)).length
  };
}
const byStatus = st => ({ n: S.payouts.filter(p => p.status === st).length, amt: sum(S.payouts.filter(p => p.status === st).map(p => p.amount)) });

/* ================= ROUTER + SHELL ================= */
const ROUTES = ['dashboard', 'payments', 'orders', 'listings', 'users'];
const NAV = { dashboard: ['Dashboard', 'Dashboard'], payments: ['Payments & Payouts', 'Payments'], orders: ['Orders', 'Orders'], listings: ['Listings', 'Listings'], users: ['Users', 'Users'] };
let current = 'dashboard';
const app = $('#app'), dlg = $('#dlg');

function go(name) { if (location.hash === '#/' + name) render(); else location.hash = '#/' + name; }
function route() { let r = location.hash.replace(/^#\/?/, '').split('?')[0]; current = ROUTES.includes(r) ? r : 'dashboard'; render(); window.scrollTo(0, 0); }

function renderNav() {
  document.querySelectorAll('#links a').forEach(a => {
    const on = a.dataset.route === current; a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const n = S.payouts.filter(unpaid).length, b = $('#pay-badge'); b.textContent = n; b.hidden = !n;
}

function render() {
  renderNav();
  document.title = NAV[current][0] + ' – MyVossieMarketplace Admin';
  app.innerHTML = { dashboard: pgDashboard, payments: pgPayments, orders: pgOrders, listings: pgListings, users: pgUsers }[current]();
  app.innerHTML += '<p class="muted foot-note">Admin changes are saved in this browser only (localStorage). That is not suitable for real financial records or secure admin access, and marking a payout as paid does not send any money.</p>';
  drawCurrent();
}
function drawCurrent() {
  ({ payments: drawPay, orders: drawOrd, listings: drawLst, users: drawUsr }[current] || function () { })();
}

/* ================= DASHBOARD ================= */
function statCard(label, value, sub, kind, icon, link) {
  const inner = '<span class="ic">' + ic(icon) + '</span><span><small>' + label + '</small><b>' + value + '</b><em>' + sub + '</em></span>';
  return link
    ? '<button type="button" class="stat ' + kind + '" data-act="card" data-type="' + link[0] + '" data-status="' + link[1] + '" aria-label="' + label + ': ' + value + '. View payouts">' + inner + '</button>'
    : '<div class="stat ' + kind + '">' + inner + '</div>';
}

function pgDashboard() {
  const m = metrics();
  // who needs to be paid: unpaid payouts grouped by recipient + type
  const g = {};
  S.payouts.forEach(p => {
    const k = p.recipientId + ':' + p.type; g[k] = g[k] || { id: p.recipientId, type: p.type, owed: 0, n: 0, paid: 0 };
    if (unpaid(p)) { g[k].owed = r2(g[k].owed + p.amount); g[k].n++; } else g[k].paid = r2(g[k].paid + p.amount);
  });
  const owing = Object.values(g).filter(x => x.owed > 0).sort((a, b) => b.owed - a.owed);
  const rows = owing.slice(0, 8).map(x => {
    const u = user(x.id);
    return '<tr><td><strong>' + esc(u.name) + '</strong></td><td>' + typeChip(x.type) + '</td><td class="num">' + x.n + '</td><td class="num strong">' + money(x.owed) +
      '</td><td class="num">' + money(x.paid) + '</td><td><button class="btn sm ghost" data-act="recip" data-name="' + esc(u.name) + '" data-type="' + x.type + '">View payouts</button></td></tr>';
  }).join('');
  const recent = S.payouts.filter(p => p.status === 'Paid').sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt))).slice(0, 5);
  const total = m.sales || 1, pct = v => (v / total * 100);
  const payable = m.paid + m.outstanding || 1;
  return '<section class="banner"><div><h1>Admin dashboard</h1><p>See what the marketplace has earned, who needs to be paid and which payments are complete. All amounts are in rand (ZAR).</p><button type="button" class="btn" data-act="card" data-type="all" data-status="outstanding">View payments</button></div></section>' +
    '<section class="cards" aria-label="Financial summary">' +
    statCard('Total Sales', money(m.sales), 'Completed orders, incl. delivery', '', 'sales') +
    statCard('Marketplace Revenue', money(m.revenue), (FEE_RATE * 100) + '% fee on item sales', 'green', 'revenue') +
    statCard('Pending Seller Payouts', money(m.sellerOut), m.sellerN + ' payouts not yet paid', 'amber', 'clock', ['Seller', 'outstanding']) +
    statCard('Pending Courier Payments', money(m.courierOut), m.courierN + ' payments not yet paid', 'amber', 'truck', ['Courier', 'outstanding']) +
    statCard('Total Outstanding Payments', money(m.outstanding), m.outN + ' payouts to settle', 'key', 'alert', ['all', 'outstanding']) +
    statCard('Completed Orders', m.completed, 'Orders delivered or collected', 'sky', 'check') +
    '</section>' +
    '<div class="dash-grid"><section class="panel" aria-labelledby="h-owed"><div class="ph-row"><h2 id="h-owed">Who needs to be paid</h2><button class="btn sm ghost" data-act="card" data-type="all" data-status="outstanding">All outstanding payouts</button></div>' +
    (rows ? '<div class="tw"><table class="tbl"><thead><tr><th><span>Recipient</span></th><th><span>Type</span></th><th class="num"><span>Unpaid</span></th><th class="num"><span>Amount owed</span></th><th class="num"><span>Paid so far</span></th><th><span class="nowrap">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (owing.length > 8 ? '<p class="muted" style="margin-top:8px">Showing the 8 largest balances of ' + owing.length + '.</p>' : '')
      : '<div class="empty"><p>Nobody is owed anything right now. All payouts are settled.</p></div>') + '</section>' +
    '<div><section class="panel" aria-labelledby="h-flow"><h2 id="h-flow">Where the sales money goes</h2>' +
    '<div class="bar" role="img" aria-label="Split of total sales"><i style="width:' + pct(m.sellerTotal) + '%;background:var(--brand)"></i><i style="width:' + pct(m.courierTotal) + '%;background:var(--sky)"></i><i style="width:' + pct(m.revenue) + '%;background:var(--gold)"></i></div>' +
    '<ul class="legend"><li><span class="sw" style="background:var(--brand)"></span>Sellers (after fee)<small>' + pct(m.sellerTotal).toFixed(0) + '%</small><b>' + money(m.sellerTotal) + '</b></li>' +
    '<li><span class="sw" style="background:var(--sky)"></span>Couriers (delivery fees)<small>' + pct(m.courierTotal).toFixed(0) + '%</small><b>' + money(m.courierTotal) + '</b></li>' +
    '<li><span class="sw" style="background:var(--gold)"></span>Marketplace revenue<small>' + pct(m.revenue).toFixed(0) + '%</small><b>' + money(m.revenue) + '</b></li></ul>' +
    '<h3 style="margin:14px 0 0;font-size:.98rem">Payout progress</h3><div class="bar" role="img" aria-label="Share of payouts already paid"><i style="width:' + (m.paid / payable * 100) + '%;background:var(--ok)"></i><i style="width:' + (m.outstanding / payable * 100) + '%;background:var(--gold)"></i></div>' +
    '<div class="split"><span><b style="color:var(--ok)">Paid</b> ' + money(m.paid) + ' (' + m.paidN + ')</span><span><b style="color:var(--warn)">Outstanding</b> ' + money(m.outstanding) + ' (' + m.outN + ')</span></div></section>' +
    '<section class="panel" aria-labelledby="h-rec"><div class="ph-row"><h2 id="h-rec">Recently paid</h2><button class="btn sm ghost" data-act="card" data-type="all" data-status="Paid">See all paid</button></div>' +
    (recent.length ? '<ul class="recent">' + recent.map(p => '<li><span><strong>' + esc(user(p.recipientId).name) + '</strong> ' + typeChip(p.type) + '<small>' + esc(p.ref || 'No reference') + ' · ' + fdate(p.paidAt) + '</small></span><b class="nowrap">' + money(p.amount) + '</b></li>').join('') + '</ul>'
      : '<p class="muted">No payments have been marked as paid yet.</p>') + '</section></div></div>' +
    '<section class="panel" aria-labelledby="h-mo"><h2 id="h-mo" style="margin-bottom:12px">Marketplace overview</h2><div class="mo-grid">' +
    [['Registered buyers', m.buyers], ['Registered sellers', m.sellers], ['Registered couriers', m.couriers], ['Active listings', m.listings], ['Pending orders', m.pending], ['Completed orders', m.completed]]
      .map(x => '<div class="mo"><b>' + x[1] + '</b><small>' + x[0] + '</small></div>').join('') + '</div></section>';
}

/* ================= PAYMENTS & PAYOUTS ================= */
const RANK = { Failed: 0, Pending: 1, Processing: 2, Paid: 3 };
const SK = {
  id: p => p.id, recipient: p => user(p.recipientId).name, type: p => p.type, order: p => p.orderId,
  total: p => order(p.orderId).total, fee: p => p.type === 'Seller' ? order(p.orderId).fee : 0,
  delivery: p => p.type === 'Courier' ? order(p.orderId).deliveryFee : 0, owed: p => p.amount, status: p => RANK[p.status], date: p => p.date
};
const SORT_LABEL = { date: 'Date', owed: 'Amount owed', recipient: 'Recipient', status: 'Status', total: 'Order total', fee: 'Marketplace fee', delivery: 'Delivery fee', order: 'Order ID', type: 'Recipient type', id: 'Payout ID' };
const matchStatus = (p, k) => k === 'all' || (k === 'outstanding' ? unpaid(p) : p.status === k);
const opts = (list, cur) => list.map(o => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');

function pgPayments() {
  const f = F.pay;
  const card = (l, st, kind, icon) => { const b = byStatus(st); return statCard(l, money(b.amt), b.n + ' payouts', kind, icon); };
  const out = metrics();
  return '<div class="page-h"><div><h1>Payments &amp; Payouts</h1><p class="muted">Seller and courier payouts are tracked separately. Self-pickup orders never create a courier payout.</p></div></div>' +
    '<section class="cards mini" aria-label="Payout totals">' +
    statCard('Outstanding (not paid)', money(out.outstanding), out.outN + ' payouts', 'amber', 'clock') + card('Processing', 'Processing', 'sky', 'truck') +
    card('Failed', 'Failed', 'red', 'alert') + card('Paid', 'Paid', 'green', 'check') + '</section>' +
    '<div class="chips" id="pchips" role="group" aria-label="Filter by payment status"></div>' +
    '<div class="toolbar tb-pay"><input type="search" data-f="pay.q" value="' + esc(f.q) + '" placeholder="Search payout ID, recipient, order ID or reference" aria-label="Search payouts">' +
    '<select data-f="pay.type" aria-label="Recipient type">' + opts([['all', 'All recipients'], ['Seller', 'Sellers only'], ['Courier', 'Couriers only']], f.type) + '</select>' +
    '<select data-f="pay.sort" aria-label="Sort by">' + opts(Object.keys(SORT_LABEL).map(k => [k, 'Sort: ' + SORT_LABEL[k]]), f.sort) + '</select>' +
    '<button type="button" class="btn ghost dir" id="dirbtn" data-act="dir"></button></div>' +
    '<div id="pout"></div>';
}

function payList() {
  const f = F.pay, q = f.q.trim().toLowerCase();
  const a = S.payouts.filter(p => {
    if (f.type !== 'all' && p.type !== f.type) return false;
    if (!matchStatus(p, f.status)) return false;
    return !q || [p.id, user(p.recipientId).name, p.orderId, p.ref].some(x => String(x || '').toLowerCase().includes(q));
  });
  const key = SK[f.sort] || SK.date, d = f.dir === 'asc' ? 1 : -1;
  return a.sort((x, y) => { const A = key(x), B = key(y); return (d * (typeof A === 'number' ? A - B : String(A).localeCompare(String(B)))) || x.id.localeCompare(y.id); });
}

function drawPay() {
  const f = F.pay, list = payList();
  const chips = [['all', 'All'], ['outstanding', 'Outstanding'], ['Pending', 'Pending'], ['Processing', 'Processing'], ['Paid', 'Paid'], ['Failed', 'Failed']];
  $('#pchips').innerHTML = chips.map(c => '<button type="button" data-act="set" data-k="pay.status" data-v="' + c[0] + '"' + (f.status === c[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + c[1] + '<span>' + S.payouts.filter(p => matchStatus(p, c[0])).length + '</span></button>').join('');
  $('#dirbtn').textContent = f.dir === 'asc' ? '↑ Ascending' : '↓ Descending';
  $('#dirbtn').setAttribute('aria-label', 'Sort direction: ' + (f.dir === 'asc' ? 'ascending' : 'descending') + '. Click to reverse');
  const th = (k, label, num) => '<th' + (num ? ' class="num"' : '') + (f.sort === k ? ' aria-sort="' + (f.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '><button type="button" class="th" data-act="sort" data-k="' + k + '">' + label + '<span class="ar" aria-hidden="true">' + (f.sort === k ? (f.dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
  if (!S.payouts.length) { $('#pout').innerHTML = '<div class="empty"><p>No payouts yet. They appear here once an order is completed and paid by the buyer.</p></div>'; return; }
  if (!list.length) { $('#pout').innerHTML = '<div class="empty"><p>No payouts match these filters.</p><button class="btn ghost" data-act="clear-pay">Clear filters</button></div>'; return; }
  const body = list.map(p => {
    const o = order(p.orderId), u = user(p.recipientId), sel = p.type === 'Seller';
    return '<tr><td class="mono">' + p.id + '</td><td><strong>' + esc(u.name) + '</strong></td><td>' + typeChip(p.type) + '</td><td class="mono">' + o.id + '</td>' +
      '<td class="num">' + money(o.total) + '</td><td class="num">' + (sel ? money(o.fee) : '—') + '</td><td class="num">' + (sel ? '—' : money(o.deliveryFee)) + '</td>' +
      '<td class="num strong">' + money(p.amount) + '</td><td>' + chip(p.status) + (p.ref ? '<small>Ref: ' + esc(p.ref) + '</small>' : '') + '</td><td class="nowrap">' + fdate(p.date) + '</td>' +
      '<td class="acts"><button class="btn sm ghost" data-act="view" data-id="' + p.id + '">Details</button>' +
      (unpaid(p) ? '<button class="btn sm ok" data-act="paid" data-id="' + p.id + '">Mark paid</button>' : '') +
      '<button class="btn sm ghost" data-act="ref" data-id="' + p.id + '">Reference</button><button class="btn sm ghost" data-act="order" data-id="' + o.id + '">Order</button></td></tr>';
  }).join('');
  const shown = sum(list.map(p => p.amount)), shownOut = sum(list.filter(unpaid).map(p => p.amount));
  $('#pout').innerHTML = '<p class="summary-line"><span>Showing <b>' + list.length + '</b> of ' + S.payouts.length + ' payouts</span><span>Amount in view: <b>' + money(shown) + '</b></span><span>Still unpaid: <b>' + money(shownOut) + '</b></span></p>' +
    '<div class="tw"><table class="tbl tbl-pay"><thead><tr>' + th('id', 'Payout ID') + th('recipient', 'Recipient') + th('type', 'Type') + th('order', 'Order ID') + th('total', 'Order Total', 1) + th('fee', 'Marketplace Fee', 1) + th('delivery', 'Delivery Fee', 1) + th('owed', 'Amount Owed', 1) + th('status', 'Status') + th('date', 'Date') + '<th><span>Actions</span></th></tr></thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><td colspan="7">Total amount owed in view</td><td class="num">' + money(shown) + '</td><td colspan="3"></td></tr></tfoot></table></div>';
}

/* ---- payout modals ---- */
function openModal(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
function mHead(t) { return '<div class="mh"><h2 id="dlg-title">' + t + '</h2><button type="button" class="x" data-act="close" aria-label="Close">×</button></div>'; }
const kv = (l, v) => '<div class="kv"><small>' + l + '</small><span>' + v + '</span></div>';
const TRANSITIONS = { Pending: ['Processing', 'Failed'], Processing: ['Pending', 'Failed'], Failed: ['Pending', 'Processing'], Paid: [] };

function calcRows(p) {
  const o = order(p.orderId);
  return p.type === 'Seller'
    ? '<tr><td>Item subtotal (' + o.qty + ' × ' + money(o.unit) + ')</td><td>' + money(o.subtotal) + '</td></tr><tr><td>Marketplace fee (' + (FEE_RATE * 100) + '%)</td><td>− ' + money(o.fee) + '</td></tr><tr class="t"><td>Amount owed to seller</td><td>' + money(p.amount) + '</td></tr>'
    : '<tr><td>Delivery fee paid by buyer</td><td>' + money(o.deliveryFee) + '</td></tr><tr><td>Marketplace cut on delivery</td><td>' + money(0) + '</td></tr><tr class="t"><td>Amount owed to courier</td><td>' + money(p.amount) + '</td></tr>';
}

function openDetails(id) {
  const p = payout(id), o = order(p.orderId), u = user(p.recipientId);
  const tr = TRANSITIONS[p.status].map(t => '<button class="btn ghost" data-act="status" data-id="' + id + '" data-v="' + t + '">' + (t === 'Pending' ? 'Move back to Pending' : 'Mark ' + t) + '</button>').join('');
  openModal(mHead('Payout ' + p.id) + '<div class="mb"><div class="kvs">' +
    kv('Status', chip(p.status)) + kv('Recipient type', typeChip(p.type)) + kv('Recipient', esc(u.name) + '<br><small>' + esc(u.email) + '</small>') + kv('Bank details', bankHtml(window.Auth && Auth.payee(u.email, p.type))) + kv('Order', o.id + ' · ' + fdate(o.date)) +
    kv('Payment reference', p.ref ? esc(p.ref) : 'Not recorded') + kv('Paid on', p.paidAt ? ftime(p.paidAt) : '—') + kv('Order total', money(o.total)) + kv('Fulfilment', esc(o.fulfilment)) + '</div>' +
    '<table class="calc">' + calcRows(p) + '</table><h3>History</h3><ul class="hist">' + p.history.slice().reverse().map(h => '<li><time>' + ftime(h.at) + '</time><span>' + esc(h.text) + '</span></li>').join('') + '</ul></div>' +
    '<div class="mf"><button class="btn ghost" data-act="close">Close</button><button class="btn ghost" data-act="order" data-id="' + o.id + '">View order</button><button class="btn ghost" data-act="ref" data-id="' + id + '">Record reference</button>' + tr +
    (unpaid(p) ? '<button class="btn ok" data-act="paid" data-id="' + id + '">Mark as paid</button>' : '') + '</div>');
}

function openConfirm(id) {
  const p = payout(id), u = user(p.recipientId);
  if (!unpaid(p)) { toast('Already paid. A second payment is blocked.'); return; }
  openModal(mHead('Mark payout as paid?') + '<div class="mb"><div class="notice">Demo only: this updates the sample data in your browser. No money is transferred.</div>' +
    '<div class="kvs">' + kv('Recipient', esc(u.name)) + kv('Type', typeChip(p.type)) + kv('Payout', p.id) + kv('Order', p.orderId) + '</div>' +
    '<small class="muted">Amount to mark as paid</small><div class="big">' + money(p.amount) + '</div>' +
    '<div class="field"><label for="refin">Payment reference (optional)</label><input id="refin" maxlength="60" value="' + esc(p.ref) + '" placeholder="e.g. EFT-20261022-001" autocomplete="off"><p class="err" id="merr" hidden></p></div></div>' +
    '<div class="mf"><button class="btn ghost" data-act="close">Cancel</button><button class="btn ok" data-act="confirm-paid" data-id="' + id + '">Yes, mark as paid</button></div>');
}

function openRef(id) {
  const p = payout(id);
  openModal(mHead('Payment reference') + '<div class="mb"><p class="muted" style="margin-bottom:12px">Record the bank or EFT reference for ' + p.id + ' (' + esc(user(p.recipientId).name) + ', ' + money(p.amount) + '). Each reference can only be used once.</p>' +
    '<div class="field"><label for="refin">Reference</label><input id="refin" maxlength="60" value="' + esc(p.ref) + '" autocomplete="off"><p class="err" id="merr" hidden></p></div></div>' +
    '<div class="mf"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="save-ref" data-id="' + id + '">Save reference</button></div>');
  setTimeout(() => { const i = $('#refin'); if (i) i.focus(); }, 30);
}

function modalErr(msg) { const e = $('#merr'); if (e) { e.textContent = msg; e.hidden = false; } else toast(msg); }
const refTaken = (ref, id) => S.payouts.find(x => x.id !== id && x.ref && x.ref.toLowerCase() === ref.toLowerCase());
const log = (p, text) => p.history.push({ at: new Date().toISOString(), text });

function doPaid(id) {
  const p = payout(id), o = order(p.orderId);
  if (!unpaid(p)) { dlg.close(); toast('Already paid. Duplicate blocked.'); return; }
  if (o.status !== 'Completed' || o.pay !== 'Paid') return modalErr('This order is not completed and paid by the buyer, so it cannot be paid out.');
  if (p.type === 'Courier' && (o.fulfilment !== 'Delivery' || !o.courierId)) return modalErr('Self-pickup orders have no courier payout.');
  if (S.payouts.some(x => x !== p && x.orderId === p.orderId && x.type === p.type && x.status === 'Paid')) return modalErr('A ' + p.type.toLowerCase() + ' payout for this order is already paid.');
  const ref = ($('#refin').value || '').trim();
  if (ref) { const t = refTaken(ref, id); if (t) return modalErr('Reference already used by ' + t.id + '. Enter a different one.'); }
  p.status = 'Paid'; if (ref) p.ref = ref; p.paidAt = new Date().toISOString();
  log(p, 'Marked as paid' + (p.ref ? '. Reference ' + p.ref : ' (no reference recorded)')); save();
  dlg.close(); toast(p.id + ' marked as paid (demo)'); render();
}
function doRef(id) {
  const p = payout(id), ref = ($('#refin').value || '').trim();
  if (!ref) return modalErr('Enter a reference.');
  const t = refTaken(ref, id); if (t) return modalErr('Reference already used by ' + t.id + '. Enter a different one.');
  p.ref = ref; log(p, 'Payment reference recorded: ' + ref); save(); dlg.close(); toast('Reference saved'); render();
}
function doStatus(id, to) {
  const p = payout(id);
  if (!TRANSITIONS[p.status].includes(to)) return;
  p.status = to; log(p, 'Status changed to ' + to); save(); toast(p.id + ' is now ' + to); render(); openDetails(id);
}

/* ================= ORDERS ================= */
function pgOrders() {
  const f = F.ord;
  return '<div class="page-h"><div><h1>Orders</h1><p class="muted">All marketplace orders. Payouts are only created once an order is completed and paid.</p></div></div>' +
    '<div class="toolbar tb-3"><input type="search" data-f="ord.q" value="' + esc(f.q) + '" placeholder="Search order ID, buyer, seller, courier or item" aria-label="Search orders">' +
    '<select data-f="ord.status" aria-label="Order status">' + opts([['all', 'All statuses'], ['Pending', 'Pending'], ['Confirmed', 'Confirmed'], ['Out for delivery', 'Out for delivery'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']], f.status) + '</select>' +
    '<select data-f="ord.pay" aria-label="Payment status">' + opts([['all', 'All payments'], ['Paid', 'Paid by buyer'], ['Unpaid', 'Unpaid'], ['Refunded', 'Refunded']], f.pay) + '</select>' +
    '<select data-f="ord.ful" aria-label="Fulfilment method">' + opts([['all', 'Delivery + pickup'], ['Delivery', 'Delivery'], ['Self-pickup', 'Self-pickup']], f.ful) + '</select></div><div id="oout"></div>';
}
function drawOrd() {
  const f = F.ord, q = f.q.trim().toLowerCase();
  const list = S.orders.filter(o => (f.status === 'all' || o.status === f.status) && (f.pay === 'all' || o.pay === f.pay) && (f.ful === 'all' || o.fulfilment === f.ful) &&
    (!q || [o.id, user(o.buyerId).name, user(o.sellerId).name, o.courierId ? user(o.courierId).name : '', o.item].some(x => x.toLowerCase().includes(q)))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!S.orders.length) { $('#oout').innerHTML = '<div class="empty"><p>No orders yet.</p></div>'; return; }
  if (!list.length) { $('#oout').innerHTML = '<div class="empty"><p>No orders match these filters.</p><button class="btn ghost" data-act="clear-ord">Clear filters</button></div>'; return; }
  $('#oout').innerHTML = '<p class="summary-line"><span>Showing <b>' + list.length + '</b> of ' + S.orders.length + ' orders</span></p><div class="tw"><table class="tbl tbl-ord"><thead><tr>' +
    ['Order ID', 'Buyer', 'Seller', 'Courier'].map(h => '<th><span>' + h + '</span></th>').join('') + '<th class="num"><span>Order Total</span></th>' + ['Order Status', 'Payment', 'Fulfilment', 'Date', 'Actions'].map(h => '<th><span>' + h + '</span></th>').join('') + '</tr></thead><tbody>' +
    list.map(o => '<tr><td class="mono">' + o.id + '</td><td>' + esc(user(o.buyerId).name) + '</td><td>' + esc(user(o.sellerId).name) + '</td><td>' + (o.courierId ? esc(user(o.courierId).name) : '—') + '</td><td class="num strong">' + money(o.total) + '</td><td>' + chip(o.status) + '</td><td>' + chip(o.pay) + '</td><td>' + esc(o.fulfilment) + '</td><td class="nowrap">' + fdate(o.date) + '</td><td class="acts"><button class="btn sm ghost" data-act="order" data-id="' + o.id + '">View</button></td></tr>').join('') + '</tbody></table></div>';
}
function openOrder(id) {
  const o = order(id), rel = S.payouts.filter(p => p.orderId === id);
  openModal(mHead('Order ' + o.id) + '<div class="mb"><div class="kvs">' + kv('Order status', chip(o.status)) + kv('Buyer payment', chip(o.pay)) +
    kv('Buyer', esc(user(o.buyerId).name)) + kv('Seller', esc(user(o.sellerId).name)) + kv('Courier', o.courierId ? esc(user(o.courierId).name) : (o.fulfilment === 'Self-pickup' ? 'None (self-pickup)' : 'Not assigned yet')) + kv('Fulfilment', esc(o.fulfilment)) +
    kv('Item', o.qty + ' × ' + esc(o.item)) + kv('Date', fdate(o.date)) + '</div><table class="calc"><tr><td>Item subtotal</td><td>' + money(o.subtotal) + '</td></tr><tr><td>Delivery fee</td><td>' + money(o.deliveryFee) + '</td></tr><tr class="t"><td>Order total</td><td>' + money(o.total) + '</td></tr></table>' +
    '<table class="calc"><tr><td>Marketplace fee (' + (FEE_RATE * 100) + '% of items)</td><td>' + money(o.fee) + '</td></tr><tr><td>Seller share</td><td>' + money(o.subtotal - o.fee) + '</td></tr><tr><td>Courier share</td><td>' + money(o.fulfilment === 'Delivery' ? o.deliveryFee : 0) + '</td></tr></table>' +
    '<h3>Related payouts</h3>' + (rel.length ? rel.map(p => '<div class="rel"><span><strong>' + p.id + '</strong> ' + typeChip(p.type) + '<small>' + esc(user(p.recipientId).name) + ' · ' + money(p.amount) + '</small></span>' + chip(p.status) + '</div>').join('') : '<p class="muted">No payouts yet. They are created when the order is completed and paid.</p>') + '</div>' +
    '<div class="mf"><button class="btn ghost" data-act="close">Close</button>' + (rel.length ? '<button class="btn" data-act="topay" data-q="' + o.id + '">View in Payments</button>' : '') + '</div>');
}

/* ================= LISTINGS ================= */
const lstState = l => l.status === 'Inactive' ? 'Inactive' : l.stock <= 0 ? 'Out of stock' : 'Active';
function pgListings() {
  const f = F.lst;
  return '<div class="page-h"><div><h1>Listings</h1><p class="muted">Items students have put up for sale.</p></div></div><div class="toolbar tb-2"><input type="search" data-f="lst.q" value="' + esc(f.q) + '" placeholder="Search listing, seller, category or campus" aria-label="Search listings">' +
    '<select data-f="lst.status" aria-label="Listing status">' + opts([['all', 'All statuses'], ['Active', 'Active'], ['Out of stock', 'Out of stock'], ['Inactive', 'Inactive']], f.status) + '</select></div><div id="lout"></div>';
}
function drawLst() {
  const f = F.lst, q = f.q.trim().toLowerCase();
  const list = S.listings.filter(l => (f.status === 'all' || lstState(l) === f.status) && (!q || [l.name, user(l.sellerId).name, l.category, l.campus].some(x => x.toLowerCase().includes(q))));
  if (!list.length) { $('#lout').innerHTML = '<div class="empty"><p>' + (S.listings.length ? 'No listings match these filters.' : 'No listings yet.') + '</p></div>'; return; }
  $('#lout').innerHTML = '<p class="summary-line"><span>Showing <b>' + list.length + '</b> of ' + S.listings.length + ' listings</span></p><div class="tw"><table class="tbl tbl-lst"><thead><tr><th><span>Listing</span></th><th><span>Seller</span></th><th><span>Category</span></th><th><span>Campus</span></th><th class="num"><span>Price</span></th><th class="num"><span>Stock</span></th><th><span>Status</span></th><th><span>Actions</span></th></tr></thead><tbody>' +
    list.map(l => '<tr><td><strong>' + esc(l.name) + '</strong><small>' + l.id + ' · listed ' + fdate(l.created) + '</small></td><td>' + esc(user(l.sellerId).name) + '</td><td>' + esc(l.category) + '</td><td>' + esc(l.campus) + '</td><td class="num">' + money(l.price) + '</td><td class="num">' + l.stock + '</td><td>' + chip(lstState(l)) + '</td><td class="acts"><button class="btn sm ghost" data-act="toggle-listing" data-id="' + l.id + '">' + (l.status === 'Inactive' ? 'Activate' : 'Deactivate') + '</button></td></tr>').join('') + '</tbody></table></div>';
}

/* ================= USERS ================= */
const bankHtml = b => b && b.bank ? esc(b.bank) + '<br>' + esc(b.holder) + '<br>Acc ' + esc(b.acc) + ' · Branch ' + esc(b.branch) : 'Not on file';
function payeePanel() {
  const A = window.Auth ? Auth.payees() : [];
  return '<section class="panel" style="margin-top:20px" aria-labelledby="h-bank"><div class="ph-row"><h2 id="h-bank">Seller and courier bank details</h2></div><p class="muted">Collected when a seller or courier signs up, and updated when they edit their profile. Use these to make payouts.</p>' +
    (A.length ? '<div class="tw"><table class="tbl"><thead><tr><th><span>Name</span></th><th><span>Type</span></th><th><span>Phone</span></th><th><span>Campus</span></th><th><span>Bank</span></th><th><span>Account holder</span></th><th><span>Account number</span></th><th><span>Branch code</span></th></tr></thead><tbody>' +
      A.map(x => '<tr><td><strong>' + esc(x.name) + '</strong><small>' + esc(x.email) + (x.studentNo ? ' · ' + esc(x.studentNo) : '') + '</small></td><td>' + typeChip(x.type) + '</td><td class="nowrap">' + esc(x.phone) + '</td><td>' + esc(x.campus) + '</td><td>' + esc(x.bank) + '</td><td>' + esc(x.holder) + '</td><td class="mono">' + esc(x.acc) + '</td><td class="mono">' + esc(x.branch) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty"><p>No sellers or couriers have signed up yet.</p></div>') + '</section>';
}
function pgUsers() {
  const f = F.usr;
  return '<div class="page-h"><div><h1>Users</h1><p class="muted">Registered students. One person can be a buyer, seller and courier.</p></div></div><div class="toolbar tb-2"><input type="search" data-f="usr.q" value="' + esc(f.q) + '" placeholder="Search name, email or campus" aria-label="Search users">' +
    '<select data-f="usr.role" aria-label="Role">' + opts([['all', 'All roles'], ['B', 'Buyers'], ['S', 'Sellers'], ['C', 'Couriers']], f.role) + '</select></div><div id="uout"></div>' + payeePanel();
}
function drawUsr() {
  const f = F.usr, q = f.q.trim().toLowerCase(), RN = { B: 'Buyer', S: 'Seller', C: 'Courier' };
  const list = S.users.filter(u => (f.role === 'all' || u.roles.includes(f.role)) && (!q || [u.name, u.email, u.campus].some(x => x.toLowerCase().includes(q))));
  if (!list.length) { $('#uout').innerHTML = '<div class="empty"><p>' + (S.users.length ? 'No users match these filters.' : 'No users yet.') + '</p></div>'; return; }
  $('#uout').innerHTML = '<p class="summary-line"><span>Showing <b>' + list.length + '</b> of ' + S.users.length + ' users</span></p><div class="tw"><table class="tbl tbl-usr"><thead><tr><th><span>Name</span></th><th><span>Roles</span></th><th><span>Campus</span></th><th><span>Joined</span></th><th class="num"><span>Currently owed</span></th><th><span>Status</span></th><th><span>Actions</span></th></tr></thead><tbody>' +
    list.map(u => '<tr><td><strong>' + esc(u.name) + '</strong><small>' + esc(u.email) + '</small></td><td>' + u.roles.map(r => '<span class="chip role">' + RN[r] + '</span>').join(' ') + '</td><td>' + esc(u.campus) + '</td><td class="nowrap">' + fdate(u.joined) + '</td><td class="num">' + money(sum(S.payouts.filter(p => p.recipientId === u.id && unpaid(p)).map(p => p.amount))) + '</td><td>' + chip(u.status) + '</td><td class="acts"><button class="btn sm ghost" data-act="toggle-user" data-id="' + u.id + '">' + (u.status === 'Suspended' ? 'Reinstate' : 'Suspend') + '</button></td></tr>').join('') + '</tbody></table></div>';
}

/* ================= EVENTS ================= */
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

document.addEventListener('input', e => {
  const el = e.target.closest('[data-f]'); if (!el) return;
  const [a, b] = el.dataset.f.split('.'); F[a][b] = el.value; drawCurrent();
});

dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const d = b.dataset, id = d.id;
  switch (d.act) {
    case 'signout': if (window.Auth) Auth.logout('admin'); location.href = '../Index.html#/signin-admin'; break;
    case 'close': dlg.close(); break;
    case 'view': openDetails(id); break;
    case 'paid': openConfirm(id); break;
    case 'confirm-paid': doPaid(id); break;
    case 'ref': openRef(id); break;
    case 'save-ref': doRef(id); break;
    case 'status': doStatus(id, d.v); break;
    case 'order': openOrder(id); break;
    case 'topay': dlg.close(); Object.assign(F.pay, { q: d.q, type: 'all', status: 'all' }); go('payments'); break;
    case 'card': Object.assign(F.pay, { q: '', type: d.type, status: d.status }); go('payments'); break;
    case 'recip': Object.assign(F.pay, { q: d.name, type: d.type, status: 'outstanding' }); go('payments'); break;
    case 'set': { const [a, k] = d.k.split('.'); F[a][k] = d.v; drawPay(); break; }
    case 'sort': if (F.pay.sort === d.k) F.pay.dir = F.pay.dir === 'asc' ? 'desc' : 'asc'; else { F.pay.sort = d.k; F.pay.dir = ['recipient', 'id', 'order', 'type'].includes(d.k) ? 'asc' : 'desc'; } render(); break;
    case 'dir': F.pay.dir = F.pay.dir === 'asc' ? 'desc' : 'asc'; drawPay(); break;
    case 'clear-pay': Object.assign(F.pay, { q: '', type: 'all', status: 'all' }); render(); break;
    case 'clear-ord': Object.assign(F.ord, { q: '', status: 'all', pay: 'all', ful: 'all' }); render(); break;
    case 'toggle-listing': { const l = S.listings.find(x => x.id === id); l.status = l.status === 'Inactive' ? 'Active' : 'Inactive'; save(); toast(l.name + ' is now ' + l.status.toLowerCase()); render(); break; }
    case 'toggle-user': { const u = S.users.find(x => x.id === id); u.status = u.status === 'Suspended' ? 'Active' : 'Suspended'; save(); toast(u.name + ' is now ' + u.status.toLowerCase()); render(); break; }
  }
});

window.MVMAdmin = { setData(d) { S = { v: 1, users: d.users || [], listings: d.listings || [], orders: d.orders || [], payouts: d.payouts || [] }; ensurePayouts(S); save(); render(); } };
window.addEventListener('hashchange', route);
route();
})();