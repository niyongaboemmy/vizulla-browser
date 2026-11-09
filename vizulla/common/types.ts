// Data shapes shared between the browser process and WebUI. Plain JSON only.

export type SpaceColor = 'indigo' | 'teal' | 'amber' | 'rose' | 'violet' | 'emerald' | 'sky' | 'slate';
export const SPACE_COLORS: readonly SpaceColor[] = ['indigo', 'teal', 'amber', 'rose', 'violet', 'emerald', 'sky', 'slate'];
export const SPACE_ICONS = ['briefcase', 'book', 'home', 'star', 'code', 'heart', 'globe', 'music', 'cart', 'flask'] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];

export interface SpaceInfo {
  id: string;
  name: string;
  color: SpaceColor;
  icon: SpaceIcon;
  order: number;
}

/** How the URL field shows the connection. URL display is security UI (CMD-01). */
export type SecurityState = 'secure' | 'insecure' | 'internal' | 'file' | 'dangerous' | 'none';

export interface TabInfo {
  id: number;
  spaceId: string;
  groupId: string | null;
  title: string;
  url: string;
  displayUrl: string;
  favicon: string | null;
  pinned: boolean;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  /** Discarded tabs keep their place but hold no renderer (TAB-07). */
  discarded: boolean;
  security: SecurityState;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
  /** Toolbar key button: saved logins for this origin, and whether the page has a password field. */
  passwords: { logins: number; form: boolean };
  lastActive: number;
  isPdf: boolean;
  /** Set for tabs driven by the agent (Stage A: isolated session). */
  agent: boolean;
  zoom: number;
}

export interface GroupInfo {
  id: string;
  spaceId: string;
  title: string;
  color: SpaceColor;
  collapsed: boolean;
  aiGenerated: boolean;
}

export type PanelKind = 'assistant' | 'notes' | 'agent';
export type TabLayout = 'vertical' | 'horizontal';

export interface ToastInfo {
  id: string;
  text: string;
  action?: { label: string; command: string };
}

export interface AgentBarState {
  taskId: string;
  goal: string;
  status: 'planning' | 'awaiting-approval' | 'running' | 'paused' | 'awaiting-confirmation' | 'done' | 'stopped' | 'failed';
  stepIndex: number;
  stepCount: number;
  stepLabel: string;
  session: 'isolated' | 'grant';
  grantOrigin?: string;
  grantExpiresAt?: number;
}

export interface WindowState {
  windowId: number;
  spaces: SpaceInfo[];
  activeSpaceId: string;
  tabs: TabInfo[];
  groups: GroupInfo[];
  activeTabId: number | null;
  /** Second pane of split view (TAB-06), shown beside the active tab. */
  splitTabId: number | null;
  layout: TabLayout;
  classic: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  panel: PanelKind | null;
  panelWidth: number;
  toasts: ToastInfo[];
  archiveCount: number;
  asleepCount: number;
  agent: AgentBarState | null;
  platform: NodeJS.Platform | string;
  locale: string;
  theme: ThemePref;
  accent: SpaceColor;
  density: 'comfortable' | 'compact';
  aiMode: AiMode;
  features: Record<string, boolean>;
  fullscreen: boolean;
  /** The frame is translucent over a system material (macOS vibrancy, Windows 11 Mica). */
  glass: boolean;
  /** Extensions pinned to the toolbar, how many are loaded, and the tab their buttons act on. */
  extensions: { pinned: string[]; count: number; activeWcId: number | null };
  /** Classic mode only: the bookmarks bar (first folder level). */
  bookmarks: { url: string; title: string }[];
  /** This window's profile (toolbar avatar). `count` is how many profiles exist. */
  profile: { id: string; name: string; color: string; count: number };
  /** Shown as the toolbar update button when a newer release exists. */
  update: UpdateInfo | null;
}

export interface UpdateInfo {
  status: 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  version: string;
  /** 0–100 while downloading. */
  percent: number;
  notesUrl: string;
  error?: string;
}

export type ThemePref = 'system' | 'light' | 'dark' | 'high-contrast';
export type AiMode = 'off' | 'cloud' | 'byo' | 'local';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SuggestionKind = 'url' | 'search' | 'tab' | 'history' | 'bookmark' | 'command' | 'ask' | 'memory' | 'archive' | 'nl-command' | 'destination' | 'scope';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  /** Shortcut hint shown on command rows. */
  shortcut?: string;
  icon?: string;
  favicon?: string | null;
  section: 'top' | 'tabs' | 'browser' | 'commands' | 'memory' | 'history' | 'search' | 'ai';
  /** Commands that change data are marked so the UI can show a confirmation affordance. */
  destructive?: boolean;
}

export interface CommandBarResult {
  input: string;
  route: 'navigate' | 'command' | 'ask' | 'search' | 'empty';
  /** Interpretation chips (R2 intent classifier). Empty in R1. */
  chips: { label: string; route: string; confidence: number }[];
  suggestions: Suggestion[];
  elapsedMs: number;
}
