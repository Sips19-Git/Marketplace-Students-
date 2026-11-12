# MyVossie Marketplace

MyVossie Marketplace is a campus-marketplace MVP with browser interfaces for buyers, sellers, and couriers, plus a FastAPI backend. The prototype includes product browsing and listing APIs, JWT-based test authentication, and order handover flows using one-time codes.

## Project layout

- `main.py` — primary FastAPI app, with health, test-token, and product endpoints.
- `admin.html`, `admin.css` — admin interface files at the repository root.
- `DBintegratedmarketplacemvp/` — buyer, seller, and courier pages and assets. This folder also contains an alternate FastAPI app with order/OTP demo endpoints.
- `requirements.txt` — Python dependencies for either backend.

The two `main.py` files are separate backend implementations. Run the root app for the primary API described below; the nested app is an additional prototype and uses its own working-directory database.

## Requirements

- Python 3.10 or newer
- A modern browser

## Run the primary API

From the repository root, create and activate a virtual environment, then install the dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Set a unique JWT signing key in the same PowerShell session before starting the API:

```powershell
$env:JWT_SECRET = python -c "import secrets; print(secrets.token_urlsafe(32))"
uvicorn main:app --reload
```

The API is available at `http://127.0.0.1:8000`. Interactive endpoint documentation is at `http://127.0.0.1:8000/docs`; the health check is `http://127.0.0.1:8000/api/health`.

The app creates `marketplace.db` and `static/uploads/` as needed. These are local runtime data and are intentionally excluded from Git.

## Run the browser app

In a second terminal, from the repository root, serve the frontend directory:

```powershell
python -m http.server 5500 --directory DBintegratedmarketplacemvp
```

Open `http://127.0.0.1:5500/Index.html`. The frontend and API are separate prototype components; some flows may require further backend integration and configuration before they work end to end.

## Configuration and security

- Set `JWT_SECRET` to a strong, private value for every backend environment. Never commit secrets or `.env` files.
- `DBintegratedmarketplacemvp/Supabase-config.js` contains browser-side Supabase project settings. Browser publishable keys are not server secrets; protect data with appropriate Supabase Row Level Security policies, and never put a Supabase secret/service-role key in frontend code.
- The test-token endpoint is for development only. Do not expose it as production authentication.
- Configure CORS for trusted origins before deploying the API.

## License

No license is currently specified.
