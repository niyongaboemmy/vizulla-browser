// Importers (P1-BRW-07/08, P4-BRW-13, SYN-03).
// Chromium-family browsers share a profile format: `Bookmarks` (JSON) and
// `History` (SQLite, Chrome time = µs since 1601). Firefox keeps both in
// places.sqlite. Databases are copied first because the source browser may hold
// a lock. Passwords use the guided CSV export path: Chrome's app-bound encryption
// blocks other apps from decrypting them on Windows (P1-BRW-08).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'arc' | 'chromium' | 'firefox';

export interface ImportSource {
  browser: BrowserKind;
  name: string;
  profileName: string;
  path: string;
}

export interface ImportedData {
  bookmarks: { url: string; title: string; folder: string; addedAt: number }[];
  history: { url: string; title: string; visitCount: number; typedCount: number; lastVisit: number }[];
}

const CHROME_EPOCH_OFFSET_US = 11644473600000000n;

export function chromeTimeToMs(t: number | bigint | string): number {
  const v = BigInt(t || 0);
  if (v === 0n) return 0;
  return Number((v - CHROME_EPOCH_OFFSET_US) / 1000n);
}

const CHROMIUM_ROOTS: Record<NodeJS.Platform | string, Partial<Record<BrowserKind, string>>> = {
  darwin: {
    chrome: 'Library/Application Support/Google/Chrome',
    edge: 'Library/Application Support/Microsoft Edge',
    brave: 'Library/Application Support/BraveSoftware/Brave-Browser',
    vivaldi: 'Library/Application Support/Vivaldi',
    opera: 'Library/Application Support/com.operasoftware.Opera',
    arc: 'Library/Application Support/Arc/User Data',
    chromium: 'Library/Application Support/Chromium',
    firefox: 'Library/Application Support/Firefox/Profiles',
  },
  win32: {
    chrome: 'AppData/Local/Google/Chrome/User Data',
    edge: 'AppData/Local/Microsoft/Edge/User Data',
    brave: 'AppData/Local/BraveSoftware/Brave-Browser/User Data',
    vivaldi: 'AppData/Local/Vivaldi/User Data',
    opera: 'AppData/Roaming/Opera Software/Opera Stable',
    chromium: 'AppData/Local/Chromium/User Data',
    firefox: 'AppData/Roaming/Mozilla/Firefox/Profiles',
  },
  linux: {
    chrome: '.config/google-chrome',
    edge: '.config/microsoft-edge',
    brave: '.config/BraveSoftware/Brave-Browser',
    vivaldi: '.config/vivaldi',
    opera: '.config/opera',
    chromium: '.config/chromium',
    firefox: '.mozilla/firefox',
  },
};

const NAMES: Record<BrowserKind, string> = {
  chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera', arc: 'Arc', chromium: 'Chromium', firefox: 'Firefox',
};

/** Finds importable profiles on this machine (or under `home`, for tests). */
export function detectSources(home = homedir(), platform: string = process.platform): ImportSource[] {
  const roots = CHROMIUM_ROOTS[platform] ?? {};
  const out: ImportSource[] = [];
  for (const [kind, rel] of Object.entries(roots) as [BrowserKind, string][]) {
    const root = join(home, rel);
    if (!existsSync(root)) continue;
    if (kind === 'firefox') {
      for (const d of safeReaddir(root)) {
        const p = join(root, d);
        if (existsSync(join(p, 'places.sqlite'))) out.push({ browser: kind, name: NAMES[kind], profileName: d.replace(/^[^.]+\./, ''), path: p });
      }
      continue;
    }
    // Opera keeps a single profile in the root.
    const candidates = existsSync(join(root, 'Bookmarks')) || existsSync(join(root, 'History')) ? [''] : safeReaddir(root).filter((d) => d === 'Default' || /^Profile \d+$/.test(d));
    for (const d of candidates) {
      const p = join(root, d);
      if (existsSync(join(p, 'Bookmarks')) || existsSync(join(p, 'History'))) {
        out.push({ browser: kind, name: NAMES[kind], profileName: d || 'Default', path: p });
      }
    }
  }
  return out;
}

export function importFrom(src: ImportSource, types: { bookmarks: boolean; history: boolean }, historyLimit = 20000): ImportedData {
  return src.browser === 'firefox' ? importFirefox(src.path, types, historyLimit) : importChromium(src.path, types, historyLimit);
}

interface ChromiumNode {
  type: 'url' | 'folder';
  name: string;
  url?: string;
  date_added?: string;
  children?: ChromiumNode[];
}

export function importChromium(dir: string, types: { bookmarks: boolean; history: boolean }, historyLimit = 20000): ImportedData {
  const data: ImportedData = { bookmarks: [], history: [] };
  if (types.bookmarks && existsSync(join(dir, 'Bookmarks'))) {
    const json = JSON.parse(readFileSync(join(dir, 'Bookmarks'), 'utf8')) as { roots: Record<string, ChromiumNode> };
    const walk = (n: ChromiumNode, folder: string) => {
      if (n.type === 'url' && n.url && /^(https?|file):/.test(n.url)) {
        data.bookmarks.push({ url: n.url, title: n.name || n.url, folder, addedAt: chromeTimeToMs(n.date_added ?? 0) });
      }
      for (const c of n.children ?? []) walk(c, n.type === 'folder' && n.name && !isRootName(n.name) ? (folder ? `${folder}/${n.name}` : n.name) : folder);
    };
    for (const [key, root] of Object.entries(json.roots ?? {})) if (root && typeof root === 'object' && key !== 'sync_transaction_version') walk(root, '');
  }
  if (types.history && existsSync(join(dir, 'History'))) {
    withCopy(join(dir, 'History'), (db) => {
      const rows = db
        .prepare('SELECT url, title, visit_count, typed_count, CAST(last_visit_time AS TEXT) AS last_visit_time FROM urls WHERE hidden = 0 ORDER BY urls.last_visit_time DESC LIMIT ?')
        .all(historyLimit) as { url: string; title: string; visit_count: number; typed_count: number; last_visit_time: string }[];
      for (const r of rows) {
        if (!/^https?:/.test(r.url)) continue;
        data.history.push({ url: r.url, title: r.title ?? '', visitCount: Number(r.visit_count), typedCount: Number(r.typed_count), lastVisit: chromeTimeToMs(r.last_visit_time) });
      }
    });
  }
  return data;
}

export function importFirefox(dir: string, types: { bookmarks: boolean; history: boolean }, historyLimit = 20000): ImportedData {
  const data: ImportedData = { bookmarks: [], history: [] };
  withCopy(join(dir, 'places.sqlite'), (db) => {
    if (types.bookmarks) {
      const rows = db
        .prepare(
          `SELECT b.title AS title, p.url AS url, b.dateAdded AS added, f.title AS folder
           FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk LEFT JOIN moz_bookmarks f ON f.id = b.parent
           WHERE b.type = 1`,
        )
        .all() as { title: string | null; url: string; added: number | bigint; folder: string | null }[];
      for (const r of rows) {
        if (!/^(https?|file):/.test(r.url)) continue;
        data.bookmarks.push({ url: r.url, title: r.title || r.url, folder: r.folder && !isRootName(r.folder) ? r.folder : '', addedAt: Math.floor(Number(r.added) / 1000) });
      }
    }
    if (types.history) {
      const rows = db
        .prepare('SELECT url, title, visit_count, typed, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?')
        .all(historyLimit) as { url: string; title: string | null; visit_count: number; typed: number; last_visit_date: number | bigint }[];
      for (const r of rows) {
        if (!/^https?:/.test(r.url)) continue;
        data.history.push({ url: r.url, title: r.title ?? '', visitCount: Number(r.visit_count), typedCount: Number(r.typed), lastVisit: Math.floor(Number(r.last_visit_date) / 1000) });
      }
    }
  });
  return data;
}

export interface CsvPassword {
  origin: string;
  username: string;
  password: string;
  note: string;
}

/** Parses Chrome/Edge/Firefox/Safari/Bitwarden-style password CSV exports (RFC 4180 quoting). */
export function parsePasswordCsv(text: string): CsvPassword[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iUrl = col('url', 'login_uri', 'website', 'origin', 'hostname');
  const iUser = col('username', 'login_username', 'user', 'email');
  const iPass = col('password', 'login_password');
  const iNote = col('note', 'notes', 'name', 'title');
  if (iUrl < 0 || iPass < 0) throw new Error('CSV needs url and password columns');
  const out: CsvPassword[] = [];
  for (const r of rows.slice(1)) {
    const url = r[iUrl]?.trim() ?? '';
    const password = r[iPass] ?? '';
    if (!url || !password) continue;
    let origin: string;
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
      if (!/^https?:$/.test(u.protocol)) continue;
      origin = u.origin;
    } catch {
      continue;
    }
    out.push({ origin, username: (iUser >= 0 ? r[iUser] : '')?.trim() ?? '', password, note: (iNote >= 0 ? r[iNote] : '') ?? '' });
  }
  return out;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function isRootName(n: string): boolean {
  return ['Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks', 'Mobile bookmarks', 'Bookmarks Toolbar', 'Bookmarks Menu', 'menu', 'toolbar', 'unfiled', 'mobile', 'Favorites bar'].includes(n);
}

function safeReaddir(d: string): string[] {
  try {
    return readdirSync(d).filter((x) => {
      try {
        return statSync(join(d, x)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function withCopy(file: string, fn: (db: DatabaseSync) => void): void {
  if (!existsSync(file)) return;
  const dir = mkdtempSync(join(tmpdir(), 'vz-import-'));
  const copy = join(dir, 'db.sqlite');
  try {
    copyFileSync(file, copy);
    for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, copy + ext);
    const db = new DatabaseSync(copy, { readOnly: false });
    try {
      fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
