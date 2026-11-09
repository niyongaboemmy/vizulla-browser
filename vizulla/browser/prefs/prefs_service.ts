import { EventEmitter } from 'node:events';
import { readJson, writeJsonAtomic } from '../storage/json_store';
import { DEFAULT_PREFS, type PrefKey, type Prefs } from './prefs_schema';

/** Typed preference store, persisted atomically and debounced. */
export class PrefsService extends EventEmitter {
  private values: Prefs;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly path: string | null) {
    super();
    const stored = path ? readJson<Partial<Prefs>>(path, {}) : {};
    this.values = { ...DEFAULT_PREFS };
    for (const k of Object.keys(stored) as PrefKey[]) {
      if (k in DEFAULT_PREFS) (this.values as unknown as Record<string, unknown>)[k] = stored[k];
    }
    // A new profile starts at the current version; files from before versioning are 0.
    const from = typeof stored['prefs.version'] === 'number' ? stored['prefs.version'] : Object.keys(stored).length ? 0 : DEFAULT_PREFS['prefs.version'];
    if (from < DEFAULT_PREFS['prefs.version']) {
      migrate(this.values, from);
      this.values['prefs.version'] = DEFAULT_PREFS['prefs.version'];
      this.scheduleWrite();
    }
  }

  get<K extends PrefKey>(key: K): Prefs[K] {
    return this.values[key];
  }

  set<K extends PrefKey>(key: K, value: Prefs[K]): void {
    if (JSON.stringify(this.values[key]) === JSON.stringify(value)) return;
    this.values[key] = value;
    this.scheduleWrite();
    this.emit('change', key, value);
    this.emit(`change:${key}`, value);
  }

  observe<K extends PrefKey>(key: K, fn: (value: Prefs[K]) => void): () => void {
    this.on(`change:${key}`, fn);
    return () => this.off(`change:${key}`, fn);
  }

  all(): Prefs {
    return { ...this.values };
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.path) writeJsonAtomic(this.path, this.values);
  }

  private scheduleWrite(): void {
    if (!this.path || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
    this.timer.unref?.();
  }
}

/** One step per version; each runs once, in order, on prefs saved by an older build. */
export function migrate(values: Prefs, from: number): void {
  // v1 (0.3.3): tabs go back on top, like Chrome. Side tabs hid the tab list (and "+")
  // once the sidebar was collapsed; they stay one click away in Settings.
  if (from < 1) {
    values['tabs.layout'] = 'horizontal';
    values['tabs.sidebarCollapsed'] = false;
  }
}
