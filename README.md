# Vizulla

A calm, private, AI-native browser on the Chromium engine (Blink + V8). Product and architecture docs are in [docs/](docs/README.md). Status against the implementation plan is in [docs/09-implementation/IMPLEMENTATION_STATUS.md](docs/09-implementation/IMPLEMENTATION_STATUS.md).

## Quick start

Requirements: Node ≥ 22, Go ≥ 1.24 (cloud services), macOS / Windows / Linux.

```bash
npm install                      # Electron is downloaded into .cache/electron
node tools/vz.mjs doctor         # check the toolchain
node tools/vz.mjs run --profile tmp   # build and launch with a throwaway profile
```

Optional local cloud services:

```bash
cd cloud && go run ./cmd/gateway      # AI Gateway on :8787 (mock model unless ANTHROPIC_API_KEY / OPENAI_API_KEY are set)
cd cloud && go run ./cmd/syncserver   # E2EE sync server on :8788
```

## The `vz` CLI

| Command | Does |
|---|---|
| `vz build [--release] [--watch]` | Bundles browser process, preloads, utility processes, and WebUI into `out/` |
| `vz run [--profile tmp]` | Build and launch |
| `vz test unit\|e2e\|cloud\|all` | vitest · Playwright (Electron) · `go test` · everything |
| `vz lint` | Typecheck, string coverage (FR must be 100%), feature-flag hygiene |
| `vz doctor` | Toolchain check |

Release helpers: `npm run sbom` (CycloneDX SBOM), `npm run lists` (compile + sign Shields filter lists).

## Layout

```
vizulla/                 client (mirrors src/vizulla/ in the handbook)
  app/                   entry point, branding, bundled resources (Shields baseline + keys)
  browser/               browser-process services
    ai/                  assistant, context builder, prompts, citations, providers, router, runtime host
    agent/               plan model, Policy Enforcer, actuator, agent session, planners, Action Log
    command_bar/         command registry, deterministic classifier, suggestions, NL commands
    memory/ notes/ sync/ shields/ spaces/ tabs/ history/ passwords/ importers/ privacy/ …
    ui/                  window controller, overlay layer, IPC router, vizulla:// protocol, pages
  common/                types, i18n, URL rules, design tokens, IPC contracts (common/mojom)
  components/            utility processes: ai_runtime, memory_index; Shields engine
  preload/               WebUI bridge, fingerprinting protection
  resources/webui/       Lit front-ends: chrome (shell), overlay, and every vizulla:// page
  strings/               en, fr (complete), rw, sw (drafts pending native review)
  test/e2e/              Playwright suites, one per phase
cloud/                   Go: AI Gateway, sync server
tools/                   vz CLI, SBOM, filter-list pipeline, release templates
```

Feature flags: `vizulla://flags`, or `--enable-features=VizullaAgent,VizullaAgentStageB` on the command line. The task agent is off by default and also needs the tester opt-in in Settings → Task agent.
