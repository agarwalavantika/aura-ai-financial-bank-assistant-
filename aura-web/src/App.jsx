// aura-web/src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import OTPModal from "./components/OTPModal";
import ChunkedVoiceBox from "./ChunkedVoiceBox";
import "./styles.css"; // import the stylesheet

const RULES_API = import.meta.env.VITE_RULES_API || "http://localhost:8081";
const VOICE_API = import.meta.env.VITE_VOICE_API || "http://localhost:8080";
const NLU_API = import.meta.env.VITE_NLU_API || "http://localhost:8090";
const BANK_API = import.meta.env.VITE_BANK_API || "http://localhost:8082";
const INSIGHTS_API = import.meta.env.VITE_INSIGHTS_API || "http://localhost:8091";

export default function App() {
  // state
  const [ruleText, setRuleText] = useState("if salary then move 20% to savings");
  const [rules, setRules] = useState([]);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [accountBalance, setAccountBalance] = useState(78523);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSession, setOtpSession] = useState(null);
  const [otpHint, setOtpHint] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    // optionally fetch saved rules on load (if endpoint exists)
    (async () => {
      try {
        // if you have an endpoint to list rules, call it here
        // const r = await axios.get(`${RULES_API}/rules`);
        // setRules(r.data || []);
      } catch {}
    })();
  }, []);

  async function speak(text) {
    try {
      const { data } = await axios.post(`${VOICE_API}/tts`, { text });
      if (data?.audio_url) {
        audioRef.current.src = data.audio_url;
        audioRef.current.play().catch(()=>{});
      }
    } catch (err) {
      console.error("TTS failed", err);
    }
  }

  async function createRuleFromText(text) {
    setStatus("Saving rule...");
    try {
      const res = await axios.post(`${RULES_API}/rules`, { text });
      setRules(prev => [res.data, ...prev]);
      setStatus("Rule saved");
      await speak("Rule saved");
    } catch (err) {
      setStatus(`Error: ${err.response?.data?.error || err.message}`);
    }
  }

  // Handler invoked when final transcript is available
  async function onFinal(t) {
    setTranscript(t);
    setStatus("Processing...");
    try {
      // try parse-and-create at voice-api first (if implemented)
      const parseResp = await axios.post(`${VOICE_API}/parse-and-create-rule`, { transcript: t }).catch(()=>null);
      if (parseResp && parseResp.data && parseResp.data.id) {
        setRules(prev => [parseResp.data, ...prev]);
        setStatus("Rule created from voice");
        await speak("Rule created");
        return;
      }

      // fallback to NLU parse
      const nluResp = await axios.post(`${NLU_API}/parse`, { text: t });
      const parsed = nluResp.data;

      if (parsed.intent === "transfer" && parsed.amount) {
        // confirm
        const ok = window.confirm(`Transfer ₹${parsed.amount} to ${parsed.name}?`);
        if (!ok) { setStatus("Transfer cancelled"); return; }

        setStatus("Requesting OTP...");
        const gen = await axios.post(`${BANK_API}/otp/generate`, {
          from_account: "00000000-0000-0000-0000-000000000001",
          to_name: parsed.name,
          amount: parsed.amount,
          currency: "INR",
          reference: "voice-demo",
          require_otp: true
        });

        setOtpSession(gen.data.session);
        setOtpHint(gen.data.otp_hint || "");
        setOtpOpen(true);
        setStatus("OTP requested (demo shows OTP)");
        return;
      }

      if (parsed.intent === "balance") {
        const b = await axios.get(`${BANK_API}/balance`);
        setAccountBalance(b.data.balance);
        await speak(`Your balance is ${Math.round(b.data.balance)} rupees`);
        setStatus("Balance read");
        return;
      }

      if (parsed.intent === "create_rule" || /if .* then /.test(t.toLowerCase())) {
        // create rule by posting to rules API
        await createRuleFromText(t);
        return;
      }

      // last fallback - save raw text as rule
      const r = await axios.post(`${RULES_API}/rules`, { text: t }).catch(()=>null);
      if (r?.data?.id) {
        setRules(prev => [r.data, ...prev]);
        setStatus("Saved literal rule");
        await speak("Saved rule");
      } else {
        setStatus("Could not interpret command");
      }

    } catch (e) {
      console.error(e);
      setStatus("Error processing command");
    }
  }

  async function onOTPVerify(otpValue) {
    setOtpOpen(false);
    setStatus("Verifying OTP...");
    try {
      const res = await axios.post(`${BANK_API}/otp/verify`, { session: otpSession, otp: otpValue });
      const nb = res.data.new_balance;
      setAccountBalance(nb);
      setStatus("Transfer successful");
      await speak(`₹${Math.round(res.data.tx.amount)} transferred to ${res.data.tx.to}. New balance is ₹${Math.round(nb)}`);
    } catch (e) {
      console.error(e);
      setStatus("OTP verification failed");
      alert("OTP invalid or expired");
    } finally {
      setOtpSession(null);
      setOtpHint("");
    }
  }

  async function simulateRule() {
    setStatus("Simulating...");
    try {
      const res = await axios.post(`${RULES_API}/simulate`, { category: "salary", type: "credit" });
      setMessages(res.data.messages || []);
      setStatus("Simulation done");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function triggerTransaction() {
    setStatus("Sending event...");
    try {
      const res = await axios.post(`${VOICE_API}/events/transaction`);
      setStatus(res.data.status === "published" ? "Event published" : "Unknown response");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">
          <div className="logo">Aura</div>
          <div className="tag">Proactive Financial Co-Pilot</div>
        </div>
        <div className="top-actions">
          <div className="balance-small">₹{Math.round(accountBalance).toLocaleString()}</div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="card">
            <h4>Navigation</h4>
            <ul className="nav">
              <li className="nav-item active">Dashboard</li>
              <li className="nav-item">Automations</li>
              <li className="nav-item">Transactions</li>
              <li className="nav-item">Insights</li>
              <li className="nav-item">Settings</li>
            </ul>
          </div>

          <div className="card compact">
            <h4>Quick Actions</h4>
            <button className="btn" onClick={() => simulateRule()}>Simulate Rule</button>
            <button className="btn ghost" onClick={() => triggerTransaction()}>Trigger Tx</button>
          </div>

          <div className="card compact">
            <h4>Saved Rules</h4>
            <div className="rules-list">
              {rules.length === 0 ? <div className="muted">No rules yet</div> :
                rules.slice(0,6).map(r => (
                  <div key={r.id} className="rule-item">
                    <div className="rule-trigger">{r.trigger}</div>
                    <div className="rule-action">{r.action}</div>
                  </div>
                ))
              }
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="grid">
            <div className="col-left">
              {/* Balance card */}
              <div className="card balance-card">
                <div className="balance-label">Available balance</div>
                <div className="balance-value">₹{Math.round(accountBalance).toLocaleString()}</div>
                <div className="balance-sub">Updated after transfers</div>
              </div>

              {/* Voice recorder + transcript */}
              <div className="card">
                <div className="card-head">
                  <h3>Voice Assistant</h3>
                  <div className="muted">Speak to create rules, transfer funds, or ask questions</div>
                </div>

                <div style={{display:"flex", gap:16, alignItems:"center", marginTop:12}}>
                  <ChunkedVoiceBox onInterim={(t)=>setTranscript(t||transcript)} onFinal={onFinal} label="Hold and speak" />
                  <div style={{flex:1}}>
                    <div className="transcript-box">{transcript || <span className="muted">Transcript will appear here</span>}</div>
                    <div style={{marginTop:8}}>
                      <button className="btn" onClick={() => createRuleFromText(transcript || ruleText)}>Save Rule</button>
                      <button className="btn ghost" onClick={() => simulateRule()} style={{marginLeft:8}}>Simulate</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transactions */}
              <div className="card">
                <h3>Recent Transactions</h3>
                <div className="muted">Showing last 5</div>
                <ul className="tx-list">
                  <li><div className="tx-desc">Salary</div><div className="tx-amt credit">+₹50,000</div></li>
                  <li><div className="tx-desc">Groceries</div><div className="tx-amt debit">-₹3,200</div></li>
                  <li><div className="tx-desc">Transfer to Rohan</div><div className="tx-amt debit">-₹500</div></li>
                  <li><div className="tx-desc">Utility</div><div className="tx-amt debit">-₹1,250</div></li>
                </ul>
              </div>
            </div>

            <aside className="col-right">
              <div className="card">
                <h3>Insights</h3>
                <div className="insights-placeholder">Spend is up 12% vs last month — Suggest setting budget</div>
              </div>

              <div className="card compact">
                <h4>Messages</h4>
                {messages.length === 0 ? <div className="muted">No messages</div> :
                  messages.map((m,i)=>(<div key={i} className="msg">{m}</div>))
                }
              </div>

              <div className="card compact">
                <h4>System Status</h4>
                <div className="muted">{status || "idle"}</div>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {/* OTP modal overlay */}
      <OTPModal open={otpOpen} onClose={()=>setOtpOpen(false)} session={otpSession} otpHint={otpHint} onVerified={onOTPVerify} />

      <audio ref={audioRef} style={{display:"none"}} />
    </div>
  );
}
