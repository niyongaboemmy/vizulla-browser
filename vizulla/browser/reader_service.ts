// Reader view (P2-AI-08, PA-07): the same extraction the assistant uses, rendered
// with Vizulla typography at vizulla://reader. Back returns to the page.
import type { BrowserApp } from './browser_app';
import type { AssistantService } from './ai/assistant_service';
import { EXTRACT_SCRIPT, ISOLATED_WORLD_ID } from './ai/context/page_scripts';
import type { Block } from './ai/context/chunker';
import { v } from '@vz/common/mojom/schema';

interface Article {
  url: string;
  title: string;
  blocks: Block[];
  site: string;
}

export function installReader(app: BrowserApp, _assistant: AssistantService | null): void {
  const store = new Map<string, Article>();
  let next = 1;
  app.commandHandlers.set('view.reader', async (w) => {
    const tab = w.activeTab();
    const wc = tab?.wc;
    if (!tab || !wc) return;
    if (tab.url.startsWith('vizulla://reader')) return wc.navigationHistory.goBack();
    if (!/^https?:/.test(tab.url)) return;
    const r = (await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: EXTRACT_SCRIPT }])) as { title: string; blocks: Block[] };
    const id = String(next++);
    store.set(id, { url: tab.url, title: r.title || tab.title, blocks: r.blocks.slice(0, 2000), site: new URL(tab.url).hostname });
    if (store.size > 30) store.delete(store.keys().next().value!);
    void wc.loadURL(`vizulla://reader/?id=${id}`);
  });
  app.pages.define('reader', {
    init: () => ({}),
    get: (payload) => store.get(v.string({ max: 12, pattern: /^\d+$/ }).parse(payload, 'id')) ?? null,
    open: (payload, ctx) => {
      const url = v.string({ max: 8192 }).parse(payload, 'url');
      const w = ctx.window;
      const tab = w && [...w.tabs.values()].find((x) => x.wc === ctx.sender);
      if (w && tab && /^https?:/.test(url)) w.loadUrl(tab.id, url);
    },
  });
}
