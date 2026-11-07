# 02 — AI Browser Market Analysis (2025–2026)

> Snapshot compiled in November 2026. Availability and pricing change fast. **The product facts in this document have not yet been checked against primary sources** (§6). Treat the landscape table as indicative until each row has a "checked" date.

---

## 0. Method and evidence grades

This analysis separates **observed facts** (what a product does, where it runs, what it costs) from **interpretation** (what that means for Vizulla). Each claim carries one of these grades:

| Grade | Meaning | Acceptable for |
|---|---|---|
| **A: Primary, checked** | Confirmed from the vendor's own site, docs, release notes, or store listing, or by hands-on testing, with a checked date | Requirements, positioning, external material |
| **B: Primary, unchecked** | A vendor source exists but has not been re-checked for this snapshot | Internal planning |
| **C: Secondary** | Reported by press, review, or comparison sites. Several sources used here are SEO-style review blogs with inconsistent details. | Direction only. Must be upgraded before external use. |
| **I: Interpretation** | Our analysis or opinion | Labeled as such |

**Process for the next revision:** for each product row, record the vendor URL, the date checked, and the checker. Where possible, install the product on an R1 platform (doc 07 §1) and test the claimed features. Security claims are traced to the original research publication, not to coverage of it.

---

## 1. Landscape

All product cells below are **grade C** unless noted. The "Strengths" and "Weaknesses" columns are **interpretation (I)** based on those reports.

| Product | Base | AI model | Platforms (reported, 2026) | Strengths (I) | Weaknesses (I) | Grade |
|---|---|---|---|---|---|---|
| **Gemini in Chrome** | Chrome | Gemini (cloud) + Gemini Nano (local) | Win, Mac, ChromeOS, Android | Widest reach. Assistance built into a browser people already use. Reported "Auto Browse" agent for paid tiers. | Agentic features reportedly gated by subscription and region. Tied to Google's ecosystem and data practices. | C (Nano local APIs: B, doc 01 §7) |
| **ChatGPT Atlas** (OpenAI) | Chromium | GPT family | macOS-first at launch | Reviewers rate its agent mode strongest. ChatGPT memory integration. | Single platform at launch. Agent reportedly paid-only. Prompt-injection concerns. | C |
| **Perplexity Comet** | Chromium | Perplexity + several models | Win, Mac, iOS, Android | Most agentic cross-platform option. Reported free worldwide since March 2026. | Reviews call auto-browse unreliable. Multi-step actions reportedly rate-limited on the free tier. | C |
| **Dia** (The Browser Company) | Chromium | several models | macOS (Apple Silicon) | Chat-with-tabs. Clean UX. Successor to Arc's ideas. | Less agentic. Limited platforms. | C |
| **Microsoft Edge + Copilot** | Chromium | Copilot (cloud) | Win, Mac, Linux, mobile | Enterprise reach. Copilot Mode. | Feels heavy and cluttered. Aggressive promotion. | C |
| **Opera Neon / Aria** | Chromium | several models | Win, Mac | Early agent concepts, sidebar AI. | Niche share. | C |
| **Brave + Leo** | Chromium | several models, privacy proxy | All | Privacy-first AI, native ad-block. | AI is an add-on, not the core experience. | C |
| **Arc** (legacy) | Chromium | — | Mac, Win | Defined the "modern browser" UX: vertical tabs, Spaces, auto-archive. | Development wound down in favor of Dia. | C |

## 2. What the market has shown

These are **interpretations (I)** drawn from the reports above and from widely adopted product patterns. Items marked † rest on specific research claims listed in §6.

### 2.1 What works
1. **Chat with the current page or tabs.** Summarize, ask questions, compare. It is reported as the most-used AI feature across products. We have no usage data of our own yet. The prototype study (doc 08 §4) measures it for our segments.
2. **Vertical tabs + Spaces/workspaces** (Arc, Edge, Vivaldi, Zen). People want context separation. (Observable: the feature ships in several browsers.)
3. **Auto-tidying.** Archiving stale tabs, AI-named tab groups.
4. **Natural-language history search** ("that article about solar panels I read last week").
5. **Native ad/tracker blocking** (Brave): a big speed and privacy win that users can see.

### 2.2 What fails or frustrates
1. **Unreliable autonomous agents.** Multi-step tasks fail silently or need babysitting.
2. **Security incidents.**† Prompt injection, credential theft through injected instructions (LayerX "BioShocking", CSA research notes), cross-origin data leaks. A University of Washington study (July 2026) reportedly found that 4 of 7 agentic browsers it tested allowed same-origin-policy bypasses. *The original paper has not yet been located and checked.*
3. **Paywalled core features.** Agents locked behind $20+/month (pricing grade C).
4. **Platform lock-in.** Mac-only launches leave out the large Windows user base, including emerging markets.
5. **Cloud-only AI.** Privacy worries, latency, and no offline use.
6. **Bloat.** AI sidebars, shopping widgets, and news feeds make browsers slower and noisier.
7. **Patch lag.**† Smaller Chromium forks fall behind on security fixes (Trail of Bits, Jan 2026, grade B).

## 3. Gap analysis: where Vizulla stands out

The gaps come from §2 (interpretation). The responses are Vizulla's plan, with the release that delivers each one.

| Gap in market | Vizulla response | Release |
|---|---|---|
| Patch lag | Security fixes shipped **within 72 hours** of the upstream release (internal SLO SEC-01, rehearsed in drills, doc 08 §5). | R1 |
| Bloat | **"Calm by default"**: no feeds, no shopping widgets. AI features stay quiet until the user calls them. | R1 |
| AI answers you can't check | **Citations on every answer**, with scroll-to-source on the page or PDF. | R1 |
| Locked to one provider | **Bring your own model**: Vizulla Gateway, user API keys (Anthropic, OpenAI, Google, etc.), or a local OpenAI-compatible server. | R1 |
| Paywalled basics | Page/PDF Q&A free (Gateway free quota in R1; on-device in R2). | R1/R2 |
| Mac-first | **Windows and macOS at R1**, Linux and ARM64 at R2. Low-RAM devices (8 GB) are a first-class target (RD-1). | R1/R2 |
| AI is cloud-only | **Hybrid AI**: an on-device small model by default for summaries, classification, tab organization, and search. Cloud only when the user opts in or the task needs it. | R2 |
| Agents are unsafe | **Capability model** (doc 06 §5): read-only first, isolated agent session, deterministic plan enforcement, browser-owned confirmations. | R3 |
| Agents are unreliable | **Structured-first actions** (WebMCP where available → accessibility tree → DOM → vision). Show the plan before running. Run step by step with checkpoints. | R3 |

## 4. Target segments

| Segment | Needs | Priority |
|---|---|---|
| **Knowledge workers** (research, writing, analysis) | Multi-tab synthesis, notes, citations, workspaces | **R1 primary** (D-2) |
| **Students** | Summaries, PDF Q&A, study notes, low-cost hardware | **R1 primary** (D-2) |
| **Everyday users** | Fast, safe, simple. Built-in ad-block, translation, passwords | R2 |
| **Developers** | DevTools, AI-assisted debugging, local models | R2 |
| **SMB / enterprise** | Policies, managed AI, data residency, audit logs | Later |

Why these two first (I): both read long pages and PDFs, both suffer from tab overload, and both value citations they can check. That fits the R1 assistant workflow and the Spaces UX. Students on 8 GB laptops are also the hardest performance target, so serving them first keeps the "lightweight" claim honest.

## 5. Positioning statement

**R1 (v1.0):**
> **For people who research and study in their browser, Vizulla is the fast, private Chromium browser that keeps your tabs organized and answers questions about what you're reading, with sources you can check. Unlike AI browsers that lag on security patches or lock you into one cloud, Vizulla ships security fixes within 72 hours, blocks trackers natively, and works with the AI provider you choose.**

**Long-term (R2–R3):**
> **For people who live in their browser, Vizulla is the lightweight Chromium browser where AI does the busywork (organizing, summarizing, finding, filling) without giving up speed, privacy, or control. Unlike cloud-locked AI browsers, Vizulla runs smart features on your device first, works with any model, and treats every AI action as something you can see, approve, and undo.**

---

## 6. Evidence log

To be completed before any external use of this document. "Checked" means a primary source was opened and the claim confirmed on that date.

| Claim | Used in | Current grade | Primary source to check | Checked |
|---|---|---|---|---|
| Gemini in Chrome platforms, Auto Browse tiers and regions | §1 | C | Google Chrome / Gemini product pages and release notes | — |
| Chrome built-in AI APIs and ~22 GB disk requirement | doc 01 §7 | B | developer.chrome.com built-in AI docs | — |
| Atlas platforms and agent pricing | §1 | C | OpenAI Atlas product page and help center | — |
| Comet free worldwide since March 2026, free-tier limits | §1 | C | Perplexity Comet site and announcements | — |
| Dia platforms; Arc development status | §1 | C | The Browser Company site/blog | — |
| Edge Copilot Mode availability | §1 | C | Microsoft Edge release notes | — |
| Opera Neon availability | §1 | C | Opera press releases | — |
| Brave Leo models and privacy proxy | §1 | C | Brave Leo docs | — |
| UW study: 4 of 7 agentic browsers allowed SOP bypass (July 2026) | §2.2, doc 06 §1 | C | The original paper or preprint | — |
| LayerX "BioShocking" credential theft | §2.2, doc 06 §1 | C (via CSA) | LayerX's original research post | — |
| Agentic browsers run Chromium weeks/months behind | §2.2, doc 01 §8.1 | B | Trail of Bits post (Jan 2026) | — |
| "Chat with page is the most-used AI feature" | §2.1 | C | Vendor usage disclosures, or our own study (doc 08 §4) | — |

---

## Sources

Secondary comparison sources (grade C):
- [TechRepublic — 5 Best AI Browsers for 2026 Compared](https://www.techrepublic.com/article/news-best-ai-browsers-2026/)
- [NoHacks — The Agentic Browser Landscape in 2026](https://nohacks.co/blog/agentic-browser-landscape-2026)
- [BrowserBash — ChatGPT Atlas vs Comet vs Gemini in Chrome](https://browserbash.com/blog/chatgpt-atlas-vs-perplexity-comet-vs-gemini-in-chrome)
- [FreeAcademy — AI Browsers 2026](https://freeacademy.ai/blog/ai-browsers-chatgpt-atlas-vs-comet-vs-gemini-2026)
- [FrankX — Best AI Browser 2026](https://www.frankx.ai/blog/best-ai-browser-2026)
- [SuperchargeBrowser — Best AI Browsers 2026](https://www.superchargebrowser.com/library/best-ai-browsers-2026/)
- [ToolChase — 9 AI Browsers Compared](https://toolchase.com/blog/best-ai-browsers-2026/)

Security research (primary or near-primary):
- [CSA — BioShocking: AI Browser Agents Weaponized for Credential Theft](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-browser-prompt-injection-20260630-csa-s/)
- [Trail of Bits — Lack of isolation in agentic browsers](https://blog.trailofbits.com/2026/01/13/lack-of-isolation-in-agentic-browsers-resurfaces-old-vulnerabilities/)
