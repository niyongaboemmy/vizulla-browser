// The browser-owned side of site permissions: the prompt, device choosers and the
// screen-sharing picker in the overlay of the tab's window, and in-use indicators.
import { desktopCapturer, type WebContents } from 'electron';
import type { BrowserApp } from '../browser_app';
import type { PermissionsUi, PromptAnswer } from './site_permissions';
import { displayUrl } from '@vz/common/url';

export function permissionsUi(app: BrowserApp): PermissionsUi {
  const windowOf = (wc: WebContents) => app.findTabByWebContents(wc)?.window ?? app.windowForSender(wc);
  return {
    async prompt({ wc, origin, embeddedIn, kinds, detail }) {
      const w = windowOf(wc);
      // An installed app's window asks in its own overlay.
      const appOverlay = w ? null : app.dialogHost(wc)?.overlay;
      if (appOverlay) return (await appOverlay.dialog<{ answer: PromptAnswer } | null>({ type: 'permission', origin: displayUrl(origin), embeddedIn: embeddedIn ? displayUrl(embeddedIn) : null, kinds, detail: detail ?? null }))?.answer ?? 'dismiss';
      if (!w) return 'dismiss';
      // A background tab can't interrupt: it waits until it's the one being looked at.
      const tab = app.findTabByWebContents(wc)?.tab;
      if (tab && w.activeTab() !== tab) return 'dismiss';
      const r = await w.overlay.dialog<{ answer: PromptAnswer } | null>({ type: 'permission', origin: displayUrl(origin), embeddedIn: embeddedIn ? displayUrl(embeddedIn) : null, kinds, detail: detail ?? null });
      return r?.answer ?? 'dismiss';
    },
    async chooseDevice({ wc, origin, kind, devices }) {
      const w = windowOf(wc);
      if (!w) return null;
      const r = await w.overlay.dialog<{ id: string } | null>({ type: 'device-chooser', origin: displayUrl(origin), kind, devices });
      return r?.id ?? null;
    },
    async chooseDisplay({ wc, origin, audio }) {
      const w = windowOf(wc);
      if (!w) return null;
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
      const tabs = [...w.tabs.values()].filter((t) => t.wc && t.wc !== wc && /^https?:/.test(t.url)).map((t) => ({ id: `tab:${t.id}`, name: t.title || t.url, favicon: t.favicon ?? null }));
      const r = await w.overlay.dialog<{ id: string; audio?: boolean } | null>({
        type: 'display-picker',
        origin: displayUrl(origin),
        audio: audio && process.platform === 'win32',
        sources: sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null })),
        tabs,
      });
      if (!r) return null;
      if (r.id.startsWith('tab:')) {
        const tab = w.tabs.get(Number(r.id.slice(4)));
        return tab?.wc ? { video: tab.wc.mainFrame, ...(r.audio ? { audio: tab.wc.mainFrame } : {}) } : null;
      }
      const source = sources.find((s) => s.id === r.id);
      return source ? { video: source, ...(r.audio && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) } : null;
    },
    inUseChanged(wc) {
      windowOf(wc)?.pushState();
    },
  };
}
