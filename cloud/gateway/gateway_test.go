package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T, cfg Config) (*httptest.Server, *bytes.Buffer) {
	t.Helper()
	logs := &bytes.Buffer{}
	if cfg.Secret == nil {
		cfg.Secret = []byte("test-secret")
	}
	if cfg.Route == nil {
		cfg.Route = func(string) []Provider { return []Provider{Mock{}} }
	}
	cfg.Logger = slog.New(slog.NewJSONHandler(logs, nil))
	ts := httptest.NewServer(New(cfg).Handler())
	t.Cleanup(ts.Close)
	return ts, logs
}

func token(t *testing.T, base string) string {
	res, err := http.Post(base+"/v1/device", "", nil)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("device: %v %v", err, res.StatusCode)
	}
	var v struct {
		Token string `json:"token"`
	}
	json.NewDecoder(res.Body).Decode(&v)
	return v.Token
}

const secretPrompt = "SECRET-PROMPT-CONTENT about the pricing page"

func chat(t *testing.T, base, tok string, msgs []Message) (*http.Response, string) {
	body, _ := json.Marshal(ChatRequest{Model: "claude-haiku-5-5", Messages: msgs})
	req, _ := http.NewRequest("POST", base+"/v1/chat", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

var page = []Message{{Role: "system", Content: "rules"}, {Role: "user", Content: "<chunk id=\"c1\" origin=\"https://a\">\nPro costs $12 per month. Team costs more.\n</chunk>\n\nQuestion: " + secretPrompt}}

func TestStreamsCitedAnswerAndMetersWithoutContent(t *testing.T) {
	ts, logs := newTestServer(t, Config{Region: "af-kigali"})
	res, body := chat(t, ts.URL, token(t, ts.URL), page)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("status %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	var text string
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "data: ") {
			var d struct{ T string }
			json.Unmarshal([]byte(line[6:]), &d)
			text += d.T
		}
	}
	if text != "Pro costs $12 per month. [c1]" {
		t.Fatalf("answer %q", text)
	}
	if res.Header.Get("X-Vizulla-Region") != "af-kigali" {
		t.Fatal("region header missing")
	}
	if strings.Contains(logs.String(), "SECRET-PROMPT") || strings.Contains(logs.String(), "Pro costs") {
		t.Fatalf("log contains content: %s", logs.String())
	}
	if !strings.Contains(logs.String(), `"msg":"meter"`) || !strings.Contains(logs.String(), `"in_tokens"`) {
		t.Fatalf("no meter record: %s", logs.String())
	}
}

func TestRejectsBadTokens(t *testing.T) {
	ts, _ := newTestServer(t, Config{})
	for _, tok := range []string{"", "garbage", "a.b", token(t, ts.URL) + "x"} {
		if res, _ := chat(t, ts.URL, tok, page); res.StatusCode != 401 {
			t.Fatalf("token %q: status %d", tok, res.StatusCode)
		}
	}
	// A token signed with another secret is rejected.
	other, _ := newTestServer(t, Config{Secret: []byte("other")})
	if res, _ := chat(t, ts.URL, token(t, other.URL), page); res.StatusCode != 401 {
		t.Fatal("foreign token accepted")
	}
}

func TestTokenExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	s := New(Config{Secret: []byte("k"), TokenTTL: time.Hour, Now: func() time.Time { return now }})
	tok := s.issue("dev1", now.Add(time.Hour))
	if _, err := s.verify(tok); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	if _, err := s.verify(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestDailyQuota(t *testing.T) {
	ts, _ := newTestServer(t, Config{DailyRequests: 2})
	tok := token(t, ts.URL)
	for i := 0; i < 2; i++ {
		if res, _ := chat(t, ts.URL, tok, page); res.StatusCode != 200 {
			t.Fatalf("request %d: %d", i, res.StatusCode)
		}
	}
	if res, body := chat(t, ts.URL, tok, page); res.StatusCode != 429 || !strings.Contains(body, "quota") {
		t.Fatalf("expected quota 429, got %d %s", res.StatusCode, body)
	}
}

func TestDeviceIssueRateLimit(t *testing.T) {
	ts, _ := newTestServer(t, Config{})
	codes := map[int]int{}
	for i := 0; i < 25; i++ {
		res, _ := http.Post(ts.URL+"/v1/device", "", nil)
		codes[res.StatusCode]++
	}
	if codes[200] != 20 || codes[429] != 5 {
		t.Fatalf("codes %v", codes)
	}
}

func TestFailoverBeforeStreaming(t *testing.T) {
	ts, logs := newTestServer(t, Config{Route: func(string) []Provider { return []Provider{Mock{Fail: true}, Mock{}} }})
	_, body := chat(t, ts.URL, token(t, ts.URL), page)
	if !strings.Contains(body, "[c1]") || strings.Contains(body, "event: error") {
		t.Fatalf("no failover: %s", body)
	}
	if !strings.Contains(logs.String(), `"ok":true`) {
		t.Fatal("meter should record success")
	}
}

func TestValidatesInput(t *testing.T) {
	ts, _ := newTestServer(t, Config{})
	tok := token(t, ts.URL)
	if res, _ := chat(t, ts.URL, tok, nil); res.StatusCode != 400 {
		t.Fatal("empty messages accepted")
	}
	if res, _ := chat(t, ts.URL, tok, []Message{{Role: "tool", Content: "x"}}); res.StatusCode != 400 {
		t.Fatal("bad role accepted")
	}
}

func TestAnthropicAdapterParsesStream(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "k" {
			w.WriteHeader(401)
			return
		}
		io.WriteString(w, "event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\nevent: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"[c1]\"}}\n\n")
	}))
	defer up.Close()
	var got string
	err := Anthropic{Key: "k", Base: up.URL}.Stream(t.Context(), ChatRequest{Model: "claude", Messages: page}, func(s string) error { got += s; return nil })
	if err != nil || got != "Hi [c1]" {
		t.Fatalf("%v %q", err, got)
	}
	if err := (Anthropic{Key: "bad", Base: up.URL}).Stream(t.Context(), ChatRequest{Messages: page}, func(string) error { return nil }); err == nil {
		t.Fatal("expected auth error")
	}
}
