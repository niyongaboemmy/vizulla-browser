// The Shields engine bundled with the app (out/resources/shields/engine.bin):
// EasyList + EasyPrivacy + uBlock Origin's lists, Vizulla's baseline (incl. regional
// rules), and uBO's resources (scriptlets for video/pre-roll ads, surrogates for ad SDKs).
// Without it the app falls back to the small baseline list.
//   Downloaded lists are cached under .cache/shields (release builds refresh them);
//   the engine is recompiled locally whenever the lists or the baseline change.
// Offline with no cache: dev builds go on with the baseline only; release builds fail.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_DEV_AGE_MS = 7 * 24 * 3600_000;
const MAX_RELEASE_AGE_MS = 3600_000;

async function download() {
  const { adsAndTrackingLists } = await import('@ghostery/adblocker');
  const get = async (url) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (r.ok) return await r.text();
      } catch {
        /* retry */
      }
    }
    throw new Error(`could not fetch ${url}`);
  };
  const lists = await Promise.all(adsAndTrackingLists.map(get));
  const resources = await get(adsAndTrackingLists[0].replace(/easylist\/easylist\.txt$/, 'ublock-origin/resources.json'));
  return { lists, resources, urls: adsAndTrackingLists };
}

export async function bundleShields({ root, out, fresh }) {
  const { version } = JSON.parse(readFileSync(join(root, 'node_modules/@ghostery/adblocker/package.json'), 'utf8'));
  const cacheDir = join(root, '.cache', 'shields');
  const listsFile = join(cacheDir, 'lists.json');
  mkdirSync(cacheDir, { recursive: true });
  const age = existsSync(listsFile) ? Date.now() - statSync(listsFile).mtimeMs : Infinity;
  if (age > (fresh ? MAX_RELEASE_AGE_MS : MAX_DEV_AGE_MS)) {
    try {
      writeFileSync(listsFile, JSON.stringify({ fetched: new Date().toISOString(), ...(await download()) }));
    } catch (e) {
      if (fresh) throw e; // a release must never ship without the full lists
      if (!existsSync(listsFile)) {
        console.warn(`[vz] Shields: full filter lists unavailable (${e.message}); the app will use the baseline list only`);
        return;
      }
      console.warn(`[vz] Shields: list refresh failed (${e.message}); using the cached lists`);
    }
  }
  const cached = JSON.parse(readFileSync(listsFile, 'utf8'));
  const baseline = readFileSync(join(root, 'vizulla/app/resources/shields/baseline.txt'), 'utf8');
  // The serialized format belongs to the engine version; the content to the lists + baseline.
  const key = createHash('sha256').update(version).update(cached.fetched).update(baseline).digest('hex').slice(0, 16);
  const engine = join(cacheDir, `engine-${key}.bin`);
  if (!existsSync(engine)) {
    await build({ entryPoints: { lib: join(root, 'tools/lists_lib.ts') }, bundle: true, platform: 'node', format: 'esm', outdir: join(root, '.cache/lists'), outExtension: { '.js': '.mjs' }, alias: { '@vz': join(root, 'vizulla') }, logLevel: 'error' });
    const { compileBundled } = await import(`${pathToFileURL(join(root, '.cache/lists/lib.mjs')).href}?t=${Date.now()}`);
    writeFileSync(engine, compileBundled([...cached.lists, baseline], cached.resources));
  }
  mkdirSync(join(out, 'resources', 'shields'), { recursive: true });
  copyFileSync(engine, join(out, 'resources', 'shields', 'engine.bin'));
  writeFileSync(join(out, 'resources', 'shields', 'engine.meta.json'), JSON.stringify({ fetched: cached.fetched, engine: version, lists: cached.urls.length + 1 }));
}
