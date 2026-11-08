import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_ID, ProfileRegistry } from './profile_registry';

const root = () => mkdtempSync(join(tmpdir(), 'vz-profiles-'));

describe('ProfileRegistry', () => {
  it('always has the default profile, which lives in the root folder', () => {
    const dir = root();
    const r = new ProfileRegistry(dir);
    expect(r.list()).toEqual([expect.objectContaining({ id: DEFAULT_PROFILE_ID, name: 'Personal', color: 'blue' })]);
    expect(r.dirOf(DEFAULT_PROFILE_ID)).toBe(dir);
    expect(r.remove(DEFAULT_PROFILE_ID)).toBe(false);
  });

  it('creates, renames, recolors and deletes profiles with their own data folders', () => {
    const dir = root();
    const r = new ProfileRegistry(dir);
    const work = r.create({ name: '  Work   stuff ', color: 'violet' });
    expect(work.name).toBe('Work stuff');
    expect(r.dirOf(work.id)).toBe(join(dir, 'Profiles', work.id));
    expect(existsSync(r.dirOf(work.id))).toBe(true);
    // A second registry (another running profile) sees the same list.
    expect(new ProfileRegistry(dir).list().map((p) => p.name)).toEqual(['Personal', 'Work stuff']);
    r.update(work.id, { name: 'Office', color: 'rose' });
    r.update(work.id, { color: 'not-a-color' as never });
    expect(r.get(work.id)).toMatchObject({ name: 'Office', color: 'rose' });
    expect(() => r.create({ name: '   ' })).toThrow();
    expect(r.remove(work.id)).toBe(true);
    expect(existsSync(join(dir, 'Profiles', work.id))).toBe(false);
    expect(r.list()).toHaveLength(1);
  });

  it('rejects ids that could escape the profiles folder and survives a corrupt file', () => {
    const dir = root();
    const r = new ProfileRegistry(dir);
    expect(() => r.dirOf('../../etc')).toThrow();
    r.create({ name: 'A' });
    writeFileSync(join(dir, 'Profiles', 'profiles.json'), '{ not json');
    expect(r.list().map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });
});
