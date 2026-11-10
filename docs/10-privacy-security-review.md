# 10 — Privacy & Security Review (0.4.1)

What Vizulla protects against, how it compares with privacy-focused browsers, what changed in 0.4.1, and what comes next. It sits on top of the AI-specific threat model in [06-ai-security-privacy.md](06-ai-security-privacy.md).

**Principle: private by default, with no setup.** Every protection below is on for new profiles except Clear on exit, which signs people out everywhere. Nothing here adds a Vizulla server to the request path.

---

## 1. Threats, in order of how often they hit real users

| # | Threat | Who does it | Vizulla's answer |
|---|---|---|---|
| T1 | Cross-site tracking via third-party scripts, pixels, cookies | Ad-tech, analytics | Shields (signed filter lists + strict mode), third-party cookies blocked natively, storage partitioning |
| T2 | Click tracking in links (`utm_*`, `fbclid`, `gclid`…) and redirect hops (`google.com/url`, `l.facebook.com`) | Platforms, email marketers | **Clean Links** (new): stripped or skipped before the request leaves |
| T3 | Fingerprinting (canvas, audio, WebGL, hardware) | Fraud/ads vendors | Per-site, per-session farbling; strict in private windows |
| T4 | Sale/sharing of personal data by sites the user visits | First parties | **Global Privacy Control** (new): legally binding opt-out in a growing number of US states (about 12 in 2026, including CA, CO, CT, OR) |
| T5 | Real-IP leak through WebRTC (local network address, IP behind a VPN) | Any page with JS | **WebRTC protection** (new): public interface only; private windows send no UDP outside a proxy |
| T6 | Network observers (Wi-Fi, ISP) | Passive attackers | HTTPS-First, DNS over HTTPS (automatic), certificate errors fail closed |
| T7 | Leftover state on shared or lost machines | Other people at the device | Private windows (in memory, capture-protected, Touch ID lock); **Clear on exit** (new, opt-in) |
| T8 | Consent dark patterns | CMP vendors | Cookie-banner auto-reject |
| T9 | `<a ping>` / beacon click auditing to third parties | Ad-tech | **Cross-site pings blocked** (new) |
| T10 | Referer leaking full URLs (tokens in paths and queries) | Any embedded third party | Chromium's default `strict-origin-when-cross-origin`: only the origin crosses sites (verified in e2e) |

## 2. Where we stand against the field

| Protection | Vizulla 0.4.1 | Brave | Firefox (ETP Standard) | Safari | Chrome |
|---|---|---|---|---|---|
| Ad/tracker blocking by default | ✅ | ✅ | trackers only | ITP heuristics | ❌ |
| 3P cookies blocked | ✅ | ✅ | partitioned | ✅ | ❌ (user choice) |
| Tracking-parameter stripping | ✅ | ✅ | private windows / strict | private only | ❌ |
| Redirect (bounce) skipping | ✅ known hops | ✅ debounce | ❌ | ❌ | ❌ |
| GPC on by default | ✅ | ✅ | private only | ❌ | ❌ |
| Fingerprint randomisation | ✅ | ✅ | resistFP opt-in | reduced surface | ❌ |
| WebRTC IP protection by default | ✅ | ✅ | ❌ | ✅ (mDNS) | ❌ (mDNS only) |
| Cookie-banner reject | ✅ | ✅ | ✅ (some regions) | ❌ | ❌ |
| Privacy checkup / score | ✅ | ❌ | ❌ | Privacy Report | Safety Check |
| AI data disclosure log | ✅ | ❌ | ❌ | ❌ | ❌ |

The table reflects vendor defaults as we understand them in late 2026. Re-verify before using it in marketing.

## 3. Shipped in 0.4.1

- **Clean Links**: `shields/link_privacy.ts`, a top-level and frame navigation handler at priority 5 in the request pipeline. Idempotent, so it never loops. It respects Shields site exceptions and is counted as a blocked tracker. Unit tests: `link_privacy.test.ts`.
- **Global Privacy Control**: Chromium's own `GlobalPrivacyControl` feature, which sends the `Sec-GPC: 1` header and sets `navigator.globalPrivacyControl`. It runs with **no header hook**, keeping the 0.4.0 speed work (the speed e2e asserts zero header listeners). A change takes effect after a restart, like third-party cookies.
- **WebRTC IP protection**: `setWebRTCIPHandlingPolicy` per web contents. `default_public_interface_only` in normal windows, `disable_non_proxied_udp` in private windows.
- **Cross-site ping blocking**: in the Shields handler, for `resourceType === 'ping'` when the target is cross-site.
- **Clear on exit**: cookies, storage and cache are cleared at quit (capped at 4 s). Extensions' own origins are excluded. Cookies are also cleared at the next start in case the browser crashed.
- **Privacy checkup**: Settings → Shields & privacy. It shows N of 10 protections with a one-click "Turn on all" and a link to the 30-day blocked count on the dashboard.
- **Tab close button**: the 20 px button kept Chromium's default 6 px side padding, which left 8 px for a 12 px glyph and pushed it off-centre. Padding is reset on `.x`, space dots and `.icon-btn`. The e2e test asserts the glyph is centred to within 0.6 px.

### Considered and rejected

- **Forced Referer trimming** (overriding pages that ask for `unsafe-url`) needs an `onBeforeSendHeaders` hook on every request. That is exactly the cost 0.4.0 removed (about 19 % on request-heavy pages). Chromium's default already trims cross-site referrers, so we rely on it.
- **Blocking all beacons**: same-site analytics and logout beacons break. We block only cross-site pings.

## 3b. Shipped in 0.4.2: ads that got through

Diagnosis: shipped builds carried only the 133-rule baseline (no list server in production), Electron has no popup blocker, and EasyList's generic hiding rules only apply when the engine is told which classes/ids a page uses.

- **Full lists bundled**: about 6.9 MB compiled engine, loaded in about 13 ms, matching in about 7 µs per request.
- **Video and pre-roll ads**: uBO scriptlets (json-prune and others) run through privileged injection before the page's scripts, so a site's CSP can't stop them. On YouTube, `adPlacements`, `playerAds` and `adSlots` are stripped from the player response (verified live).
- **Popups, popunders and tab-unders**: the lists' `$popup` rules, Chrome's rule of one tab per real gesture, and `$document` rules for cross-site navigations a page starts (never typed addresses).
- **Self-hosted banners** (e.g. IGIHE) need site rules: a regional section in `baseline.txt`.
- **Limit**: the lists refresh with each release. YouTube changes often, so a signed list server (`VZ_SHIELDS_LIST_URL`, already supported) should come next.

## 4. Next (proposed)

1. **HTTPS-Only mode**: an interstitial instead of a silent HTTP fallback, with a per-site "continue".
2. **Breached-password alerts**: k-anonymity range queries (only 5 SHA-1 prefix characters leave the device), opt-in.
3. **Bounce-tracking mitigation**: clear the storage of sites that only ever appear as redirect hops (Chromium's `BtmEnabled` / DIPS feature is a candidate to enable).
4. **Forget-me sites**: per-site "clear when all tabs close" (Brave/Firefox style).
5. **Phishing and malware protection** without Google: a local Bloom filter of known-bad hosts, updated with the signed Shields lists, plus a lookalike-domain warning built on the existing punycode display.
6. **Download protection**: warn on executables from sites never visited before, and keep Mark-of-the-Web on Windows and macOS.
