// Vizulla browser process entry point.
import { app, BrowserWindow, crashReporter, session } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDING } from './branding';
import { registerVizullaScheme } from '@vz/browser/ui/webui_protocol';
import { Profile } from '@vz/browser/profile';
import { BrowserApp } from '@vz/browser/browser_app';
import { installPhaseServices } from '@vz/browser/services';
import { runSelfTest } from './self_test';

const OUT = join(__dirname, '..');

// ---- Before ready: identity, scheme registration, switches.
app.setName(BRANDING.productName);
if (!process.argv.some((a) => a.startsWith('--user-data-dir='))) {
  app.setPath('userData', join(app.getPath('appData'), BRANDING.userDataDirName));
}
registerVizullaScheme();
// No Google API keys, no background networking to Google services (SRS C4).
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-features', 'InterestFeedContentSuggestions,MediaRouter,OptimizationHints,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater');
app.commandLine.appendSwitch('enable-features', 'PartitionedCookies,ThirdPartyStoragePartitioning');
// Third-party cookies (SHD-04) are blocked by Chromium itself: no per-request hook in
// the browser process (that cost ~25% on request-heavy pages). Read before the profile
// loads, so a change in Settings applies after a restart.
if (startupPref('shields.blockThirdPartyCookies') !== false) app.commandLine.appendSwitch('test-third-party-cookie-phaseout');

function startupPref(key: string): unknown {
  try {
    return (JSON.parse(readFileSync(join(app.getPath('userData'), 'Preferences.json'), 'utf8')) as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

// Never block on a modal error dialog in the browser process: log and keep going.
process.on('uncaughtException', (e) => console.error('[vz] uncaught exception', e));
process.on('unhandledRejection', (e) => console.error('[vz] unhandled rejection', e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let browser: BrowserApp | null = null;
  const pendingUrls: string[] = process.argv.slice(1).filter((a) => /^https?:\/\//.test(a));

  app.on('second-instance', (_e, argv) => {
    const urls = argv.filter((a) => /^https?:\/\//.test(a));
    const w = browser?.focused() ?? browser?.openWindow();
    if (!w) return;
    for (const u of urls) w.loadUrl(null, u, { newTab: true });
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    const w = browser?.focused();
    if (w) w.loadUrl(null, url, { newTab: true });
    else pendingUrls.push(url);
  });

  app.whenReady().then(() => {
    const t0 = performance.now();
    const profile = Profile.createRegular({
      dir: app.getPath('userData'),
      outDir: OUT,
      argv: process.argv,
      shieldsListUrl: BRANDING.shieldsListUrl,
    });
    if (profile.prefs.get('privacy.crashReports')) {
      crashReporter.start({ submitURL: process.env.VZ_CRASH_URL ?? 'http://localhost:8790/crash', uploadToServer: true, compress: true });
    }
    profile.shields.applyDnsConfig();
    profile.shields.startUpdates();
    browser = new BrowserApp(profile, OUT);
    const services = installPhaseServices(browser);
    (browser as unknown as { __services: unknown }).__services = services;
    if (process.argv.includes('--vz-self-test')) {
      void runSelfTest(browser, services);
      return;
    }
    browser.restoreOrOpen();
    const w = browser.focused();
    for (const u of pendingUrls.splice(0)) w?.loadUrl(null, u, { newTab: true });
    if (process.env.VZ_DEV === '1') console.log(`[vz] browser ready in ${Math.round(performance.now() - t0)} ms (process start → ready ${Math.round(performance.now())} ms)`);
    (globalThis as { __vz?: unknown }).__vz = browser;
  });

  app.on('activate', () => {
    if (browser && !browser.windows.size) browser.openWindow();
  });
  // Save while everything is alive; close stores only after every window is gone.
  app.on('before-quit', () => browser?.prepareToQuit());
  app.on('will-quit', () => browser?.shutdown());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // Never let a page open a native BrowserWindow; tabs are views (WebTab).
  app.on('browser-window-created', (_e, win: BrowserWindow) => win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })));
  // Certificate errors fail closed; the tab shows our error page (security state "dangerous").
  app.on('certificate-error', (e, _wc, _url, _err, _cert, cb) => {
    e.preventDefault();
    cb(false);
  });
  void session;
}
