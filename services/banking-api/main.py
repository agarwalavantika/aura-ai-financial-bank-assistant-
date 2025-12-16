# services/banking-api/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn, random, time
from typing import List
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Aura - Mock Banking API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory DB (per-run). Use file or sqlite for persistence.
ACCOUNTS = {
    "00000000-0000-0000-0000-000000000001": {
        "name": "Demo User",
        "currency": "INR",
        "balance": 78523.00,
        "transactions": [
            {"id": 1, "type": "credit", "category": "Salary", "amount": 50000, "ts": time.time()-86400*30},
            {"id": 2, "type": "debit", "category": "Groceries", "amount": 3200, "ts": time.time()-86400*2},
        ],
    }
}

# OTP store (session keyed)
OTP_STORE = {}

class TransferRequest(BaseModel):
    from_account: str
    to_name: str
    amount: float
    currency: str = "INR"
    reference: str | None = None
    require_otp: bool = True

class OTPVerify(BaseModel):
    session: str
    otp: str

@app.get("/balance")
def get_balance(account_id: str = "00000000-0000-0000-0000-000000000001"):
    acc = ACCOUNTS.get(account_id)
    if not acc:
        raise HTTPException(404, "account not found")
    return {"account_id": account_id, "balance": acc["balance"], "currency": acc["currency"]}

@app.get("/transactions")
def get_transactions(account_id: str = "00000000-0000-0000-0000-000000000001", limit: int = 10):
    acc = ACCOUNTS.get(account_id)
    if not acc:
        raise HTTPException(404, "account not found")
    txs = sorted(acc["transactions"], key=lambda x: x["ts"], reverse=True)[:limit]
    return {"transactions": txs}

@app.post("/otp/generate")
def generate_otp(req: TransferRequest):
    # Create a session id and OTP; in prod you'd send SMS/Push
    session = f"sess-{int(time.time()*1000)}-{random.randint(1000,9999)}"
    otp = f"{random.randint(100000,999999)}"
    OTP_STORE[session] = {"otp": otp, "req": req.dict(), "created": time.time()}
    # For demo: return OTP (so you can show it); in production, never return OTP body
    return {"session": session, "otp_hint": otp, "message": "OTP generated (mock) - sent via SMS in real system"}

@app.post("/otp/verify")
def verify_otp(body: OTPVerify):
    rec = OTP_STORE.get(body.session)
    if not rec:
        raise HTTPException(404, "session not found")
    if rec["otp"] != body.otp:
        raise HTTPException(400, "invalid otp")
    # proceed to perform transfer
    t = rec["req"]
    # debit from source
    acc = ACCOUNTS.get(t["from_account"])
    if not acc:
        raise HTTPException(404, "account not found")
    if acc["balance"] < t["amount"]:
        raise HTTPException(400, "insufficient funds")
    acc["balance"] -= t["amount"]
    tx = {"id": int(time.time()*1000), "type": "debit", "category": "transfer", "amount": t["amount"], "to": t["to_name"], "ts": time.time()}
    acc["transactions"].append(tx)
    # remove used OTP
    del OTP_STORE[body.session]
    return {"status": "ok", "new_balance": acc["balance"], "tx": tx}

@app.post("/transfer")
def transfer_direct(req: TransferRequest):
    # convenience: direct transfer without OTP (for internal testing)
    acc = ACCOUNTS.get(req.from_account)
    if not acc:
        raise HTTPException(404, "account not found")
    if acc["balance"] < req.amount:
        raise HTTPException(400, "insufficient funds")
    acc["balance"] -= req.amount
    tx = {"id": int(time.time()*1000), "type": "debit", "category": "transfer", "amount": req.amount, "to": req.to_name, "ts": time.time()}
    acc["transactions"].append(tx)
    return {"status": "ok", "new_balance": acc["balance"], "tx": tx}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8082, reload=False)
