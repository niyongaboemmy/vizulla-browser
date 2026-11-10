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

## 2e. 0.4.3

| Area | Shipped |
|------|---------|
| JavaScript dialogs | `alert`/`confirm`/`prompt` replaced in every frame (Electron has no `prompt`, draws the others natively) by synchronous calls to browser-owned overlay dialogs (`ui/js_dialogs.ts`): "site says" / embedded-frame attribution, prompt with selected default, Enter/Escape, "Don't let this page show more dialogs" from the 2nd dialog, dismissed when the tab closes or navigates; works in installed-app windows. Session preloads now run in iframes (`nodeIntegrationInSubFrames`, still sandboxed/isolated), so fingerprinting protection, Shields scriptlets and element hiding also cover iframes |
| Themes | New profiles follow the computer ("Automatic"); Settings theme cards with previews and a live "now Light/Dark" line; ⋮ menu theme row (stays open); light↔dark cross-fade (View Transitions); solid frames and Windows/Linux caption buttons follow theme changes; private windows get a solid dark frame instead of glass that follows the OS appearance |
| Installable web apps | Manifest parsing with spec URL rules and Chrome's installability criteria (`apps/manifest.ts`); detection on load; address-bar Install pill, one-time hint, ⋮ menu item; `beforeinstallprompt`/`appinstalled` for sites' own buttons; install dialog (editable name, what you get, phone hand-off with QR + iOS/Android steps), icon composed in the overlay (any format, maskable rounded, letter tile fallback); OS integration (`apps/os_integration.ts`): macOS `.app` + `.icns` in ~/Applications/Vizulla Apps, Windows Start-menu/Desktop `.lnk` + `.ico` + own AppUserModelID, Linux `.desktop`; app windows (`apps/app_window.ts`) on the profile session with in-scope navigation, OAuth popups, own dialogs/permissions/context menu/shortcuts; `--vz-app=<id>` launches; `vizulla://apps` (open, restore shortcut, remove, guided empty state) |
| Window frame | Solid and coloured like the visited site, as on phones: its `theme-color` (light/dark variants resolved by Chromium), else its page background, sampled on load and in-page navigation (`common/color.ts`, `tabs/web_tab.ts`); white in light theme and black in dark without one (internal pages, new tab, private windows stay black, high contrast keeps its tokens). Everything in the frame is drawn in one ink chosen for contrast, and on a site colour the frame goes monochrome (no blue-on-blue accents); Windows/Linux caption buttons follow. Soft top sheen, colour changes glide, a light sweep when the window comes forward. No OS see-through material on any platform. Setting: Appearance › "Color the window like the website" (on). Menus, popovers, command bar, dialogs, side panels, internal pages and the new tab page are solid with a soft elevation shadow (`--vz-shadow-pop`) |

Tests: `manifest.test.ts`, `phase17_dialogs_themes_apps.e2e.ts`.

## 2d. 0.4.2

| Area | Shipped |
|------|---------|
| Ad blocking | Full filter lists bundled with the app (EasyList, EasyPrivacy, uBlock Origin filters/privacy/badware/quick fixes, Peter Lowe) plus uBO resources, compiled at build time (`tools/shields_bundle.mjs`; release builds refuse to ship without them). Scriptlets injected before page scripts (YouTube/pre-roll ads); generic element hiding driven by the classes/ids/links on the page; `$popup` and page-initiated `$document` rules; Chrome's popup rule (a tab only right after a real click or key, one per gesture) with a "Pop-up blocked — Open" toast; regional Rwanda rules (IGIHE) |
| Speed | Same-site hover prefetch through Speculation Rules (state-changing links excluded; never other sites or private windows), V8 code cache on first visit |
| Screenshots | "Visible area" and "Whole page"; whole page scrolls and stitches (lazy content loads, fixed/sticky elements once, inner scrollers, scrollbars hidden, position restored), DevTools capture as fallback |
| Fonts | Sites always keep their own fonts; Settings → Appearance sets fonts for pages without one, and a minimum size |
| UI | Tab tooltips that don't fit in the chrome are drawn in a small view above the page (`ui/tip_view.ts`); one glass surface for tabs, toolbar, sidebar and panels (`under-window` vibrancy, sheen and edge highlight, no separator lines); the current tab is a pill like the address field; palette without violet (`indigo` renders as Vizulla blue, `violet` as coral; stored keys unchanged); Space buttons with a ring and a spring when switching, "+" turns on hover, the address field glows on focus (all off with Reduce Motion) |

Tests: `phase16_privacy.e2e.ts`, updated `phase1`/`phase3`/`phase12`.

## 2c. Since 0.4.0

| Area | Shipped |
|------|---------|
| Permissions | All 37 Chromium/Electron capabilities catalogued with Chrome's defaults (ask / allow / block), changeable per kind in Settings; camera and microphone separate; prompt with allow while visiting / allow this time / never; embargo after 3 dismissals (7 days); secure-context rule; device choosers for USB, serial, HID and Bluetooth with remembered grants; screen-sharing picker (screens, windows, tabs, audio where supported); file-editing prompts that are never remembered beyond the visit; in-use indicators in the tab and the address bar; site-info panel from the lock icon |
| Site technologies | Tools → Site technologies: ~170 fingerprints (headers, cookies, meta, globals, scripts, resources, DOM, markup), versions and confidence, implied technologies, copyable report; runs only on demand |
| Speed | Adaptive Memory Saver (sooner on battery or low memory), unchanged window state not resent, Task Manager "Put background tabs to sleep" |
| Privacy & security | Clean Links (tracking parameters stripped, redirect hops skipped), Global Privacy Control on by default (native Chromium, no header hook), WebRTC IP-leak protection, cross-site pings blocked, Clear on exit (opt-in), Settings privacy checkup with one-click fix; tab close × centred (see [10-privacy-security-review.md](../10-privacy-security-review.md); `link_privacy.test.ts`, `phase16_privacy.e2e.ts`) |

## 2b. Since 0.3.5 (0.4.0, see PLAN_0.4.md)

| Area | Shipped |
|------|---------|
| Extensions | Chrome Web Store install, vizulla://extensions (on/off, details, remove, developer mode), toolbar buttons with badges and popups, puzzle menu with pinning, context-menu items, onInstalled, no extensions in private windows |
| Speed | No per-request header hooks (third-party cookies blocked natively), web hook limited to network schemes, one page-config call per frame, lighter password detector, omnibox preconnect, Task Manager (Shift+Esc) |
| Privacy | Ads blocked by default with an Ads & trackers panel (allow per site or everywhere, trackers stay blocked), strict mode that blocks known trackers beyond the lists, private windows: own start page, dark, capture protection, strict fingerprinting, Touch ID lock, close all, no leaks to the privacy log |
| Search | ~75 Vizulla destinations with keywords in EN/FR/SW/RW, Settings deep links, @tabs/@history/@bookmarks/@settings/@tools, search-engine suggestions through a cookie-free session (never in private) |
| Tools & glass | Tools menu (screenshot, full-page screenshot, PDF, print, QR, read aloud, PiP, colour picker, clear site data, Copy as Markdown, Task Manager), glass ⋮ menu, Mica on Windows 11, frosted internal pages and panels |
| Developers | F12 / inspect element / view source, JSON viewer, local MCP server for AI coding tools (token, origin/host checks, per-tool approval, list_tabs, open_url, read_page, screenshot, console_logs) |

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
| Extension compatibility (EXT-01) | Since 0.4: Chrome Web Store installs and the common `chrome.*` APIs via electron-chrome-extensions / electron-chrome-web-store (verified with Dark Reader). Still missing: `chrome.commands`, some `tabs` methods. The ≥ 95% target is not measured yet. |
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
