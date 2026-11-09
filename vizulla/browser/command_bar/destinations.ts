// Where people go inside a browser, phrased the way they type it (Chrome's omnibox
// "actions" and settings results, plus Vizulla's own pages and tools). Keywords mix
// English, French, Kiswahili and Kinyarwanda so "dark mode", "mode sombre", "giza" and
// "umwijima" all land on the theme setting. Pure data and matching: no Electron.
import type { StringKey } from '@vz/common/i18n';
import { fuzzyScore } from './commands';

export type DestinationGroup = 'settings' | 'pages' | 'tools';

export interface Destination {
  id: string;
  group: DestinationGroup;
  title: StringKey;
  icon: string;
  /** A vizulla:// page, or a Settings section + the setting's label (deep link via search). */
  url?: string;
  settings?: { section: string; label?: StringKey };
  /** A command from the registry instead of a page. */
  command?: string;
  keywords: string;
}

/** Settings: a section (label null) or one setting in it (found through the page's search). */
const S = (id: string, section: string, title: StringKey, icon: string, keywords: string, label: StringKey | null = title): Destination => ({ id, group: 'settings', title, icon, settings: { section, label: label ?? undefined }, keywords });
const P = (id: string, url: string, title: StringKey, icon: string, keywords: string): Destination => ({ id, group: 'pages', title, icon, url, keywords });
const T = (id: string, command: string, title: StringKey, icon: string, keywords: string): Destination => ({ id, group: 'tools', title, icon, command, keywords });

export const DESTINATIONS: Destination[] = [
  // Settings sections
  S('settings', 'general', 'cmd_settings', 'settings', 'settings preferences options configure réglages paramètres mipangilio igenamiterere', null),
  S('appearance', 'appearance', 'settings_appearance', 'grid', 'appearance look design apparence muonekano imigaragarire', null),
  S('tabs-settings', 'tabs', 'settings_tabs', 'layers', 'tabs settings onglets vichupo', null),
  S('privacy', 'shields', 'settings_shields', 'shield', 'privacy security protection confidentialité sécurité faragha usalama ubuzima bwite umutekano', null),
  S('ai-settings', 'ai', 'settings_ai', 'sparkle', 'ai assistant artificial intelligence ia akili bandia ubwenge', null),
  S('permissions', 'permissions', 'settings_permissions', 'lock', 'site permissions camera microphone location notifications autorisations caméra position ruhusa kamera eneo uruhushya', null),
  S('import', 'import', 'settings_import', 'download', 'import bookmarks passwords from chrome edge safari firefox importer leta injiza', null),
  // Specific settings
  S('search-engine', 'general', 'set_search_engine', 'search', 'search engine default google duckduckgo bing change moteur de recherche injini ya utafutaji moteri ishakisha'),
  S('language', 'general', 'set_language', 'translate', 'language english french kiswahili kinyarwanda langue lugha ururimi'),
  S('default-browser', 'general', 'set_default_browser', 'globe', 'default browser make default navigateur par défaut kivinjari chaguo-msingi mushakisha'),
  S('restore', 'general', 'set_restore', 'history', 'startup restore tabs continue where left off démarrage kuanza gutangira'),
  S('downloads-ask', 'general', 'set_downloads_ask', 'download', 'download location folder where save téléchargements dossier mahali'),
  S('updates', 'general', 'settings_updates_auto', 'update', 'updates update automatic version mise à jour sasisha kuvugurura'),
  S('theme', 'appearance', 'set_theme', 'moon', 'theme dark mode light mode night thème sombre clair mode nuit giza mwanga umwijima urumuri'),
  S('accent', 'appearance', 'set_accent', 'grid', 'accent color colour couleur rangi ibara'),
  S('layout', 'appearance', 'set_layout', 'sidebar', 'tab layout vertical tabs side tabs on top horizontal disposition onglets verticaux mpangilio'),
  S('zoom', 'appearance', 'set_zoom', 'search', 'default zoom page size text size font size taille texte ukubwa'),
  S('memory-saver', 'tabs', 'set_memory_saver', 'zap', 'memory saver sleeping tabs performance speed ram économiseur mémoire kumbukumbu kwihuta'),
  S('archive', 'tabs', 'set_archive', 'archive', 'auto archive idle tabs archiver kuhifadhi'),
  S('block-ads', 'shields', 'set_block_ads', 'shield-check', 'block ads adblock ad blocker show ads allow ads bloquer publicités matangazo amatangazo zuia'),
  S('shields', 'shields', 'set_shields', 'shield', 'shields trackers tracking protection traqueurs ufuatiliaji ababakurikirana'),
  S('cookies', 'shields', 'set_3p_cookies', 'eye-off', 'cookies third party cookies tracking cookies tiers vidakuzi'),
  S('https', 'shields', 'set_https_first', 'lock', 'https secure connection ssl sécurisé salama'),
  S('dns', 'shields', 'set_doh', 'cloud', 'dns over https doh secure dns'),
  S('fingerprinting', 'shields', 'set_fingerprinting', 'eye-off', 'fingerprinting fingerprint protection empreinte alama za vidole'),
  S('cookie-banners', 'shields', 'set_cookie_banners', 'x', 'cookie banners consent popups gdpr bannières bandeaux'),
  S('clear-data', 'shields', 'set_clear_data', 'trash', 'clear browsing data delete history cache cookies erase effacer données supprimer historique futa data futa historia gusiba amateka'),
  S('private-capture', 'shields', 'set_private_capture', 'eye-off', 'private window screenshots screen recording capture privé'),
  S('telemetry', 'shields', 'set_telemetry', 'info', 'telemetry usage statistics diagnostics télémétrie'),
  S('passwords-settings', 'passwords', 'settings_passwords', 'key', 'passwords settings autofill save passwords mots de passe nenosiri ijambo ry ibanga', null),
  // Pages
  P('history', 'vizulla://history/', 'cmd_history', 'history', 'history recently visited sites historique historia amateka'),
  P('bookmarks', 'vizulla://bookmarks/', 'cmd_bookmarks', 'star', 'bookmarks favorites saved favoris alamisho ibyo nabitse'),
  P('downloads', 'vizulla://downloads/', 'cmd_downloads', 'download', 'downloads files downloaded téléchargements vipakuliwa ibyakuruwe'),
  P('passwords', 'vizulla://passwords/', 'cmd_passwords', 'key', 'passwords password manager logins accounts credentials mots de passe identifiants nenosiri ijambo ry ibanga konti'),
  P('extensions', 'vizulla://extensions/', 'cmd_extensions', 'puzzle', 'extensions add-ons addons plugins chrome web store install extension viendelezi inyongera'),
  P('task-manager', 'vizulla://task-manager/', 'cmd_task_manager', 'cpu', 'task manager memory cpu slow performance processes gestionnaire tâches lenteur polepole buhoro'),
  P('privacy-dashboard', 'vizulla://privacy/', 'cmd_privacy_dashboard', 'shield-check', 'privacy dashboard blocked trackers report tableau de bord'),
  P('archive-page', 'vizulla://archive/', 'cmd_archive', 'archive', 'archived tabs archive closed tabs'),
  P('memory', 'vizulla://memory/', 'cmd_memory_page', 'brain', 'memory remembered pages recall mémoire kumbukumbu'),
  P('about', 'vizulla://about/', 'cmd_about', 'info', 'about version help vizulla à propos kuhusu ibyerekeye'),
  P('flags', 'vizulla://flags/', 'cmd_flags', 'flask', 'flags experiments experimental features'),
  P('profiles', 'vizulla://profiles/', 'profile_manage', 'user', 'profiles profile people accounts switch profile profils wasifu porofayili'),
  // Tools and actions
  T('new-private', 'window.newPrivate', 'cmd_new_private', 'eye-off', 'private window incognito private browsing navigation privée fenêtre privée dirisha la faragha ibanga'),
  T('new-window', 'window.new', 'cmd_new_window', 'columns', 'new window nouvelle fenêtre dirisha jipya idirishya rishya'),
  T('reopen', 'tab.reopen', 'cmd_tab_reopen', 'undo', 'reopen closed tab restore tab undo close rouvrir onglet fermé'),
  T('find', 'view.find', 'cmd_find', 'search', 'find in page search page ctrl f rechercher dans la page tafuta'),
  T('reader', 'view.reader', 'cmd_reader', 'reader', 'reader mode reading view lecture mode lecteur kusoma'),
  T('devtools', 'view.devtools', 'cmd_devtools', 'code', 'developer tools devtools inspect console outils de développement'),
  T('fullscreen', 'view.fullscreen', 'cmd_fullscreen', 'maximize', 'full screen fullscreen plein écran skrini nzima'),
  T('zoom-in', 'view.zoomIn', 'cmd_zoom_in', 'plus', 'zoom in bigger larger agrandir kuza'),
  T('zoom-out', 'view.zoomOut', 'cmd_zoom_out', 'minimize', 'zoom out smaller réduire'),
  T('copy-url', 'nav.copyUrl', 'cmd_copy_url', 'copy', 'copy link copy url copier le lien nakili kiungo'),
  T('bookmark-page', 'nav.bookmark', 'cmd_bookmark', 'star', 'bookmark this page save page add favorite ajouter aux favoris'),
  T('split', 'tab.split', 'cmd_tab_split', 'columns', 'split view side by side two pages écran partagé'),
  T('summarize', 'ai.summarize', 'cmd_ai_summarize', 'sparkle', 'summarize page summary tldr résumer muhtasari incamake'),
  T('update', 'app.checkUpdates', 'cmd_check_updates', 'update', 'check for updates update vizulla upgrade mise à jour sasisha'),
  T('close-private', 'window.closePrivate', 'cmd_close_private', 'x', 'close private windows close incognito'),
  T('screenshot', 'tools.screenshot', 'tool_screenshot', 'focus', 'screenshot capture screen snapshot image capture d écran picha ya skrini ifoto'),
  T('screenshot-full', 'tools.screenshotFull', 'tool_screenshot_full', 'columns', 'full page screenshot whole page long screenshot capture entière'),
  T('save-pdf', 'tools.savePdf', 'tool_save_pdf', 'reader', 'save as pdf export pdf download page as pdf enregistrer pdf'),
  T('print', 'tools.print', 'tool_print', 'copy', 'print printer imprimer chapisha gucapa'),
  T('qr', 'tools.qr', 'tool_qr', 'grid', 'qr code send to phone share link scan code qr'),
  T('read-aloud', 'tools.readAloud', 'tool_read_aloud', 'volume', 'read aloud text to speech listen speak voice lire à voix haute soma kwa sauti'),
  T('pip', 'tools.pip', 'tool_pip', 'play', 'picture in picture pip floating video'),
  T('color-picker', 'tools.colorPicker', 'tool_color_picker', 'wand', 'color picker eyedropper colour hex pipette rangi'),
  T('tech-stack', 'tools.techStack', 'tool_tech', 'code', 'technologies tech stack built with framework cms detect what is this site made with wappalyzer builtwith'),
  T('clear-site', 'tools.clearSiteData', 'tool_clear_site', 'trash', 'clear site data reset site cookies for this site effacer données du site'),
];

export interface DestinationMatch {
  d: Destination;
  score: number;
}

/** Destinations matching the query, best first (title counts more than keywords). */
export function matchDestinations(q: string, title: (d: Destination) => string, limit: number, group?: DestinationGroup): DestinationMatch[] {
  const query = q.trim();
  const pool = group ? DESTINATIONS.filter((d) => d.group === group) : DESTINATIONS;
  if (!query) return pool.slice(0, limit).map((d) => ({ d, score: 0 }));
  return pool
    .map((d) => ({ d, score: Math.max(fuzzyScore(query, title(d)), keywordScore(query, d.keywords)) }))
    .filter((m) => m.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Keyword lists are long and multilingual, so they're matched word by word: the typed
 * phrase at a word start scores 90; every typed word starting some keyword scores 75.
 */
export function keywordScore(q: string, keywords: string): number {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const k = ` ${norm(keywords)}`;
  const query = norm(q).trim();
  if (query.length < 2) return 0;
  if (k.includes(` ${query}`)) return 90 + Math.min(query.length, 9);
  const words = k.split(/\s+/).filter(Boolean);
  const parts = query.split(/\s+/).filter((p) => p.length >= 2);
  return parts.length && parts.every((p) => words.some((w) => w.startsWith(p))) ? 75 : 0;
}

/** The vizulla:// URL a destination opens (Settings deep links search for the setting). */
export function destinationUrl(d: Destination, label: (k: StringKey) => string): string | null {
  if (d.url) return d.url;
  if (!d.settings) return null;
  const base = `vizulla://settings/${d.settings.section}`;
  return d.settings.label ? `${base}?q=${encodeURIComponent(label(d.settings.label))}` : base;
}
