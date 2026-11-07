// Filter-list pipeline (P1-CLD-03): compile lists into a serialized engine, sign it
// with ed25519, and write the CDN artifacts (engine.bin + engine.json).
//   node tools/lists.mjs [list files or URLs…]   (defaults to the bundled baseline)
// The dev signing key lives in .cache/keys (never committed); its public key is
// written to vizulla/app/resources/shields/keys/dev.pem so dev builds trust it.
// Production signing happens only in the Release pipeline with an HSM-held key.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const keyDir = '.cache/keys';
mkdirSync(keyDir, { recursive: true });
const privPath = join(keyDir, 'shields_dev.pem');
// The Release pipeline supplies the signing key (an HSM/secret store in production).
if (process.env.VZ_SHIELDS_SIGNING_KEY && !existsSync(privPath)) writeFileSync(privPath, process.env.VZ_SHIELDS_SIGNING_KEY, { mode: 0o600 });
if (!existsSync(privPath)) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  mkdirSync('vizulla/app/resources/shields/keys', { recursive: true });
  writeFileSync('vizulla/app/resources/shields/keys/dev.pem', publicKey.export({ type: 'spki', format: 'pem' }));
}
// Bundle the engine + signer so this script uses exactly the client's code.
await build({ entryPoints: { lib: 'tools/lists_lib.ts' }, bundle: true, platform: 'node', format: 'esm', outdir: '.cache/lists', outExtension: { '.js': '.mjs' }, alias: { '@vz': './vizulla' }, logLevel: 'error' });
const { compile } = await import(pathToFileURL(join(process.cwd(), '.cache/lists/lib.mjs')).href);
const sources = process.argv.slice(2).length ? process.argv.slice(2) : ['vizulla/app/resources/shields/baseline.txt'];
const texts = [];
for (const s of sources) texts.push(/^https?:/.test(s) ? await (await fetch(s)).text() : readFileSync(s, 'utf8'));
const version = Math.floor(Date.now() / 1000);
const { blob, manifest } = compile(texts, version, readFileSync(privPath, 'utf8'));
mkdirSync('out/lists', { recursive: true });
writeFileSync('out/lists/engine.bin', blob);
writeFileSync('out/lists/engine.json', JSON.stringify(manifest, null, 1));
console.log(`[vz] lists v${version}: ${blob.byteLength} bytes signed → out/lists (serve with VZ_SHIELDS_LIST_URL)`);
