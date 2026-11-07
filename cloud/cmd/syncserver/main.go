// Command syncserver runs the Vizulla E2EE sync server. ADDR (default :8788), DATA (state file).
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"vizulla.org/cloud/syncserver"
)

func main() {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8788"
	}
	s := syncserver.New(os.Getenv("DATA"))
	slog.Info("sync server listening", "addr", addr)
	srv := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("stopped", "err", err)
		os.Exit(1)
	}
}
