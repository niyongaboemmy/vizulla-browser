# Phase 3 — R1 Hardening & v1.0 Release (months 12–13, ~8 weeks)

**Goal:** turn the public beta into v1.0. No new features: fix, measure, audit, and set up how we run releases.
**Exit:** Gate **G3**, the R1 GA gate in [SRS §7.1](../04-srs.md#71-verification-methods).
**Rule:** feature freeze from day 1. Only changes that fix a beta finding, a gate metric, or a security issue land on the release branch. New ideas go to the R2 backlog.

---

## 1. Milestones

| Weeks | Milestone |
|---|---|
| 1–2 | **M3.1 Triage**: beta feedback, crash, and bug-bounty queues sorted into G3 blockers / R2 / won't-fix |
| 3–6 | **M3.2 Gate metrics**: perf, accessibility, and eval targets met. External pentest done. |
| 5–6 | **M3.3 Release candidate**: RC on Beta for ≥ 2 weeks with no new blockers |
| 7–8 | **M3.4 v1.0**: staged rollout to Stable. Support and operations running. → **G3** |

---

## 2. Performance (BRW, PLT, REL)

Work only from perf-bot data on official builds. Tune nothing on a developer machine.

| ID | Task | Est. | SRS | Done when |
|---|---|---|---|---|
| P3-REL-01 | **Startup profile** (M-START on RD-1/RD-2): defer the creation of non-visible panels, side panel WebUI, Shields list loading (memory-map the serialized engine), and the Spaces DB load. Check the order of startup tasks. | 3 ew | PERF-01 | ≤ 1.2 s median, ≤ 2.0 s p95 |
| P3-BRW-01 | **Idle memory** (M-IDLE): measure the WebUI renderer cost and the vertical region's views. Lazily create WebUI, and close idle panel renderers. | 2 ew | PERF-02 | ≤ upstream + 10% |
| P3-BRW-02 | **W30 memory** (M-W30): tune discard thresholds and Shields' effect, and check archive behavior | 2 ew | PERF-03 | ≤ 0.85 × Chrome median, Shields on |
| P3-BRW-03 | **Command Bar latency**: profile the provider pipeline. Cap expensive providers. | 1 ew | PERF-05 | ≤ 50 ms p95 |
| P3-REL-02 | **Battery** (M-BATT): check that no Vizulla timers wake while idle or during video | 1 ew | PERF-10 | ≤ Chrome + 3% |
| P3-AI-01 | **Assistant first token**: start building the context while the user is typing, reuse HTTP/2 connections to the Gateway, keep the system prompt short | 1 ew | PERF-07 | ≤ 1.5 s median excluding provider time |

---

## 3. Quality & accessibility (UX, BRW, AI)

| ID | Task | Est. | SRS | Done when |
|---|---|---|---|---|
| P3-UX-01 | **External accessibility audit** (WCAG 2.2 AA) of all Vizulla UI: tab list, Command Bar, panels, dialogs, settings, onboarding. Test with NVDA, JAWS, Narrator, and VoiceOver. | vendor + 3 ew fixes | USE-01, SET-04 | No open AA failures |
| P3-UX-02 | **Usability test** USE-02 (R1 task) on the RC, n ≥ 20, including RD-1-class devices and French/Kinyarwanda-first speakers | 2 ew | USE-02 | ≥ 85% success in ≤ 30 s |
| P3-AI-02 | **Eval refresh**: add the failure cases from the beta (with consent) to the eval set, re-run, fix the prompt or model choice | 2 ew | AIQ-01 | Targets met on the refreshed set |
| P3-BRW-04 | **Site-compat sweep**: top 500 sites with Shields on. Fix breakage (list exceptions or engine fixes). | 2 ew | SHD-01 | Breakage ≤ 1% with a published exceptions process |
| P3-BRW-05 | **Extension compat**: M-EXT ≥ 95%. Publish the known-issues page. | 1 ew | EXT-01 | Report published |

---

## 4. Security & privacy (SEC)

| ID | Task | Done when |
|---|---|---|
| P3-SEC-01 | **External pentest** of R1: IPC surfaces, Command Bar URL display (spoofing), disclosure UI, the updater, Gateway auth, filter-list signing | No open Critical/High |
| P3-SEC-02 | **Bug bounty triage**: SLA 3 working days to first response, severity per the published rubric | Queue under SLA at GA |
| P3-SEC-03 | **Threat-intel live** in production with monitoring for latency and errors (ID-04 blocks GA) | Live on Stable-test channel |
| P3-SEC-04 | **Two consecutive SEC-01 drills** passed in this phase | Both ≤ 72 h |
| P3-SEC-05 | **Privacy check of the Stable build**: network capture of a fresh install, onboarding with each AI mode, AI off (no AI request at all), telemetry off (nothing sent) | Report signed by the privacy lead |

---

## 5. Release operations (REL, PM, CLD)

| ID | Task | Done when |
|---|---|---|
| P3-REL-03 | **Stable channel** setup: release branch per Chromium milestone, a release checklist, staged rollout (1% → 10% → 50% → 100% over ≥ 5 days), with automatic pause on a crash-rate rise | Dry-run on Beta |
| P3-REL-04 | **Release notes, SBOM, and a security advisory** template for every release | Used for the RC |
| P3-CLD-01 | **On-call** for the Gateway, update server, and CDN: SLOs (Gateway availability ≥ 99.5%, update server ≥ 99.9%), alerts, runbooks | On-call rota live |
| P3-PM-01 | **Support**: help center (EN/FR), in-product "Send feedback" (opt-in, no URLs unless the user adds them), triage rota | Live at GA |
| P3-PM-02 | **Website and download pages**: platform detection, checksums, signature instructions | Live at GA |

---

## 6. R2 preparation (in parallel, AI + PLT, ≤ 20% of their time)

| ID | Task | Feeds |
|---|---|---|
| P3-AI-03 | Repeat S4 on the GA tag with the final model shortlist, with a decision on the R2 engine (D-6) | Phase 4 |
| P3-AI-04 | Spike DD-8: flat int8 vector index, recall@10 and latency for 50k pages on RD-1 | P4 Memory |
| P3-SEC-06 | Spike DD-9: encrypting SQLite VFS shim prototype, review of its key handling | P4 Memory |
| P3-PLT-01 | Spike: utility-process sandbox policy for GPU inference on Windows and macOS (compare with the upstream on-device model service's policy) | P4 runtime |

---

## 7. Exit checklist (G3)

- [ ] Every R1 requirement verified, with artifacts linked (SRS traceability report).
- [ ] PERF-01..05, 07, 10 met on RD-1/RD-2. AIQ-01/04 met.
- [ ] No open Critical/High security issues. Pentest closed.
- [ ] SEC-01 drill passed twice in a row. ID-04 live.
- [ ] Accessibility audit closed (AA).
- [ ] Staged rollout plan approved. On-call and support live.
