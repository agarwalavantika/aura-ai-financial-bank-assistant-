from fastapi import FastAPI
from pydantic import BaseModel
import json, os
import pandas as pd

app = FastAPI(title="insights")
MOCK = os.getenv("MOCK_TX_PATH","/app/mock_transactions.json")

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/pulse")
def pulse():
    df = pd.read_json(MOCK)
    dining = df[df.category=="Dining"].amount.sum()
    usual = 150.0
    msgs = []
    if dining > 1.2*usual:
        pct = ((dining-usual)/usual)*100
        msgs.append(f"Dining spend ${dining:.2f} is ~{pct:.0f}% above usual. Want to set a limit?")
    stale = df[(df.category=="Subscriptions") & (~df.used_recently.fillna(True))]
    if len(stale)>0:
        s = stale.iloc[0]
        msgs.append(f"Unused subscription: {s.merchant} (${s.amount}). Shall I cancel?")
    return {"messages": msgs or ["All good."]}

class Event(BaseModel):
    text: str

@app.post("/simulate")
def simulate(e: Event):
    # future: write to Kafka (transaction.posted)
    return {"status":"ok","event": e.text}

from fastapi import FastAPI
import os, psycopg2, datetime as dt

app = FastAPI()
DSN = os.getenv("POSTGRES_DSN","postgres://aura:aura@postgres:5432/auradb?sslmode=disable").replace("postgres://","postgresql://")
db = psycopg2.connect(DSN)

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/pulse")
def pulse():
    cur = db.cursor()
    # Spend by category last 30d
    cur.execute("""
      SELECT category, SUM(amount)::float
      FROM transactions
      WHERE posted_at >= NOW() - INTERVAL '30 days'
      GROUP BY category ORDER BY 2 DESC
    """)
    cats = [{"category":c,"sum":s} for c,s in cur.fetchall()]

    # Subscription unused detection: same merchant repeatedly
    cur.execute("""
      SELECT merchant, COUNT(*) cnt, SUM(amount)::float
      FROM transactions
      WHERE category='Subscriptions' AND posted_at >= NOW() - INTERVAL '90 days'
      GROUP BY merchant HAVING COUNT(*)>=2 ORDER BY cnt DESC
    """)
    subs = [{"merchant":m,"count":cnt,"sum":s} for m,cnt,s in cur.fetchall()]

    insights = []
    if cats:
      top = cats[0]
      insights.append(f"Top spending in last 30d: {top['category']} (${top['sum']:.0f}).")
    for s in subs:
      insights.append(f"Recurring subscription detected: {s['merchant']} (${s['sum']:.2f}, {s['count']} charges). Consider cancel?")
    return {"items": insights, "by_category": cats}
