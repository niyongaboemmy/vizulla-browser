// Profiles (like Chrome's): each has its own data folder, so cookies, history,
// passwords, Spaces and settings never mix. The registry is a small JSON file in
// the default profile's folder, shared by every running profile (each profile
// runs in its own browser process, with its own --user-data-dir).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PROFILE_COLORS = ['blue', 'violet', 'rose', 'amber', 'emerald', 'teal', 'sky', 'slate'] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export interface ProfileEntry {
  id: string;
  name: string;
  color: ProfileColor;
  createdAt: number;
  lastUsed: number;
}

export const DEFAULT_PROFILE_ID = 'default';
const MAX_PROFILES = 20;

export class ProfileRegistry {
  private readonly file: string;

  /** `root` is the default profile's data folder; other profiles live in root/Profiles/<id>. */
  constructor(private readonly root: string, private readonly now: () => number = Date.now) {
    this.file = join(root, 'Profiles', 'profiles.json');
  }

  dirOf(id: string): string {
    if (id === DEFAULT_PROFILE_ID) return this.root;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('bad profile id');
    return join(this.root, 'Profiles', id);
  }

  list(): ProfileEntry[] {
    let stored: ProfileEntry[] = [];
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { profiles?: unknown };
      if (Array.isArray(raw.profiles)) stored = raw.profiles.filter(isEntry);
    } catch {
      /* first run or unreadable: start fresh */
    }
    if (!stored.some((p) => p.id === DEFAULT_PROFILE_ID)) {
      stored.unshift({ id: DEFAULT_PROFILE_ID, name: 'Personal', color: 'blue', createdAt: this.now(), lastUsed: this.now() });
    }
    return stored;
  }

  get(id: string): ProfileEntry | undefined {
    return this.list().find((p) => p.id === id);
  }

  create(input: { name: string; color?: ProfileColor }): ProfileEntry {
    const list = this.list();
    if (list.length >= MAX_PROFILES) throw new Error('too many profiles');
    const entry: ProfileEntry = { id: randomUUID(), name: cleanName(input.name), color: input.color ?? PROFILE_COLORS[list.length % PROFILE_COLORS.length]!, createdAt: this.now(), lastUsed: 0 };
    mkdirSync(this.dirOf(entry.id), { recursive: true });
    this.save([...list, entry]);
    return entry;
  }

  update(id: string, patch: { name?: string; color?: ProfileColor; lastUsed?: number }): ProfileEntry | undefined {
    const list = this.list();
    const p = list.find((x) => x.id === id);
    if (!p) return undefined;
    if (patch.name !== undefined) p.name = cleanName(patch.name);
    if (patch.color && PROFILE_COLORS.includes(patch.color)) p.color = patch.color;
    if (patch.lastUsed !== undefined) p.lastUsed = patch.lastUsed;
    this.save(list);
    return p;
  }

  /** Deletes a profile and all its data. The default profile can't be removed. */
  remove(id: string): boolean {
    if (id === DEFAULT_PROFILE_ID) return false;
    const list = this.list();
    if (!list.some((p) => p.id === id)) return false;
    this.save(list.filter((p) => p.id !== id));
    const dir = this.dirOf(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return true;
  }

  private save(list: ProfileEntry[]): void {
    mkdirSync(join(this.root, 'Profiles'), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, profiles: list }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function cleanName(name: string): string {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!n) throw new Error('name required');
  return n;
}

function isEntry(x: unknown): x is ProfileEntry {
  const p = x as ProfileEntry;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && PROFILE_COLORS.includes(p.color) && typeof p.createdAt === 'number';
}
