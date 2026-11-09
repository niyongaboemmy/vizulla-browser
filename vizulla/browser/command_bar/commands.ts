// The command registry (P2-BRW-13, CMD-08). One list feeds the application menu,
// keyboard accelerators, the Command Bar palette (">"), and, in R2, the natural
// language command mapper, which can only pick from this list (CMD-05).
import type { StringKey } from '@vz/common/i18n';

export type CommandCategory = 'tabs' | 'spaces' | 'navigation' | 'view' | 'ai' | 'privacy' | 'pages' | 'window' | 'agent' | 'tools';

export interface CommandArgSpec {
  name: string;
  kind: 'space' | 'text' | 'url' | 'number' | 'group';
  optional?: boolean;
}

export interface CommandDef {
  id: string;
  title: StringKey;
  category: CommandCategory;
  /** Electron accelerator syntax. CmdOrCtrl keeps Chrome-compatible defaults (USE-03). */
  accelerator?: string;
  keywords?: string;
  /** Changes or removes user data: NL commands must confirm first (P4-BRW-06). */
  destructive?: boolean;
  args?: CommandArgSpec[];
  /** Feature flag that must be on for the command to exist. */
  feature?: string;
}

export const COMMANDS: readonly CommandDef[] = [
  // Tabs
  { id: 'tab.new', title: 'cmd_tab_new', category: 'tabs', accelerator: 'CmdOrCtrl+T', keywords: 'open blank' },
  { id: 'tab.close', title: 'cmd_tab_close', category: 'tabs', accelerator: 'CmdOrCtrl+W', destructive: false },
  { id: 'tab.reopen', title: 'cmd_tab_reopen', category: 'tabs', accelerator: 'CmdOrCtrl+Shift+T', keywords: 'undo closed restore' },
  { id: 'tab.duplicate', title: 'cmd_tab_duplicate', category: 'tabs', keywords: 'copy clone' },
  { id: 'tab.pin', title: 'cmd_tab_pin', category: 'tabs', keywords: 'unpin favorite' },
  { id: 'tab.mute', title: 'cmd_tab_mute', category: 'tabs', accelerator: 'CmdOrCtrl+Shift+M', keywords: 'sound audio silence unmute' },
  { id: 'tab.next', title: 'cmd_tab_next', category: 'tabs', accelerator: 'Ctrl+Tab' },
  { id: 'tab.previous', title: 'cmd_tab_previous', category: 'tabs', accelerator: 'Ctrl+Shift+Tab' },
  { id: 'tab.search', title: 'cmd_tab_search', category: 'tabs', accelerator: 'CmdOrCtrl+Shift+A', keywords: 'find archived switch' },
  { id: 'tab.closeOthers', title: 'cmd_tab_close_others', category: 'tabs', destructive: true, keywords: 'clean up' },
  { id: 'tab.archiveIdle', title: 'cmd_tab_archive_idle', category: 'tabs', keywords: 'clean tidy declutter' },
  { id: 'tab.group', title: 'cmd_tab_group', category: 'tabs', keywords: 'folder collect', args: [{ name: 'title', kind: 'text', optional: true }] },
  { id: 'tab.groupAi', title: 'cmd_tab_group_ai', category: 'ai', keywords: 'organize sort automatic tidy', feature: 'VizullaLocalRuntime' },
  { id: 'tab.split', title: 'cmd_tab_split', category: 'view', keywords: 'side by side two panes' },
  { id: 'tab.moveToSpace', title: 'cmd_tab_move_space', category: 'spaces', args: [{ name: 'space', kind: 'space' }] },
  // Spaces
  { id: 'space.new', title: 'cmd_space_new', category: 'spaces', keywords: 'create workspace', args: [{ name: 'name', kind: 'text', optional: true }] },
  { id: 'space.rename', title: 'cmd_space_rename', category: 'spaces', args: [{ name: 'name', kind: 'text' }] },
  { id: 'space.delete', title: 'cmd_space_delete', category: 'spaces', destructive: true },
  { id: 'space.switch', title: 'cmd_space_switch', category: 'spaces', args: [{ name: 'space', kind: 'space' }] },
  { id: 'space.next', title: 'cmd_space_next', category: 'spaces', accelerator: 'CmdOrCtrl+Alt+Right' },
  { id: 'space.previous', title: 'cmd_space_previous', category: 'spaces', accelerator: 'CmdOrCtrl+Alt+Left' },
  { id: 'focus.toggle', title: 'cmd_focus', category: 'spaces', keywords: 'sleep discard memory calm', accelerator: 'CmdOrCtrl+Shift+F' },
  // Navigation
  { id: 'nav.back', title: 'cmd_nav_back', category: 'navigation', accelerator: 'CmdOrCtrl+[' },
  { id: 'nav.forward', title: 'cmd_nav_forward', category: 'navigation', accelerator: 'CmdOrCtrl+]' },
  { id: 'nav.reload', title: 'cmd_nav_reload', category: 'navigation', accelerator: 'CmdOrCtrl+R' },
  { id: 'nav.hardReload', title: 'cmd_nav_hard_reload', category: 'navigation', accelerator: 'CmdOrCtrl+Shift+R' },
  { id: 'nav.focusAddress', title: 'cmd_focus_address', category: 'navigation', accelerator: 'CmdOrCtrl+L' },
  { id: 'nav.commandBar', title: 'cmd_command_bar', category: 'navigation', accelerator: 'CmdOrCtrl+K' },
  { id: 'nav.copyUrl', title: 'cmd_copy_url', category: 'navigation', accelerator: 'CmdOrCtrl+Shift+C', keywords: 'link share' },
  { id: 'nav.bookmark', title: 'cmd_bookmark', category: 'navigation', accelerator: 'CmdOrCtrl+D', keywords: 'save star favorite' },
  // View
  { id: 'view.toggleSidebar', title: 'cmd_toggle_sidebar', category: 'view', accelerator: 'CmdOrCtrl+S', keywords: 'hide show tabs' },
  { id: 'view.toggleLayout', title: 'cmd_toggle_layout', category: 'view', keywords: 'vertical horizontal tabs top' },
  { id: 'view.classic', title: 'cmd_classic', category: 'view', keywords: 'traditional old normal' },
  { id: 'view.reader', title: 'cmd_reader', category: 'view', accelerator: 'CmdOrCtrl+Alt+R', keywords: 'read article clean' },
  { id: 'view.find', title: 'cmd_find', category: 'view', accelerator: 'CmdOrCtrl+F', keywords: 'search page' },
  { id: 'view.zoomIn', title: 'cmd_zoom_in', category: 'view', accelerator: 'CmdOrCtrl+=', keywords: 'bigger larger text' },
  { id: 'view.zoomOut', title: 'cmd_zoom_out', category: 'view', accelerator: 'CmdOrCtrl+-', keywords: 'smaller text' },
  { id: 'view.zoomReset', title: 'cmd_zoom_reset', category: 'view', accelerator: 'CmdOrCtrl+0' },
  { id: 'view.devtools', title: 'cmd_devtools', category: 'view', accelerator: 'CmdOrCtrl+Alt+I', keywords: 'inspect developer console' },
  { id: 'view.inspect', title: 'cmd_inspect', category: 'view', accelerator: 'CmdOrCtrl+Alt+C', keywords: 'inspect element select element devtools' },
  { id: 'view.source', title: 'cmd_view_source', category: 'view', accelerator: process.platform === 'darwin' ? 'Cmd+Alt+U' : 'Ctrl+U', keywords: 'view source page source html code' },
  { id: 'tools.copyMarkdown', title: 'tool_copy_markdown', category: 'tools', keywords: 'copy as markdown page to markdown llm context ai prompt' },
  { id: 'view.fullscreen', title: 'cmd_fullscreen', category: 'view', accelerator: 'F11' },
  { id: 'view.theme', title: 'cmd_theme', category: 'view', keywords: 'dark light mode appearance' },
  // AI
  { id: 'ai.panel', title: 'cmd_ai_panel', category: 'ai', accelerator: 'CmdOrCtrl+E', keywords: 'assistant chat ask' },
  { id: 'ai.summarize', title: 'cmd_ai_summarize', category: 'ai', keywords: 'tldr summary key points' },
  { id: 'ai.compareTabs', title: 'cmd_ai_compare', category: 'ai', keywords: 'multi tab synthesis table', feature: 'VizullaMultiTab' },
  { id: 'notes.panel', title: 'cmd_notes_panel', category: 'ai', accelerator: 'CmdOrCtrl+Shift+N', keywords: 'clip write', feature: 'VizullaNotes' },
  { id: 'memory.save', title: 'cmd_memory_save', category: 'ai', accelerator: 'CmdOrCtrl+Shift+S', keywords: 'remember keep', feature: 'VizullaMemory' },
  { id: 'agent.start', title: 'cmd_agent_start', category: 'agent', keywords: 'task do for me automate', feature: 'VizullaAgent', args: [{ name: 'goal', kind: 'text', optional: true }] },
  { id: 'agent.stop', title: 'cmd_agent_stop', category: 'agent', feature: 'VizullaAgent' },
  // Privacy
  { id: 'shields.toggleSite', title: 'cmd_shields_toggle', category: 'privacy', keywords: 'adblock block ads trackers' },
  { id: 'privacy.clearHistory', title: 'cmd_clear_history', category: 'privacy', destructive: true, keywords: 'delete browsing data' },
  { id: 'window.newPrivate', title: 'cmd_new_private', category: 'window', accelerator: 'CmdOrCtrl+Shift+P', keywords: 'incognito' },
  { id: 'window.new', title: 'cmd_new_window', category: 'window', accelerator: 'CmdOrCtrl+N' },
  { id: 'app.checkUpdates', title: 'cmd_check_updates', category: 'window', keywords: 'upgrade new version release' },
  { id: 'app.update', title: 'cmd_update', category: 'window', keywords: 'upgrade install restart' },
  { id: 'window.next', title: 'cmd_window_next', category: 'window', accelerator: 'CmdOrCtrl+`', keywords: 'cycle switch other' },
  { id: 'tab.moveToNewWindow', title: 'cmd_tab_move_window', category: 'window', keywords: 'detach tear off pop out separate' },
  // Internal pages
  { id: 'page.settings', title: 'cmd_settings', category: 'pages', accelerator: 'CmdOrCtrl+,', keywords: 'preferences options' },
  { id: 'page.settingsShields', title: 'ads_settings', category: 'pages', keywords: 'ads adblock block ads show ads trackers shields ad blocker privacy' },
  { id: 'profile.manage', title: 'profile_manage', category: 'window', keywords: 'profiles people accounts switch user' },
  { id: 'profile.add', title: 'profile_add', category: 'window', keywords: 'new profile person account user' },
  { id: 'page.passwords', title: 'cmd_passwords', category: 'pages', keywords: 'password manager login account credentials keys' },
  { id: 'tools.menu', title: 'cmd_tools', category: 'tools', keywords: 'tools utilities more tools' },
  { id: 'tools.screenshot', title: 'tool_screenshot', category: 'tools', keywords: 'screenshot capture screen image snapshot capture d écran picha ya skrini ifoto' },
  { id: 'tools.screenshotFull', title: 'tool_screenshot_full', category: 'tools', keywords: 'full page screenshot whole page capture long screenshot' },
  { id: 'tools.savePdf', title: 'tool_save_pdf', category: 'tools', keywords: 'save as pdf export pdf enregistrer pdf' },
  { id: 'tools.print', title: 'tool_print', category: 'tools', accelerator: 'CmdOrCtrl+P', keywords: 'print printer imprimer chapisha' },
  { id: 'tools.qr', title: 'tool_qr', category: 'tools', keywords: 'qr code share link phone send to phone code qr' },
  { id: 'tools.readAloud', title: 'tool_read_aloud', category: 'tools', keywords: 'read aloud text to speech listen speak voice lire à voix haute soma kwa sauti' },
  { id: 'tools.pip', title: 'tool_pip', category: 'tools', keywords: 'picture in picture pip video floating video' },
  { id: 'tools.colorPicker', title: 'tool_color_picker', category: 'tools', keywords: 'color picker eyedropper colour hex pipette' },
  { id: 'tools.clearSiteData', title: 'tool_clear_site', category: 'tools', destructive: true, keywords: 'clear site data cookies storage reset site effacer données du site' },
  { id: 'window.closePrivate', title: 'cmd_close_private', category: 'window', keywords: 'close private incognito windows' },
  { id: 'page.taskManager', title: 'cmd_task_manager', category: 'pages', accelerator: 'Shift+Escape', keywords: 'task manager memory cpu slow performance process heavy' },
  { id: 'page.extensions', title: 'cmd_extensions', category: 'pages', keywords: 'extensions add-ons addons plugins chrome web store puzzle install' },
  { id: 'page.history', title: 'cmd_history', category: 'pages', accelerator: 'CmdOrCtrl+Y' },
  { id: 'page.downloads', title: 'cmd_downloads', category: 'pages', accelerator: 'CmdOrCtrl+Shift+J' },
  { id: 'page.bookmarks', title: 'cmd_bookmarks', category: 'pages', accelerator: 'CmdOrCtrl+Shift+O' },
  { id: 'page.privacy', title: 'cmd_privacy_dashboard', category: 'pages', keywords: 'blocked ai log' },
  { id: 'page.archive', title: 'cmd_archive', category: 'pages', keywords: 'old closed tabs' },
  { id: 'page.memory', title: 'cmd_memory_page', category: 'pages', feature: 'VizullaMemory', keywords: 'recall remembered' },
  { id: 'page.agentLog', title: 'cmd_agent_log', category: 'pages', feature: 'VizullaAgent', keywords: 'action audit' },
  { id: 'page.flags', title: 'cmd_flags', category: 'pages', keywords: 'experiments features' },
  { id: 'page.import', title: 'cmd_import', category: 'pages', keywords: 'chrome firefox edge migrate bookmarks passwords' },
  { id: 'page.about', title: 'cmd_about', category: 'pages', keywords: 'version update' },
  // Ask Settings (P4-BRW-07): change one setting by name. Always confirmed before applying.
  { id: 'settings.set', title: 'cmd_settings_set', category: 'view', destructive: true, feature: 'VizullaNlCommands', args: [{ name: 'key', kind: 'text' }, { name: 'value', kind: 'text' }] },
];

export function findCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}

/** Fuzzy subsequence score: consecutive and word-start matches score higher. 0 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 1;
  if (s.startsWith(q)) return 100 + q.length;
  if (s.includes(q)) return 60 + q.length - s.indexOf(q) * 0.1;
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      score += prev === i - 1 ? 5 : i === 0 || /[\s.\-_/]/.test(s[i - 1]!) ? 4 : 1;
      prev = i;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

/** Ranks commands for a query using the localized title plus keywords. */
export function matchCommands(query: string, titleOf: (c: CommandDef) => string, enabled: (c: CommandDef) => boolean, limit = 8): CommandDef[] {
  return COMMANDS.filter(enabled)
    .map((c) => {
      const title = titleOf(c);
      const s = Math.max(fuzzyScore(query, title), fuzzyScore(query, c.keywords ?? '') * 0.8, fuzzyScore(query, c.id) * 0.5);
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}
