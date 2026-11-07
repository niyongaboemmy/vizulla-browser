// The Policy Enforcer (P5-SEC-01, AGT-05/11/12, ADR-011): deterministic checks on
// every proposed tool call against the approved plan. This is the security
// boundary; it has no model in the loop and must be 100% green on the attack
// suite. Detection (injection_detector) is advisory and can only pause.
import { Tier, type ApprovedPlan, type ProfileField } from './plan';
import { siteOf } from '@vz/common/url';

export type Tool = 'observe' | 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'submit' | 'fill_personal' | 'wait' | 'done';

export const TOOL_TIER: Record<Tool, Tier> = {
  observe: Tier.T0Read,
  wait: Tier.T0Read,
  done: Tier.T0Read,
  scroll: Tier.T0Read,
  navigate: Tier.T1Navigate,
  click: Tier.T2Interact,
  type: Tier.T2Interact,
  select: Tier.T2Interact,
  fill_personal: Tier.T3PersonalData,
  submit: Tier.T4Commit,
};

/** Provenance of a value the agent wants to type (C7a). Values are referenced by handle, never copied by the model. */
export type ValueRef =
  | { kind: 'user'; handle: string }
  | { kind: 'profile'; field: ProfileField }
  | { kind: 'page'; origin: string; text: string }
  | { kind: 'free'; text: string };

export interface ToolCall {
  id: string;
  tool: Tool;
  /** Origin of the page the call acts on (set by the browser from the tab, never by the model). */
  targetOrigin: string;
  url?: string;
  nodeId?: number;
  snapshotId?: number;
  value?: ValueRef;
  /** Set by the actuator from the target node: submit buttons, "Pay", "Book"… are commits. */
  targetIsCommit?: boolean;
}

export interface ExecutionState {
  currentStep: number;
  stageB: boolean;
  lastSnapshotId: number;
  seenCallIds: Set<string>;
  now: number;
  /** Known private values (profile, vault usernames) that must not leak via free text. */
  privateValues: string[];
}

export type Verdict =
  | { kind: 'allow' }
  | { kind: 'reject'; reason: RejectReason }
  | { kind: 'needs-approval'; reason: 'new-origin'; origin: string }
  | { kind: 'needs-confirmation'; reason: 'commit' | 'personal-data' };

export type RejectReason =
  | 'plan-expired' | 'replayed-call' | 'unknown-tool' | 'tier-exceeded' | 'stage-disabled' | 'bad-step'
  | 'bad-url' | 'stale-snapshot' | 'missing-node' | 'disallowed-data' | 'pii-in-free-text' | 'free-text-too-long' | 'grant-scope';

const reject = (reason: RejectReason): Verdict => ({ kind: 'reject', reason });

const PII = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email
  /(?:\+?\d[\s-]?){9,15}/, // phone-like digit runs
  /\b(?:\d[ -]*?){13,19}\b/, // card-like
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/, // IBAN-like
];

export function looksLikePii(text: string): boolean {
  return PII.some((re) => re.test(text));
}

export function tierOf(call: ToolCall): Tier {
  const base = TOOL_TIER[call.tool];
  if (base === undefined) return Tier.T4Commit;
  // A click on a commit control is a commit (T4), whatever the tool is called.
  if ((call.tool === 'click' || call.tool === 'type') && call.targetIsCommit) return Tier.T4Commit;
  if (call.value?.kind === 'profile') return Math.max(base, Tier.T3PersonalData) as Tier;
  return base;
}

export function check(plan: ApprovedPlan, call: ToolCall, state: ExecutionState): Verdict {
  if (state.now > plan.expiresAt) return reject('plan-expired');
  if (!call.id || state.seenCallIds.has(call.id)) return reject('replayed-call');
  if (!(call.tool in TOOL_TIER)) return reject('unknown-tool');
  const step = plan.steps[state.currentStep];
  if (!step) return reject('bad-step');
  const tier = tierOf(call);
  if (tier >= Tier.T3PersonalData && !state.stageB) return reject('stage-disabled');
  if (tier > step.maxTier) return reject('tier-exceeded');

  // Where the call acts. Navigation targets the destination URL.
  let target = call.targetOrigin;
  if (call.tool === 'navigate') {
    let u: URL;
    try {
      u = new URL(call.url ?? '');
    } catch {
      return reject('bad-url');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject('bad-url');
    if (u.username || u.password) return reject('bad-url');
    target = u.origin;
  }
  // A logged-in session grant covers exactly one origin (Stage B, P6-BRW-02).
  if (plan.session === 'grant' && plan.grantOrigin && target !== plan.grantOrigin && call.tool !== 'observe') return reject('grant-scope');
  if (tier > Tier.T0Read && !plan.allowedOrigins.has(target)) return { kind: 'needs-approval', reason: 'new-origin', origin: target };

  // Node-targeting tools must use an id from the latest snapshot (stale → re-observe).
  if (['click', 'type', 'select', 'submit', 'fill_personal'].includes(call.tool)) {
    if (call.nodeId === undefined) return reject('missing-node');
    if (call.snapshotId !== state.lastSnapshotId) return reject('stale-snapshot');
  }

  // Data flow checks (AGT-12 / C7a).
  const v = call.value;
  if (v) {
    switch (v.kind) {
      case 'user':
        // Own properties only: prototype keys like "constructor" are not user values.
        if (!Object.hasOwn(plan.userValues, v.handle)) return reject('disallowed-data');
        break;
      case 'profile':
        if (!step.dataFields.includes(v.field)) return reject('disallowed-data');
        break;
      case 'page':
        // Text read from one origin may only be typed back into the same site.
        if (siteOf(v.origin) !== siteOf(target)) return reject('disallowed-data');
        break;
      case 'free':
        if (v.text.length > 200) return reject('free-text-too-long');
        if (looksLikePii(v.text)) return reject('pii-in-free-text');
        if (state.privateValues.some((p) => p.length >= 4 && v.text.toLowerCase().includes(p.toLowerCase()))) return reject('pii-in-free-text');
        break;
    }
  } else if (call.tool === 'type' || call.tool === 'fill_personal') {
    return reject('disallowed-data');
  }

  if (tier === Tier.T4Commit) return { kind: 'needs-confirmation', reason: 'commit' };
  if (tier === Tier.T3PersonalData) return { kind: 'needs-confirmation', reason: 'personal-data' };
  return { kind: 'allow' };
}
