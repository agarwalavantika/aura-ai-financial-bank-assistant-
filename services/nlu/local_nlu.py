# services/nlu/local_nlu.py
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import re, uvicorn

app = FastAPI(title="Aura - Local NLU")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

class ParseReq(BaseModel):
    text: str

@app.post("/parse")
def parse(req: ParseReq):
    t = req.text.strip().lower()
    # transfer intent
    m = re.search(r"(?:transfer|send)\s+([0-9,\.]+)\s*(?:rupee|rs|inr|₹)?\s*(?:to)?\s+([a-zA-Z ]+)", t)
    if m:
        amt = m.group(1).replace(",", "")
        name = m.group(2).strip().title()
        try:
            amount = float(amt)
        except:
            amount = None
        return {"intent":"transfer", "amount": amount, "name": name, "raw": req.text}

    # create-rule intent
    m2 = re.search(r"if (.+?) then (.+)", t)
    if m2:
        trigger = m2.group(1).strip()
        action = m2.group(2).strip()
        return {"intent":"create_rule", "trigger": trigger, "action": action, "raw": req.text}

    # balance intent
    if "balance" in t or "what is my balance" in t:
        return {"intent":"balance", "raw": req.text}

    # fallback - ask clarifying
    return {"intent":"unknown", "raw": req.text}
    
if __name__ == "__main__":
    uvicorn.run("local_nlu:app", host="0.0.0.0", port=8090)
