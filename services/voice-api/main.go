package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/segmentio/kafka-go"
)

/* ---------------------------------- TYPES ---------------------------------- */

type Health struct{ Status string `json:"status"` }

/* ------------------------------- MAIN FUNCTION ------------------------------ */

func main() {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Logger, middleware.Recoverer, middleware.Timeout(30*time.Second))
	r.Use(withCORS)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, Health{"ok"})
	})

	/* -------------- CHUNKED ASR HANDLERS ---------------- */
	r.Post("/asr/chunk", handleASRChunk)
	r.Post("/asr/complete", handleASRComplete)

	/* ------------------ SIMPLE MOCK TTS ------------------ */
	r.Post("/tts", func(w http.ResponseWriter, req *http.Request) {
		var in struct{ Text string }
		_ = json.NewDecoder(req.Body).Decode(&in)
		if in.Text == "" {
			writeErr(w, 400, fmt.Errorf("text required"))
			return
		}
		writeJSON(w, 200, map[string]string{
			"audio_url": "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
		})
	})

	/* ----------- PUBLISH KAFKA EVENT -------------------- */
	r.Post("/events/transaction", func(w http.ResponseWriter, req *http.Request) {
		broker := env("KAFKA_BROKER", "redpanda:9092")

		wtr := kafka.NewWriter(kafka.WriterConfig{
			Brokers: []string{broker},
			Topic:   "transaction.posted",
		})
		defer wtr.Close()

		msg := map[string]any{
			"category": "Salary",
			"amount":   25000,
			"user_id":  "00000000-0000-0000-0000-000000000001",
			"id":       time.Now().Unix(),
		}

		b, _ := json.Marshal(msg)
		err := wtr.WriteMessages(context.Background(), kafka.Message{Value: b})
		if err != nil {
			writeErr(w, 500, err)
			return
		}

		writeJSON(w, 200, map[string]string{"status": "published"})
	})

	/* ----------------- PARSE AND CREATE RULE ---------------- */
	r.Post("/parse-and-create-rule", func(w http.ResponseWriter, req *http.Request) {
		var body struct{ Transcript string `json:"transcript"` }
		_ = json.NewDecoder(req.Body).Decode(&body)

		t := strings.TrimSpace(body.Transcript)
		if t == "" {
			writeErr(w, 400, fmt.Errorf("transcript required"))
			return
		}

		// 1) heuristic: "if <trigger> then <action>"
		re := regexp.MustCompile(`(?i)if (.+?) then (.+)`)
		if m := re.FindStringSubmatch(t); len(m) >= 3 {
			rulePayload := map[string]string{
				"text": "if " + strings.TrimSpace(m[1]) + " then " + strings.TrimSpace(m[2]),
			}
			b, _ := json.Marshal(rulePayload)

			rulesURL := env("RULES_API", "http://localhost:8081") + "/rules"
			resp, err := http.Post(rulesURL, "application/json", bytes.NewReader(b))
			if err != nil {
				writeErr(w, 502, err)
				return
			}
			defer resp.Body.Close()
			io.Copy(w, resp.Body)
			return
		}

		// 2) fallback to local NLU
		nluURL := env("NLU_API", "http://localhost:8090") + "/parse"
		np := map[string]string{"text": t}
		nb, _ := json.Marshal(np)

		nr, err := http.Post(nluURL, "application/json", bytes.NewReader(nb))
		if err == nil {
			defer nr.Body.Close()

			var parsed map[string]any
			_ = json.NewDecoder(nr.Body).Decode(&parsed)

			// If NLU returns create_rule
			if parsed["intent"] == "create_rule" {
				trigger := parsed["trigger"].(string)
				action := parsed["action"].(string)

				rulePayload := map[string]string{
					"text": "if " + trigger + " then " + action,
				}
				b2, _ := json.Marshal(rulePayload)

				rulesURL := env("RULES_API", "http://localhost:8081") + "/rules"
				resp2, err2 := http.Post(rulesURL, "application/json", bytes.NewReader(b2))
				if err2 != nil {
					writeErr(w, 502, err2)
					return
				}
				defer resp2.Body.Close()
				io.Copy(w, resp2.Body)
				return
			}
		}

		writeJSON(w, 200, map[string]string{
			"status":     "not_parsed",
			"transcript": t,
		})
	})

	addr := ":8080"
	log.Printf("voice-api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

/* ------------------------- CHUNKED ASR IMPLEMENTATION ------------------------ */

func handleASRChunk(w http.ResponseWriter, r *http.Request) {
	session := r.FormValue("session")
	seq := r.FormValue("seq")

	if session == "" || seq == "" {
		http.Error(w, "session & seq required", 400)
		return
	}

	file, _, err := r.FormFile("chunk")
	if err != nil {
		http.Error(w, "chunk missing:"+err.Error(), 400)
		return
	}
	defer file.Close()

	dir := filepath.Join(os.TempDir(), "asr", session)
	os.MkdirAll(dir, 0o755)

	outPath := filepath.Join(dir, seq+".webm")
	out, err := os.Create(outPath)
	if err != nil {
		http.Error(w, "write failed:"+err.Error(), 500)
		return
	}
	defer out.Close()

	io.Copy(out, file)

	writeJSON(w, 200, map[string]any{
		"seq":     seq,
		"interim": "",
	})
}

func handleASRComplete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Session string `json:"session"`
	}

	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.Session == "" {
		http.Error(w, "session required", 400)
		return
	}

	dir := filepath.Join(os.TempDir(), "asr", body.Session)

	// Build concat list
	listPath := filepath.Join(dir, "list.txt")
	lf, _ := os.Create(listPath)

	for i := 1; ; i++ {
		chunk := filepath.Join(dir, fmt.Sprintf("%d.webm", i))
		if _, err := os.Stat(chunk); os.IsNotExist(err) {
			break
		}
		lf.WriteString(fmt.Sprintf("file '%s'\n", chunk))
	}
	lf.Close()

	outWebm := filepath.Join(dir, "out.webm")
	outWav := filepath.Join(dir, "out.wav")

	// ffmpeg concat
	exec.Command("ffmpeg", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outWebm, "-y").Run()
	exec.Command("ffmpeg", "-i", outWebm, "-ar", "16000", "-ac", "1", "-vn", outWav, "-y").Run()

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		writeJSON(w, 200, map[string]string{"transcript": "(mock transcription — no OpenAI key)"})
		return
	}

	// Whisper request
	audio, _ := os.Open(outWav)
	defer audio.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	fw, _ := mw.CreateFormFile("file", "audio.wav")
	io.Copy(fw, audio)
	mw.WriteField("model", "whisper-1")
	mw.Close()

	req, _ := http.NewRequest("POST", "https://api.openai.com/v1/audio/transcriptions", &buf)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	defer resp.Body.Close()

	var out struct{ Text string `json:"text"` }
	json.NewDecoder(resp.Body).Decode(&out)

	writeJSON(w, 200, map[string]string{
		"transcript": out.Text,
	})
}

/* ------------------------------ HELPERS ------------------------------------- */

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}

		next.ServeHTTP(w, r)
	})
}
