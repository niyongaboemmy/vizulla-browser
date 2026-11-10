#!/usr/bin/env node
// vz: the one entry point for building, running, and testing Vizulla (handbook §3).
// Everyone runs the same steps; CI calls the same commands.
import { build, context } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir, totalmem, freemem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleShields } from './shields_bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');
const VZ = join(ROOT, 'vizulla');
const WEBUI = join(VZ, 'resources', 'webui');

process.env.electron_config_cache ??= join(ROOT, '.cache', 'electron');

const alias = { '@vz': VZ };

/** Bundles for the privileged side: the browser process, preloads, utility processes. */
function nodeTargets(dev) {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: dev ? 'inline' : 'linked',
    minify: !dev,
    alias,
    external: ['electron', 'pdfjs-dist', 'pdfjs-dist/*'],
    define: { 'process.env.VZ_DEV': JSON.stringify(dev ? '1' : '0'), BUILD_TIME: String(Date.now()) },
    logLevel: 'warning',
  };
  const preloads = readdirSync(join(VZ, 'preload')).filter((f) => f.endsWith('_preload.ts'));
  return [
    // Extension libraries resolve their preload scripts from node_modules at run time.
    { ...common, external: [...common.external, 'electron-chrome-extensions', 'electron-chrome-web-store'], entryPoints: { main: join(VZ, 'app', 'main.ts') }, outdir: join(OUT, 'main') },
    {
      ...common,
      entryPoints: Object.fromEntries(preloads.map((f) => [f.replace('.ts', ''), join(VZ, 'preload', f)])),
      outdir: join(OUT, 'preload'),
    },
    {
      ...common,
      // Sandboxed utility processes (R2+): one bundle per components/<name>/<name>_main.ts.
      entryPoints: Object.fromEntries(
        readdirSync(join(VZ, 'components'))
          .filter((d) => existsSync(join(VZ, 'components', d, `${d}_main.ts`)))
          .map((d) => [d, join(VZ, 'components', d, `${d}_main.ts`)]),
      ),
      outdir: join(OUT, 'utility'),
    },
  ].filter((t) => Object.keys(t.entryPoints).length);
}

/** WebUI bundles: one per page directory under resources/webui (shared/ is a library). */
function webuiTarget(dev) {
  const pages = readdirSync(WEBUI).filter(
    (d) => d !== 'shared' && statSync(join(WEBUI, d)).isDirectory() && existsSync(join(WEBUI, d, 'index.ts')),
  );
  return {
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome130',
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    alias,
    entryPoints: Object.fromEntries(pages.map((p) => [`${p}/index`, join(WEBUI, p, 'index.ts')])),
    outdir: join(OUT, 'webui'),
    loader: { '.css': 'text', '.svg': 'text' },
    logLevel: 'warning',
    _pages: pages,
  };
}

function copyStatic(pages) {
  for (const p of pages) {
    mkdirSync(join(OUT, 'webui', p), { recursive: true });
    for (const f of readdirSync(join(WEBUI, p))) {
      if (f.endsWith('.html')) cpSync(join(WEBUI, p, f), join(OUT, 'webui', p, f));
    }
  }
  cpSync(join(VZ, 'app', 'resources'), join(OUT, 'resources'), { recursive: true });
}

async function cmdBuild({ dev = true, watch = false } = {}) {
  const t0 = Date.now();
  rmSync(OUT, { recursive: true, force: true });
  const { _pages, ...web } = webuiTarget(dev);
  const targets = [...nodeTargets(dev), web];
  copyStatic(_pages);
  if (watch) {
    for (const t of targets) await (await context(t)).watch();
    console.log('[vz] watching…');
    return;
  }
  await Promise.all([...targets.map((t) => build(t)), bundleShields({ root: ROOT, out: OUT, fresh: !dev })]);
  console.log(`[vz] built ${_pages.length} WebUI pages + browser/preload/utility bundles in ${Date.now() - t0} ms`);
}

function electronBin() {
  // The electron package exports the binary path when required from Node.
  const out = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("electron"))'], { cwd: ROOT });
  return out.stdout.toString();
}

async function cmdRun(args) {
  await cmdBuild({ dev: true });
  const extra = [];
  const pi = args.indexOf('--profile');
  if (pi >= 0 && args[pi + 1] === 'tmp') extra.push(`--user-data-dir=${mkdtempSync(join(tmpdir(), 'vizulla-'))}`);
  const child = spawn(electronBin(), [ROOT, ...extra], { stdio: 'inherit', env: { ...process.env, VZ_CHANNEL: 'dev' } });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT, ...opts });
  return r.status ?? 1;
}

async function cmdTest([suite = 'unit', ...rest]) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  switch (suite) {
    case 'unit':
      return run(npx, ['vitest', 'run', ...rest]);
    case 'e2e':
      await cmdBuild({ dev: true });
      return run(npx, ['playwright', 'test', ...rest]);
    case 'cloud':
      return run('go', ['test', './...', ...rest], { cwd: join(ROOT, 'cloud') });
    case 'all': {
      const codes = [await cmdTest(['unit']), await cmdTest(['cloud']), await cmdTest(['e2e'])];
      return codes.some((c) => c !== 0) ? 1 : 0;
    }
    default:
      console.error(`[vz] unknown suite ${suite} (unit | e2e | cloud | all)`);
      return 2;
  }
}

/** Static checks that CI runs on every PR (handbook §11.1, §7, §3.2). */
async function cmdLint() {
  let failed = 0;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  failed |= run(npx, ['tsc', '-p', 'tsconfig.json', '--noEmit']);

  // Strings: every locale has every key of en.json (no hard-coded UI text, DoD §3.2).
  const sdir = join(VZ, 'strings');
  const en = JSON.parse(readFileSync(join(sdir, 'en.json'), 'utf8'));
  for (const f of readdirSync(sdir).filter((x) => x.endsWith('.json') && x !== 'en.json')) {
    const loc = JSON.parse(readFileSync(join(sdir, f), 'utf8'));
    const missing = Object.keys(en).filter((k) => !(k in loc));
    if (missing.length) {
      console.warn(`[vz] ${f}: ${missing.length} untranslated strings (falls back to en)`);
      if (f === 'fr.json') failed = 1; // FR is an R1 launch language: 100% coverage required (SET-05).
    }
  }

  // Feature flags: each flag has an owner and a removal date (handbook §7).
  const flags = readFileSync(join(VZ, 'browser', 'vizulla_features.ts'), 'utf8');
  const decl = [...flags.matchAll(/feature\(\{([^}]*)\}\)/g)];
  for (const [, body] of decl) {
    if (!/owner:/.test(body) || !/removeBy:/.test(body)) {
      console.error(`[vz] feature flag without owner/removeBy: ${body.trim().slice(0, 60)}`);
      failed = 1;
    }
  }
  console.log(failed ? '[vz] lint FAILED' : '[vz] lint ok');
  return failed;
}

function cmdDoctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(['node >= 22', nodeMajor >= 22, process.versions.node]);
  checks.push(['electron binary', existsSync(electronBin()), electronBin()]);
  const go = spawnSync('go', ['version']);
  checks.push(['go (cloud services, DD-12)', go.status === 0, go.stdout?.toString().trim() ?? 'missing']);
  checks.push(['RAM >= 8 GB', totalmem() >= 8 * 2 ** 30, `${(totalmem() / 2 ** 30).toFixed(0)} GB (${(freemem() / 2 ** 30).toFixed(1)} free)`]);
  for (const [name, ok, detail] of checks) console.log(`${ok ? '✓' : '✗'} ${name.padEnd(28)} ${detail}`);
  return checks.every((c) => c[1]) ? 0 : 1;
}

const [cmd = 'help', ...args] = process.argv.slice(2);
const commands = {
  build: () => cmdBuild({ dev: !args.includes('--release'), watch: args.includes('--watch') }),
  run: () => cmdRun(args),
  test: () => cmdTest(args),
  lint: cmdLint,
  doctor: cmdDoctor,
  help: () =>
    console.log(`vz <command>
  build [--release] [--watch]   bundle browser, preloads, utilities, WebUI into out/
  run [--profile tmp]           build and launch (tmp = throwaway profile)
  test <unit|e2e|cloud|all>     run a test suite (extra args go to the runner)
  lint                          typecheck, string coverage, feature-flag hygiene
  doctor                        check the toolchain`),
};
const fn = commands[cmd];
if (!fn) {
  console.error(`[vz] unknown command ${cmd}`);
  process.exit(2);
}
const code = await fn();
if (typeof code === 'number' && cmd !== 'run') process.exit(code);
