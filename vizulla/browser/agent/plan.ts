// The plan is data, not text (Phase 5 §2). The planner model outputs JSON; the
// browser parses and validates it into a candidate plan. Only what the user
// approves in browser-owned UI becomes an ApprovedPlan.

export enum Tier {
  T0Read = 0,
  T1Navigate = 1,
  T2Interact = 2,
  T3PersonalData = 3,
  T4Commit = 4,
}

export const PROFILE_FIELDS = ['profile.name', 'profile.email', 'profile.phone', 'profile.address', 'profile.city', 'profile.country'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface PlanStep {
  index: number;
  label: string;
  origin: string;
  maxTier: Tier;
  dataFields: ProfileField[];
}

export interface ApprovedPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  allowedOrigins: Set<string>;
  /** Values the user typed in the plan, referenced by handle ({{value:v1}}). */
  userValues: Record<string, string>;
  session: 'isolated' | 'grant';
  grantOrigin?: string;
  approvedAt: number;
  expiresAt: number;
}

export type PlanCandidate = Omit<ApprovedPlan, 'approvedAt' | 'expiresAt' | 'id'>;

export class PlanError extends Error {}

const MAX_STEPS = 20;

export function normalizeOrigin(o: unknown): string {
  if (typeof o !== 'string' || o.length > 300) throw new PlanError('origin must be a string');
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(o) ? o : `https://${o}`);
  } catch {
    throw new PlanError(`bad origin ${o}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PlanError(`scheme not allowed: ${u.protocol}`);
  if (u.username || u.password) throw new PlanError('credentials in origin');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw new PlanError(`bad host ${u.hostname}`);
  return u.origin;
}

/**
 * Validates planner output (model JSON) into a plan candidate. Unknown fields,
 * unknown tiers, missing labels, bad origins, or over-scoped steps are rejected.
 */
export function validatePlan(raw: unknown, opts: { searchOrigin: string; stageB: boolean; userValues?: Record<string, string> }): PlanCandidate {
  if (typeof raw !== 'object' || raw === null) throw new PlanError('plan must be an object');
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['goal', 'steps'].includes(k)) throw new PlanError(`unexpected field ${k}`);
  if (typeof r.goal !== 'string' || !r.goal.trim() || r.goal.length > 500) throw new PlanError('goal required');
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > MAX_STEPS) throw new PlanError(`1..${MAX_STEPS} steps required`);
  const steps: PlanStep[] = r.steps.map((s: unknown, i: number) => {
    if (typeof s !== 'object' || s === null) throw new PlanError(`step ${i} must be an object`);
    const st = s as Record<string, unknown>;
    for (const k of Object.keys(st)) if (!['label', 'origin', 'tier', 'data_fields'].includes(k)) throw new PlanError(`step ${i}: unexpected field ${k}`);
    if (typeof st.label !== 'string' || !st.label.trim() || st.label.length > 200) throw new PlanError(`step ${i}: label required`);
    if (!Number.isInteger(st.tier) || (st.tier as number) < 0 || (st.tier as number) > 4) throw new PlanError(`step ${i}: unknown tier`);
    const tier = st.tier as Tier;
    if (tier >= Tier.T3PersonalData && !opts.stageB) throw new PlanError(`step ${i}: tier ${tier} needs Stage B`);
    const fields = st.data_fields ?? [];
    if (!Array.isArray(fields) || fields.some((f) => !(PROFILE_FIELDS as readonly string[]).includes(f as string))) throw new PlanError(`step ${i}: unknown data field`);
    if (fields.length && tier < Tier.T3PersonalData) throw new PlanError(`step ${i}: data fields need tier 3`);
    return { index: i, label: st.label.trim(), origin: normalizeOrigin(st.origin), maxTier: tier, dataFields: fields as ProfileField[] };
  });
  const allowed = new Set([...steps.map((s) => s.origin), normalizeOrigin(opts.searchOrigin)]);
  return { goal: r.goal.trim(), steps, allowedOrigins: allowed, userValues: { ...(opts.userValues ?? {}) }, session: 'isolated' };
}

export function maxTier(plan: Pick<ApprovedPlan, 'steps'>): Tier {
  return plan.steps.reduce<number>((m, s) => Math.max(m, s.maxTier), 0) as Tier;
}
