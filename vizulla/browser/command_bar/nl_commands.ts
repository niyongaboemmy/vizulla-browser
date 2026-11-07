// Natural-language commands (P4-BRW-06, CMD-05) and Ask Settings (P4-BRW-07).
// The mapper only ever returns a command id from COMMANDS, with arguments that
// are validated against the current state (existing Spaces, writable prefs).
// It runs on device; the input never leaves the machine.
import { COMMANDS, findCommand, fuzzyScore } from './commands';
import { WRITABLE_PREFS } from '../prefs/prefs_schema';

export interface NlContext {
  spaces: string[];
  commandTitle: (id: string) => string;
  prefs: { defaultZoom: number };
}

export interface NlResult {
  commandId: string;
  args?: Record<string, string>;
  /** Human-readable interpretation shown in the Command Bar row. */
  label: string;
}

type Rule = [RegExp, (m: RegExpExecArray, ctx: NlContext) => NlResult | null];

const space = (name: string, ctx: NlContext) => ctx.spaces.find((s) => s.toLowerCase() === name.toLowerCase()) ?? ctx.spaces.find((s) => s.toLowerCase().startsWith(name.toLowerCase()));
const setting = (key: string, value: unknown, label: string): NlResult | null => (WRITABLE_PREFS[key as keyof typeof WRITABLE_PREFS]?.(value) ? { commandId: 'settings.set', args: { key, value: JSON.stringify(value) }, label } : null);

const RULES: Rule[] = [
  [/^(?:please )?(?:un)?mute (?:this |the )?tab$|^(?:silence|quiet) (?:this )?tab$/i, () => ({ commandId: 'tab.mute', label: '' })],
  [/^(?:un)?pin (?:this |the )?tab$/i, () => ({ commandId: 'tab.pin', label: '' })],
  [/^close (?:all )?(?:the )?other tabs$/i, () => ({ commandId: 'tab.closeOthers', label: '' })],
  [/^close (?:this |the )?tab$/i, () => ({ commandId: 'tab.close', label: '' })],
  [/^(?:reopen|restore) (?:the )?(?:last )?closed tab$/i, () => ({ commandId: 'tab.reopen', label: '' })],
  [/^duplicate (?:this )?tab$/i, () => ({ commandId: 'tab.duplicate', label: '' })],
  [/^(?:organi[sz]e|group|tidy|sort) (?:up )?(?:my |the )?tabs$/i, () => ({ commandId: 'tab.groupAi', label: '' })],
  [/^(?:archive|clean up) (?:my )?(?:idle |old )?tabs$/i, () => ({ commandId: 'tab.archiveIdle', label: '' })],
  [/^(?:open )?split(?: view| screen)?$|^side by side$/i, () => ({ commandId: 'tab.split', label: '' })],
  [/^(?:switch|go|jump) to (?:my |the )?(.+?)(?: space)?$|^open (?:my |the )?(.+?) space$/i, (m, ctx) => {
    const s = space((m[1] ?? m[2])!, ctx);
    return s ? { commandId: 'space.switch', args: { space: s }, label: s } : null;
  }],
  [/^move (?:this |the )?tab to (?:my |the )?(.+?)(?: space)?$/i, (m, ctx) => {
    const s = space(m[1]!, ctx);
    return s ? { commandId: 'tab.moveToSpace', args: { space: s }, label: s } : null;
  }],
  [/^(?:create|make|add|new) (?:a )?(?:new )?space(?: (?:called|named|for))? (.{1,40})$/i, (m) => ({ commandId: 'space.new', args: { name: m[1]!.trim() }, label: m[1]!.trim() })],
  [/^rename (?:this )?space (?:to|as) (.{1,40})$/i, (m) => ({ commandId: 'space.rename', args: { name: m[1]!.trim() }, label: m[1]!.trim() })],
  [/^delete (?:this |the current )?space$/i, () => ({ commandId: 'space.delete', label: '' })],
  [/^(?:summari[sz]e|tl;?dr)(?: this(?: page)?)?$/i, () => ({ commandId: 'ai.summarize', label: '' })],
  [/^(?:reader|reading)(?: mode| view)?$/i, () => ({ commandId: 'view.reader', label: '' })],
  [/^(?:clear|delete|erase) (?:my |the )?(?:browsing )?history$/i, () => ({ commandId: 'privacy.clearHistory', label: '' })],
  [/^(?:focus|focus mode|sleep other spaces)$/i, () => ({ commandId: 'focus.toggle', label: '' })],
  // Ask Settings
  [/\b(?:dark (?:mode|theme)|mode sombre)\b/i, () => setting('appearance.theme', 'dark', 'Theme → Dark')],
  [/\b(?:light (?:mode|theme)|mode clair)\b/i, () => setting('appearance.theme', 'light', 'Theme → Light')],
  [/\bhigh contrast\b/i, () => setting('appearance.theme', 'high-contrast', 'Theme → High contrast')],
  [/\b(?:make |set )?(?:the )?text (?:bigger|larger)\b|\bincrease (?:the )?(?:text|font) size\b|\bzoom in on all sites\b/i, (_m, ctx) =>
    setting('appearance.defaultZoom', Math.min(3, Math.round((ctx.prefs.defaultZoom + 0.1) * 10) / 10), `Default zoom → ${Math.round(Math.min(3, ctx.prefs.defaultZoom + 0.1) * 100)}%`)],
  [/\b(?:make |set )?(?:the )?text smaller\b|\bdecrease (?:the )?(?:text|font) size\b/i, (_m, ctx) =>
    setting('appearance.defaultZoom', Math.max(0.5, Math.round((ctx.prefs.defaultZoom - 0.1) * 10) / 10), `Default zoom → ${Math.round(Math.max(0.5, ctx.prefs.defaultZoom - 0.1) * 100)}%`)],
  [/\b(?:turn |switch )?(on|off) (?:the )?shields\b|\b(enable|disable) (?:ad ?block|shields)\b/i, (m) => {
    const on = /on|enable/i.test(m[1] ?? m[2]!);
    return setting('shields.enabled', on, `Shields → ${on ? 'On' : 'Off'}`);
  }],
  [/\b(?:use|switch to) (?:the )?(top|horizontal|vertical|side(?:bar)?) tabs\b|\btabs (?:on|at) the (top|side)\b/i, (m) => {
    const v = /top|horizontal/i.test(m[1] ?? m[2]!) ? 'horizontal' : 'vertical';
    return setting('tabs.layout', v, `Tab layout → ${v}`);
  }],
  [/\bturn (on|off) (?:ai|the assistant)\b/i, (m) => setting('ai.mode', m[1]!.toLowerCase() === 'off' ? 'off' : 'local', `AI → ${m[1]}`)],
];

export function mapNlCommand(text: string, ctx: NlContext): NlResult | null {
  const q = text.trim().replace(/[.!]+$/, '');
  if (q.length < 3 || q.length > 120) return null;
  for (const [re, fn] of RULES) {
    const m = re.exec(q);
    if (!m) continue;
    const r = fn(m, ctx);
    if (r && findCommand(r.commandId)) return { ...r, label: r.label ? `${ctx.commandTitle(r.commandId)}: ${r.label}` : ctx.commandTitle(r.commandId) };
  }
  // Fallback: a confident match against command titles (never anything outside COMMANDS).
  let best: { id: string; s: number } | null = null;
  for (const c of COMMANDS) {
    if (c.args?.some((a) => !a.optional)) continue;
    const s = fuzzyScore(q, ctx.commandTitle(c.id));
    if (s >= 100 + Math.min(q.length, 8) && (!best || s > best.s)) best = { id: c.id, s };
  }
  return best ? { commandId: best.id, label: ctx.commandTitle(best.id) } : null;
}

/** AI tab grouping (P4-AI-13): cluster by site, then by shared title vocabulary. */
export function proposeGroups(tabs: { id: number; title: string; url: string }[], tokenize: (s: string) => string[]): { title: string; tabIds: number[] }[] {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const left = new Set(tabs.map((t) => t.id));
  const groups: { title: string; tabIds: number[] }[] = [];
  const bySite = new Map<string, number[]>();
  for (const t of tabs) {
    const h = host(t.url);
    if (h) bySite.set(h, [...(bySite.get(h) ?? []), t.id]);
  }
  for (const [h, ids] of bySite) {
    if (ids.length < 2) continue;
    groups.push({ title: h.split('.').slice(-2, -1)[0]!.replace(/^./, (c) => c.toUpperCase()), tabIds: ids });
    ids.forEach((id) => left.delete(id));
  }
  const toks = new Map(tabs.filter((t) => left.has(t.id)).map((t) => [t.id, new Set(tokenize(t.title))]));
  const freq = new Map<string, number[]>();
  for (const [id, set] of toks) for (const w of set) if (w.length > 3) freq.set(w, [...(freq.get(w) ?? []), id]);
  for (const [w, ids] of [...freq.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const free = ids.filter((id) => left.has(id));
    if (free.length < 2) continue;
    groups.push({ title: w.replace(/^./, (c) => c.toUpperCase()), tabIds: free });
    free.forEach((id) => left.delete(id));
  }
  return groups;
}
