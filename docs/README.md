# Vizulla — Documentation Index

> **Vizulla** is a lightweight, AI-native desktop browser built on the Chromium engine (Blink rendering + V8 JavaScript). It works like a normal browser out of the box, and it rethinks traditional browsing patterns (tabs, bookmarks, address bar, history, downloads) around an assistant that understands what you are doing.

| Field | Value |
|---|---|
| Document set version | 0.2 (Draft) |
| Date | 2026-11-07 |
| Status | For review. Phase 0 decisions open (doc 07 §3). |
| Owner | Vizulla Product & Engineering |

## Documents

| # | Document | Purpose |
|---|---|---|
| 01 | [Browser Architecture Research](01-research-browser-architecture.md) | How modern browsers are designed and built: engines, process model, rendering pipeline, networking, security, extensions, and ways to build on Chromium. |
| 02 | [AI Browser Market Analysis](02-market-analysis-ai-browsers.md) | The 2025–2026 AI browser landscape, with evidence grades. What works, what fails, and where Vizulla can stand out. |
| 03 | [Traditional → Modern Browsing Transition](03-traditional-to-modern-transition.md) | Each legacy browsing concept mapped to its AI-native replacement and its release, with backward-compatibility rules. |
| 04 | [Software Requirements Specification (SRS)](04-srs.md) | The acceptance contract: requirements with a target release and verification method, measurement definitions, owners. |
| 05 | [Architecture & Big-Picture Prototype](05-architecture-prototype.md) | System architecture, process model, AI subsystem, data flows, UI wireframes, code layout, and architecture by release. |
| 06 | [AI Security & Privacy Model](06-ai-security-privacy.md) | Threat model, controls (enforcement vs detection), the agent capability model, and the data lifecycle. |
| 07 | [Roadmap & Architecture Decisions](07-roadmap-and-decisions.md) | Staged releases (R1/R2/R3), phased plan, open decisions, ADRs, risks, team and capacity. |
| 08 | [Validation Plan](08-validation-plan.md) | Gates, foundation (fork) evaluation, technical spikes, user research, and the Chromium update & security process. |
| 09 | [Implementation Plan](09-implementation/README.md) | For developers: the engineering handbook and phase-by-phase tasks (Phase 0 → Stage B agent), with Chromium integration points, interfaces, estimates, and done criteria. |

## Release plan at a glance

| Release | Contents | Gate |
|---|---|---|
| **R1 = v1.0** Browser + Assistant | Chromium browser, Shields, vertical tabs + Spaces, Command Bar, page/PDF Q&A with citations (cloud or BYO model, read-only). Windows + macOS. EN/FR. | G3 ≈ month 12–13 |
| **R2 = v1.x** Memory + Local AI | On-device runtime, Memory, Notes, multi-tab synthesis, sync, Linux/ARM64, Kinyarwanda/Swahili | G4 ≈ month 18–19 |
| **R3 = v2.0** Supervised Agent | Stage A (isolated session, navigate/interact), then Stage B (personal data and commit actions) | G5/G6 |

## How to read this set

- **Product / stakeholders:** 02 → 03 → 07 §1–3 → 04 §1–2 → 08 §1.
- **Engineers:** 01 → 05 → 06 → 04 (§3–7) → 07 (ADRs) → 08 §2–3 → 09 (handbook, then your phase).
- **Security reviewers:** 06 → 05 §3, §4, §7 → 04 §5.3 → 08 §5.
- **QA / release:** 04 §7 (verification and measurement methods) → 08 §5.

## Change log

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-11-07 | First draft. |
| 0.2 | 2026-11-07 | Incorporated the external architecture review. **Scope:** single v1.0 replaced by staged releases R1/R2/R3. v1.0 now ships without the agent, Memory, sync, or a bundled runtime (07 §1). **Fork:** ADR-001 now Proposed, decided at Gate G1 with measured criteria against a narrow fork and an extension-first fallback (08 §2). **Security:** controls typed as enforcement vs detection, a "guaranteed / not guaranteed" list, an explicit capability model with data access and egress rules, staged agent gates (06). **SRS:** target release + verification method per requirement, reference devices, named workloads and pass rules for PERF/WPT/extensions, owners and dependencies (04 §7–8). **Consistency fixes:** sync moved to R2, the agent flag audience defined (07 §2.1), launch languages staged, the 72 h SLO measured from the upstream Stable release everywhere, Google breach-check dependency flagged (C4). **Dependencies:** WebMCP and built-in AI APIs flag-gated (SRS C6). Local runtime starts with one engine. **Market:** evidence grades and an evidence log (02 §0, §6). **New:** doc 08 Validation Plan. |

## A note on terminology

People often say "the Chrome engine, V8". To be precise:

- **Chromium** is the open-source browser project Chrome is built from.
- **Blink** is Chromium's rendering engine (HTML, CSS, layout, paint).
- **V8** is Chromium's JavaScript and WebAssembly engine.
- **Skia** is the 2D graphics library; **Viz** is the compositor/display service.

Vizulla is built on **Chromium**, so it gets Blink and V8 together with Chromium's networking, sandboxing, and security work.
