# Vizulla 0.4 plan: extensions, private mode, ads panel, tools, search, speed, developers

Status: implemented (0.4.0). All seven phases built and tested; see IMPLEMENTATION_STATUS.md §2b.

## 1. Research summary

### Extensions
- Electron 45 loads **unpacked** MV3/MV2 extensions per session (`session.extensions.loadExtension`), but only a DevTools-oriented subset of `chrome.*`. Loaded extensions are not remembered: they must be loaded on every start. In-memory (private) sessions can't load extensions.
- `electron-chrome-extensions` 4.10 (MIT) adds the APIs real extensions use: `action` (toolbar button, popup, badge), `tabs`, `windows`, `contextMenus`, `cookies`, `notifications`, `runtime`, `storage`, `webNavigation`. The app tells it about tabs (`addTab`/`selectTab`) and how to create/select/remove tabs and windows.
- `electron-chrome-web-store` 0.13 (MIT) installs extensions **from the Chrome Web Store by ID or store URL**, unpacks the CRX, verifies it, loads it, and auto-updates (startup + every 5 h).
- Gaps (from its API table): `chrome.commands`, `tabs.move/duplicate/captureVisibleTab`, `contextMenus.update`, `notifications.onButtonClicked`. Extensions that depend on those degrade. This meets "install, manage and use like Chrome" for the large majority (ad blockers, Dark Reader, password managers, Grammarly-style content scripts, React/Vue DevTools), not 100 % of the store, and the UI says so honestly.

### Search suggestions (what people look for in a browser)
- Chrome's omnibox mixes: URL completion, history, bookmarks, open tabs, search-engine suggestions, "Search tabs/history/bookmarks" scopes (`@tabs`, `@history`, `@bookmarks`), actions ("clear browsing data", "manage passwords", "update Chrome") and settings pages.
- Vizulla already has tabs, history, bookmarks, commands and memory rows. Missing: **settings sections and internal pages as destinations**, **actions phrased the way people type them** ("delete history", "block ads", "dark mode", "change search engine", "incognito"), **`@` scopes**, and **search-engine suggestions**.
- Decision: a local catalog of ~80 destinations/actions with keywords in EN/FR/SW/RW (zero network), plus engine suggestions from the chosen search engine (on by default in normal windows, never in private windows, switchable in Settings → Privacy).

### Private mode (Chrome Incognito, modernised)
- Chrome Incognito: separate in-memory session, nothing saved, third-party cookies blocked, extensions off by default, dark UI, explanatory start page, "close all Incognito windows", and on mobile a **lock** that needs biometrics to reopen. Chrome 2025+ adds fingerprinting and IP protections in Incognito.
- Vizulla gaps found: shields counts from private tabs are written to the persistent privacy log; fingerprint protection isn't registered on private sessions; settings changed in a private window persist; no private start page.
- Modernisation: private start page that says exactly what is and isn't protected; strict fingerprinting, third-party cookies blocked, HTTPS-First and engine suggestions off in private; **screen-capture protection** for private windows (macOS/Windows content protection); **lock private windows with Touch ID** when the app is hidden or idle; "Close all private windows"; a distinct dark-glass look.

### Ads
- Shields blocks ads, trackers and cookie banners; per-site exceptions exist. `shields.aggressive` is never read (dead setting). There is no dedicated ads control.
- Decision: an **Ads & trackers panel** (toolbar chip) and a Settings section: "Show ads" (off by default), per-site "allow ads on this site", separate switches for trackers, annoyances (cookie banners, newsletter pop-ups via cosmetic rules), social widgets; live counts; "aggressive" made real (stricter lists + cosmetic rules).

### Tools menu
- Most-used simple browser tools (Chrome/Edge/Arc/Opera menus and "more tools"): screenshot (visible / full page), save as PDF, print, QR code / share link, reader view, read aloud, find in page, zoom, picture-in-picture, colour picker, clear site data, task manager.
- Decision: a glass **Tools** popover (toolbar wrench + ⋮ menu + command bar) with those tools; all local, no network.

### Speed (heavy web apps)
- Found: two preload scripts (language, fingerprinting) make a **synchronous IPC call on every page and frame**, blocking the renderer each time; the password detector observes **every style/class change** on every page (heavy SPAs mutate constantly); session restore loads every tab at start; Memory Saver reads only the default profile's prefs; no GPU rasterisation switches.
- Decision: config delivered through a generated preload file (no sync IPC); password detector watches inserted nodes only; lazy restore (only the visible tab loads); GPU rasterisation + zero-copy; Memory Saver per profile with levels; **Task Manager** (per-tab CPU and memory, end process).

### Developers (AI era)
- Standard shortcuts missing: F12, Ctrl/⌘+Shift+C (inspect), Ctrl/⌘+U (view source).
- Most attractive in the AI era: let coding agents (Claude Code, Cursor, VS Code) see and drive the browser through **MCP**, locally and with consent; give LLMs clean page context (**Copy page as Markdown**); built-in **JSON viewer**; DevTools extensions (React/Vue) from the store.

## 2. Phases

| # | Phase | Ships |
|---|-------|-------|
| 1 | Extensions | Chrome Web Store install (button on store pages, paste URL/ID, drag a .crx/.zip or "Load unpacked"), vizulla://extensions (enable/disable, remove, details, permissions, site access, errors, update now, developer mode), puzzle-piece menu with pin to toolbar, extension buttons + popups + badges, context-menu items, chrome.tabs/windows wired to Vizulla tabs, auto-update, off in private windows. |
| 2 | Speed | No sync IPC in page scripts, lighter password detector, lazy session restore, GPU switches, Memory Saver per profile + levels, Task Manager. |
| 3 | Privacy | Private-mode overhaul (leaks fixed, start page, strict defaults, capture protection, Touch ID lock, close-all), Ads & trackers panel + settings, "aggressive" made real. |
| 4 | Search | Destination/action catalog (4 languages), `@tabs/@history/@bookmarks/@settings/@tools` scopes, settings deep links, engine suggestions (opt-out; never in private). |
| 5 | Tools & glass | Glass app menu (replaces the native ⋮ menu) with a Tools section; screenshot, PDF, print, QR, read aloud, PiP, colour picker, clear site data; glass pass on panels, menus, popovers; Windows 11 Mica. |
| 6 | Developers & interaction | F12 / inspect / view-source shortcuts, JSON viewer, Copy as Markdown, local MCP server (opt-in, token, per-client approval), tab hover cards, click-to-mute. |
| 7 | Regression & release | Full unit + E2E + accessibility runs, docs, release. |

## 3. Testing
Each phase adds unit tests for its logic and E2E tests for its user flows (a local test extension fixture for Phase 1; a frame-heavy page for Phase 2; private-session assertions for Phase 3). Phase 7 runs everything, plus manual checks of the packaged app.

## 4. Risks
- Electron MV3 service-worker bugs can break individual extensions; mitigated by testing with a fixture extension and showing load errors per extension.
- Chrome Web Store downloads need network; offline shows a clear error.
- MCP gives external tools browser access; off by default, localhost only, token + per-client approval, never in private windows, all actions logged.
