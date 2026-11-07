# 00 — Engineering Handbook

The conventions every phase relies on. Read this before your first change.

---

## 1. Repositories and layout

| Repo | Contents | Who commits |
|---|---|---|
| `vizulla-core` | Everything under `src/vizulla/`: Vizulla C++, WebUI, Mojo, Rust, `chromium_src/` overrides, `patches/`, tests | All client engineers |
| `vizulla-build` | The `vz` CLI, `.gclient` template, CI pipelines, Siso/RBE config, signing scripts, packaging | PLT, REL |
| `vizulla-cloud` | Gateway, update server, sync server, crash/telemetry ingest, infra-as-code | CLD |
| `vizulla-evals` | AI eval sets (faithfulness, citations, intent, injection, agent tasks), runners, reports | AI, SEC |
| `vizulla-site-lists` | Frozen test lists: W30 workload, top-100 extensions, site-compat list, WPR archives | REL |

Upstream Chromium is **not** forked as a git repo. It is checked out by `gclient` at a pinned Stable tag. Our changes live only in `vizulla-core`, as overlay code, overrides, and patches.

```
vizulla-src/                      # workspace root (created by `vz init`)
├── .gclient                      # generated: chromium @ <stable tag> + vizulla-core
├── src/                          # upstream Chromium (never committed to)
│   ├── chrome/ content/ …
│   └── vizulla/                  # ← vizulla-core checkout
│       ├── DEPS                  # pins the Chromium tag + Vizulla-only third_party deps
│       ├── BUILD.gn
│       ├── build/                # vizulla.gni (args), patch tooling hooks
│       ├── app/                  # branding, icons, installer resources, channel config
│       ├── browser/              # browser-process C++ (see doc 05 §9)
│       ├── components/           # self-contained components + utility services
│       ├── renderer/             # renderer-side code (cosmetic filters, later agent actuator)
│       ├── common/mojom/         # .mojom interfaces
│       ├── resources/webui/      # TypeScript + Lit front-ends
│       ├── rust/                 # Rust crates (filter engine bridge)
│       ├── chromium_src/         # override shims mirroring upstream paths
│       ├── patches/              # numbered *.patch against upstream
│       ├── grit/ strings/        # .grd/.grdp string resources
│       └── test/                 # browser_tests, unit tests, data
└── out/                          # build outputs (Default, Release, Official)
```

---

## 2. Machine setup

| Item | Requirement |
|---|---|
| Disk | ≥ 250 GB free on an SSD (checkout ≈ 100 GB + builds) |
| RAM | ≥ 64 GB recommended. 32 GB works with distributed builds. |
| CPU | As many cores as possible, or use remote build (§3.3) |
| OS toolchain | **Windows:** Visual Studio 2022 with the Windows SDK version upstream requires at the tag. **macOS:** Xcode version upstream requires. **Linux:** run `install-build-deps.sh` from upstream. |
| Tools | `depot_tools` on `PATH`, Python 3, Node (the version `vz` pins), Rust toolchain from upstream's `//tools/rust` (do not use your own rustc) |

Always follow upstream's per-platform build instructions for the pinned tag. `vz doctor` checks the versions.

---

## 3. The `vz` CLI and daily workflow

`vz` (in `vizulla-build`) wraps `gclient`, patching, GN, and Siso so everyone runs the same steps.

| Command | Does |
|---|---|
| `vz init` | Writes `.gclient`, runs `gclient sync` at the pinned tag, applies patches, runs hooks |
| `vz sync` | Re-syncs after a tag bump or a `DEPS` change. Re-applies patches cleanly. |
| `vz patch apply` / `vz patch update` | Applies `patches/*.patch` to `src/` / regenerates the patch files from your working changes in `src/` |
| `vz gen <config>` | Runs `gn gen` with a preset: `debug`, `release`, `official`, `asan` |
| `vz build [target]` | Builds (default target: `vizulla` = the browser) with Siso |
| `vz test <suite> [--filter]` | Runs `vizulla_unittests`, `vizulla_browser_tests`, or upstream suites |
| `vz run [--profile tmp]` | Launches the build with a throwaway profile |
| `vz rebase <new-tag>` | The rebase helper: bumps the tag, re-syncs, applies patches with a 3-way merge, and reports conflicts per patch |
| `vz doctor` | Checks the toolchain, disk, and auth for remote build |

### 3.1 GN presets

```gn
# vizulla/build/args/debug.gn
import("//vizulla/build/args/common.gn")
is_debug = true
is_component_build = true        # fast incremental links
symbol_level = 1

# vizulla/build/args/common.gn
vizulla_build = true             # declared in //vizulla/build/vizulla.gni
is_chrome_branded = false
enable_nacl = false
proprietary_codecs = true        # H.264/AAC: licensing reviewed (Phase 1, P1-PLT-09)
ffmpeg_branding = "Chrome"
google_api_key = ""              # no Google API keys (SRS C4)
google_default_client_id = ""
google_default_client_secret = ""
enable_reporting = true

# vizulla/build/args/official.gn
import("//vizulla/build/args/common.gn")
is_official_build = true         # PGO and LTO as upstream does at this tag
is_debug = false
symbol_level = 1
```

Exact args are confirmed in Phase 1. The `official` preset is what the perf bots and releases use (SRS §7.2).

### 3.2 A normal day

```bash
vz sync                              # morning: pick up teammates' DEPS/patch changes
vz build && vz run --profile tmp     # iterate
vz test vizulla_unittests --filter='Spaces*'
vz test vizulla_browser_tests --filter='SpacesBrowserTest.*'
git -C src/vizulla push              # PR in vizulla-core
```

### 3.3 Remote build

A full Chromium build takes 2–4 h on a high-core machine. Use **Siso with a Remote Build Execution (RBE)-compatible backend** (self-hosted Buildbarn, or a hosted RBE service), plus a shared cache. Phase 1 sets this up (P1-PLT-04). Target: an incremental build under 5 min, and a clean build from cache under 30 min.

---

## 4. Patch policy

Upstream patches are the cost driver of every rebase. Choose the mechanism with the smallest footprint:

| Preference | Mechanism | Use when | Example |
|---|---|---|---|
| 1 | **Pure overlay code** in `vizulla/` registered through existing extension points | Upstream already exposes a hook | A `KeyedService`, a side panel entry, a WebUI page, an autocomplete provider |
| 2 | **Upstream delegate / embedder hook** | `ChromeContentBrowserClient`, `ChromeBrowserMainExtraParts`, observer interfaces | Registering the Shields `URLLoaderFactory` proxy |
| 3 | **`chromium_src/` override** | We must change behavior inside one upstream file | Changing the default value of a feature, swapping the class a factory creates |
| 4 | **Numbered patch** in `patches/` | No other way. Keep it to a few lines that call into `vizulla/`. | Inserting the vertical tab region into `BrowserView` layout |

### 4.1 How `chromium_src/` overrides work

A file at `vizulla/chromium_src/<upstream path>` replaces `src/<upstream path>` at compile time (a compiler-wrapper redirect, the same idea as Brave's). The override normally `#include`s the original and changes it with small, local macros or by adding a subclass:

```cpp
// vizulla/chromium_src/chrome/browser/ui/browser_command_controller.cc
#include "vizulla/browser/ui/vizulla_commands.h"

// Route our extra command IDs to Vizulla before upstream handles the rest.
#define VIZULLA_EXECUTE_COMMAND_HOOK \
  if (vizulla::ExecuteVizullaCommand(browser_, id)) return true;

#include "src/chrome/browser/ui/browser_command_controller.cc"  // the original
#undef VIZULLA_EXECUTE_COMMAND_HOOK
```

The macro still needs a one-line insertion point upstream, so it is a patch too. Overrides that only redefine names are cheaper. Choose per case, and say why in the PR.

### 4.2 Patch rules

1. **Every patch line calls into `vizulla/`, or is a hook point.** No feature logic in patches.
2. **Each patch has a header** stating its purpose, owner, and whether an upstream contribution is possible.
3. **Patch budget:** PLT sets a budget (patch files and patched lines) at the start of each phase. Exceeding it needs PLT-lead approval and a plan to shrink it (MNT-01).
4. **Upstream first:** if a hook would help other embedders, propose it upstream. Every upstreamed hook is a patch we no longer carry.
5. `vz patch lint` runs in CI and rejects patches without a header or with unchanged context larger than needed.

---

## 5. Chromium integration patterns

| Need | Pattern | Notes |
|---|---|---|
| Per-profile state and logic | `KeyedService` + `ProfileKeyedServiceFactory` | E.g. `SpacesService`, `ShieldsService`, `AssistantService`. Declare which profiles it serves (regular, incognito, guest). |
| Startup hooks | `ChromeBrowserMainExtraParts` subclass added by a small patch | Registers global services, the filter-list loader, etc. |
| Network interception | `ChromeContentBrowserClient::WillCreateURLLoaderFactory` via an override | Proxy factory for Shields (DD-3) and later agent egress (Phase 5) |
| Renderer behavior | `ChromeContentRendererClient` override + a `RenderFrameObserver` | Cosmetic filtering |
| Settings | Prefs registered in `RegisterProfilePrefs` from our code. UI in a WebUI settings section. | Never read prefs from renderers |
| Commands and shortcuts | Command IDs in `vizulla_command_ids.h`, accelerator table override | Keep Chrome-compatible defaults (USE-03) |
| Internal pages | `WebUIConfig` + `MojoWebUIController` + a `PageHandler` Mojo interface | The page talks to the browser only through its Mojo `PageHandler` |
| Side panels | Register a `SidePanelEntry` with the side panel registry | Assistant (R1), Notes (R2), Agent and Action Log (R3) |
| Utility services (R2+) | `content::ServiceProcessHost::Launch<mojom::X>()` with a sandbox type | `ai_runtime`, `memory_index`. Never in-process. |
| Background work | `base::ThreadPool` with task traits. No new raw threads. | Use `SequenceChecker` |

---

## 6. Browser UI

| Surface | Tech | Why |
|---|---|---|
| Window frame, vertical tab list, Command Bar field, agent control bar, confirmation dialogs | **Native Views** (C++) | Hot paths, drag-and-drop, startup cost, and security UI that pages must not be able to spoof (DD-2, C9) |
| Assistant panel, Space switcher menus, archive, settings sections, Privacy Dashboard, onboarding, `vizulla://` pages | **WebUI** (TypeScript + Lit) | Fast iteration, rich layout |

**WebUI rules**
- Build with upstream's `build_webui` GN template. TypeScript strict mode. Lit components, reusing upstream `cr_elements` where they fit.
- Communication only through Mojo `PageHandler`/`Page` pairs. No `chrome.send`.
- No remote code. Everything ships in resources. A strict Content Security Policy.
- WebUI renderers count toward PERF-02. Lazily create panels on first open.

**Design tokens:** colors, spacing, and type scale come from a shared token file used by both Views (color mixers) and WebUI (CSS custom properties). Light, dark, high-contrast, and accent colors come from one source (SET-03).

---

## 7. Feature flags

| Layer | Mechanism | Use |
|---|---|---|
| Compile-time | GN `vizulla_enable_<x>` | Only for code that must not ship at all on some platforms (e.g. no agent code in a Stable build before G5) |
| Runtime default | `BASE_FEATURE(kVizullaSpaces, "VizullaSpaces", base::FEATURE_DISABLED_BY_DEFAULT)` | Every feature. Flipped to enabled-by-default at its release gate. |
| User toggle | An entry in `vizulla://flags` (upstream flags page, via override) | Nightly/Beta testing |
| Remote config | **Our own variations seed server** (upstream variations framework, pointed at a Vizulla URL) | Staged rollouts, kill switches, the agent-tester audience ([roadmap §2.1](../07-roadmap-and-decisions.md#21-feature-flags-and-audiences-resolves-the-v01-agent-behind-a-flag-ambiguity)) |

Naming: `kVizulla<Feature>`. Every flag has an owner and a removal date in `vizulla/browser/vizulla_features.cc`. Flags are removed within two releases after reaching 100%.

---

## 8. Testing

| Level | Framework | Runs | Required for |
|---|---|---|---|
| Unit | gtest / `base::test::TaskEnvironment` | Every PR | All C++ logic |
| Browser tests | `InProcessBrowserTest` (`vizulla_browser_tests`) | Every PR (sharded) | UI, cross-process, IPC |
| Interactive UI tests | `interactive_ui_tests` (focus, drag, keyboard) | Every PR for touched areas, nightly in full | Tab strip, Command Bar, keyboard paths |
| WebUI tests | Mocha in the WebUI test harness | Every PR | WebUI components |
| Rust | `cargo test` via GN `rust_static_library` test targets | Every PR | Filter engine bridge |
| Upstream subsets | `browser_tests`, `unit_tests`, `content_browsertests` (selected shards) | Nightly | Catching patch breakage |
| WPT | `run_wpt_tests.py` (M-WPT) | Nightly + every rebase | CORE-01 |
| Extensions | M-EXT harness | Weekly + every rebase | EXT-01 |
| Perf | Crossbench (Speedometer/JetStream), memory-infra traces, startup traces on RD-1/RD-2 | Nightly on official builds | PERF-* |
| AI evals | `vizulla-evals` runners | Every PR touching prompts/models (smoke set), nightly (full) | AIQ-* |
| Fuzzing | libFuzzer targets (filter list parser, content extractor, Mojo boundaries) | Continuous | SEC |

**Flaky tests** are quarantined within 24 h, with a ticket. Quarantine is not a fix.

---

## 9. Mojo and process conventions

1. **Interfaces live in `vizulla/common/mojom/`.** Name them by capability (`AssistantPageHandler`, `AiRuntime`), not by implementation.
2. **Never trust the less-privileged side.** Browser-side implementations validate every argument coming from renderers, WebUI, and utility processes (sizes, enums, origins). Use `mojo::ReportBadMessage` on violations.
3. **Origins come from the browser.** Never accept an origin claimed by a renderer. Use `RenderFrameHost::GetLastCommittedOrigin()`.
4. **No secrets across IPC to lower-privilege processes.** API keys and vault data stay in the browser process (C8).
5. **Untrusted text carries a `TrustLevel` and an origin** from the moment it is extracted ([doc 05 §9.1](../05-architecture-prototype.md#91-example-mojo-interface)).
6. **Big payloads** (page text, model weights) use `mojo_base.mojom.BigString` or shared memory / file handles, not giant strings.
7. **Every new interface gets a SEC review** and a fuzzer if it parses untrusted input.

---

## 10. Cloud services

| Service | Stack | Data it holds |
|---|---|---|
| AI Gateway | Go, HTTP/2 + SSE streaming, provider adapters, Postgres for accounts/quotas, Redis for rate limits | Metering only (tokens, time, account). Never prompts or outputs (C14). |
| Update server | Omaha protocol server (DD-7), signed manifests, CDN-backed binaries | Version pings without identifiers |
| Variations / remote config | Static signed seed files on the CDN | — |
| Filter-list & model CDN | Object storage + CDN. Signed manifests (ed25519), hash-pinned artifacts. | — |
| Crash ingest | Crashpad-compatible minidump server (opt-in) with symbol storage | Minidumps, kept 90 days |
| Sync server (R2) | Go, ciphertext-only storage | Encrypted blobs |

Infra is managed as code (Terraform or equivalent) with staging and production environments. The Gateway runs in at least two regions, one of them an option close to Rwanda for data residency (PRV-04).

---

## 11. CI/CD and release trains

### 11.1 CI tiers

| Tier | Trigger | Runs | Time budget |
|---|---|---|---|
| **PR** | Every PR to `vizulla-core` | Incremental build (Linux + Windows + macOS), Vizulla unit + browser tests, WebUI tests, `vz patch lint`, clang-format/`gn format`/eslint, AI smoke evals if prompts changed | ≤ 45 min |
| **Nightly** | 02:00 UTC | Official builds on R1 platforms, upstream test subsets, WPT, perf bots, full evals, trial rebase against upstream `main` | ≤ 6 h |
| **Release** | Tag | Official signed builds, symbols upload, SBOM, installers, update manifests | ≤ 4 h |

CI runs on **self-hosted runners** (Chromium is too big for hosted CI runners) with the shared RBE cache.

### 11.2 Channels

| Channel | Source | Cadence | Audience |
|---|---|---|---|
| Nightly | `main` | Daily | Team |
| Beta | Release branch | Weekly | Opt-in public (from G2) |
| Stable | Release branch | One Chromium Stable milestone + ~1 week | Everyone (from G3) |
| Security respins | Stable branch | Within 72 h of an upstream security release (SEC-01) | Stable |

Release branches are cut per Chromium milestone: `release/<chromium-major>`.

---

## 12. Code review and ownership

- `OWNERS` files per directory in `vizulla/`, upstream style. Two approvals for `browser/agent/`, `browser/permissions/`, `common/mojom/`, `patches/`, and `chromium_src/`. One of them must be SEC or PLT as relevant.
- PR description template: what, why, SRS IDs, screenshots/recordings for UI, perf impact, security notes, flag name.
- Follow the Chromium C++ style guide and upstream's TypeScript/Lit conventions. `clang-format`, `gn format`, and eslint run in CI.
- Keep PRs small (≤ 400 changed lines excluding tests and generated files). Large features land behind a flag in steps.
