# main.py - minimal NLU parser service (FastAPI)
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, json, re

try:
    import openai
    OPENAI_AVAILABLE = True
    openai.api_key = os.getenv("OPENAI_API_KEY", "")
except Exception:
    OPENAI_AVAILABLE = False

app = FastAPI()

class ParseReq(BaseModel):
    text: str

@app.post("/parse")
async def parse(req: ParseReq):
    txt = (req.text or "").strip()
    # heuristic parser first
    m = re.search(r"if (.+?) then (.+)", txt, re.I)
    if m:
        trigger = m.group(1).strip()
        action = m.group(2).strip()
        return {"trigger": trigger, "action": action, "rule_text": f"if {trigger} then {action}"}
    # small fallback
    if "salary" in txt.lower():
        return {"trigger": "salary", "action": "move 20% to savings", "rule_text": "if salary then move 20% to savings"}

    # optional GPT parsing if key present
    if OPENAI_AVAILABLE and os.getenv("OPENAI_API_KEY"):
        try:
            resp = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[
                    {"role":"system","content":"You are a strict parser. Return JSON with keys: trigger, action, rule_text"},
                    {"role":"user","content":txt}
                ],
                max_tokens=200,
                temperature=0.0
            )
            out = resp["choices"][0]["message"]["content"].strip()
            # try to parse JSON from model output
            try:
                data = json.loads(out)
                return {"trigger": data.get("trigger",""), "action": data.get("action",""), "rule_text": data.get("rule_text","")}
            except Exception:
                m = re.search(r"if (.+?) then (.+)", out, re.I)
                if m:
                    tr=m.group(1).strip(); ac=m.group(2).strip()
                    return {"trigger":tr,"action":ac,"rule_text":f"if {tr} then {ac}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {"trigger": "", "action": "", "rule_text": ""}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8090, reload=False)
