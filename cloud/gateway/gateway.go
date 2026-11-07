// Package gateway is the Vizulla AI Gateway (DD-12): a streaming proxy between
// the browser and LLM providers.
//
// Data it holds (handbook §10, C14): metering only (device id, model, token
// counts, latency). Never prompts or outputs: requests are streamed through and
// never logged or stored.
package gateway

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	Messages  []Message `json:"messages"`
}

// Provider streams text deltas for a request. It must stop when ctx is done.
type Provider interface {
	Name() string
	Stream(ctx context.Context, req ChatRequest, emit func(string) error) error
}

type Config struct {
	Secret        []byte
	Region        string
	DailyRequests int
	DailyTokens   int
	MaxBodyBytes  int64
	TokenTTL      time.Duration
	// Route picks providers (primary first, then fallbacks) for a model.
	Route  func(model string) []Provider
	Logger *slog.Logger
	Now    func() time.Time
}

type usage struct {
	day      string
	requests int
	tokens   int
}

type Server struct {
	cfg      Config
	mu       sync.Mutex
	quota    map[string]*usage
	ipBucket map[string][]time.Time
}

func New(cfg Config) *Server {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MaxBodyBytes == 0 {
		cfg.MaxBodyBytes = 512 << 10
	}
	if cfg.TokenTTL == 0 {
		cfg.TokenTTL = 24 * time.Hour
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Server{cfg: cfg, quota: map[string]*usage{}, ipBucket: map[string][]time.Time{}}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("POST /v1/device", s.device)
	mux.HandleFunc("POST /v1/chat", s.chat)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Vizulla-Region", s.cfg.Region)
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

// ---- device tokens (P2-CLD-01): anonymous, rotating, HMAC-signed ----

func (s *Server) issue(device string, exp time.Time) string {
	payload := fmt.Sprintf("%s.%d", device, exp.Unix())
	mac := hmac.New(sha256.New, s.cfg.Secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) verify(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", errors.New("malformed token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("malformed token")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("malformed token")
	}
	mac := hmac.New(sha256.New, s.cfg.Secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return "", errors.New("bad signature")
	}
	var device string
	var exp int64
	if i := bytes.LastIndexByte(payload, '.'); i > 0 {
		device = string(payload[:i])
		fmt.Sscan(string(payload[i+1:]), &exp)
	}
	if device == "" || s.cfg.Now().Unix() > exp {
		return "", errors.New("expired token")
	}
	return device, nil
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Abuse control: at most 20 new device tokens per IP per hour.
func (s *Server) allowIssue(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now()
	recent := s.ipBucket[ip][:0]
	for _, t := range s.ipBucket[ip] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 20 {
		s.ipBucket[ip] = recent
		return false
	}
	s.ipBucket[ip] = append(recent, now)
	return true
}

func (s *Server) device(w http.ResponseWriter, r *http.Request) {
	if !s.allowIssue(clientIP(r)) {
		http.Error(w, `{"error":"rate limited"}`, http.StatusTooManyRequests)
		return
	}
	b := make([]byte, 16)
	rand.Read(b)
	device := hex.EncodeToString(b)
	exp := s.cfg.Now().Add(s.cfg.TokenTTL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"token": s.issue(device, exp), "expires_at": exp.Unix()})
}

// ---- quota (P2-CLD-03) ----

func approxTokens(s string) int { return len(s)/4 + 1 }

func (s *Server) charge(device string, tokens int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	day := s.cfg.Now().UTC().Format("2006-01-02")
	u := s.quota[device]
	if u == nil || u.day != day {
		u = &usage{day: day}
		s.quota[device] = u
	}
	if s.cfg.DailyRequests > 0 && u.requests >= s.cfg.DailyRequests {
		return errors.New("daily request quota reached")
	}
	if s.cfg.DailyTokens > 0 && u.tokens+tokens > s.cfg.DailyTokens {
		return errors.New("daily token quota reached")
	}
	u.requests++
	u.tokens += tokens
	return nil
}

func (s *Server) addTokens(device string, n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if u := s.quota[device]; u != nil {
		u.tokens += n
	}
}

// ---- chat ----

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	start := s.cfg.Now()
	device, err := s.verify(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err != nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	var req ChatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, s.cfg.MaxBodyBytes)).Decode(&req); err != nil || len(req.Messages) == 0 || len(req.Messages) > 40 {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if req.MaxTokens <= 0 || req.MaxTokens > 4096 {
		req.MaxTokens = 1024
	}
	in := 0
	for _, m := range req.Messages {
		if m.Role != "system" && m.Role != "user" && m.Role != "assistant" {
			http.Error(w, `{"error":"bad role"}`, http.StatusBadRequest)
			return
		}
		in += approxTokens(m.Content)
	}
	if err := s.charge(device, in); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"quota: %s"}`, err), http.StatusTooManyRequests)
		return
	}
	providers := s.cfg.Route(req.Model)
	if len(providers) == 0 {
		http.Error(w, `{"error":"unknown model"}`, http.StatusBadRequest)
		return
	}
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	out := 0
	started := false
	emit := func(t string) error {
		if r.Context().Err() != nil {
			return r.Context().Err()
		}
		started = true
		out += approxTokens(t)
		b, _ := json.Marshal(map[string]string{"t": t})
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return err
		}
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	}
	var used string
	var lastErr error
	// Failover (P2-CLD-02): try the next provider only if nothing was streamed yet.
	for _, p := range providers {
		used = p.Name()
		lastErr = p.Stream(r.Context(), req, emit)
		if lastErr == nil || started {
			break
		}
	}
	if lastErr != nil {
		b, _ := json.Marshal(lastErr.Error())
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", b)
	}
	s.addTokens(device, out)
	// Metering record: no prompt, no output (C14).
	s.cfg.Logger.Info("meter", "device", device[:8], "model", req.Model, "provider", used, "in_tokens", in, "out_tokens", out,
		"ms", s.cfg.Now().Sub(start).Milliseconds(), "region", s.cfg.Region, "ok", lastErr == nil)
}

// ---- providers ----

// Mock is a deterministic provider for tests and offline development: it
// answers with the first sentence of the first <chunk>, citing it.
type Mock struct{ Fail bool }

func (Mock) Name() string { return "mock" }

func (m Mock) Stream(ctx context.Context, req ChatRequest, emit func(string) error) error {
	if m.Fail {
		return errors.New("mock provider down")
	}
	last := req.Messages[len(req.Messages)-1].Content
	answer := "I couldn't find that on this page."
	if i := strings.Index(last, `<chunk id="`); i >= 0 {
		rest := last[i+len(`<chunk id="`):]
		id := rest[:strings.IndexByte(rest, '"')]
		body := rest[strings.Index(rest, ">\n")+2:]
		if j := strings.Index(body, "\n</chunk>"); j >= 0 {
			body = body[:j]
		}
		sentence := body
		if k := strings.IndexAny(body, ".!?"); k >= 0 {
			sentence = body[:k+1]
		}
		answer = strings.TrimSpace(strings.TrimPrefix(sentence, "• ")) + " [" + id + "]"
	}
	for _, w := range strings.SplitAfter(answer, " ") {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := emit(w); err != nil {
			return err
		}
	}
	return nil
}

// Anthropic streams from the Messages API (zero-data-retention contract, PRV-02).
type Anthropic struct {
	Key    string
	Base   string
	Client *http.Client
}

func (Anthropic) Name() string { return "anthropic" }

func (a Anthropic) Stream(ctx context.Context, req ChatRequest, emit func(string) error) error {
	var system string
	var msgs []Message
	for _, m := range req.Messages {
		if m.Role == "system" {
			system += m.Content + "\n"
		} else {
			msgs = append(msgs, m)
		}
	}
	body, _ := json.Marshal(map[string]any{"model": req.Model, "max_tokens": req.MaxTokens, "stream": true, "system": system, "messages": msgs})
	base := a.Base
	if base == "" {
		base = "https://api.anthropic.com"
	}
	hreq, _ := http.NewRequestWithContext(ctx, "POST", base+"/v1/messages", bytes.NewReader(body))
	hreq.Header.Set("content-type", "application/json")
	hreq.Header.Set("x-api-key", a.Key)
	hreq.Header.Set("anthropic-version", "2023-06-01")
	client := a.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(hreq)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("anthropic HTTP %d", res.StatusCode)
	}
	return readSSE(res.Body, func(event, data string) error {
		if event != "content_block_delta" {
			return nil
		}
		var d struct {
			Delta struct{ Type, Text string } `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &d) == nil && d.Delta.Type == "text_delta" && d.Delta.Text != "" {
			return emit(d.Delta.Text)
		}
		return nil
	})
}

// OpenAI streams from Chat Completions.
type OpenAI struct {
	Key    string
	Base   string
	Client *http.Client
}

func (OpenAI) Name() string { return "openai" }

func (o OpenAI) Stream(ctx context.Context, req ChatRequest, emit func(string) error) error {
	body, _ := json.Marshal(map[string]any{"model": req.Model, "max_tokens": req.MaxTokens, "stream": true, "messages": req.Messages})
	base := o.Base
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	hreq, _ := http.NewRequestWithContext(ctx, "POST", base+"/chat/completions", bytes.NewReader(body))
	hreq.Header.Set("content-type", "application/json")
	hreq.Header.Set("authorization", "Bearer "+o.Key)
	client := o.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(hreq)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("openai HTTP %d", res.StatusCode)
	}
	return readSSE(res.Body, func(_, data string) error {
		if data == "[DONE]" {
			return nil
		}
		var d struct {
			Choices []struct {
				Delta struct{ Content string } `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &d) == nil && len(d.Choices) > 0 && d.Choices[0].Delta.Content != "" {
			return emit(d.Choices[0].Delta.Content)
		}
		return nil
	})
}

func readSSE(r io.Reader, fn func(event, data string) error) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	event, data := "message", ""
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		switch {
		case line == "":
			if data != "" {
				if err := fn(event, data); err != nil {
					return err
				}
			}
			event, data = "message", ""
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			if data != "" {
				data += "\n"
			}
			data += strings.TrimPrefix(line[5:], " ")
		}
	}
	return sc.Err()
}
