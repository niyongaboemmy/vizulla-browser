// Package syncserver is the Vizulla sync server (P4-CLD-01, SYN-01/02).
//
// It stores ciphertext only. Clients derive everything from a sync code that
// never reaches the server: the chain id (a hash), an auth token (the server
// keeps only its SHA-256), and the encryption key (never sent). Record ids are
// opaque HMACs, so the server cannot see URLs, titles, or settings either.
// No recovery is possible without the code (stated in the UI).
package syncserver

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"sync"
	"time"
)

const (
	MaxBlobBytes = 64 << 10
	MaxItems     = 50_000
	MaxDevices   = 20
	MaxBatch     = 500
)

type Record struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Seq     int64  `json:"seq"`
	Deleted bool   `json:"deleted,omitempty"`
	Blob    string `json:"blob,omitempty"` // base64 ciphertext
}

type Device struct {
	ID       string `json:"id"`
	NameEnc  string `json:"name_enc"`
	LastSeen int64  `json:"last_seen"`
}

type Chain struct {
	AuthHash string             `json:"auth_hash"`
	Seq      int64              `json:"seq"`
	Records  map[string]*Record `json:"records"`
	Devices  map[string]*Device `json:"devices"`
}

type Server struct {
	mu     sync.Mutex
	chains map[string]*Chain
	path   string
	now    func() time.Time
}

func New(path string) *Server {
	s := &Server{chains: map[string]*Chain{}, path: path, now: time.Now}
	if path != "" {
		if b, err := os.ReadFile(path); err == nil {
			json.Unmarshal(b, &s.chains)
		}
	}
	return s
}

var idRe = regexp.MustCompile(`^[0-9a-f]{32,64}$`)
var typeRe = regexp.MustCompile(`^[a-z]{2,20}$`)

func hashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

func (s *Server) persist() {
	if s.path == "" {
		return
	}
	b, _ := json.Marshal(s.chains)
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, s.path)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// auth checks the bearer token against the chain's stored hash (constant time).
func (s *Server) auth(r *http.Request, id string) (*Chain, bool) {
	c := s.chains[id]
	if c == nil {
		return nil, false
	}
	tok := r.Header.Get("Authorization")
	if len(tok) < 8 || tok[:7] != "Bearer " {
		return nil, false
	}
	got := hashToken(tok[7:])
	return c, subtle.ConstantTimeCompare([]byte(got), []byte(c.AuthHash)) == 1
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	// Create or join: the first device creates the chain; later ones must present the same token.
	mux.HandleFunc("PUT /v1/chains/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Token string `json:"token"`
		}
		if !idRe.MatchString(id) || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil || len(body.Token) < 32 {
			writeJSON(w, 400, map[string]string{"error": "bad request"})
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		c := s.chains[id]
		if c == nil {
			s.chains[id] = &Chain{AuthHash: hashToken(body.Token), Records: map[string]*Record{}, Devices: map[string]*Device{}}
			s.persist()
			writeJSON(w, 201, map[string]any{"created": true})
			return
		}
		if subtle.ConstantTimeCompare([]byte(hashToken(body.Token)), []byte(c.AuthHash)) != 1 {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		writeJSON(w, 200, map[string]any{"created": false})
	})
	mux.HandleFunc("DELETE /v1/chains/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if _, ok := s.auth(r, r.PathValue("id")); !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		delete(s.chains, r.PathValue("id"))
		s.persist()
		w.WriteHeader(204)
	})
	mux.HandleFunc("PUT /v1/chains/{id}/devices/{dev}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		c, ok := s.auth(r, r.PathValue("id"))
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		dev := r.PathValue("dev")
		var body struct {
			NameEnc string `json:"name_enc"`
		}
		if !idRe.MatchString(dev) || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
			writeJSON(w, 400, map[string]string{"error": "bad request"})
			return
		}
		if c.Devices[dev] == nil && len(c.Devices) >= MaxDevices {
			writeJSON(w, 429, map[string]string{"error": "too many devices"})
			return
		}
		c.Devices[dev] = &Device{ID: dev, NameEnc: body.NameEnc, LastSeen: s.now().Unix()}
		s.persist()
		w.WriteHeader(204)
	})
	mux.HandleFunc("DELETE /v1/chains/{id}/devices/{dev}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		c, ok := s.auth(r, r.PathValue("id"))
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		delete(c.Devices, r.PathValue("dev"))
		s.persist()
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /v1/chains/{id}/devices", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		c, ok := s.auth(r, r.PathValue("id"))
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		out := []*Device{}
		for _, d := range c.Devices {
			out = append(out, d)
		}
		writeJSON(w, 200, out)
	})
	mux.HandleFunc("POST /v1/chains/{id}/records", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Records []Record `json:"records"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxBatch*(MaxBlobBytes+256))).Decode(&body) != nil || len(body.Records) > MaxBatch {
			writeJSON(w, 400, map[string]string{"error": "bad request"})
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		c, ok := s.auth(r, r.PathValue("id"))
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		for _, rec := range body.Records {
			if !typeRe.MatchString(rec.Type) || !idRe.MatchString(rec.ID) || len(rec.Blob) > MaxBlobBytes {
				writeJSON(w, 400, map[string]string{"error": "bad record"})
				return
			}
		}
		if len(c.Records)+len(body.Records) > MaxItems {
			writeJSON(w, 429, map[string]string{"error": "quota"})
			return
		}
		for _, rec := range body.Records {
			c.Seq++
			rec := rec
			rec.Seq = c.Seq
			if rec.Deleted {
				rec.Blob = ""
			}
			c.Records[rec.Type+"/"+rec.ID] = &rec
		}
		s.persist()
		writeJSON(w, 200, map[string]int64{"seq": c.Seq})
	})
	mux.HandleFunc("GET /v1/chains/{id}/records", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		c, ok := s.auth(r, r.PathValue("id"))
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		out := []*Record{}
		for _, rec := range c.Records {
			if rec.Seq > since {
				out = append(out, rec)
			}
		}
		writeJSON(w, 200, map[string]any{"records": out, "seq": c.Seq})
	})
	return mux
}
