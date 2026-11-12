import os
import sqlite3
import hashlib
import hmac
import secrets
import jwt
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Security, Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Security, Depends, status, File, UploadFile, Form
from fastapi.staticfiles import StaticFiles
import shutil


# 1. APP & CORS CONFIGURATION

app = FastAPI(
    title="MyVossie Marketplace - Security & OTP Engine",
    version="1.0.0",
    description="Auth, RBAC, and Cryptographic Handover (OTP) API"
)

# Create an uploads folder if it doesn't exist
os.makedirs("static/uploads", exist_ok=True)
# Mount the static folder so the frontend can display the images
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("JWT_SECRET", "super_secret_hackjam_jwt_key_2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
DB_PATH = "marketplace.db"

security_scheme = HTTPBearer()


# 2. BUILT-IN DATABASE INITIALIZATION (SQLite)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Users Table (Multi-role support)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        campus TEXT DEFAULT 'Potchefstroom',
        roles TEXT DEFAULT 'buyer'
    )
    """)

    # Products Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER NOT NULL,
        category TEXT NOT NULL,
        campus TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        created_at TEXT NOT NULL
    )
    """)

    # Orders Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL,
        seller_id INTEGER NOT NULL,
        courier_id INTEGER,
        fulfilment TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """
                   )

    # Mandatory OTP Tokens Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS otp_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        is_used INTEGER DEFAULT 0,
        is_locked INTEGER DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)

    

    # Seed a test pickup order and delivery order if empty
    cursor.execute("SELECT COUNT(*) FROM orders")
    if cursor.fetchone()[0] == 0:
        now_str = datetime.now(timezone.utc).isoformat()
        # Order 1: Self-Pickup Ready for Collection (Buyer=1, Seller=2)
        cursor.execute(
            "INSERT INTO orders (buyer_id, seller_id, courier_id, fulfilment, status, updated_at) VALUES (1, 2, NULL, 'pickup', 'Ready for Collection', ?)",
            (now_str,)
        )
        # Order 2: Delivery Collected / In Transit (Buyer=1, Seller=2, Courier=3)
        cursor.execute(
            "INSERT INTO orders (buyer_id, seller_id, courier_id, fulfilment, status, updated_at) VALUES (1, 2, 3, 'delivery', 'Collected', ?)",
            (now_str,)
        )
    conn.commit()
    conn.close()

init_db()

# 3. PASSWORD & JWT SECURITY ENGINE

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}${key.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        salt, key_hex = hashed_password.split('$')
        new_key = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return secrets.compare_digest(key_hex, new_key.hex())
    except Exception:
        return False

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security_scheme)) -> dict:
    token = credentials.credentials
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token.")


# 4. CRYPTOGRAPHIC OTP ENGINE (SHA-256 + Lockout)

def _hash_otp(plain_code: str) -> str:
    return hashlib.sha256(plain_code.strip().encode("utf-8")).hexdigest()

def issue_otp(conn: sqlite3.Connection, order_id: int, purpose: str) -> str:
    plain_otp = f"{secrets.randbelow(900000) + 100000}"
    hashed_otp = _hash_otp(plain_otp)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(hours=48)).isoformat()

    cursor = conn.cursor()
    # Lock any previous unused OTPs for this order & purpose
    cursor.execute(
        "UPDATE otp_tokens SET is_locked = 1 WHERE order_id = ? AND purpose = ? AND is_used = 0",
        (order_id, purpose)
    )
    cursor.execute(
        """INSERT INTO otp_tokens (order_id, purpose, token_hash, attempts, is_used, is_locked, expires_at, created_at)
           VALUES (?, ?, ?, 0, 0, 0, ?, ?)""",
        (order_id, purpose, hashed_otp, expires, now.isoformat())
    )
    conn.commit()
    return plain_otp

def verify_otp_submission(conn: sqlite3.Connection, order_id: int, purpose: str, submitted_code: str):
    cursor = conn.cursor()
    cursor.execute(
        """SELECT * FROM otp_tokens 
           WHERE order_id = ? AND purpose = ? AND is_used = 0 AND is_locked = 0
           ORDER BY id DESC LIMIT 1""",
        (order_id, purpose)
    )
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=400, detail="No active OTP found. It may be used, locked, or expired.")

    # Check 48h Expiration
    expires_at = datetime.fromisoformat(row["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        cursor.execute("UPDATE otp_tokens SET is_locked = 1 WHERE id = ?", (row["id"],))
        conn.commit()
        raise HTTPException(status_code=410, detail="OTP has expired (48-hour limit reached).")

    # Check 5-attempt Lockout
    if row["attempts"] >= 5:
        cursor.execute("UPDATE otp_tokens SET is_locked = 1 WHERE id = ?", (row["id"],))
        conn.commit()
        raise HTTPException(status_code=403, detail="OTP locked due to 5 failed attempts.")

    # Constant-Time Hash Check
    submitted_hash = _hash_otp(submitted_code)
    if not hmac.compare_digest(submitted_hash, row["token_hash"]):
        new_attempts = row["attempts"] + 1
        lock_flag = 1 if new_attempts >= 5 else 0
        cursor.execute(
            "UPDATE otp_tokens SET attempts = ?, is_locked = ? WHERE id = ?",
            (new_attempts, lock_flag, row["id"])
        )
        conn.commit()
        remaining = 5 - new_attempts
        msg = f"Invalid OTP. {remaining} attempt(s) left." if remaining > 0 else "Invalid OTP. Code is now permanently locked."
        raise HTTPException(status_code=400, detail=msg)

    # Mark Consumed
    cursor.execute("UPDATE otp_tokens SET is_used = 1 WHERE id = ?", (row["id"],))
    conn.commit()


# 5. API SCHEMAS & ENDPOINTS

class LoginTestRequest(BaseModel):
    user_id: int = Field(1, description="1=Buyer, 2=Seller, 3=Courier, 99=Admin")
    email: str = "student@eduvos.com"
    campus: str = "Potchefstroom"
    roles: List[str] = ["buyer", "seller", "courier"]

class OTPVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)

@app.get("/api/health", tags=["System"])
def health_check():
    return {"status": "online", "service": "MyVossie Security & OTP Engine"}

@app.post("/api/auth/token", tags=["Authentication"])
def generate_test_jwt(payload: LoginTestRequest):
    """Generates a valid signed JWT token for testing Buyer (id=1), Seller (id=2), or Courier (id=3)."""
    token = create_access_token({
        "sub": str(payload.user_id),
        "email": payload.email,
        "campus": payload.campus,
        "roles": payload.roles
    })
    return {"access_token": token, "token_type": "bearer", "user_id": payload.user_id, "roles": payload.roles}

@app.get("/api/orders/{order_id}/pickup-code", tags=["Handover & OTP"])
def seller_get_pickup_code(
    order_id: int,
    current_user: dict = Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db)
):
    """SELLER ONLY: Generates/displays the 6-digit pickup code to give to the buyer."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cursor.fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["seller_id"] != int(current_user["sub"]):
        raise HTTPException(status_code=403, detail="Only the order's seller can generate the pickup code.")

    if order["fulfilment"] != "pickup" or order["status"] != "Ready for Collection":
        raise HTTPException(status_code=400, detail="Order must be 'pickup' and 'Ready for Collection'.")

    code = issue_otp(conn, order_id, "pickup")
    return {"orderId": order_id, "code": code, "purpose": "pickup", "note": "Give this code to the buyer."}

@app.post("/api/orders/{order_id}/verify-pickup", tags=["Handover & OTP"])
def buyer_verify_pickup_code(
    order_id: int,
    payload: OTPVerifyRequest,
    current_user: dict = Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db)
):
    """BUYER ONLY: Enters the seller's 6-digit code to mark a self-pickup order Completed."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cursor.fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["buyer_id"] != int(current_user["sub"]):
        raise HTTPException(status_code=403, detail="Only the buyer can verify self-pickup.")

    verify_otp_submission(conn, order_id, "pickup", payload.code)

    cursor.execute(
        "UPDATE orders SET status = 'Completed', updated_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), order_id)
    )
    conn.commit()
    return {"message": "Pickup confirmed! Order marked as Completed.", "status": "Completed"}

@app.get("/api/orders/{order_id}/delivery-code", tags=["Handover & OTP"])
def buyer_get_delivery_code(
    order_id: int,
    current_user: dict = Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db)
):
    """BUYER ONLY: Displays the delivery code for the buyer to give to the courier."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cursor.fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["buyer_id"] != int(current_user["sub"]):
        raise HTTPException(status_code=403, detail="Only the buyer can view the delivery code.")

    code = issue_otp(conn, order_id, "delivery")
    return {"orderId": order_id, "code": code, "purpose": "delivery", "note": "Give this code to your courier."}

@app.post("/api/orders/{order_id}/verify-delivery", tags=["Handover & OTP"])
def courier_verify_delivery_code(
    order_id: int,
    payload: OTPVerifyRequest,
    current_user: dict = Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db)
):
    """COURIER ONLY: Enters the buyer's 6-digit code to mark delivery as Delivered."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cursor.fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["courier_id"] != int(current_user["sub"]):
        raise HTTPException(status_code=403, detail="Only the assigned courier can verify this delivery.")

    verify_otp_submission(conn, order_id, "delivery", payload.code)

    cursor.execute(
        "UPDATE orders SET status = 'Delivered', updated_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), order_id)
    )
    conn.commit()
    return {"message": "Delivery verified! Order marked as Delivered.", "status": "Delivered"}

@app.get("/api/products", tags=["Marketplace"])
def get_products():
    return [
        {
            "id": "1",
            "name": "Calculus Textbook",
            "price": 450.00,
            "stock": 5,
            "category": "Books",
            "campus": "Potchefstroom",
            "description": "Mathematics 1B textbook in great condition.",
            "seller": {"name": "Test Seller"},
            "image": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=500&q=80"
        },
        {
            "id": "2",
            "name": "Network Switch",
            "price": 800.00,
            "stock": 2,
            "category": "Electronics",
            "campus": "Potchefstroom",
            "description": "Cisco 2960 switch for lab practice.",
            "seller": {"name": "Test Seller"},
            "image": "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=500&q=80"
        }
    ]

@app.post("/api/products", tags=["Marketplace - Seller Operations"])
def create_product_listing(
    name: str = Form(...),
    price: float = Form(...),
    stock: int = Form(...),
    category: str = Form(...),
    campus: str = Form(...),
    description: str = Form(""),
    image: UploadFile = File(None),
    current_user: dict = Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db)
):
    """SELLER ONLY: Uploads a new product listing with an image."""
    # 1. Security Check: Ensure the user is actually a seller
    if "seller" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Only registered sellers can list products.")
    
    # 2. Handle the Image Upload
    image_url = None
    if image:
        # Create a safe file path
        file_path = f"static/uploads/{image.filename}"
        # Save the physical file to the disk
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        # Create the URL the frontend will use to load it
        image_url = f"http://127.0.0.1:8000/{file_path}"

    # 3. Save to Database
    cursor = conn.cursor()
    now_str = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        """INSERT INTO products (seller_id, name, price, stock, category, campus, description, image_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (current_user["sub"], name, price, stock, category, campus, description, image_url, now_str)
    )
    conn.commit()
    
    return {
        "message": "Product successfully listed!", 
        "product_id": cursor.lastrowid,
        "image_url": image_url
    }
