// Installed web apps on the computer: where each OS keeps apps, with the app's own
// name and icon, launching Vizulla with --vz-app=<id> (the running browser opens the
// app's window; see main.ts).
//   macOS    ~/Applications/Vizulla Apps/<Name>.app   (Launchpad, Spotlight, Finder)
//   Windows  Start menu › Vizulla Apps › <Name>.lnk   (+ Desktop), own taskbar identity
//   Linux    ~/.local/share/applications/vizulla-<id>.desktop  (+ Desktop)
// Phones can't run Vizulla apps: the install dialog hands the site to the phone (QR code).
// VZ_APPS_DIR puts everything under one folder (tests).
import { app, nativeImage, shell, type NativeImage } from 'electron';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { shortcutName } from './manifest';

export interface ShortcutApp {
  id: string;
  name: string;
  /** A 512×512 PNG (already composed for the platform's icon style). */
  icon: NativeImage;
}

export interface Shortcuts {
  /** Every file created, so uninstalling removes exactly these. */
  paths: string[];
  /** Where people find it ("Launchpad", "Start menu", "your apps menu"). */
  where: 'launchpad' | 'start-menu' | 'apps-menu';
}

const testRoot = () => process.env.VZ_APPS_DIR || null;

/** How the launcher starts this browser: same binary, profile and data folder as now. */
export function launchCommand(appId: string): { exec: string; args: string[] } {
  const keep = process.argv.filter((a) => /^--(user-data-dir|vz-profile|vz-profiles-root)=/.test(a));
  if (!keep.some((a) => a.startsWith('--user-data-dir='))) keep.unshift(`--user-data-dir=${app.getPath('userData')}`);
  return { exec: process.execPath, args: [...(app.isPackaged ? [] : [app.getAppPath()]), ...keep, `--vz-app=${appId}`] };
}

export function createShortcuts(a: ShortcutApp, opts: { desktop: boolean }): Shortcuts {
  if (process.platform === 'darwin') return mac(a);
  if (process.platform === 'win32') return windows(a, opts.desktop);
  return linux(a, opts.desktop);
}

export function removeShortcuts(paths: string[]): void {
  for (const p of paths) rmSync(p, { recursive: true, force: true });
}

// ---- macOS: a tiny app bundle whose launcher asks LaunchServices to start Vizulla with the app's id.

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mac(a: ShortcutApp): Shortcuts {
  const root = testRoot() ? join(testRoot()!, 'Applications') : join(app.getPath('home'), 'Applications', 'Vizulla Apps');
  const bundle = join(root, `${shortcutName(a.name)}.app`);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true });
  const { exec, args } = launchCommand(a.id);
  // `open -n` hands the arguments to a new Vizulla process, which passes them to the running
  // one (single instance) or becomes the browser itself. The launcher exits right away.
  const vizullaApp = exec.slice(0, exec.indexOf('.app/') + 4);
  const script = vizullaApp.endsWith('.app')
    ? `#!/bin/sh\nexec /usr/bin/open -n -a ${sh(vizullaApp)} --args ${args.map(sh).join(' ')}\n`
    : `#!/bin/sh\nexec ${sh(exec)} ${args.map(sh).join(' ')}\n`;
  writeFileSync(join(bundle, 'Contents', 'MacOS', 'launcher'), script, { mode: 0o755 });
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${xml(a.name)}</string>
  <key>CFBundleDisplayName</key><string>${xml(a.name)}</string>
  <key>CFBundleIdentifier</key><string>rw.vizulla.webapp.${a.id}</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>app</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`,
  );
  writeIcns(a.icon, join(bundle, 'Contents', 'Resources', 'app.icns'));
  return { paths: [bundle], where: 'launchpad' };
}

function writeIcns(icon: NativeImage, out: string): void {
  const set = `${out.slice(0, -5)}.iconset`;
  mkdirSync(set, { recursive: true });
  try {
    for (const s of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${s}x${s}.png`), icon.resize({ width: s, height: s, quality: 'best' }).toPNG());
      writeFileSync(join(set, `icon_${s}x${s}@2x.png`), icon.resize({ width: s * 2, height: s * 2, quality: 'best' }).toPNG());
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', out, set], { stdio: 'ignore', timeout: 10_000 });
  } catch {
    /* no icon: the bundle still launches */
  } finally {
    rmSync(set, { recursive: true, force: true });
  }
}

// ---- Windows: .lnk shortcuts with the app's icon and its own AppUserModelID (taskbar grouping).

/** An .ico holding PNG images (supported since Windows Vista). */
export function encodeIco(pngs: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.png)]);
}

export function appUserModelId(id: string): string {
  return `Vizulla.WebApp.${id}`;
}

function windows(a: ShortcutApp, desktop: boolean): Shortcuts {
  const root = testRoot();
  const iconDir = join(app.getPath('userData'), 'WebApps', 'icons');
  mkdirSync(iconDir, { recursive: true });
  const ico = join(iconDir, `${a.id}.ico`);
  writeFileSync(ico, encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: a.icon.resize({ width: size, height: size, quality: 'best' }).toPNG() }))));
  const { exec, args } = launchCommand(a.id);
  const quoted = args.map((x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)).join(' ');
  const dirs = [root ? join(root, 'StartMenu') : join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Vizulla Apps')];
  if (desktop) dirs.push(root ? join(root, 'Desktop') : app.getPath('desktop'));
  const paths = [ico];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    const lnk = join(d, `${shortcutName(a.name)}.lnk`);
    const ok = shell.writeShortcutLink(lnk, 'create', { target: exec, args: quoted, icon: ico, iconIndex: 0, appUserModelId: appUserModelId(a.id), description: a.name });
    if (ok) paths.push(lnk);
  }
  return { paths, where: 'start-menu' };
}

// ---- Linux: freedesktop .desktop entries (application menu, and the desktop when asked).

const desktopArg = (s: string) => `"${s.replace(/(["`$\\])/g, '\\$1')}"`;

function linux(a: ShortcutApp, desktop: boolean): Shortcuts {
  const root = testRoot();
  const data = process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share');
  const iconPath = root ? join(root, 'icons', `vizulla-${a.id}.png`) : join(data, 'icons', 'hicolor', '512x512', 'apps', `vizulla-${a.id}.png`);
  mkdirSync(dirname(iconPath), { recursive: true });
  writeFileSync(iconPath, a.icon.toPNG());
  const { exec, args } = launchCommand(a.id);
  const entry = `[Desktop Entry]
Version=1.0
Type=Application
Name=${a.name.replace(/[\r\n]/g, ' ')}
Exec=${[exec, ...args].map(desktopArg).join(' ')}
Icon=${iconPath}
Terminal=false
Categories=Network;WebBrowser;
StartupWMClass=vizulla-${a.id}
`;
  const files = [root ? join(root, 'applications', `vizulla-${a.id}.desktop`) : join(data, 'applications', `vizulla-${a.id}.desktop`)];
  if (desktop) files.push(join(root ? join(root, 'Desktop') : app.getPath('desktop'), `vizulla-${a.id}.desktop`));
  for (const f of files) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, entry);
    chmodSync(f, 0o755);
  }
  return { paths: [iconPath, ...files], where: 'apps-menu' };
}

/** A PNG data URL from the install dialog (the overlay composes the icon), as an image. */
export function iconFromDataUrl(url: string): NativeImage | null {
  if (!/^data:image\/png;base64,/.test(url) || url.length > 4_000_000) return null;
  const img = nativeImage.createFromDataURL(url);
  return img.isEmpty() ? null : img;
}

export function shortcutsExist(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => existsSync(p));
}
