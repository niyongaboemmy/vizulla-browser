// When a background tab may be put to sleep (Memory Saver) or archived. Pure (tab_lifecycle.test.ts).

/** A tab that played media keeps its page this long after it stops (a paused film, a break). */
export const MEDIA_GRACE_MS = 60 * 60_000;

/** Media playing now (even muted or in picture-in-picture), or within the grace period. */
export function holdsMedia(tab: { audible: boolean; mediaPlaying: boolean; mediaAt: number }, now: number): boolean {
  return tab.audible || tab.mediaPlaying || (tab.mediaAt > 0 && now - tab.mediaAt < MEDIA_GRACE_MS);
}

/**
 * Whether the computer is short of memory. macOS reports almost no "free" memory because it keeps
 * the rest as file cache it can drop at once, so that cache (and purgeable memory) counts as
 * available; otherwise every Mac looked short of memory and tabs slept after 5 minutes.
 * Values in KB, as process.getSystemMemoryInfo() reports them.
 */
export function memoryLow(m: { total: number; free: number; fileBacked?: number; purgeable?: number }): boolean {
  if (!(m.total > 0)) return false;
  const available = m.free + (m.fileBacked ?? 0) + (m.purgeable ?? 0);
  return available / m.total < 0.05;
}
