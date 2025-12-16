package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/segmentio/kafka-go"
)

type Rule struct {
	ID      string `json:"id"`
	Trigger string `json:"trigger"`
	Action  string `json:"action"`
}

type Store struct {
	sync.RWMutex
	Rules []Rule
}

var store = &Store{}
var re = regexp.MustCompile(`(?i)if (.+?) then (.+)`)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer, middleware.Timeout(30*time.Second))
	r.Use(withCORS)
	
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Post("/rules", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)
		m := re.FindStringSubmatch(body.Text)
		if len(m) < 3 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "say: if <trigger> then <action>"})
			return
		}
		rule := Rule{ID: time.Now().Format("20060102150405"), Trigger: m[1], Action: m[2]}
		store.Lock()
		store.Rules = append(store.Rules, rule)
		store.Unlock()
		writeJSON(w, http.StatusOK, rule)
	})

	r.Post("/simulate", func(w http.ResponseWriter, req *http.Request) {
		var ev map[string]any
		_ = json.NewDecoder(req.Body).Decode(&ev)
		messages := evalRules(ev)
		writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
	})

	go consumeKafka()

	addr := ":8081"
	log.Printf("rules-engine listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

func evalRules(event map[string]any) []string {
	triggerText := ""
	if cat, ok := event["category"].(string); ok {
		triggerText += cat
	}
	if t, ok := event["type"].(string); ok {
		triggerText += " " + t
	}

	store.RLock()
	defer store.RUnlock()
	msgs := []string{}
	for _, r := range store.Rules {
		if containsFold(triggerText, r.Trigger) {
			msgs = append(msgs, "Executed action: "+r.Action)
		}
	}
	return msgs
}

func consumeKafka() {
	broker := env("KAFKA_BROKER", "redpanda:9092")
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{broker},
		Topic:   "transaction.posted",
		GroupID: "rules-engine",
	})
	defer r.Close()
	ctx := context.Background()
	for {
		m, err := r.ReadMessage(ctx)
		if err != nil {
			log.Println("kafka read:", err)
			time.Sleep(time.Second)
			continue
		}
		var ev map[string]any
		_ = json.Unmarshal(m.Value, &ev)
		msgs := evalRules(ev)
		if len(msgs) > 0 {
			log.Println("Rules fired:", msgs)
		}
	}
}

func containsFold(a, b string) bool {
	return regexp.MustCompile(`(?i)`+regexp.QuoteMeta(b)).FindStringIndex(a) != nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func withCORS(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        next.ServeHTTP(w, r)
    })
}

