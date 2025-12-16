// aura-web/src/ChunkedVoiceBox.jsx
import React, { useEffect, useRef, useState } from "react";

export default function ChunkedVoiceBox({
  sessionId = null,
  onInterim = () => {},
  onFinal = () => {},
  label = "Record live",
}) {
  const [recording, setRecording] = useState(false);
  const [seq, setSeq] = useState(0);
  const mediaRef = useRef(null);
  const sessionRef = useRef(sessionId || `sess-${Date.now()}`);

  useEffect(() => {
    // cleanup tracks on unmount
    return () => {
      try {
        mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  async function start() {
    setRecording(true);
    setSeq(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRef.current = { mr, stream };

      mr.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        // increment seq and upload
        setSeq((s) => {
          const next = s + 1;
          uploadChunk(e.data, next).catch((err) => {
            console.error("uploadChunk failed", err);
          });
          return next;
        });
      };

      mr.start(1000); // fire dataavailable every ~1000ms
    } catch (err) {
      console.error("Microphone access error:", err);
      alert("Microphone access denied or not available.");
      setRecording(false);
    }
  }

  async function stop() {
    setRecording(false);
    try {
      mediaRef.current?.mr?.stop();
    } catch {}
    // finalize
    try {
      const base = import.meta.env.VITE_VOICE_API || "http://localhost:8080";
      const res = await fetch(`${base}/asr/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionRef.current }),
      });
      if (!res.ok) {
        console.error("complete failed", await res.text());
        return;
      }
      const j = await res.json();
      if (j.transcript) onFinal(j.transcript);
    } catch (e) {
      console.error("complete error", e);
    } finally {
      try {
        mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
      } catch {}
    }
  }

  async function uploadChunk(blob, idx) {
    const fd = new FormData();
    fd.append("chunk", blob, `chunk-${idx}.webm`);
    fd.append("seq", String(idx));
    fd.append("session", sessionRef.current);

    const base = import.meta.env.VITE_VOICE_API || "http://localhost:8080";
    try {
      const res = await fetch(`${base}/asr/chunk`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        console.error("chunk upload failed", await res.text());
        return;
      }
      const j = await res.json();
      if (j.interim) onInterim(j.interim);
    } catch (e) {
      console.error("uploadChunk error", e);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <button
        onClick={() => (recording ? stop() : start())}
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          border: "none",
          background: recording ? "#ef4444" : "#4f46e5",
          color: "white",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
          position: "relative",
        }}
        aria-pressed={recording}
      >
        {recording ? "Stop" : "Record"}
        {recording && (
          <span
            style={{
              position: "absolute",
              width: 90,
              height: 90,
              borderRadius: "50%",
              left: -9,
              top: -9,
              pointerEvents: "none",
              background:
                "radial-gradient(circle, rgba(79,70,229,0.18) 0%, rgba(79,70,229,0) 60%)",
              animation: "pulse 1.6s infinite",
            }}
          />
        )}
      </button>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>
          {recording ? "Recording… speak now" : "Click Record to speak"}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.6; }
          70% { transform: scale(1.9); opacity: 0.08; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
