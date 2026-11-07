# 07 — Roadmap & Architecture Decisions

> **What changed in 0.2.** The single 18–20 month plan to a full-featured v1.0 has been replaced by **three staged releases**, each with a measured **gate** (doc 08). v1.0 is now a narrow release that ships without the agent, Memory, sync, or a bundled AI runtime. The full-fork decision (ADR-001) is now **Proposed**, to be settled with evidence at Gate G1. Open product decisions are listed in §3.

---

## 1. Release strategy

### 1.1 Releases

| | **R1 = v1.0: Browser + Assistant** | **R2 = v1.x: Memory + Local AI** | **R3 = v2.0: Supervised Agent** |
|---|---|---|---|
| **Promise to users** | A fast, private Chromium browser with a calm modern layout, and an assistant that answers questions about the page or PDF you are reading, with citations. | The browser remembers what you read (opt-in, on device) and runs everyday AI locally. | The browser does multi-step web tasks for you, under supervision. |
| **Browser** | Import (Chrome/Edge/Firefox/Safari), core navigation, profiles, extensions, password manager + passkeys, Safe Browsing, PDF viewer, DevTools, session restore | Split view, PDF annotation, media extras, more importers | — |
| **Modern UX** | Vertical tabs, Spaces, pins, auto-archive, Focus, tab search, Command Bar (deterministic), command palette, Classic mode, Reader | AI tab grouping, natural-language commands, Ask Settings, Notes, predictive discard | — |
| **Privacy** | Shields (ads/trackers, 3P cookies, HTTPS-First, DoH), Privacy Dashboard | Fingerprinting protection, cookie-banner auto-reject | — |
| **AI** | Page/PDF Q&A + summary with citations. Cloud through the Gateway (free quota) or BYO key / local OpenAI-compatible server. **Read-only (T0).** | Bundled on-device runtime (one engine), embeddings, Model Router, Memory, multi-tab synthesis, selected-text actions, translation | Agent Stage A (isolated session; navigate/read/interact), then Stage B (personal-data fill and commit, with confirmation) |
| **Sync** | — | E2EE sync (no Memory) | — |
| **Platforms** | Windows 10/11 x64, macOS Apple Silicon | + Windows ARM64, macOS Intel, Linux x64 | same |
| **Languages** | English, French | + Kinyarwanda, Swahili | same |
| **Primary users** | Knowledge workers (UC2), students (UC3) | + everyday users (UC1), developers (UC4) | same |
| **Gate** | G2 (beta), G3 (GA) | G4 | G5 (Stage A), G6 (Stage B) |

**Later (not committed):** recurring agent tasks, credential fill by the agent (T5), Chrome built-in AI web APIs, MCP connectors, Memory sync, Timeline, enterprise policies and audit export, mobile.

### 1.2 Why R1 is a product on its own

R1 has to be worth switching to *without* any of the costly AI bets. Its value comes from four things:

1. A Chromium browser that keeps up with security patches (SEC-01), which most small forks do not (doc 02 §2.2).
2. Native ad/tracker blocking and a calm, feed-free UI.
3. Vertical tabs + Spaces + auto-archive for tab overload, the most-requested modern UX pattern.
4. One assistant workflow done well: ask about this page or PDF and get an answer you can check (citations, scroll-to-source).

If R2 or R3 slip or are cancelled, R1 still stands. That is the test of a good cut.

### 1.3 How each costly bet is introduced

| Bet | Not in R1 because | Introduced when |
|---|---|---|
| Task Agent | Highest security risk (doc 06). Needs a deterministic enforcement layer, a red team, and AIQ-02/03. | R3, in two capability stages with their own gates |
| Memory | Privacy-heavy (DPIA, deletion, encryption). Its value depends on a local embedding runtime. | R2, after AI-01 ships |
| Bundled local runtime | Cross-platform engines, accelerators, model downloads, and memory budgets all need validating (spike S4). | R2, one engine first |
| Sync | Needs E2EE key design, a server, and account recovery UX. | R2 |
| Kinyarwanda/Swahili UI | Chromium may not ship Kinyarwanda strings, so upstream strings would need translating too (spike S6). | R2 |
| Linux, ARM64, Intel Mac | Adds QA, packaging, and updater work for each platform | R2 |

---

## 2. Phased plan

Durations are estimates for the team in §6, and they depend on the gate results. A failed gate changes the plan, not the gate.

| Phase | Duration | Goal | Key deliverables | Exit gate |
|---|---|---|---|---|
| **0: Discovery & validation** | 10–12 weeks | Validate the UX and the costly assumptions before committing | Throwaway UX prototype (doc 08 §4). Spikes S1–S10 (doc 08 §3). Fork evaluation (doc 08 §2). Decisions D-1..D-8 (§3). | **G0** scope commit · **G1** foundation decision |
| **1: Foundation** | 4 months | A real, branded, updatable Chromium build | Fork setup (overlay layout) or G1 alternative, build farm, CI, signing, updater, branding, importers, Shields engine, security sheriff rotation live | Daily Nightly on R1 platforms. Two Stable rebases done in ≤ 5 days each. SEC-01 drill passed. |
| **2: R1 build** | 4 months | Modern shell + assistant | Vertical tabs, Spaces, auto-archive, Focus, Command Bar, Classic mode, Reader, assistant panel, Gateway, BYO providers, citations, Privacy Dashboard | **G2**: R1 public beta |
| **3: R1 hardening** | 2 months | Ship v1.0 | Bug bounty findings, performance work, accessibility audit, FR localization, DPIA, threat-intel live | **G3**: R1 GA (v1.0) ≈ month 12–13 |
| **4: R2** | 5–6 months | Memory + Local AI | ai_runtime (one engine), model download manager, Model Router, Memory, Notes, multi-tab, NL commands, sync, more platforms and languages | **G4**: R2 release ≈ month 18–19 |
| **5: R3 Stage A** | 4–5 months | Agent in an isolated session | AgentController + plan enforcement (AGT-11), Agent Session, overlay, Action Log, injection detector, red team, WebMCP behind a flag | **G5**: Stage A opt-in beta ≈ month 23 |
| **6: R3 Stage B** | 3 months+ | Personal-data fill and commit actions | PermissionBroker confirmations, egress rules (AGT-12), external pentest | **G6**: Stage B release |

**Comparison with v0.1:** v0.1 put everything into one GA at month 18–20. v0.2 ships a narrower v1.0 about 6 months earlier, and puts the agent after a validated foundation. The full vision lands around month 24+, which is more realistic for ~19 people who are also maintaining a fork.

### 2.1 Feature flags and audiences (resolves the v0.1 "agent behind a flag" ambiguity)

| Audience | Who | What they can enable |
|---|---|---|
| Nightly | Internal | All in-development features, behind flags |
| Beta | Public opt-in | Features targeted at the current release only |
| Stable | Everyone | Released features only. Unreleased features are compiled out or hard-disabled by server config. |
| Agent testers | Invited, signed agreement, from G5 | Agent Stage A in Beta builds, with telemetry consent for agent evals |

No agent code runs in Stable before G5.

---

## 3. Open decisions register

Each decision has a proposal, an owner, and the gate it must be settled by. Proposals are recommendations, not decisions.

| ID | Decision | Proposal | Owner | By |
|---|---|---|---|---|
| D-1 | R1 desktop platforms | Windows 10/11 x64 + macOS Apple Silicon. Linux nightly unsupported until R2. | Product + Eng leads | G0 |
| D-2 | R1 primary user segment | Knowledge workers and students (UC2/UC3). The R1 assistant workflow is chosen for them. | Product | G0 |
| D-3 | R1 assistant workflow | "Ask about this page/PDF, with citations" (PA-01/02/04). Multi-tab synthesis moves to R2. | Product + AI lead | G0 |
| D-4 | Cloud access in R1 | Vizulla Gateway with a free quota plus BYO keys, so students can use the assistant without a paid API key. Quota is set from spike S10. | Product + Cloud lead | G0 |
| D-5 | Foundation approach | Full fork with overlay layout, if it meets the G1 criteria (doc 08 §2). Otherwise the fallback in doc 08 §2.4. | CTO / Platform lead | G1 |
| D-6 | Local inference engine for R2 | Chosen in spike S4 from llama.cpp, ONNX Runtime, and MLX. One engine first. | AI lead | G1 (preliminary), G4 prep |
| D-7 | R1 languages | English + French. Kinyarwanda/Swahili in R2, after spike S6 sizes the string work. | Product + Design | G0 |
| D-8 | Threat-intel and breach-check providers | Licensed commercial feed + a k-anonymity breach API (spike S9). | Security lead | G1 |

---

## 4. Architecture Decision Records

### ADR-001: Build on a full Chromium fork with an overlay layout
- **Status:** **Proposed**, to be decided at Gate G1 (D-5).
- **Context:** We need full web compatibility, Chrome Web Store extensions, DevTools, PDF, a password manager, native Shields, browser-owned security UI, and top performance. Options: full fork, content-layer embedder, CEF, Electron, OS webviews (doc 01 §8). A fork's ongoing cost (rebases, security merges, build farm) has not yet been measured for our team.
- **Proposed decision:** Fork `//chrome`. Keep Vizulla code in `src/vizulla/`, use `chromium_src/` overrides and a small numbered patch set (the Brave model), and rebase onto every Stable release.
- **Evidence required (doc 08 §2):** two consecutive Stable rebases within the MNT-02 budget, a security-merge drill within 72 h, a measured build cost, M-EXT ≥ 95%, and staffing confirmed.
- **Consequences:** + Feature parity and performance. + Same architecture as Edge/Brave/Vivaldi. − Big build infrastructure. − Needs ≥ 2 platform engineers dedicated to rebases and security merges. − About 100 GB checkouts.
- **Alternatives kept open:** see doc 08 §2.4 (narrow fork, extension-first).
- **Rejected for the product:** *Electron* (extra overhead, limited tab and extension model, patch lag; acceptable only for the Phase 0 prototype). *CEF* (weak extension support, not built for a full browser). *Content-layer embedder* (would mean rebuilding years of `//chrome` features).

### ADR-002: Track Chromium Stable (not Extended Stable)
- **Status:** Accepted, conditional on ADR-001.
- **Decision:** Rebase onto each 4-week Stable release. Merge security fixes in between within 72 h of the upstream release.
- **Rationale:** Agentic browsers that lag on patches are exposed to injection-plus-exploit chains (Trail of Bits). Vivaldi's Extended Stable approach makes sense for its large patch set. Our overlay layout keeps the patch set small enough to follow Stable.
- **Revisit if:** two consecutive rebases miss MNT-02. Extended Stable plus security merges then becomes the fallback.

### ADR-003: AI runtime as a sandboxed Mojo utility service
- **Status:** Accepted (design), implementation in R2.
- **Decision:** Run inference in a separate utility process with no network and no file system. It loads models through brokered file handles and starts lazily. R1 has no bundled runtime: cloud calls go through the browser process (doc 05 §3).
- **Consequences:** + Crash isolation, security, unloadable memory. − IPC overhead (negligible compared with inference time).

### ADR-004: Hybrid local/cloud with a provider-agnostic router
- **Status:** Accepted.
- **Decision:** R1 routes by the user's mode and chosen provider. R2 adds the policy router: on-device by default for light tasks, and cloud through the Vizulla Gateway or a BYO key for heavy tasks. Providers are adapters behind one interface.
- **Consequences:** + Privacy, offline use, no lock-in. − Quality varies by device. Mitigated by routing on device capability.

### ADR-005: Structured-first agent actuation
- **Status:** Accepted (R3).
- **Decision:** Order of preference: WebMCP (behind a flag while it is a proposal) → accessibility tree → DOM → vision. Every path goes through the same browser-side validation against the approved plan. No launch scope depends on WebMCP adoption (SRS C6).
- **Consequences:** + Reliability, auditability, lower token cost. − Some sites need the vision fallback, which is slower.

### ADR-006: Browser UI in WebUI (TypeScript + Lit), native Views for frames and security UI
- **Status:** Accepted, with the memory overhead checked in spike S5.
- **Decision:** Sidebar, panels, and `vizulla://` pages in WebUI. Window frame, agent control bar, and confirmation dialogs in native Views, so pages cannot spoof them.
- **Consequences:** + Fast iteration and a larger hiring pool. − Must watch WebUI renderer memory (one shared WebUI process). This counts toward PERF-02.

### ADR-007: Native Shields engine in Rust inside the network service
- **Status:** Accepted.
- **Decision:** Integrate a Rust filter engine (the adblock-rust approach) in the network service, plus cosmetic filtering in the renderer.
- **Consequences:** + Speed, no MV3 rule limits. − Must keep pace with filter syntax changes. License review of the chosen engine required (adblock-rust is MPL-2.0).

### ADR-008: Memory is local, opt-in, encrypted SQLite (FTS5 + vector)
- **Status:** Accepted (R2).
- **Decision:** A single encrypted SQLite store per profile with full-text and vector search. No server-side index.
- **Consequences:** + Privacy, simplicity. − Cross-device recall needs E2EE Memory sync (Later, MEM-08).

### ADR-009: Staged releases with measured gates
- **Status:** Accepted.
- **Decision:** Deliver in R1/R2/R3 (§1). Each release has a gate with evidence defined in doc 08 §1. Scope moves to a later release instead of stretching the current one.
- **Consequences:** + An earlier, safer v1.0. + Costly bets validated before commitment. − The full vision reaches users later. − Positioning must work without the agent at launch (doc 02 §5).

### ADR-010: Agent capabilities are added in stages, read-only first
- **Status:** Accepted.
- **Decision:** R1 AI is read-only (T0). The agent arrives in R3 Stage A (T1–T2, isolated session only), then Stage B (T3–T4). T5 is Later. Each stage needs its own gate (doc 06 §5.3).
- **Consequences:** + Each capability's scope, confirmation, and audit behavior is testable before it ships. − Slower to reach "agentic" marketing parity.

### ADR-011: Enforcement is deterministic, detection is advisory
- **Status:** Accepted.
- **Decision:** Security decisions (origin scope, allowed tools, allowed data fields, confirmations, credential fill) are made by deterministic browser-process code. Injection detection, trust labels, and spotlighting reduce risk and alert the user, but no security property depends on them (doc 06 §1.1).
- **Consequences:** + Security claims are auditable and testable. − Some useful agent behaviors are blocked by conservative rules and need explicit user approval.

### ADR-012: Vertical tab list in native Views (amends ADR-006)
- **Status:** Proposed, decided by spike S5 (DD-2 in the [implementation plan](09-implementation/README.md#4-design-decisions-introduced-by-this-plan)).
- **Decision:** The vertical tab list is native Views reusing upstream tab rendering and `TabStripModel`. WebUI is kept for the Space switcher menus, archive, and panels.
- **Rationale:** The tab list is a hot path: drag-and-drop, hundreds of rows, startup cost, and accessibility. A WebUI tab list adds a renderer to the critical path.

### ADR-013: Shields request filter in the browser process via a URLLoaderFactory proxy (amends ADR-007)
- **Status:** Proposed, decided by the Phase 1 benchmark (DD-3).
- **Decision:** Install the request filter with the same proxy hook the extensions webRequest API uses, and call the Rust engine on a thread pool. Move it into the network service only if profiling shows IPC cost (> 1 ms p95 per request).
- **Rationale:** No patches inside the network service, which keeps rebases cheap. The same proxy mechanism also serves the agent egress filter (R3).

---

## 5. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Rebase burden grows and Vizulla falls behind upstream | Medium | High | Overlay layout, patch budget per release, nightly trial rebases, dedicated team. Measured at G1. Extended Stable fallback (ADR-002). |
| R2 | Prompt-injection incident damages trust | High | Critical | Staged capabilities (ADR-010), deterministic enforcement (ADR-011), doc 06 controls, bug bounty, agent opt-in. |
| R3 | Local model quality too low on 8 GB devices | Medium | Medium | Cloud fallback, task-specific small models, measured in spike S4 before R2 commits. |
| R4 | Chrome Web Store policy restricts third-party browsers | Low | High | Monitor policy. Support side-loading. Partner with major extension developers. |
| R5 | Cloud AI costs exceed revenue | Medium | High | Free-quota sizing (spike S10), local-first routing in R2, BYO key, paid tier for heavy cloud use. |
| R6 | Big incumbents (Chrome + Gemini, Edge + Copilot) copy features | High | Medium | Stand out on patch speed, privacy, regional languages, lightness, and safety. |
| R7 | Safe Browsing / threat-intel licensing | Medium | High | Spike S9 in Phase 0. ID-04 blocks R1 GA. |
| R8 | Build infrastructure cost | Medium | Medium | Measured at G1. Distributed build caching, cloud build credits, build only changed targets. |
| R9 | Scope creep back into R1 | High | High | The gate rules in §1 and doc 08. New scope goes to R2+ by default. Product owns the R1 cut. |
| R10 | Platform dependencies change (WebMCP, built-in AI APIs, provider terms) | Medium | Medium | SRS C6: flag-gated with fallbacks. No launch commitment depends on them. |
| R11 | Team capacity eaten by fork maintenance | Medium | High | Capacity check (§6.1) re-run at every gate. Platform work is ring-fenced from feature work. |
| R12 | R1 is not differentiated enough without the agent | Medium | High | UX prototype study (doc 08 §4) must show preference over the participants' current browser before G0. |

---

## 6. Team shape

| Role | Count | R1 focus |
|---|---|---|
| Chromium platform engineers (C++, rebases, security merges) | 3 | Fork, build, updater, rebases, security sheriff |
| Browser feature engineers (C++/Views + WebUI TS) | 4 | Sidebar, Spaces, Command Bar, Shields UI, Classic mode |
| AI/ML engineers (runtime, routing, evals, agent) | 3 | Assistant, citations, eval sets, spike S4 |
| Security engineer (AI red team, sandboxing) | 1–2 | Threat model, bug bounty, sandbox review |
| Product designer (UX research included) | 2 | Prototype study, R1 UX, accessibility |
| Cloud/backend engineer (Gateway, sync, update) | 2 | Gateway, update server, filter-list CDN |
| QA / release engineering | 2 | Perf bots, RD-x lab, release process |
| Product manager | 1 | R1 cut, decisions register |
| **Total** | **~18–19** | |

### 6.1 Capacity check

| Workload | Estimated steady-state FTE | Notes |
|---|---|---|
| Stable rebases (every 4 weeks) | 1.5–2 | To be measured in spike S1. This is the biggest unknown. |
| Security merges and sheriff rotation | 0.5–1 | Spread across platform engineers plus 1 release engineer |
| Build farm, CI, signing, updater | 0.5 | Spread across platform and release engineering |
| **Fork maintenance total** | **2.5–3.5** | Roughly the whole platform team. Feature work cannot borrow from it. |

**Rule:** if spike S1 measures fork maintenance above 3.5 FTE, then R1 scope, team size, or the foundation approach (D-5) must change at G1. Pushing the timeline out is not an acceptable answer on its own.

---

## 7. Success metrics

| Metric | Target | From |
|---|---|---|
| Weekly active users | Set by GTM plan | R1 |
| D30 retention | ≥ 35% | R1 |
| Mean upstream security-fix lag (SEC-01) | ≤ 48 h | R1 |
| Median memory vs Chrome (W30, RD-1) | ≤ 0.85× | R1 |
| % WAU using the assistant weekly | ≥ 40% | R1 |
| Citation click-through ("open source") on assistant answers | Tracked (opt-in telemetry) | R1 |
| % WAU using an AI feature weekly | ≥ 50% | R2 |
| % AI requests served on device | ≥ 60% | R2 |
| Agent tasks completed without takeover | ≥ 75% | R3 |
| Security: agent-caused sensitive action without confirmation | **0** | R3 |
