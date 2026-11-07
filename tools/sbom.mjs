// SBOM (P1-SEC-05, SEC-08): CycloneDX 1.5 JSON for the release: the Chromium
// engine (via Electron), production npm dependencies, and Go cloud modules.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const electronVersion = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version;
const electronBin = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("electron"))']).toString();
const runtime = JSON.parse(execFileSync(electronBin, ['-p', 'JSON.stringify(process.versions)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).toString());

const components = [
  { type: 'framework', name: 'chromium', version: runtime.chrome, purl: `pkg:generic/chromium@${runtime.chrome}`, description: 'Blink + V8 engine (via Electron)' },
  { type: 'framework', name: 'v8', version: runtime.v8, purl: `pkg:generic/v8@${runtime.v8}` },
  { type: 'framework', name: 'electron', version: electronVersion, purl: `pkg:npm/electron@${electronVersion}` },
];
for (const [path, info] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/') || info.dev) continue;
  const name = path.replace(/^.*node_modules\//, '');
  components.push({ type: 'library', name, version: info.version, purl: `pkg:npm/${name.replace('@', '%40')}@${info.version}`, licenses: info.license ? [{ license: { id: info.license } }] : undefined });
}
try {
  const mods = execFileSync('go', ['list', '-m', '-json', 'all'], { cwd: 'cloud' }).toString();
  for (const m of mods.split(/\n}\n?/).filter(Boolean).map((x) => JSON.parse(x.endsWith('}') ? x : `${x}}`))) {
    components.push({ type: m.Main ? 'application' : 'library', name: m.Path, version: m.Version ?? pkg.version, purl: `pkg:golang/${m.Path}@${m.Version ?? pkg.version}` });
  }
} catch {
  /* go not installed: client-only SBOM */
}
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
  metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'vizulla', version: pkg.version } },
  components,
};
mkdirSync('out/release', { recursive: true });
writeFileSync('out/release/sbom.cdx.json', JSON.stringify(sbom, null, 1));
console.log(`[vz] SBOM: ${components.length} components → out/release/sbom.cdx.json`);
