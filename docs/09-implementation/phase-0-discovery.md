# Phase 0 — Discovery & Validation (weeks 1–12)

**Goal:** before committing to a fork and the R1 scope, measure what a fork costs us, validate the UX with real users, and settle the open design decisions.
**Exit:** Gate **G0** (scope commit, ≈ week 10) and Gate **G1** (foundation decision, ≈ week 12). See [validation plan §1](../08-validation-plan.md#1-gates).
**Team:** everyone. PLT owns S1/S2/S7, BRW owns S5 and the prototype build, AI owns S4/S8, SEC owns S9, CLD owns S10 and DD-12, UX owns the study and S6.

Phase 0 code is **throwaway** unless a task says otherwise. Its outputs are numbers, decisions, and lessons.

---

## 1. Milestones

| Weeks | Milestone | Output |
|---|---|---|
| 1–2 | **M0.1 Workspace up** | Branded Chromium builds locally on all three OSes. RBE trial running. Prototype skeleton. |
| 3–6 | **M0.2 First measurements** | First rebase measured (S1). First security drill (S2). Extension test run (S3). Prototype in users' hands. |
| 7–10 | **M0.3 Study + decisions** | Second rebase and drill. S4 benchmarks. S5 UI prototypes. Study results. → **G0** |
| 11–12 | **M0.4 Foundation decision** | Fork scorecard ([validation plan §2.2](../08-validation-plan.md#22-criteria-and-measurement)) completed. → **G1** |

---

## 2. Platform spikes (PLT)

| ID | Task | Depends | Est. | Done when |
|---|---|---|---|---|
| P0-PLT-01 | **Minimal fork workspace.** `.gclient` at the current Stable tag, a skeleton `vizulla-core` with `BUILD.gn`, branding (name, icons, `BRANDING` file), `is_chrome_branded=false`, the empty-Google-keys args. A first `vz` script for init/sync/build. | — | 2 ew | Builds and runs on Win/mac/Linux with Vizulla branding |
| P0-PLT-02 | **Five representative patches** (S1): (1) a vertical tab region hook in `BrowserView` layout, (2) an omnibox replacement hook in `ToolbarView`, (3) a `WillCreateURLLoaderFactory` registration, (4) a startup `ChromeBrowserMainExtraParts`, (5) the updater URL. Keep each as small as possible. | 01 | 2 ew | All five apply, build, and are covered by a smoke browser test |
| P0-PLT-03 | **Rebase #1 and #2** (S1): run `vz rebase` onto the next two Stable milestones. Log hours, conflicts per patch, build breaks, and test breaks. | 02 | 2 × 1 ew | Spreadsheet of hours and conflicts per milestone |
| P0-PLT-04 | **Remote build trial**: Siso + an RBE backend. Measure clean/incremental build times and monthly cost at the expected PR volume. | 01 | 1.5 ew | Numbers for the G1 cost criterion |
| P0-PLT-05 | **Security drill ×2** (S2): pick a past upstream security release, cherry-pick it onto our branch, official build, sign (test certs), and publish to a test update channel on Windows and macOS. Time every step. | 02, P0-REL-01 | 2 × 0.5 ew | End-to-end time recorded. Bottlenecks listed. |
| P0-PLT-06 | **Updater spike** (S7, DD-7): brand `//chrome/updater` and point it at a test Omaha server. Install per-user and per-machine on Windows. Install a notarized build on macOS. Do one delta update and one rollback. | 01 | 3 ew | DD-7 decided, with a working demo |
| P0-PLT-07 | **De-Googling inventory**: list every Google-backed service the build calls (sync, Safe Browsing, component updater, variations, translate, spellcheck dictionaries, password leak detection, crash upload, GCM/push, Widevine CDM delivery, CRLSet delivery, Optimization Guide, NTP services). For each: disable, replace, or license. | 01 | 1.5 ew | Table feeds Phase 1 P1-PLT-06..09 |

> **Watch out:** the **component updater** delivers security-relevant data (CRLSets, certificate transparency logs, the Widevine CDM, first-party sets…). Switching it off silently weakens security. Phase 1 must either run our own component update server for those components or license them. The Widevine CDM also needs a **license from Google** for DRM video (streaming sites). Brave, Vivaldi, and Opera have one. **Start the application in Phase 0**: it can take months.

---

## 3. Browser UI spikes (BRW) — S5, DD-1, DD-2, DD-4

| ID | Task | Depends | Est. | Done when |
|---|---|---|---|---|
| P0-BRW-01 | **Throwaway UX prototype** (Electron): vertical tabs, Spaces, auto-archive, Command Bar, assistant panel (cloud model through a test Gateway). Real browsing, not a click-through. Signed builds for the study. | — | 4 ew (2 people) | Installed on study participants' machines by week 5 |
| P0-BRW-02 | **Vertical tabs in Views** on the S1 build: a `VerticalTabStripRegionView` in the left of `BrowserView`, hosting upstream tab views in vertical layout and observing `TabStripModel`. Drag-and-drop between positions and groups. | P0-PLT-02 | 3 ew | 200 tabs scroll at 60 fps on RD-1. Keyboard and screen reader basics work. |
| P0-BRW-03 | **Same list in WebUI** (for comparison): a WebUI page in the side region listing tabs via a Mojo `TabsPageHandler`. | P0-PLT-02 | 2 ew | Memory and input latency measured against BRW-02 |
| P0-BRW-04 | **Spaces model prototype** (DD-1): Option A, one `TabStripModel` with a hidden-set filter, vs Option B, inactive Spaces' `WebContents` detached into a side store. Test: Ctrl+Tab, `chrome.tabs` from an extension, session restore, tab dragging between windows, a crash during a Space switch. | P0-BRW-02 | 3 ew | A recommendation with a list of edge cases found |
| P0-BRW-05 | **Command Bar hook**: replace the omnibox view with a Vizulla view backed by upstream `AutocompleteController`. Add one custom `AutocompleteProvider` (open tabs + commands). | P0-PLT-02 | 2 ew | Keystroke-to-suggestion p95 measured on RD-1 (PERF-05 target ≤ 50 ms) |
| P0-BRW-06 | **Content extraction probe** (DD-4): `WebContents::RequestAXTreeSnapshot` on 50 sites from W30 and on 10 PDFs. Measure size, time, text completeness against a Readability-style DOM extractor, and how well node IDs work for citations. | P0-PLT-01 | 1.5 ew | DD-4 decided with data |

### 3.1 What to measure in S5

| Metric | How | Target |
|---|---|---|
| Extra idle memory from the tab list | memory-infra, M-IDLE | Fits PERF-02 together with everything else (≤ +10%) |
| Tab list frame time while scrolling 200 tabs | Trace, RD-1 | p95 < 16.7 ms |
| Tab activation latency (click → content visible) | Trace | No worse than upstream horizontal tabs |
| Startup cost | M-START with and without the region | ≤ +50 ms |

---

## 4. AI spikes (AI) — S4, S8

| ID | Task | Depends | Est. | Done when |
|---|---|---|---|---|
| P0-AI-01 | **Eval set v0**: 300 page/PDF + question items (≥ 25% French/Kinyarwanda/Swahili), with gold answers and gold supporting passages. A faithfulness and citation grader (an LLM judge + a human-graded calibration slice of 60 items). | — | 3 ew | AIQ-01 can be measured |
| P0-AI-02 | **Cloud answer pipeline prototype**: AX-snapshot chunks → prompt with numbered chunks → answer with `[c12]` citation markers → parse and validate the citations. Measure faithfulness and citation accuracy with 2–3 Gateway candidate models. | P0-AI-01, P0-BRW-06 | 3 ew | Numbers for D-3/D-4. Prompt v0 committed to `vizulla-evals`. |
| P0-AI-03 | **Local inference benchmarks** (S4): llama.cpp, ONNX Runtime (DirectML), MLX × 2–3 ~3B models × 2 embedding models on RD-1/2/3. Tokens/s, first token for a 2,000-word summary, resident memory, and quality on the eval slice. Also evaluate reusing the upstream on-device model service pattern (its sandboxed process host and GPU access) with our own backend. | — | 6 ew | D-6 preliminary recommendation |
| P0-AI-04 | **Platform API watch** (S8): status of WebMCP and Chrome built-in AI APIs at the pinned tag (flags, origin trials, spec state). | — | 0.5 ew | A one-page note |

---

## 5. Security, cloud, UX, release

| ID | Task | Depends | Est. | Done when |
|---|---|---|---|---|
| P0-SEC-01 | **Threat-intel & breach-check vendors** (S9): ≥ 2 feeds, ≥ 1 k-anonymity breach API. Check coverage, latency, privacy terms, price. | — | 2 ew | D-8 proposal |
| P0-SEC-02 | **R1 threat model review**: walk doc 06 with R1 scope only (T0 assistant, Shields, passwords). List required SEC reviews for Phase 1–2. | — | 1 ew | Review checklist per Phase 2 component |
| P0-CLD-01 | **Gateway prototype** for the study: one streaming endpoint, 2 providers, per-user quota, metering only. Go (DD-12). | — | 2 ew | Prototype and study use it |
| P0-CLD-02 | **Cost model** (S10): tokens per question and questions per day from study logs → cost per user per month for 2–3 models. | P0-CLD-01, study week 2 | 1 ew | D-4 free-quota proposal |
| P0-UX-01 | **Prototype study** ([validation plan §4](../08-validation-plan.md#4-user-research-thin-prototype-study-phase-0)): recruit, run, and analyze. | P0-BRW-01 | 6 ew (2 people) | G0 study criteria reported |
| P0-UX-02 | **Localization sizing** (S6): count strings in Vizulla vs upstream. Check whether `rw` and `sw` exist in upstream locales. Get vendor quotes. | P0-PLT-01 | 1 ew | D-7 input |
| P0-REL-01 | **Signing setup (test)**: test Authenticode cert, Apple Developer ID + notarization through `notarytool`. Order production EV/HSM certificates now, since they take weeks. | — | 1 ew | Test-signed builds. Production certs ordered. |
| P0-REL-02 | **Reference device lab**: buy RD-1, RD-2, RD-4 (and RD-3 for S4). Set up remote access and automation. Freeze the W30 and top-100 extension lists (draft). | — | 1.5 ew | Devices running the perf scripts |

---

## 6. Exit checklist

**G0 (scope commit)**
- [ ] Study passes G0 criteria, or the failing surfaces are redesigned or cut.
- [ ] D-1 platforms, D-2 segment, D-3 workflow, D-4 cloud access, D-7 languages decided.
- [ ] Named owners for every SRS area (SRS §8.2).
- [ ] Widevine license application submitted.

**G1 (foundation)**
- [ ] S1: two rebases measured. S2: two drills timed. S3: top-100 extension results. S7: updater demo.
- [ ] Fork scorecard filled in, and D-5 decided.
- [ ] DD-1, DD-2, DD-4, DD-7, DD-12 decided and recorded as ADRs.
- [ ] De-Googling inventory complete, with an owner per item.
- [ ] Capacity check re-run with measured numbers.
- [ ] Reference devices and lists frozen.
