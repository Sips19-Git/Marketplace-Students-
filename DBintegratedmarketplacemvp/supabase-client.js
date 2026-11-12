/* MyVossieMarketplace - supabase-client.js
   FILE 2 of 2. Creates the ONE Supabase client for the whole site and wraps the calls the pages need.
   Needs, loaded before it in the page:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
     <script src="supabase-config.js"></script>
     <script src="supabase-client.js"></script>
   Exposes:  window.sb (the raw client)  and  window.MVM (the helpers below).

   WHO DOES WHAT (this matches the schema):
   - The BROWSER uses this file for: sign up / sign in / sign out, reading data that RLS allows, uploading product photos,
     and Realtime refreshes.
   - The FASTAPI BACKEND does every WRITE that touches money, stock, status or roles: place order, accept/reject/ready,
     claim job, OTP checks, payout requests, admin actions. In the schema the api_* functions and the trigger helpers
     are granted to service_role ONLY, so the browser cannot (and must not) call them.
   - The browser proves who it is to FastAPI by sending its Supabase access token: MVM.api() does that automatically. */
(function () {
  'use strict';
  const C = window.MVM_CONFIG;
  if (!C) throw new Error('supabase-config.js must load before supabase-client.js');
  if (!window.supabase || !window.supabase.createClient) throw new Error('Load the supabase-js script before supabase-client.js');
  if (/YOUR-PROJECT-REF|REPLACE_ME/.test(C.SUPABASE_URL + C.SUPABASE_PUBLISHABLE_KEY)) console.warn('[MVM] Fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in supabase-config.js');

  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // Turn Supabase's { data, error } into "return data or throw"
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  /* ---------------- AUTH ---------------- */
  // meta keys MUST match what handle_new_user() reads in the schema:
  //   full_name, student_number, phone, campus (campus NAME e.g. 'Potchefstroom'), default_address
  // Everyone starts as a buyer. Becoming a seller/courier is a backend call (see api_register_role).
  async function signUp(email, password, meta = {}) {
    return unwrap(await sb.auth.signUp({
      email: email.trim().toLowerCase(), password,
      options: { data: {
        full_name: meta.full_name || '', student_number: meta.student_number || '',
        phone: meta.phone || '', campus: meta.campus || '', default_address: meta.default_address || ''
      } }
    }));
  }
  const signIn  = async (email, password) => unwrap(await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
  const signOut = async () => { const { error } = await sb.auth.signOut(); if (error) throw error; };
  const getSession = async () => unwrap(await sb.auth.getSession()).session;
  const getUser = async () => (await getSession())?.user || null;
  const accessToken = async () => (await getSession())?.access_token || null;
  const onAuthChange = cb => sb.auth.onAuthStateChange((event, session) => cb(event, session));

  // Roles come from the user_roles table (never from user metadata). Returns e.g. ['buyer','seller']
  async function myRoles() {
    const u = await getUser(); if (!u) return [];
    return unwrap(await sb.from('user_roles').select('role').eq('user_id', u.id)).map(r => r.role);
  }
  const hasRole = async role => (await myRoles()).includes(role);

  /* ---------------- REFERENCE DATA (public read) ---------------- */
  const campuses       = async () => unwrap(await sb.from('campuses').select('id,name').eq('is_active', true).order('name'));
  const banks          = async () => unwrap(await sb.from('banks').select('id,name').order('name'));
  const categories     = async () => unwrap(await sb.from('product_categories').select('id,name').order('sort_order'));
  const paymentMethods = async () => unwrap(await sb.from('payment_methods').select('code,label').eq('is_active', true).order('sort_order'));
  const settings       = async () => unwrap(await sb.from('platform_settings').select('*').single()); // signed-in users only

  /* ---------------- READS THAT RLS ALLOWS ---------------- */
  // Public marketplace feed (view hides seller details). opts: { campus, category, q, limit }
  async function marketplace({ campus, category, q, limit = 60 } = {}) {
    let qb = sb.from('marketplace_products').select('*').order('created_at', { ascending: false }).limit(limit);
    if (campus) qb = qb.eq('campus', campus);
    if (category) qb = qb.eq('category', category);
    if (q) qb = qb.ilike('name', '%' + q.replace(/[%,]/g, '') + '%');
    return unwrap(await qb);
  }
  // My own orders. RLS decides who sees what: a buyer gets theirs, a seller theirs, a courier theirs, an admin all.
  const myOrders = async () => unwrap(await sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }));
  const orderEvents = async orderId => unwrap(await sb.from('order_events').select('*').eq('order_id', orderId).order('created_at'));
  // Courier: open delivery jobs on my campus (view already hides the buyer's phone)
  const availableJobs = async () => unwrap(await sb.from('courier_available_jobs').select('*').order('released_at', { ascending: false }));
  // Seller/courier earnings summary (one row per role I hold)
  const myBalance = async () => unwrap(await sb.from('v_recipient_balances').select('*'));
  const myPayouts = async () => unwrap(await sb.from('payouts').select('*').order('created_at', { ascending: false }));
  const myNotifications = async () => unwrap(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50));
  const adminDashboard = async () => unwrap(await sb.from('v_admin_dashboard').select('*').single()); // admins only (RLS)
  const myProfile = async () => { const u = await getUser(); return u ? unwrap(await sb.from('profiles').select('*').eq('id', u.id).single()) : null; };

  /* ---------------- PRODUCT PHOTOS (Storage) ---------------- */
  // Schema rule: path MUST be {sellerUserId}/{productId}/{file}, jpeg/png/webp, max 5 MB, seller role only.
  // After uploading, the backend (or the seller's allowed insert) records the path in product_images.
  async function uploadProductImage(productId, file) {
    const u = await getUser(); if (!u) throw new Error('Sign in first');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP photo');
    if (file.size > 5 * 1024 * 1024) throw new Error('Photo must be 5 MB or smaller');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${u.id}/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    unwrap(await sb.storage.from(C.PRODUCT_BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
    return path; // store this in product_images.storage_path
  }
  // product_images.storage_path / marketplace_products.images[] -> a displayable URL (bucket is public for reads)
  const imageUrl = path => path ? sb.storage.from(C.PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl : '';
  const removeProductImage = async path => unwrap(await sb.storage.from(C.PRODUCT_BUCKET).remove([path]));

  /* ---------------- REALTIME (RLS still applies, so people only get their own rows) ---------------- */
  // Replaces the setInterval polling in courier.js. Returns a function that unsubscribes.
  function subscribe(table, onChange, name) {
    const ch = sb.channel(name || 'mvm-' + table + '-' + Math.random().toString(36).slice(2, 7))
      .on('postgres_changes', { event: '*', schema: 'public', table }, payload => onChange(payload))
      .subscribe();
    return () => sb.removeChannel(ch);
  }
  const watchOrders = cb => subscribe('orders', cb);
  const watchNotifications = cb => subscribe('notifications', cb);

  /* ---------------- CALLING THE FASTAPI BACKEND ---------------- */
  // Sends the signed-in user's Supabase access token as "Authorization: Bearer <token>".
  // FastAPI must VERIFY that token and use the user id inside it. It must never trust a user id sent in the body.
  // FastAPI errors look like { "detail": "..." } and are thrown here as Error(message) with .status set.
  async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const token = await accessToken();
    const res = await fetch(C.API_BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : (j.message || JSON.stringify(j.detail || j)); } catch {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  window.sb = sb;
  window.MVM = {
    config: C, sb, api,
    auth: { signUp, signIn, signOut, getSession, getUser, accessToken, onAuthChange, myRoles, hasRole },
    ref: { campuses, banks, categories, paymentMethods, settings },
    read: { marketplace, myOrders, orderEvents, availableJobs, myBalance, myPayouts, myNotifications, adminDashboard, myProfile },
    img: { upload: uploadProductImage, url: imageUrl, remove: removeProductImage },
    live: { watchOrders, watchNotifications, subscribe }
  };
})();

/* =====================================================================================================
   HOW TO USE (for the team)

   1) Add to the <head>/bottom of each page, in this order:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
        <script src="supabase-config.js"></script>
        <script src="supabase-client.js"></script>
        <script src="auth.js"></script>   <!-- to be replaced by MVM.auth, see below -->
        <script src="buyer.js"></script>

   2) Sign up / sign in (replaces Auth.register / Auth.login in auth.js):
        await MVM.auth.signUp('a@b.co.za', 'password123', { full_name:'Thandi M', student_number:'12345', phone:'0821234567', campus:'Potchefstroom' });
        await MVM.auth.signIn('a@b.co.za', 'password123');
        const roles = await MVM.auth.myRoles();         // ['buyer'] or ['buyer','seller','admin'] ...
        if (roles.includes('admin')) location.href = 'admin/admin.html';

   3) Read data directly (RLS filters it per user):
        const products = await MVM.read.marketplace({ campus:'Potchefstroom', category:'Books', q:'calculus' });
        const img = MVM.img.url(products[0].images[0]);
        const orders = await MVM.read.myOrders();
        const jobs = await MVM.read.availableJobs();    // courier page

   4) Writes go to FastAPI (the browser never writes orders, payouts or roles itself):
        const res = await MVM.api('/orders', { method:'POST', body:{ items:[{ product_id, quantity:2 }], fulfilment:'delivery', delivery_address:'...', payment_method:'card' } });
        await MVM.api('/orders/' + id + '/action', { method:'POST', body:{ action:'accept' } });
        await MVM.api('/payouts/request', { method:'POST' });
      (The endpoint names above are examples. The backend team defines the real ones and wraps the api_* SQL functions.)

   5) Live refresh (replaces setInterval polling):
        const stop = MVM.live.watchOrders(() => refresh());   // call stop() when leaving the page

   6) Upload a listing photo (seller):
        const path = await MVM.img.upload(productId, fileInput.files[0]);
        // then save `path` in product_images (sort_order 0..3, max 4 photos)

   ----- FOR THE FASTAPI SIDE (not built here, just the rules) -----
   - Keep the SECRET key and DB credentials in server env vars only, e.g.
        SUPABASE_URL=...   SUPABASE_SECRET_KEY=...   (never commit, never send to the browser)
   - Verify every request's Bearer token (supabase-py: client.auth.get_user(token), or verify the JWT with the project's JWKS),
     then take user_id from the VERIFIED token.
   - Call the SQL functions with the secret/service_role client and pass that verified id as p_actor / p_user / p_courier /
     p_buyer, for example:  supabase.rpc('api_order_action', {'p_order': id, 'p_actor': user_id, 'p_action': 'accept'})
     Never accept the actor's id from the request body: that would let anyone act as anyone.
   - Functions the backend uses: api_place_order, api_order_action, api_register_role, api_request_payout, api_set_payout_status,
     api_set_user_status, api_set_listing_status, api_confirm_payment, api_available_jobs, api_cancel_stale_orders
     (plus claim_delivery_job, verify_order_otp, reissue_order_otp).
   - Admin-only endpoints must also confirm the caller has the 'admin' role (public.actor_role / user_roles) before running.
   - Enable CORS on FastAPI only for your site's origin.
   ===================================================================================================== */