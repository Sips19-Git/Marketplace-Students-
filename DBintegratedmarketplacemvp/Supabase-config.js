/* MyVossieMarketplace - supabase-config.js
   FILE 1 of 2. The ONLY place project settings live for the browser code.
   Everything in this file is PUBLIC (it ships to every visitor's browser), so it may only hold:
     - the Supabase project URL
     - the PUBLISHABLE key (new projects: "sb_publishable_...", older projects: the "anon" key)
   The publishable key is safe in the browser BECAUSE your row level security (RLS) policies in DB_Full_Schema.txt
   decide what each person may read. It cannot bypass RLS.

   NEVER put any of these in this file, in the HTML, or in any .js that reaches the browser:
     - the SECRET key ("sb_secret_...") or the legacy "service_role" key
     - the database password / connection string
     - the JWT secret
   Those belong ONLY in the FastAPI server's environment variables (.env, not committed to git).

   Where to find the values: Supabase Dashboard > Project Settings > API Keys (and "Data API" for the URL).
   Load order in every page:  supabase-js CDN -> supabase-config.js -> supabase-client.js -> auth.js -> page script */
window.MVM_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://ihpvzuyghewrruojzudq.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_awuSIpWToWE7VH8UoXA47A_a9m3QVNO',

  // Base URL of the FastAPI backend. Replaces CONFIG.API_BASE in buyer.js / seller.js / courier.js / admin.js.
  // Local dev: 'http://localhost:8000/api'.  Production: 'https://api.yourdomain.co.za/api'
  API_BASE: 'http://localhost:8000/api',

  // Must match the bucket created in BLOCK 10 of the schema
  PRODUCT_BUCKET: 'product-images'
});