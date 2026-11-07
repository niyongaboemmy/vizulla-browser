// R2 AI features wired into the browser (Track E): NL commands and Ask Settings
// in the Command Bar, on-device intent chips, AI tab grouping, and confirmation
// for anything destructive. Everything here runs on device.
import type { BrowserApp } from '../browser_app';
import type { RuntimeService } from './runtime/runtime_service';
import { mapNlCommand, proposeGroups } from '../command_bar/nl_commands';
import { findCommand } from '../command_bar/commands';
import { WRITABLE_PREFS, type PrefKey } from '../prefs/prefs_schema';
import { tokenize } from '@vz/components/ai_runtime/extractive';
import { t } from '@vz/common/i18n';
import { kVizullaNlCommands } from '../vizulla_features';
import type { SpaceColor } from '@vz/common/types';

const INTENT_ROUTES: Record<string, string> = { ask: 'ask', recall: 'recall', command: 'command', agent: 'agent', search: 'search' };

export function installAiFeatures(app: BrowserApp, runtime: RuntimeService): void {
  const p = app.profile;
  const intents = new Map<string, { label: string; route: string; confidence: number }[]>();
  const nlOn = () => p.features.isEnabled(kVizullaNlCommands) && p.prefs.get('ai.mode') !== 'off';

  app.hooks.prefetchSuggest.push(async (_w, q) => {
    if (!nlOn() || q.trim().length < 4 || /^[>?]/.test(q.trim())) return;
    const r = await runtime.classify(q).catch(() => []);
    intents.set(q, r.slice(0, 3).map((x) => ({ label: t(`intent_${x.label}` as never), route: INTENT_ROUTES[x.label] ?? 'search', confidence: x.confidence })));
    if (intents.size > 50) intents.delete(intents.keys().next().value!);
  });
  app.hooks.suggestSources.push((profile) => ({
    nlCommand: (q: string) => {
      if (!nlOn()) return null;
      const r = mapNlCommand(q, { spaces: profile.spaces.list().map((s) => s.name), commandTitle: (id) => t(findCommand(id)!.title), prefs: { defaultZoom: profile.prefs.get('appearance.defaultZoom') } });
      return r ? { commandId: r.commandId, title: r.label, args: r.args } : null;
    },
    // Chips only when the classifier is unsure and it isn't plain search.
    intents: (q: string) => (intents.get(q) ?? []).filter((x, i, all) => all[0]!.confidence < 0.7 && x.route !== 'search'),
  }));

  // Ask Settings: always confirmed, with undo (SET-01).
  app.commandHandlers.set('settings.set', async (w, args) => {
    const key = String(args?.key ?? '') as PrefKey;
    let value: unknown;
    try {
      value = JSON.parse(String(args?.value ?? 'null'));
    } catch {
      return;
    }
    if (!WRITABLE_PREFS[key]?.(value)) return;
    const before = p.prefs.get(key);
    const ok = await w.overlay.dialog<boolean | null>({ type: 'confirm', title: t('ask_settings_title'), body: t('ask_settings_body', { key, from: JSON.stringify(before), to: JSON.stringify(value) }), confirm: t('action_apply') });
    if (!ok) return;
    p.prefs.set(key, value as never);
    w.toast(t('ask_settings_done'), { label: t('action_undo'), run: () => p.prefs.set(key, before as never) });
  });

  // AI tab grouping, with undo (TAB-05).
  app.commandHandlers.set('tab.groupAi', (w) => {
    const tabs = w.model
      .visible()
      .filter((m) => !m.pinned && !m.groupId)
      .map((m) => ({ id: m.id, title: w.tabs.get(m.id)!.title, url: w.tabs.get(m.id)!.url }))
      .filter((x) => /^https?:/.test(x.url));
    const proposals = proposeGroups(tabs, tokenize);
    if (!proposals.length) return w.toast(t('group_ai_none'), undefined, 2500);
    const colors: SpaceColor[] = ['teal', 'amber', 'violet', 'sky', 'rose', 'emerald'];
    const created = proposals.map((g, i) => w.model.createGroup(g.tabIds, g.title, colors[i % colors.length]!, true)).filter((x): x is string => !!x);
    w.toast(t('group_ai_done', { count: created.length }), { label: t('action_undo'), run: () => created.forEach((id) => w.model.ungroup(id)) });
  });
}

/** Commands picked through natural language that change data are confirmed first (P4-BRW-06). */
export async function confirmNl(app: BrowserApp, w: import('../ui/browser_window').BrowserWindowController, id: string): Promise<boolean> {
  const def = findCommand(id);
  if (!def?.destructive || id === 'settings.set') return true;
  const ok = await w.overlay.dialog<boolean | null>({ type: 'confirm', title: t('nl_confirm_title', { command: t(def.title) }), body: t('nl_confirm_body'), confirm: t(def.title), danger: true });
  void app;
  return !!ok;
}
