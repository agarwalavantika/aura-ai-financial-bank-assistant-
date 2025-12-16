# services/bank-mock/main.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict
import time, uuid
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS (allow frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSIONS: Dict[str, Dict] = {}
BALANCE = {"balance": 78523}  # demo balance


class OTPGen(BaseModel):
    from_account: str
    to_name: str
    amount: float
    currency: str = "INR"
    reference: str = "demo"
    require_otp: bool = True


class OTPVerify(BaseModel):
    session: str
    otp: str


@app.post("/otp/generate")
def generate_otp(req: OTPGen):
    sess = "sess-" + uuid.uuid4().hex[:8]
    otp = "1234"  # demo OTP
    SESSIONS[sess] = {
        "otp": otp,
        "amount": req.amount,
        "to": req.to_name,
        "created": time.time(),
    }
    return {
        "session": sess,
        "otp_hint": "1234 (demo OTP)",
        "expires_at": time.time() + 300,
    }


@app.post("/otp/verify")
def verify_otp(req: OTPVerify):
    s = SESSIONS.get(req.session)
    if not s:
        return {"error": "invalid session"}, 400
    if req.otp != s["otp"]:
        return {"error": "invalid otp"}, 400

    BALANCE["balance"] -= s["amount"]

    return {
        "status": "ok",
        "new_balance": BALANCE["balance"],
        "tx": {"to": s["to"], "amount": s["amount"]},
    }


@app.get("/balance")
def get_balance():
    return {"balance": BALANCE["balance"]}
