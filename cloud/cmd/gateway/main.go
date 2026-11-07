// Command gateway runs the Vizulla AI Gateway.
//
//	VZ_GATEWAY_SECRET   HMAC secret for device tokens (required in production)
//	ANTHROPIC_API_KEY   enables claude-* models
//	OPENAI_API_KEY      enables gpt-* models
//	VZ_REGION           region label (e.g. "eu-west", "af-kigali") for residency (PRV-04)
//	ADDR                listen address (default :8787)
package main

import (
	"crypto/rand"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"vizulla.org/cloud/gateway"
)

func main() {
	secret := []byte(os.Getenv("VZ_GATEWAY_SECRET"))
	if len(secret) == 0 {
		secret = make([]byte, 32)
		rand.Read(secret)
		slog.Warn("VZ_GATEWAY_SECRET not set: using an ephemeral secret (dev only)")
	}
	anthropicKey, openaiKey := os.Getenv("ANTHROPIC_API_KEY"), os.Getenv("OPENAI_API_KEY")
	route := func(model string) []gateway.Provider {
		switch {
		case strings.HasPrefix(model, "claude") && anthropicKey != "":
			ps := []gateway.Provider{gateway.Anthropic{Key: anthropicKey}}
			if openaiKey != "" {
				ps = append(ps, gateway.OpenAI{Key: openaiKey})
			}
			return ps
		case strings.HasPrefix(model, "gpt") && openaiKey != "":
			return []gateway.Provider{gateway.OpenAI{Key: openaiKey}}
		default:
			return []gateway.Provider{gateway.Mock{}}
		}
	}
	srv := gateway.New(gateway.Config{Secret: secret, Region: envOr("VZ_REGION", "dev"), DailyRequests: 200, DailyTokens: 400_000, Route: route})
	addr := envOr("ADDR", ":8787")
	slog.Info("gateway listening", "addr", addr)
	s := &http.Server{Addr: addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	if err := s.ListenAndServe(); err != nil {
		slog.Error("gateway stopped", "err", err)
		os.Exit(1)
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
