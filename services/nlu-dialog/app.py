from fastapi import FastAPI
from pydantic import BaseModel
import os, re, httpx
from typing import Dict, Any

app = FastAPI(title="Aura-NLU", description="AI Voice Banking NLU")

class Utterance(BaseModel):
    text: str
    user_id: str = "default"

class BankingNLU:
    def __init__(self):
        self.financial_terms = {
            'transfer': ['send', 'transfer', 'pay', 'move money'],
            'balance': ['balance', 'how much', 'check account'],
            'rules': ['whenever', 'if then', 'automate', 'always'],
            'spending': ['spent', 'expense', 'where did my money go'],
            'savings': ['save', 'set aside', 'investment']
        }
    
    def detect_intent(self, text: str) -> Dict[str, Any]:
        text_lower = text.lower()
        
        # Balance check
        if any(term in text_lower for term in self.financial_terms['balance']):
            return {"intent": "check_balance", "confidence": 0.9}
        
        # Transfer money
        transfer_match = re.search(r"(?:send|transfer|pay)\s+(?:₹|rs\.?)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:to|for)\s+(\w+)", text_lower)
        if transfer_match:
            amount = transfer_match.group(1).replace(',', '')
            recipient = transfer_match.group(2)
            return {
                "intent": "transfer_money",
                "slots": {"amount": float(amount), "recipient": recipient.title()},
                "confidence": 0.95
            }
        
        # Create automation rule
        if "whenever" in text_lower or "if" in text_lower and "then" in text_lower:
            return {"intent": "create_rule", "confidence": 0.85}
        
        return {"intent": "fallback", "confidence": 0.1, "text": text}

@app.get("/health")
def health():
    return {"status": "ok", "service": "Aura NLU"}

@app.post("/parse")
async def parse_utterance(u: Utterance):  
    nlu_engine = BankingNLU()
    result = nlu_engine.detect_intent(u.text)
   
    if os.getenv("OPENAI_API_KEY") and result["intent"] == "fallback":
        return await enhance_with_ai(u.text)
    
    return result

async def enhance_with_ai(text: str):
    """Use OpenAI to handle complex or ambiguous banking requests"""
    prompt = f"""
    You are Aura, an AI banking assistant. Analyze this banking request and return JSON:
    {{
        "intent": "transfer_money|check_balance|create_rule|explain|fallback",
        "slots": {{"amount": number, "recipient": string, "category": string}},
        "confidence": 0.0-1.0,
        "response": "Natural language response to speak back"
    }}
    
    User: "{text}"
    """
    
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            }
        )
        return response.json()["choices"][0]["message"]["content"]

@app.post("/suggest_rule")
async def suggest_rule(q: Utterance):
    # Your existing rule suggestion logic
    if os.getenv("OPENAI_API_KEY"):
        prompt = f"""Create a banking automation rule from: "{q.text}" 
        Format: if <trigger> then <action>"""
        # ... your existing OpenAI call
        pass
    return {"rule": "if salary_credited then save_20_percent"}