package syncserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const chain = "0123456789abcdef0123456789abcdef"
const token = "tok-0123456789abcdef0123456789abcdef"

func do(t *testing.T, ts *httptest.Server, method, path, tok string, body any) (int, string) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, r)
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestCiphertextOnlyFlow(t *testing.T) {
	dir := t.TempDir()
	state := filepath.Join(dir, "state.json")
	ts := httptest.NewServer(New(state).Handler())
	defer ts.Close()
	if c, _ := do(t, ts, "PUT", "/v1/chains/"+chain, "", map[string]string{"token": token}); c != 201 {
		t.Fatalf("create %d", c)
	}
	if c, _ := do(t, ts, "PUT", "/v1/chains/"+chain, "", map[string]string{"token": "wrong-token-0123456789abcdef012345"}); c != 403 {
		t.Fatalf("join with wrong token %d", c)
	}
	if c, _ := do(t, ts, "PUT", "/v1/chains/"+chain, "", map[string]string{"token": token}); c != 200 {
		t.Fatalf("join %d", c)
	}
	rec := map[string]any{"records": []map[string]any{{"type": "bookmarks", "id": strings.Repeat("ab", 16), "blob": "Q0lQSEVSVEVYVA=="}}}
	if c, b := do(t, ts, "POST", "/v1/chains/"+chain+"/records", token, rec); c != 200 || !strings.Contains(b, `"seq":1`) {
		t.Fatalf("push %d %s", c, b)
	}
	if c, _ := do(t, ts, "POST", "/v1/chains/"+chain+"/records", "nope", rec); c != 401 {
		t.Fatal("push without auth accepted")
	}
	_, b := do(t, ts, "GET", "/v1/chains/"+chain+"/records?since=0", token, nil)
	if !strings.Contains(b, "Q0lQSEVSVEVYVA==") {
		t.Fatalf("pull %s", b)
	}
	_, b = do(t, ts, "GET", "/v1/chains/"+chain+"/records?since=1", token, nil)
	if !strings.Contains(b, `"records":[]`) {
		t.Fatalf("incremental pull %s", b)
	}
	// The token itself is never stored, only its hash.
	raw, _ := os.ReadFile(state)
	if strings.Contains(string(raw), token) {
		t.Fatal("token stored in clear")
	}
	// Survives restart.
	ts2 := httptest.NewServer(New(state).Handler())
	defer ts2.Close()
	if c, b := do(t, ts2, "GET", "/v1/chains/"+chain+"/records?since=0", token, nil); c != 200 || !strings.Contains(b, "Q0lQ") {
		t.Fatalf("after restart %d %s", c, b)
	}
}

func TestValidation(t *testing.T) {
	ts := httptest.NewServer(New("").Handler())
	defer ts.Close()
	do(t, ts, "PUT", "/v1/chains/"+chain, "", map[string]string{"token": token})
	bad := []map[string]any{
		{"type": "../etc", "id": strings.Repeat("ab", 16), "blob": "x"},
		{"type": "bookmarks", "id": "not-hex", "blob": "x"},
		{"type": "bookmarks", "id": strings.Repeat("ab", 16), "blob": strings.Repeat("x", MaxBlobBytes+1)},
	}
	for _, r := range bad {
		if c, _ := do(t, ts, "POST", "/v1/chains/"+chain+"/records", token, map[string]any{"records": []any{r}}); c != 400 {
			t.Fatalf("accepted bad record %v: %d", r["type"], c)
		}
	}
	if c, _ := do(t, ts, "PUT", "/v1/chains/xyz", "", map[string]string{"token": token}); c != 400 {
		t.Fatal("bad chain id accepted")
	}
}

func TestDevicesAndLeave(t *testing.T) {
	ts := httptest.NewServer(New("").Handler())
	defer ts.Close()
	do(t, ts, "PUT", "/v1/chains/"+chain, "", map[string]string{"token": token})
	dev := strings.Repeat("cd", 16)
	if c, _ := do(t, ts, "PUT", "/v1/chains/"+chain+"/devices/"+dev, token, map[string]string{"name_enc": "enc"}); c != 204 {
		t.Fatalf("register %d", c)
	}
	_, b := do(t, ts, "GET", "/v1/chains/"+chain+"/devices", token, nil)
	if !strings.Contains(b, dev) {
		t.Fatal(b)
	}
	do(t, ts, "DELETE", "/v1/chains/"+chain+"/devices/"+dev, token, nil)
	if c, _ := do(t, ts, "DELETE", "/v1/chains/"+chain, token, nil); c != 204 {
		t.Fatal("delete chain")
	}
	if c, _ := do(t, ts, "GET", "/v1/chains/"+chain+"/records", token, nil); c != 401 {
		t.Fatal("deleted chain still readable")
	}
}
