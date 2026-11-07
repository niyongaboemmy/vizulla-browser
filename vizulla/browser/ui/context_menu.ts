// Native context menus for page content (accessible by default, and not spoofable by pages).
import { clipboard, Menu, type MenuItemConstructorOptions } from 'electron';
import { t } from '@vz/common/i18n';
import type { BrowserWindowController } from './browser_window';
import type { WebTab } from '../tabs/web_tab';

export function buildPageContextMenu(w: BrowserWindowController, tab: WebTab, p: Electron.ContextMenuParams): Menu {
  const wc = tab.wc!;
  const items: MenuItemConstructorOptions[] = [];
  const sep = () => items.length && items.at(-1)?.type !== 'separator' && items.push({ type: 'separator' });

  if (p.linkURL && /^(https?|vizulla|file):/.test(p.linkURL)) {
    items.push(
      { label: t('ctx_open_link_new_tab'), click: () => w.createTab({ url: p.linkURL, afterId: tab.id, openerId: tab.id, activate: false }) },
      { label: t('ctx_open_link_split'), click: () => w.setSplit(w.createTab({ url: p.linkURL, afterId: tab.id, activate: false }).id) },
      { label: t('ctx_copy_link'), click: () => clipboard.writeText(p.linkURL) },
    );
    sep();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: t('ctx_open_image'), click: () => w.createTab({ url: p.srcURL, afterId: tab.id, activate: false }) },
      { label: t('ctx_copy_image'), click: () => wc.copyImageAt(p.x, p.y) },
      { label: t('ctx_save_image'), click: () => wc.downloadURL(p.srcURL) },
    );
    sep();
  }
  const sel = p.selectionText.trim();
  if (sel) {
    items.push({ label: t('ctx_copy'), role: 'copy' });
    const ai = w.app.selectionActions(w, tab, sel, p);
    if (ai.length) {
      sep();
      items.push(...ai);
    }
    sep();
  }
  if (p.isEditable) {
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      items.push({ label: t('ctx_add_dictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    }
    items.push({ label: t('ctx_cut'), role: 'cut', enabled: p.editFlags.canCut }, { label: t('ctx_copy'), role: 'copy', enabled: p.editFlags.canCopy }, { label: t('ctx_paste'), role: 'paste', enabled: p.editFlags.canPaste }, { label: t('ctx_select_all'), role: 'selectAll' });
    sep();
  }
  if (!sel && !p.isEditable && !p.linkURL) {
    items.push(
      { label: t('cmd_nav_back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: t('cmd_nav_forward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: t('cmd_nav_reload'), click: () => wc.reload() },
    );
    sep();
    if (!tab.url.startsWith('vizulla:')) {
      items.push({ label: t('cmd_ai_summarize'), click: () => w.app.runCommand(w, 'ai.summarize') });
      items.push({ label: t('cmd_reader'), click: () => w.app.runCommand(w, 'view.reader') });
      sep();
    }
  }
  items.push({ label: t('ctx_inspect'), click: () => wc.inspectElement(p.x, p.y) });
  return Menu.buildFromTemplate(items);
}
