// ModelRouter (doc 05 §4.2, P4-AI-05): deterministic routing with a reason for
// every decision (logged to the Privacy Dashboard). R1 follows the user's mode;
// R2 adds task kind, sensitivity, and the device's local AI profile.
import type { AiMode } from '@vz/common/types';
import type { ProviderId } from '../../prefs/prefs_schema';

export type TaskKind = 'intent' | 'group_tabs' | 'embed' | 'classify' | 'short_summary' | 'qa' | 'summary' | 'agent_plan' | 'multi_tab_synthesis' | 'long_doc_qa' | 'selection';

export interface RouteInput {
  mode: AiMode;
  provider: ProviderId;
  task: TaskKind;
  sensitivity: 'normal' | 'high';
  deviceHasLocalProfile: boolean;
  privateWindow: boolean;
  /** The configured OpenAI-compatible endpoint is on this machine. */
  compatIsLocal: boolean;
  generativeLocalAvailable: boolean;
}

export type Route =
  | { kind: 'local'; reason: string }
  | { kind: 'cloud'; provider: ProviderId; reason: string }
  | { kind: 'refuse'; reason: string }
  | { kind: 'degrade'; reason: string };

const LOCAL_TASKS: TaskKind[] = ['intent', 'group_tabs', 'embed', 'classify', 'short_summary'];
const CLOUD_TASKS: TaskKind[] = ['agent_plan', 'multi_tab_synthesis', 'long_doc_qa'];

export function route(i: RouteInput): Route {
  if (i.mode === 'off') return { kind: 'refuse', reason: 'ai-off' };
  const cloudProvider: ProviderId = i.mode === 'cloud' ? 'gateway' : i.provider === 'local' ? 'gateway' : i.provider;
  const cloudIsLocal = cloudProvider === 'openai-compatible' && i.compatIsLocal;
  if (i.sensitivity === 'high' || i.privateWindow) {
    if (cloudIsLocal && i.mode === 'byo') return { kind: 'cloud', provider: cloudProvider, reason: 'sensitive→local-endpoint' };
    return i.deviceHasLocalProfile ? { kind: 'local', reason: i.privateWindow ? 'private-window→local' : 'sensitive→local' } : { kind: 'refuse', reason: 'sensitive-no-local' };
  }
  if (i.mode === 'local') return { kind: 'local', reason: 'mode-local' };
  if (LOCAL_TASKS.includes(i.task) && i.deviceHasLocalProfile) return { kind: 'local', reason: `task-${i.task}→local` };
  if (!i.deviceHasLocalProfile) return { kind: 'cloud', provider: cloudProvider, reason: 'no-local-profile' };
  if (CLOUD_TASKS.includes(i.task)) return { kind: 'cloud', provider: cloudProvider, reason: `task-${i.task}→cloud` };
  // Q&A and summaries: the user's chosen provider. Local first only when a generative local model exists (R2).
  if (i.generativeLocalAvailable) return { kind: 'local', reason: 'local-first (escalate on low confidence)' };
  return { kind: 'cloud', provider: cloudProvider, reason: `mode-${i.mode}` };
}

const SENSITIVE = /(^|\.)(bank|banque|paypal|stripe|chase|wellsfargo|hsbc|barclays|equitybank|bk\.rw|mtn|momo|airtel|irembo|health|clinic|hospital|patient|tax|impots|irs|revenue)/i;

/** Pages that are sensitive by URL category (MEM-02 shares this list). Defaults to sensitive when unsure. */
export function sensitivityOf(url: string): 'normal' | 'high' {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'normal';
    if (SENSITIVE.test(u.hostname) || /\/(login|signin|account|checkout|payment|billing|password)/i.test(u.pathname)) return 'high';
    return 'normal';
  } catch {
    return 'high';
  }
}
