// 0.4.11: a film keeps playing for hours. A tab with media (playing, muted, in picture-in-picture,
// or paused within the last hour) is never put to sleep or archived; a Mac no longer counts as
// "short of memory" because of its file cache (which made background tabs sleep after 5 minutes);
// "Sleep tab" still works when asked. Video playback holds the system's display wake lock.
import { expect, test } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

async function filmInBackground() {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, u) => vz.focused().loadUrl(null, u, { newTab: true }), `${h.base}/film`);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Film');
  await inMain(h, (vz) => vz.focused().activeTab().wc.executeJavaScript("document.getElementById('v').play()", true));
  const id = await inMain(h, (vz) => vz.focused().activeTab().id);
  await waitFor(() => inMain(h, (vz, id) => vz.focused().tabs.get(id).mediaPlaying, id), (p) => p === true);
  // Another tab in front: the film's tab is now in the background.
  await inMain(h, (vz, u) => vz.focused().loadUrl(null, u, { newTab: true }), `${h.base}/article`);
  return id as number;
}

test('a muted film in a background tab is never put to sleep or archived; Sleep tab still works', async () => {
  const id = await filmInBackground();
  const tryDiscard = (byUser = false) => inMain(h, (vz, a) => vz.focused().discardTab(a.id, a.byUser), { id, byUser });
  expect(await tryDiscard()).toBe(false);
  // Long idle: Memory Saver and auto-archive both pass it by.
  await inMain(h, (vz, id) => { const w = vz.focused(); w.model.get(id).lastActive = Date.now() - 48 * 3600_000; vz.profile.prefs.set('tabs.archiveEnabled', true); return w.autoArchive(); }, id);
  expect(await inMain(h, (vz, id) => vz.focused().tabs.has(id), id)).toBe(true);
  // Paused: it keeps its page (and place) for an hour.
  await inMain(h, (vz, id) => vz.focused().tabs.get(id).wc.executeJavaScript("document.getElementById('v').pause()"), id);
  await waitFor(() => inMain(h, (vz, id) => vz.focused().tabs.get(id).mediaPlaying, id), (p) => p === false);
  expect(await tryDiscard()).toBe(false);
  // An hour after it last played, it may sleep like any other tab.
  await inMain(h, (vz, id) => (vz.focused().tabs.get(id).mediaAt = Date.now() - 61 * 60_000), id);
  expect(await tryDiscard()).toBe(true);
});

test('"Sleep tab" from the menu puts a tab with media to sleep when asked', async () => {
  const id = await filmInBackground();
  expect(await inMain(h, (vz, id) => vz.focused().discardTab(id, true), id)).toBe(true);
  expect(await inMain(h, (vz, id) => vz.focused().tabs.get(id).discarded, id)).toBe(true);
});
