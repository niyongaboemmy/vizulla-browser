# Implementation Status

**Date:** 2026-11-08 · **Applies to:** the code in `vizulla/`, `cloud/`, `tools/`.

## 1. Foundation decision used for this build

The plans assume a Chromium fork (F1/F2, decided at G1). This build uses **Electron 45 (Chromium 156, Blink + V8)**: the "throwaway UX prototype (Electron)" route from P0-BRW-01, carried through every phase. A fork checkout needs ~100 GB of disk and ≥ 32–64 GB of RAM, so it could not be built on the development machine. The module boundaries follow the handbook so the work can move onto a fork. The mapping:

| Plan (fork) | This build |
|---|---|
| `KeyedService` per profile | `Profile.register()` services (`vizulla/browser/profile.ts`) |
| Mojo interfaces + `ReportBadMessage` | Typed contracts in `common/mojom/*.ts`, schema-validated, sender host-checked (`browser/ui/ipc_router.ts`) |
| `chrome://` ↔ `vizulla://` rewrite (DD-6) | A real `vizulla://` scheme with strict CSP, absent from agent sessions |
| Native Views tab strip (DD-2) | Lit WebUI shell + native `WebContentsView` per tab; browser-owned overlay layer for security UI (C9) |
| `URLLoaderFactory` proxy (DD-3) | `RequestPipeline` over `session.webRequest` (Shields, HTTPS-First, 3P cookies, agent egress) |
| `ServiceProcessHost` utility processes | `utilityProcess` via `UtilityHost` (lazy start, idle unload, crash restart + serialized retry) |
| AX tree snapshots (DD-4, DD-11) | Readability-style isolated-world extraction for Q&A; CDP `Accessibility.getFullAXTree` + trusted CDP input for the agent |
| Encrypting SQLite VFS (DD-9) | Row-level AES-256-GCM, with searchable state held only in the `memory_index` process (node:sqlite can't load a VFS) |
| Off-the-record agent profile (DD-10) | A fresh in-memory session partition per task |

## 2. Status by phase

Verification: 862 unit tests (vitest), Go tests for the Gateway and sync server, 34 Electron E2E tests (Playwright). Run with `node tools/vz.mjs test all`.

| Phase | Delivered | Main verification |
|---|---|---|
| Handbook | `vz` CLI, typed IPC contracts, flags with owner/removal date, string resources, design tokens, test tiers | `vz lint`, schema + flag unit tests |
| 0 / 1 Foundation | Branded shell, `vizulla://` pages, Shields (filter engine, signed list pipeline, cosmetic filtering, 3P cookies, HTTPS-First, DoH), importers (Chrome/Edge/Brave/Vivaldi/Opera/Arc/Firefox + password CSV), encrypted password vault with k-anonymity breach check, history/bookmarks/downloads, permissions, session restore | `phase1_foundation.e2e.ts`, Shields/importer/vault unit tests |
| 2 R1 | Vertical tabs, Spaces, groups, pins, archive, Focus, split view, Command Bar (classifier, palette, ≥ 60 commands), assistant (page + PDF Q&A, citations, reveal, disclosure, 6 providers), Go AI Gateway, Privacy Dashboard, Reader, onboarding, Classic mode, settings | `phase2_r1.e2e.ts`, router table (352 combinations), provider contract tests |
| 3 Hardening | WCAG 2.2 AA (axe) on every surface, contrast tokens fixed, CSP/sandbox invariants, fresh-profile privacy check, fuzzers, French 100%, SBOM, release templates, packaging config | `phase3_hardening.e2e.ts`, `test/fuzz.test.ts` |
| 4 R2 | `ai_runtime` and `memory_index` utility processes, model manager (signed manifests, hash checks), device profile, Memory (opt-in, encrypted, hybrid recall, deletion follows history), Notes, NL commands + Ask Settings, intent chips, AI tab grouping, E2EE sync (Go server), fingerprinting protection, cookie-banner reject, rw/sw drafts | `phase4_r2.e2e.ts` |
| 5–6 R3 | Plan validator, deterministic Policy Enforcer (322-case model-free attack suite, 100% green), isolated agent session + egress filter, CDP actuator, heuristic + LLM planners, advisory injection detector, control bar, Esc kill switch, login-page stop, Action Log, build-staleness gating, Stage B confirmations (exact destination/fields, delayed arming), PII handles, egress content matching, session grants | `policy_enforcer.test.ts`, `phase5_6_agent.e2e.ts` |

## 2a. Since 0.2.1

| Area | Delivered | Notes |
|---|---|---|
| Brand | Blue "two panes" V mark (`vizulla/app/icons/icon.svg`), `logo()` in WebUI, blue brand accent | Flat, no shadows |
| Look | No drop shadows; glass = translucency, blur and hairline edges; translucent frame on macOS; fully rounded controls; `<vz-select>`; restyled fields, checkboxes, radios, range; entrance and press animations (reduced-motion respected) | |
| Tabs and windows | Multi-select (Cmd/Ctrl/Shift-click) with batch menu; drag tabs between windows or out into a new one; Move to (new) window; tab search across windows; window titles follow the active tab | `BrowserApp.moveTabs`, `tab_selection.ts` |
| Responsive | Toolbar folds at 760/600 px; tabs shrink to icons then scroll; sidebar narrows then hides; panels capped to half the window; internal pages reflow | Minimum window 400×360 |
| Updates | GitHub Releases check (startup + every 6 h, can be turned off), toolbar button: download → SHA-256 check against `SHA256SUMS.txt` → restart and install | Builds are unsigned, so this is not Squirrel: macOS swaps the .app with a script after quit; Windows runs the NSIS installer silently; AppImage replaces itself; .deb is handed to the user |
| Passwords | Save/update prompt after sign-in, key button (fill, generate), `vizulla://passwords` (search, edit, copy, reveal behind Touch ID, Checkup: compromised/reused/weak, import/export CSV, never-saved list) | Page side runs in an isolated world; fills only into the saved origin; the save dialog never receives the password |
| Search | Custom search engine (https template with one %s) | |
| Profiles | Registry + `vizulla://profiles` picker, toolbar avatar menu | Each profile runs in its own browser process with its own data folder (on macOS each open profile has its own Dock icon). In-process profiles need the services to stop assuming `app.profile`. |
| Languages | English, French, Kiswahili, Kinyarwanda UI; websites get the chosen language (Accept-Language and navigator.language) | sw/rw are machine-drafted and need native-speaker review |

## 3. Not done or not equivalent (open work)

| Item | Why / what remains |
|---|---|
| Chromium fork work: patches, rebases, RBE, perf bots on RD devices, 72 h security drill | Requires the fork (G1 decision) and infrastructure |
| Extension compatibility (EXT-01) | Electron supports only a subset of Chrome extension APIs. Fails the ≥ 95% target; needs the fork. |
| Updater, signing, notarization | `electron-builder` config only; no certificates, no update server |
| Safe Browsing replacement (ID-04), CRLSet/component updater, Widevine | Need vendor contracts / licenses |
| On-device generative model | The runtime ships extractive, embedding, and intent engines; the model manager is ready, but no llama.cpp/MLX engine is integrated (D-6) |
| OS-level sandbox of utility processes | Electron utility processes are not sandboxed like Chromium's; network is denied in JS only (defense in depth, not a boundary) |
| Translation (P4-AI-15), predictive discard, PDF annotation, task manager | Not started |
| Vision fallback (P5-AI-02), WebMCP bridge | Not started; WebMCP flag exists and is off |
| LLM planner against a real model; agent benchmark (AIQ-02) and eval sets (AIQ-01) | Planner code is in place; only the heuristic and scripted planners are tested |
| Sync of history and passwords | Spaces, bookmarks, settings, and open tabs sync today |
| Kinyarwanda and Swahili | Core strings are machine-drafted and must pass native-speaker review (P4-UX-01) before release |
| Windows and Linux | Developed and tested on macOS (Apple Silicon) only |
| Crash ingest, telemetry client | Settings exist (off by default); no backends |
