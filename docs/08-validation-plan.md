# 08 — Validation Plan: Gates, Spikes & Operational Readiness

This document turns the costly assumptions in docs 01–07 into experiments with pass/fail criteria. It defines the **gates** each release must pass (doc 07 §2), the **evaluation of the foundation approach** (ADR-001), the **technical spikes**, the **user research** plan, and the **Chromium update and security process**.

Rule: a gate is passed on evidence, not on schedule. If a gate fails, the plan changes (scope, approach, or team) before work continues.

---

## 1. Gates

| Gate | When | Question | Evidence required | Decides |
|---|---|---|---|---|
| **G0: Scope commit** | End of Phase 0 (≈ week 10) | Is R1 worth building, for whom, on which platforms? | Prototype study results (§4). Decisions D-1..D-4 and D-7 settled (doc 07 §3). Named owners for each SRS area (SRS §8.2). | R1 scope is frozen. Changes after G0 need product sign-off and move other scope out. |
| **G1: Foundation** | End of Phase 0 (≈ week 12) | Can we sustain a Chromium fork? | Spikes S1, S2, S3, S5, S7, S9 complete. Fork evaluation scored (§2). Capacity check (doc 07 §6.1). | D-5 (fork or fallback), D-8, the reference device list, the frozen W30 and top-100 extension lists |
| **G2: R1 beta** | End of Phase 2 | Is R1 safe and usable enough for the public? | All R1 functional requirements pass on R1 platforms. SEC-01 drill passed. DPIA done. Bug bounty ready. | Public beta |
| **G3: R1 GA** | End of Phase 3 | Does R1 meet its acceptance contract? | SRS §7.1 R1 gate | v1.0 release |
| **G4: R2** | End of Phase 4 | Does local AI + Memory meet quality, privacy, and performance targets? | SRS §7.1 R2 gate. Spike S4 numbers reproduced on the release build. | R2 release |
| **G5: Agent Stage A** | End of Phase 5 | Is the agent safe in an isolated session? | Doc 06 §5.3 Stage A criteria | Opt-in agent beta |
| **G6: Agent Stage B** | End of Phase 6 | Is the agent safe with personal data and commit actions? | Doc 06 §5.3 Stage B criteria | Stage B release |

---

## 2. Foundation evaluation (ADR-001, decision D-5)

The full fork is the leading option, but it is the most expensive commitment in the plan. It is compared against narrower alternatives using the same criteria and measured data.

### 2.1 Options

| Option | Description |
|---|---|
| **F1: Full fork, overlay layout** | `//chrome` fork, Brave-style `vizulla/` overlay, `chromium_src/` overrides, small patch set (doc 01 §8). |
| **F2: Narrow fork** | The same fork, but R1 features are built as a built-in component extension + WebUI side panel, with only branding, Shields, and vertical-tab hooks as patches. This has the smallest patch set possible while still owning the binary. |
| **F3: Extension-first** | R1 ships as an MV3 extension + side panel for Chrome/Edge, with no browser binary. It tests assistant usefulness with real users while the fork matures. It cannot deliver native Shields, a real vertical-tab UI, browser-owned confirmation UI, or a sandboxed AI process. |
| **F4: Electron/CEF shell** | Rejected for the product (doc 01 §8). Only scored for completeness, and used as the Phase 0 throwaway prototype. |

### 2.2 Criteria and measurement

| Criterion | Weight | How it is measured | F1 pass threshold |
|---|---|---|---|
| Security-update lag | 25% | Spike S2 drill: time from an upstream Stable security release to a signed update offered, on both R1 platforms | ≤ 72 h, twice in a row |
| Rebase cost | 20% | Spike S1: engineer-hours per Stable rebase, over 2 consecutive milestones | ≤ 5 working days elapsed and ≤ 1.5 FTE-weeks |
| Extension compatibility | 15% | M-EXT on the top-100 list (SRS §7.2) | ≥ 95% |
| Required custom features | 15% | Can it deliver: vertical tabs + Spaces, network-level Shields, browser-owned confirmation UI, sandboxed AI utility process, Command Bar replacing the omnibox? | All five |
| Build/infra cost | 10% | Measured build time and monthly cost for CI + distributed build across R1 platforms | Within budget set at G0 |
| Staffing | 10% | Capacity check (doc 07 §6.1) using the S1/S2 figures | Fork maintenance ≤ 3.5 FTE |
| Time to R1 | 5% | Estimate re-planned from spike data | ≤ 13 months |

### 2.3 Decision rule

- Choose **F1** if it meets every pass threshold.
- Choose **F2** if F1 misses the rebase-cost or staffing thresholds but F2 meets them. F2 still delivers every R1 feature with fewer touch points, and can grow into F1 later.
- If neither fork option meets the **security-update lag** threshold, do not ship a fork to the public. Take the fallback below.

### 2.4 Fallback

If both F1 and F2 fail G1: ship **F3 (extension-first)** as a public "Vizulla Assistant" preview to validate the assistant workflow and build an audience. Keep investing in the fork until it passes a repeat of G1. The R1 browser release slips, but users never get an unpatched Vizulla binary.

---

## 3. Technical spikes (Phase 0)

Each spike has a timebox, an owner role, and a stated output. A spike that exceeds its timebox reports what it has and the gate decides.

| ID | Question | Method | Success criteria | Owner | Timebox | Feeds |
|---|---|---|---|---|---|---|
| **S1** | What does a Stable rebase cost us? | Fork, brand, and add 5 representative patches (sidebar hook, omnibox replacement hook, Shields network hook, branding, updater). Rebase across 2 consecutive Stable milestones. Log hours and conflicts. | Data collected. Thresholds in §2.2 evaluated. | Platform lead | 8 weeks (overlaps) | G1, D-5 |
| **S2** | Can we ship a security fix in 72 h? | Drill: pick a past upstream security release, cherry-pick it onto our branch, build, sign, and offer an update to a test channel on Windows and macOS. Time each step. | ≤ 72 h end to end, twice | Platform lead + release eng | 2 drills | G1, SEC-01 |
| **S3** | Do Chrome Web Store extensions work? | Run M-EXT on the top-100 list against the S1 build. | ≥ 95 pass. Failures root-caused. | Platform eng | 2 weeks | G1, EXT-01 |
| **S4** | Is local inference good and light enough? | Benchmark llama.cpp, ONNX Runtime (DirectML), and MLX with 2–3 candidate ~3B models and 2 embedding models on RD-1, RD-2, RD-3: tokens/s, first token for a 2,000-word summary, resident memory, faithfulness on a 100-item slice of the eval set, and Kinyarwanda/French/Swahili quality. | Results for PERF-06/09 and AIQ-01. One engine recommended per platform. | AI lead | 6 weeks | D-6, R2 scope |
| **S5** | Does the UI integrate cleanly? | Build the vertical tab strip, sidebar, and Command Bar in WebUI hosted in Views on the S1 build. Measure the memory cost of the WebUI renderer and input latency. | WebUI overhead fits PERF-02. PERF-05 met. | Browser features lead | 4 weeks | ADR-006 |
| **S6** | What does localization really cost? | Count translatable strings: Vizulla overlay vs upstream Chromium UI. Check which of `fr`, `sw`, `rw` Chromium ships. Get vendor quotes. | Cost and timeline for each language | Design lead | 2 weeks | D-7, SET-05 |
| **S7** | Do updates work on every R1 platform? | Stand up an Omaha-compatible update server. Deliver signed full and delta updates on Windows (per-user and per-machine installs) and macOS (notarized), including a rollback. | Silent update and rollback work. Fits into the S2 timing. | Release eng | 4 weeks | G1, SEC-06 |
| **S8** | How stable are WebMCP and the Chrome built-in AI APIs? | Paper spike: spec status, implementation status in Chromium (flags, origin trials), adoption by sites, and expected API churn. | Recommendation: flag-gate, implement, or wait | AI lead | 1 week, repeated before each release | C6, AI-06/07 |
| **S9** | Can we get Safe Browsing and breach checking without Google? | Evaluate ≥ 2 commercial threat-intel feeds and ≥ 1 k-anonymity breach API: coverage, latency, privacy terms, price at 100k and 1M users. | A contract path within budget | Security lead | 4 weeks | D-8, ID-01/04 |
| **S10** | What does the free assistant quota cost? | Model costs from prototype usage logs (tokens per question, questions per user per day) for 2–3 Gateway models. | Free quota and per-user monthly cost | Cloud lead + PM | 2 weeks | D-4, risk R5 |

---

## 4. User research: thin prototype study (Phase 0)

**Prototype:** the throwaway Electron build (doc 07 Phase 0) with vertical tabs, Spaces, auto-archive, Command Bar, and the assistant panel (cloud model). Real browsing, not a click-through mock.

| Item | Plan |
|---|---|
| Participants | ≥ 24 people: ≥ 12 knowledge workers and ≥ 12 university students. ≥ 10 in Kigali, ≥ 8 French- or Kinyarwanda-first speakers. ≥ 8 using their own 8 GB-class laptops. |
| Format | 60-min moderated session + 1 week of diary use as a secondary browser |
| Tasks | Organize a research session into Spaces. Find a tab from earlier. Ask a question about a long article and check the cited passage. Ask about a PDF. Switch to Classic mode. |
| Measures | USE-02 success and time. SUS score. "Would you switch?" (5-point). Assistant answers rated useful/correct by the participants. Citation click-through. Tabs per session. |
| Pass for G0 | USE-02 R1 task ≥ 85% success. SUS ≥ 70. ≥ 40% would switch or keep using it (top-2 box). Assistant answers rated useful ≥ 70%. |
| If it fails | Redesign and retest the failing surface, or cut it from R1 (risk R12). |

---

## 5. Chromium update & security process (operational readiness)

This process must be running before R1 beta (G2). It is a product capability, not an ops chore (doc 01 §10).

### 5.1 Ownership

| Role | Responsibility |
|---|---|
| **Platform lead** (named at G0) | Owns MNT-01/02, the patch budget, and the rebase schedule. Accountable for SEC-01. |
| **Security sheriff** (weekly rotation across the platform engineers + 1 release engineer) | Watches upstream Chrome Releases and security advisories, triages fixes, runs the 72 h merge path, and posts status. |
| **Release engineering lead** | Signing, updater, staged rollout, rollback. |
| **Security lead** | Severity calls, advisories, bug bounty triage. |

### 5.2 Targets

| Item | Target |
|---|---|
| Critical/High security fix → update offered | ≤ 72 h (SEC-01). Running mean ≤ 48 h. |
| Stable rebase | ≤ 5 working days (MNT-02) |
| Patch budget | Upstream patches and patched lines reported every release. Any growth over the budget needs platform-lead approval with a plan to shrink it. |
| Trial rebase against upstream `main` | Nightly, with conflicts filed automatically |
| Security drill | Every quarter, plus after any process change |

### 5.3 72-hour path

1. **T+0:** upstream Stable security release. The sheriff is paged by an automated feed watcher.
2. **T+4 h:** fixes identified, cherry-picked or rebased onto the Vizulla Stable branch.
3. **T+24 h:** builds green on every R1 platform. Security smoke suite + top sites + update test passed.
4. **T+36 h:** signed builds to the Beta channel, then staged rollout to Stable (10% → 100% within 24 h unless crash rate rises).
5. **T+72 h at the latest:** update offered to 100% of Stable users. Status published.

If the path fails, the sheriff escalates to the platform lead. SEC-09 disables the agent (R3) on builds more than 14 days behind.

---

## 6. Next steps checklist

The external review's recommendations, mapped to this plan.

**P0: before committing to the build (Phase 0 → G0/G1)**
- [ ] Decide R1 platforms and target segment (D-1, D-2).
- [ ] Freeze the narrow R1: reliable browsing, import, core navigation, privacy controls, one assistant workflow (doc 07 §1, D-3).
- [ ] Set up the Chromium update and security process with named owners (§5). Run drill S2.
- [ ] Adopt the explicit agent capability model and the read-only-first staging (doc 06 §5, ADR-010).

**P1: before implementation expands (Phase 0–1)**
- [ ] Run the thin prototype study (§4), including low-end hardware and local-language participants.
- [ ] Run spikes S1–S10, covering extensions, updates, local inference, UI integration, localization, threat intel, and cost.
- [ ] Record the owner, verification artifact, platform, and dependency for every requirement (SRS §1.5, §8.2).

**P2: before beta or GA (Phase 2–3)**
- [ ] Freeze the reference devices, W30, and top-100 extension lists (SRS §7.2) at G1. Bring the perf bots up on RD-1/RD-2.
- [ ] Implement the data lifecycle (retention, deletion, backup, sync) for every store (doc 06 §7).
- [ ] Re-run the capacity check against measured fork maintenance at G2 and G3 (doc 07 §6.1).
