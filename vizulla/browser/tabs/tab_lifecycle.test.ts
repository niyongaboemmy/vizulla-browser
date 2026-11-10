import { describe, expect, it } from 'vitest';
import { holdsMedia, MEDIA_GRACE_MS, memoryLow } from './tab_lifecycle';

describe('tab lifecycle', () => {
  it('keeps a tab with media: playing, muted or paused for a while', () => {
    const now = 10 * MEDIA_GRACE_MS;
    expect(holdsMedia({ audible: true, mediaPlaying: false, mediaAt: 0 }, now)).toBe(true);
    expect(holdsMedia({ audible: false, mediaPlaying: true, mediaAt: 0 }, now)).toBe(true); // muted or picture-in-picture
    expect(holdsMedia({ audible: false, mediaPlaying: false, mediaAt: now - 20 * 60_000 }, now)).toBe(true); // paused 20 min ago
    expect(holdsMedia({ audible: false, mediaPlaying: false, mediaAt: now - MEDIA_GRACE_MS - 1 }, now)).toBe(false);
    expect(holdsMedia({ audible: false, mediaPlaying: false, mediaAt: 0 }, now)).toBe(false);
  });

  it('counts macOS file cache as available memory', () => {
    // A 16 GB Mac as it reports itself: 96 MB "free", 3 GB of file cache.
    expect(memoryLow({ total: 16777216, free: 96768, fileBacked: 3152912, purgeable: 103712 })).toBe(false);
    expect(memoryLow({ total: 16777216, free: 96768, fileBacked: 200000, purgeable: 0 })).toBe(true);
    // Windows and Linux report what is really free.
    expect(memoryLow({ total: 8_000_000, free: 2_000_000 })).toBe(false);
    expect(memoryLow({ total: 8_000_000, free: 100_000 })).toBe(true);
    expect(memoryLow({ total: 0, free: 0 })).toBe(false);
  });
});
