// Opening profiles. The current profile opens a window in this process; any other
// profile starts (or, if it's already running, focuses) its own browser process
// with that profile's data folder, the way Chrome keeps profile data apart.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROFILE_ID, ProfileRegistry, type ProfileEntry } from './profile_registry';

export class Profiles {
  readonly registry: ProfileRegistry;

  constructor(readonly currentId: string, readonly root: string, private readonly openWindowHere: () => void) {
    this.registry = new ProfileRegistry(root);
    if (!this.registry.get(currentId)) this.currentId = DEFAULT_PROFILE_ID;
    this.registry.update(this.currentId, { lastUsed: Date.now() });
  }

  private cache: { at: number; list: ProfileEntry[] } | null = null;

  /** The registry, re-read at most every two seconds (window state reads it often). */
  list(): ProfileEntry[] {
    if (!this.cache || Date.now() - this.cache.at > 2000) this.cache = { at: Date.now(), list: this.registry.list() };
    return this.cache.list;
  }

  /** Call after changing the registry. */
  changed(): void {
    this.cache = null;
  }

  current(): ProfileEntry {
    return this.list().find((p) => p.id === this.currentId) ?? this.registry.get(this.currentId)!;
  }

  open(id: string): void {
    if (id === this.currentId) return this.openWindowHere();
    const entry = this.registry.get(id);
    if (!entry) return;
    const args = [
      ...(app.isPackaged ? [] : [app.getAppPath()]),
      `--user-data-dir=${this.registry.dirOf(id)}`,
      `--vz-profile=${id}`,
      `--vz-profiles-root=${this.root}`,
    ];
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: process.env }).unref();
  }

  /** Chromium's single-instance lock names the owning process: "<host>-<pid>". */
  isRunning(id: string): boolean {
    if (id === this.currentId) return true;
    try {
      const target = readlinkSync(join(this.registry.dirOf(id), 'SingletonLock'));
      const pid = Number(target.split('-').pop());
      if (!pid) return false;
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/** Reads --vz-profile / --vz-profiles-root from the command line. */
export function profileArgs(argv: string[], userData: string): { id: string; root: string } {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const id = get('vz-profile') ?? DEFAULT_PROFILE_ID;
  return { id, root: id === DEFAULT_PROFILE_ID ? userData : (get('vz-profiles-root') ?? userData) };
}
