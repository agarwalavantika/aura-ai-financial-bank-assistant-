import React, { useRef, useState } from "react";

export default function VoiceBox({ onInterim = () => {}, onFinal = () => {} }) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  async function start() {
    setRecording(true);
    setLoading(false);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRef.current = { mr, stream };

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        setLoading(true);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudio(blob);
        stream.getTracks().forEach(t => t.stop());
        setLoading(false);
      };

      mr.start();
    } catch (err) {
      alert("Microphone access denied.");
      setRecording(false);
    }
  }

  function stop() {
    setRecording(false);
    try { mediaRef.current?.mr?.stop(); } catch {}
  }

  async function sendAudio(blob) {
    try {
      const fd = new FormData();
      fd.append("file", blob, "voice.webm");
      const base = import.meta.env.VITE_VOICE_API || "http://localhost:8080";
      const res = await fetch(`${base}/asr`, { method: "POST", body: fd });
      if (!res.ok) {
        onInterim("");
        onFinal("");
        throw new Error(await res.text());
      }
      const j = await res.json();
      const t = j.transcript || j.text || "";
      // call NLU final flow
      onInterim(t);
      onFinal(t);
    } catch (err) {
      console.error("ASR error", err);
      onInterim("");
      onFinal("");
    }
  }

  return (
    <div className="voicebox">
      <button
        className={`record-btn ${recording ? "recording" : ""}`}
        onClick={() => (recording ? stop() : start())}
        aria-pressed={recording}
      >
        <div className="pulse" />
        <div className="icon">{recording ? "■" : "●"}</div>
      </button>

      <div className="voice-help">
        <div className="title">{recording ? "Recording..." : "Click to speak"}</div>
        <div className="hint muted">Short commands work best</div>
      </div>

      {loading && <div className="loader">Transcribing…</div>}
    </div>
  );
}
