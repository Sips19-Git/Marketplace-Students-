/* MyVossieMarketplace - shared accounts for buyer, seller and courier (prototype).
   Everything is stored in localStorage on this device. Each function here maps to one backend call later
   (sign up, sign in, update profile, list payees). In production never keep passwords or bank details in the browser. */
(function () {
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const del = k => { try { localStorage.removeItem(k); } catch {} };
  const norm = e => String(e || '').trim().toLowerCase();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + Math.random()).slice(0, 12);

  // role -> [account list key, signed-in email key, key the dashboards read their profile from]
  const KEY = { buyer: ['cm_users', 'cm_session', 'cm_profile'], seller: ['cm_sellers', 'cm_seller_session', 'cm_seller_profile'], courier: ['cm_couriers', 'cm_courier_session', 'cm_courier'], admin: ['', 'cm_admin_session', ''] };
  // Admin accounts cannot be created from the site. Edit this block (or generate a new hash with `await Auth.hashFor('new password')` in the console).
  // Prototype only: this check runs in the browser, so anyone who can edit the page can bypass it. Move it to a server before launch.
  const ADMIN = { email: 'admin@myvossie.co.za', salt: 'mvm-admin-v1', hashes: ['7fabf2ded1c3b3f6aad56429193782c17a66065b6dba1406a3943d6b6368644a', 'x1170720916'] };
  // fields a person may change after sign-up (email is the sign-in id, so it is fixed)
  const FIELDS = {
    buyer: ['name', 'studentNo', 'phone', 'campus', 'addr', 'notifyOrders', 'notifyNews'],
    seller: ['name', 'studentNo', 'phone', 'campus', 'products', 'days', 'bank', 'holder', 'acc', 'branch'],
    courier: ['name', 'studentNo', 'phone', 'campus', 'vehicle', 'availability', 'bank', 'holder', 'acc', 'branch']
  };

  async function digest(pw, salt) {
    const s = salt + ':' + pw;
    if (window.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + h; // fallback when SubtleCrypto is unavailable
  }

  const list = role => get(KEY[role][0], []);
  const find = (role, email) => list(role).find(u => u.email === norm(email));
  const current = role => {
    if (role === 'admin') return get(KEY.admin[1], null) === ADMIN.email ? { name: 'Admin', email: ADMIN.email } : null;
    const e = get(KEY[role][1], null); return e ? find(role, e) || null : null; };

  // copy an account into the key the page for that role already reads (cm_profile, cm_seller_profile, cm_courier)
  function mirror(role, u) {
    if (role === 'buyer') set(KEY.buyer[2], { name: u.name, studentNo: u.studentNo, email: u.email, phone: u.phone, campus: u.campus, addr: u.addr, notifyOrders: u.notifyOrders, notifyNews: u.notifyNews });
    if (role === 'seller') set(KEY.seller[2], { name: u.name, studentNo: u.studentNo, email: u.email, phone: u.phone, campus: u.campus, bank: u.bank, holder: u.holder, acc: u.acc, branch: u.branch });
    if (role === 'courier') set(KEY.courier[2], { id: u.id, name: u.name, email: u.email, phone: u.phone, studentNo: u.studentNo, campus: u.campus, vehicle: u.vehicle, availability: u.availability, bank: u.bank, holder: u.holder, acc: u.acc, branch: u.branch, status: 'approved' });
  }
  function start(role, u) { set(KEY[role][1], u.email); mirror(role, u); }

  async function register(role, data, password) {
    if (find(role, data.email)) return { error: 'An account with this email already exists. Sign in instead.' };
    const salt = uid(), rec = { id: uid(), ...data, email: norm(data.email), salt, hash: await digest(password, salt), createdAt: Date.now() };
    const L = list(role); L.push(rec);
    if (!set(KEY[role][0], L)) return { error: 'This device has no storage space left. Free some space and try again.' };
    start(role, rec); return { user: rec };
  }
  async function login(role, email, password) {
    if (role === 'admin') {
      const lock = get('cm_admin_lock', { n: 0, until: 0 });
      if (Date.now() < lock.until) return { error: 'Too many failed attempts. Try again in ' + Math.ceil((lock.until - Date.now()) / 60000) + ' minute(s).' };
      if (norm(email) === ADMIN.email && ADMIN.hashes.includes(await digest(password, ADMIN.salt))) { set('cm_admin_lock', { n: 0, until: 0 }); set(KEY.admin[1], ADMIN.email); return { user: { name: 'Admin', email: ADMIN.email } }; }
      lock.n++; if (lock.n >= 5) { lock.until = Date.now() + 5 * 60000; lock.n = 0; } set('cm_admin_lock', lock);
      return { error: 'Email or password is incorrect.' };
    }
    const u = find(role, email);
    if (!u || u.hash !== await digest(password, u.salt)) return { error: 'Email or password is incorrect.' };
    start(role, u); return { user: u };
  }
  function logout(role) { del(KEY[role][1]); if (KEY[role][2]) del(KEY[role][2]); }
  function sync(role) { const u = current(role); if (u) mirror(role, u); }
  function update(role, patch) {
    const email = get(KEY[role][1], null), L = list(role), i = L.findIndex(u => u.email === email);
    if (i < 0) { if (role === 'admin') return null; const k = KEY[role][2], cur = get(k, {}); FIELDS[role].forEach(f => { if (f in patch) cur[f] = patch[f]; }); set(k, cur); return cur; } // not signed in: still save the details for this page
    FIELDS[role].forEach(k => { if (k in patch) L[i][k] = patch[k]; });
    set(KEY[role][0], L); mirror(role, L[i]); return L[i];
  }

  // for the admin dashboard: every seller and courier with their payout details
  const payees = () => [...list('seller').map(u => ({ ...u, type: 'Seller' })), ...list('courier').map(u => ({ ...u, type: 'Courier' }))]
    .map(({ salt, hash, ...rest }) => rest).sort((a, b) => b.createdAt - a.createdAt);
  const payee = (email, type) => { const u = find(String(type).toLowerCase(), email); if (!u) return null; const { salt, hash, ...rest } = u; return rest; };

  window.Auth = { hashFor: pw => digest(pw, ADMIN.salt), register, login, logout, current, update, sync, payees, payee };

  // The seller and courier pages open normally. If someone is signed in, their saved details are loaded into the page.
  const cl = document.body && document.body.classList, role = cl ? (cl.contains('seller') ? 'seller' : cl.contains('courier') ? 'courier' : '') : '';
  if (role && current(role)) sync(role);
})();