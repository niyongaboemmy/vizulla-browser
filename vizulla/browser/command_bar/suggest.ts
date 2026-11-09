// Command Bar suggestions (P2-BRW-14): open tabs (switch-to-tab), pins, history,
// bookmarks, commands, archive, search, ask, and Memory (R2). The deterministic
// classifier picks the default action; providers only add rows (CMD-02/07).
import { classifyInput, displayUrl, engineName, searchUrl, type SearchEngineId } from '@vz/common/url';
import type { CommandBarResult, Suggestion } from '@vz/common/types';
import { fuzzyScore, matchCommands, type CommandDef } from './commands';

export interface TabCandidate {
  id: number;
  title: string;
  url: string;
  favicon: string | null;
  spaceName: string;
  pinned: boolean;
  active: boolean;
}

export interface SuggestSources {
  tabs(): TabCandidate[];
  history(q: string, limit: number): { url: string; title: string; favicon: string | null }[];
  bookmarks(q: string, limit: number): { url: string; title: string }[];
  archive(q: string, limit: number): { id: number; url: string; title: string; favicon: string | null }[];
  inlineCompletion(q: string): string | null;
  commandTitle(c: CommandDef): string;
  commandEnabled(c: CommandDef): boolean;
  shortcutLabel(accel: string | undefined): string | undefined;
  searchEngine: SearchEngineId;
  aiEnabled: boolean;
  /** R2: Memory recall (MEM-03). */
  memory?(q: string, limit: number): { id: number; url: string; title: string; snippet: string; when: string }[];
  /** R2: on-device intent chips; only shown below 0.7 confidence (P4-AI-12). */
  intents?(q: string): { label: string; route: string; confidence: number }[];
  /** R2: natural-language command mapping (only commands from the registry). */
  nlCommand?(q: string): { commandId: string; title: string; args?: Record<string, string> } | null;
  /** Vizulla's own settings, pages and tools (destinations.ts), titles resolved. */
  destinations?(q: string, limit: number, group?: 'settings' | 'pages' | 'tools'): { id: string; title: string; detail: string; icon: string; target: string }[];
  strings: { goTo: string; searchFor: string; ask: string; switchToTab: string; restoreArchived: string; scopes?: Record<Scope, string> };
}

/** "@tabs dentist" searches only open tabs, as in Chrome's omnibox. */
export const SCOPES = ['tabs', 'history', 'bookmarks', 'settings', 'tools'] as const;
export type Scope = (typeof SCOPES)[number];
const SCOPE_ICONS: Record<Scope, string> = { tabs: 'layers', history: 'history', bookmarks: 'star', settings: 'settings', tools: 'zap' };

export type SuggestMode = 'palette' | 'address' | 'tab-search' | 'ask';

export function suggest(input: string, mode: SuggestMode, src: SuggestSources): CommandBarResult {
  const t0 = performance.now();
  const route = classifyInput(input);
  const q = input.trim();
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion) => {
    const key = s.kind === 'command' || s.kind === 'ask' || s.kind === 'search' || s.kind === 'nl-command' || s.kind === 'destination' || s.kind === 'scope' ? s.id : `${s.kind === 'tab' ? 'tab' : 'url'}:${s.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  if (mode === 'tab-search') {
    for (const t of rankTabs(src.tabs(), q).slice(0, 12)) push(tabRow(t, src));
    for (const a of src.archive(q, 8)) {
      push({ id: `archive:${a.id}`, kind: 'archive', title: a.title || displayUrl(a.url), detail: `${src.strings.restoreArchived} · ${displayUrl(a.url)}`, favicon: a.favicon, section: 'history' });
    }
    return { input, route: route.route === 'empty' ? 'empty' : route.route, chips: [], suggestions: out, elapsedMs: performance.now() - t0 };
  }

  // @scopes: "@" lists them; "@tabs foo" searches only that kind of result.
  const scoped = /^@(\w*)(?:\s+(.*))?$/.exec(q);
  if (scoped) {
    const name = scoped[1]!.toLowerCase();
    const rest = scoped[2]?.trim() ?? '';
    const scope = SCOPES.find((x) => x === name);
    if (!scope || scoped[2] === undefined) {
      for (const sc of SCOPES.filter((x) => x.startsWith(name))) {
        push({ id: `scope:@${sc} `, kind: 'scope', title: `@${sc}`, detail: src.strings.scopes?.[sc] ?? sc, icon: SCOPE_ICONS[sc], section: 'top' });
      }
      if (out.length) return { input, route: 'empty', chips: [], suggestions: out, elapsedMs: performance.now() - t0 };
    } else {
      if (scope === 'tabs') for (const t of rankTabs(src.tabs(), rest).slice(0, 12)) push(tabRow(t, src));
      if (scope === 'history') for (const h of src.history(rest, 12)) push({ id: `nav:${h.url}`, kind: 'history', title: h.title || displayUrl(h.url), detail: displayUrl(h.url), favicon: h.favicon, section: 'history' });
      if (scope === 'bookmarks') for (const b of src.bookmarks(rest, 12)) push({ id: `nav:${b.url}`, kind: 'bookmark', title: b.title || displayUrl(b.url), detail: displayUrl(b.url), icon: 'star', section: 'history' });
      if (scope === 'settings' || scope === 'tools') {
        for (const d of src.destinations?.(rest, 12, scope === 'settings' ? 'settings' : 'tools') ?? []) push(destRow(d));
        if (scope === 'tools') for (const c of matchCommands(rest, src.commandTitle, src.commandEnabled, 8)) push(cmdRow(c, src));
      }
      return { input, route: 'empty', chips: [], suggestions: out.slice(0, 14), elapsedMs: performance.now() - t0 };
    }
  }

  if (route.route === 'empty') {
    // Empty Command Bar: recent tabs, then quick commands.
    for (const t of src.tabs().filter((t) => !t.active).slice(0, 5)) push(tabRow(t, src));
    for (const c of matchCommands('', src.commandTitle, src.commandEnabled, 4)) push(cmdRow(c, src));
    return { input, route: 'empty', chips: [], suggestions: out, elapsedMs: performance.now() - t0 };
  }

  if (route.route === 'command') {
    for (const c of matchCommands(route.text, src.commandTitle, src.commandEnabled, 12)) push(cmdRow(c, src));
    return { input, route: 'command', chips: [], suggestions: out, elapsedMs: performance.now() - t0 };
  }

  if (route.route === 'ask' || mode === 'ask') {
    const text = route.route === 'ask' ? route.text : q;
    if (src.aiEnabled) push({ id: `ask:${text}`, kind: 'ask', title: text || src.strings.ask, detail: src.strings.ask, icon: 'sparkle', section: 'ai' });
    return { input, route: 'ask', chips: [], suggestions: out, elapsedMs: performance.now() - t0 };
  }

  // Default action first: the classifier decides navigate vs search. Never a model.
  if (route.route === 'navigate') {
    push({ id: `nav:${route.url}`, kind: 'url', title: displayUrl(route.url) || route.url, detail: src.strings.goTo, icon: 'globe', section: 'top' });
  } else {
    const inline = src.inlineCompletion(q);
    if (inline) push({ id: `nav:https://${inline}/`, kind: 'url', title: inline, detail: src.strings.goTo, icon: 'globe', section: 'top' });
  }

  for (const t of rankTabs(src.tabs(), q).slice(0, 3)) push(tabRow(t, src));

  // Vizulla's own settings, pages and tools ("dark mode", "block ads", "passwords").
  if (q.length >= 2 && route.route !== 'navigate') for (const d of src.destinations?.(q, 3) ?? []) push(destRow(d));

  const nl = src.nlCommand?.(q);
  if (nl) push({ id: `nl:${nl.commandId}:${JSON.stringify(nl.args ?? {})}`, kind: 'nl-command', title: nl.title, detail: '', icon: 'sparkle', section: 'commands' });

  if (q.length >= 2) for (const c of matchCommands(q, src.commandTitle, src.commandEnabled, 3).filter((c) => fuzzyScore(q, src.commandTitle(c)) >= 60 || fuzzyScore(q, c.keywords ?? '') >= 60)) push(cmdRow(c, src));

  const mem = src.memory?.(q, 4) ?? [];
  for (const m of mem) push({ id: `memory:${m.id}`, kind: 'memory', title: m.title || displayUrl(m.url), detail: `${m.when} · ${m.snippet}`, icon: 'brain', section: 'memory' });

  for (const b of src.bookmarks(q, 3)) push({ id: `nav:${b.url}`, kind: 'bookmark', title: b.title || displayUrl(b.url), detail: displayUrl(b.url), icon: 'star', section: 'history' });
  for (const h of src.history(q, 6)) push({ id: `nav:${h.url}`, kind: 'history', title: h.title || displayUrl(h.url), detail: displayUrl(h.url), favicon: h.favicon, section: 'history' });

  const text = route.route === 'search' ? route.text : q;
  push({ id: `search:${text}`, kind: 'search', title: text, detail: src.strings.searchFor.replace('{engine}', engineName(src.searchEngine)), icon: 'search', section: 'search' });
  if (src.aiEnabled && text.split(/\s+/).length >= 2) push({ id: `ask:${text}`, kind: 'ask', title: text, detail: src.strings.ask, icon: 'sparkle', section: 'ai' });

  const chips = (src.intents?.(q) ?? []).filter((c) => c.confidence < 0.7);
  return { input, route: route.route, chips, suggestions: out.slice(0, 14), elapsedMs: performance.now() - t0 };
}

function rankTabs(tabs: TabCandidate[], q: string): TabCandidate[] {
  if (!q) return tabs;
  return tabs
    .map((t) => ({ t, s: Math.max(fuzzyScore(q, t.title), fuzzyScore(q, displayUrl(t.url)) * 0.9) }))
    .filter((x) => x.s >= 8)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

function tabRow(t: TabCandidate, src: SuggestSources): Suggestion {
  return { id: `tab:${t.id}`, kind: 'tab', title: t.title || displayUrl(t.url), detail: `${src.strings.switchToTab} · ${t.spaceName}`, favicon: t.favicon, section: 'tabs' };
}

function destRow(d: { id: string; title: string; detail: string; icon: string; target: string }): Suggestion {
  return { id: d.target, kind: 'destination', title: d.title, detail: d.detail, icon: d.icon, section: 'browser' };
}

function cmdRow(c: CommandDef, src: SuggestSources): Suggestion {
  return { id: `cmd:${c.id}`, kind: 'command', title: src.commandTitle(c), detail: '', shortcut: src.shortcutLabel(c.accelerator), icon: 'command', section: 'commands', destructive: c.destructive };
}

/** What accepting a row (or Enter on raw text) does. */
export type AcceptAction =
  | { kind: 'navigate'; url: string; typed: boolean }
  | { kind: 'switch-tab'; tabId: number }
  | { kind: 'command'; id: string; args?: Record<string, string> }
  | { kind: 'ask'; text: string }
  | { kind: 'restore-archived'; id: number }
  | { kind: 'memory'; id: number }
  | { kind: 'none' };

export function resolveAccept(text: string, suggestionId: string | undefined, engine: SearchEngineId): AcceptAction {
  if (suggestionId) {
    const i = suggestionId.indexOf(':');
    const kind = suggestionId.slice(0, i);
    const rest = suggestionId.slice(i + 1);
    switch (kind) {
      case 'nav':
        return { kind: 'navigate', url: rest, typed: true };
      case 'tab':
        return { kind: 'switch-tab', tabId: Number(rest) };
      case 'cmd':
        return { kind: 'command', id: rest };
      case 'nl': {
        const j = rest.indexOf(':');
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(rest.slice(j + 1)) as Record<string, string>;
        } catch {
          /* no args */
        }
        return { kind: 'command', id: rest.slice(0, j), args };
      }
      case 'search':
        return { kind: 'navigate', url: searchUrl(engine, rest), typed: false };
      case 'ask':
        return { kind: 'ask', text: rest };
      case 'archive':
        return { kind: 'restore-archived', id: Number(rest) };
      case 'memory':
        return { kind: 'memory', id: Number(rest) };
    }
  }
  const r = classifyInput(text);
  switch (r.route) {
    case 'navigate':
      return { kind: 'navigate', url: r.url, typed: true };
    case 'search':
      return { kind: 'navigate', url: searchUrl(engine, r.text), typed: false };
    case 'ask':
      return { kind: 'ask', text: r.text };
    case 'command':
      return { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
