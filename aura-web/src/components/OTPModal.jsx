// aura-web/src/components/OTPModal.jsx
import React, { useState, useEffect } from "react";

export default function OTPModal({ open, onClose, session, otpHint, onVerified }) {
  const [otp, setOtp] = useState("");
  useEffect(() => {
    if (otpHint) setOtp(otpHint); // auto-fill for demo
  }, [otpHint]);

  if (!open) return null;
  return (
    <div style={{
      position: "fixed", left:0, right:0, top:0, bottom:0,
      background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
    }}>
      <div style={{ background:"#fff", padding:20, width:420, borderRadius:8, boxShadow:"0 20px 60px rgba(0,0,0,0.18)" }}>
        <h3>Confirm Transfer</h3>
        <p>Session: <code style={{fontSize:12}}>{session}</code></p>
        <p style={{color:"#555"}}>Enter the OTP sent to your phone (demo shows it below)</p>
        <div style={{marginTop:8}}>
          <input value={otp} onChange={e=>setOtp(e.target.value)} placeholder="Enter OTP" style={{width:"100%",padding:10,borderRadius:6,border:"1px solid #ddd"}} />
        </div>
        <div style={{marginTop:12, display:"flex", gap:8, justifyContent:"flex-end"}}>
          <button onClick={()=> onClose()} style={{padding:"8px 12px"}}>Cancel</button>
          <button onClick={()=> onVerified(otp)} style={{padding:"8px 12px", background:"#4f46e5", color:"#fff", borderRadius:6}}>Verify & Transfer</button>
        </div>
        <div style={{marginTop:10, fontSize:12, color:"#888"}}>Demo OTP (visible): {otpHint}</div>
      </div>
    </div>
  );
}
