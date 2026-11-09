// Profile preferences: one typed schema with defaults. Renderers never read prefs
// directly (handbook §5); WebUI pages get the subset their PageHandler exposes.
import type { AiMode, SpaceColor, TabLayout, ThemePref } from '@vz/common/types';
import { isValidEngineTemplate, type CustomEngine, type SearchEngineId } from '@vz/common/url';

export type ProviderId = 'gateway' | 'anthropic' | 'openai' | 'google' | 'openai-compatible' | 'local';

export interface Prefs {
  'appearance.theme': ThemePref;
  'appearance.accent': SpaceColor;
  'appearance.density': 'comfortable' | 'compact';
  'appearance.locale': 'auto' | 'en' | 'fr' | 'rw' | 'sw' | 'pseudo';
  'appearance.defaultZoom': number;
  'tabs.layout': TabLayout;
  'tabs.classic': boolean;
  'tabs.sidebarWidth': number;
  'tabs.sidebarCollapsed': boolean;
  'tabs.panelWidth': number;
  'tabs.archiveEnabled': boolean;
  'tabs.archiveAfterHours': number;
  'tabs.archiveRetentionDays': number;
  'tabs.memorySaverMinutes': number;
  'tabs.discardExemptSites': string[];
  'tabs.restoreOnStartup': boolean;
  'updates.autoCheck': boolean;
  'passwords.offerToSave': boolean;
  'passwords.neverSave': string[];
  /** Extension IDs turned off (kept installed, not loaded). */
  /** Ads are blocked by default (Vizulla is ad-free); off shows ads everywhere, trackers stay blocked. */
  /** Search suggestions from the search engine while typing (never in private windows). */
  'search.suggestions': boolean;
  /** Local MCP server for AI coding tools (off by default). */
  'dev.mcp': boolean;
  'dev.mcpToken': string;
  'dev.mcpPort': number;
  /** Tools (MCP client names) the user allowed. */
  'dev.mcpClients': string[];
  'shields.blockAds': boolean;
  /** Sites where the user chose to see ads (trackers stay blocked). */
  'shields.adsAllowedSites': string[];
  'extensions.disabled': string[];
  /** Extension IDs shown as toolbar buttons (the rest live in the puzzle menu). */
  'extensions.pinned': string[];
  /** Folders loaded with "Load unpacked" (developer mode). */
  'extensions.unpacked': string[];
  'extensions.devMode': boolean;
  'search.engine': SearchEngineId;
  'search.custom': CustomEngine | null;
  'search.chosen': boolean;
  'shields.enabled': boolean;
  'shields.aggressive': boolean;
  'shields.siteExceptions': string[];
  'shields.blockThirdPartyCookies': boolean;
  'shields.httpsFirst': boolean;
  'shields.doh': 'off' | 'automatic' | 'secure';
  'shields.dohProvider': string;
  'shields.fingerprinting': 'off' | 'standard' | 'strict';
  'shields.cookieBanners': boolean;
  'ai.mode': AiMode;
  'ai.provider': ProviderId;
  'ai.models': Partial<Record<ProviderId, string>>;
  'ai.compatBaseUrl': string;
  'ai.gatewayUrl': string;
  'ai.disclosedSites': string[];
  'ai.saveConversations': boolean;
  'ai.answerLanguage': 'auto' | 'en' | 'fr' | 'rw' | 'sw';
  'memory.enabled': boolean;
  'memory.excludedSites': string[];
  'memory.retentionDays': number;
  'memory.indexOnBattery': boolean;
  'privacy.telemetry': boolean;
  /** Private windows can't be captured by screenshots or screen recording. */
  'privacy.privateCaptureProtection': boolean;
  /** macOS: hide private windows when Vizulla is in the background until Touch ID. */
  'privacy.lockPrivate': boolean;
  'privacy.crashReports': boolean;
  'privacy.logRetentionDays': number;
  'onboarding.completed': boolean;
  'agent.testerOptIn': boolean;
  'agent.grantMinutes': number;
  'sync.enabled': boolean;
  'sync.serverUrl': string;
  'sync.deviceName': string;
  'sync.types': string[];
  'downloads.askWhere': boolean;
  'flags.user': Record<string, boolean>;
  /** Schema version of the stored prefs (prefs_service.ts migrations). Not user-writable. */
  'prefs.version': number;
}

export const DEFAULT_PREFS: Prefs = {
  'appearance.theme': 'system',
  'appearance.accent': 'indigo',
  'appearance.density': 'comfortable',
  'appearance.locale': 'auto',
  'appearance.defaultZoom': 1,
  'tabs.layout': 'horizontal',
  'tabs.classic': false,
  'tabs.sidebarWidth': 264,
  'tabs.sidebarCollapsed': false,
  'tabs.panelWidth': 380,
  'tabs.archiveEnabled': true,
  'tabs.archiveAfterHours': 12,
  'tabs.archiveRetentionDays': 30,
  'tabs.memorySaverMinutes': 30,
  'tabs.discardExemptSites': [],
  'tabs.restoreOnStartup': true,
  'updates.autoCheck': true,
  'passwords.offerToSave': true,
  'passwords.neverSave': [],
  'search.suggestions': true,
  'dev.mcp': false,
  'dev.mcpToken': '',
  'dev.mcpPort': 39457,
  'dev.mcpClients': [],
  'shields.blockAds': true,
  'shields.adsAllowedSites': [],
  'extensions.disabled': [],
  'extensions.pinned': [],
  'extensions.unpacked': [],
  'extensions.devMode': false,
  'search.engine': 'duckduckgo',
  'search.custom': null,
  'search.chosen': false,
  'shields.enabled': true,
  'shields.aggressive': false,
  'shields.siteExceptions': [],
  'shields.blockThirdPartyCookies': true,
  'shields.httpsFirst': true,
  'shields.doh': 'automatic',
  'shields.dohProvider': 'https://cloudflare-dns.com/dns-query',
  'shields.fingerprinting': 'standard',
  'shields.cookieBanners': true,
  'ai.mode': 'local',
  'ai.provider': 'local',
  'ai.models': {
    gateway: 'claude-haiku-5-5',
    anthropic: 'claude-sonnet-5-5',
    openai: 'gpt-5-mini',
    google: 'gemini-2.5-flash',
    'openai-compatible': 'llama3.2',
    local: 'vz-extractive-1',
  },
  'ai.compatBaseUrl': 'http://localhost:11434/v1',
  'ai.gatewayUrl': 'http://localhost:8787',
  'ai.disclosedSites': [],
  'ai.saveConversations': false,
  'ai.answerLanguage': 'auto',
  'memory.enabled': false,
  'memory.excludedSites': [],
  'memory.retentionDays': 90,
  'memory.indexOnBattery': false,
  'privacy.telemetry': false,
  'privacy.privateCaptureProtection': true,
  'privacy.lockPrivate': false,
  'privacy.crashReports': false,
  'privacy.logRetentionDays': 30,
  'onboarding.completed': false,
  'agent.testerOptIn': false,
  'agent.grantMinutes': 30,
  'sync.enabled': false,
  'sync.serverUrl': 'http://localhost:8788',
  'sync.deviceName': '',
  'sync.types': ['spaces', 'bookmarks', 'history', 'settings', 'tabs'],
  'downloads.askWhere': false,
  'flags.user': {},
  'prefs.version': 1,
};

export type PrefKey = keyof Prefs;

/** Prefs a WebUI settings page may write, with validation. Anything else is rejected. */
export const WRITABLE_PREFS: Partial<Record<PrefKey, (v: unknown) => boolean>> = {
  'appearance.theme': (v) => ['system', 'light', 'dark', 'high-contrast'].includes(v as string),
  'appearance.accent': (v) => ['indigo', 'teal', 'amber', 'rose', 'violet', 'emerald', 'sky', 'slate'].includes(v as string),
  'appearance.density': (v) => v === 'comfortable' || v === 'compact',
  'appearance.locale': (v) => ['auto', 'en', 'fr', 'rw', 'sw', 'pseudo'].includes(v as string),
  'appearance.defaultZoom': (v) => typeof v === 'number' && v >= 0.5 && v <= 3,
  'tabs.layout': (v) => v === 'vertical' || v === 'horizontal',
  'tabs.classic': (v) => typeof v === 'boolean',
  'tabs.archiveEnabled': (v) => typeof v === 'boolean',
  'tabs.archiveAfterHours': (v) => typeof v === 'number' && v >= 1 && v <= 24 * 30,
  'tabs.memorySaverMinutes': (v) => typeof v === 'number' && v >= 0 && v <= 24 * 60,
  'tabs.restoreOnStartup': (v) => typeof v === 'boolean',
  'updates.autoCheck': (v) => typeof v === 'boolean',
  'passwords.offerToSave': (v) => typeof v === 'boolean',
  'passwords.neverSave': (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && x.length <= 512),
  'search.engine': (v) => ['duckduckgo', 'google', 'bing', 'brave', 'startpage', 'ecosia', 'qwant', 'custom'].includes(v as string),
  'search.custom': (v) => v === null || (typeof v === 'object' && typeof (v as CustomEngine).name === 'string' && (v as CustomEngine).name.trim().length > 0 && (v as CustomEngine).name.length <= 40 && isValidEngineTemplate((v as CustomEngine).url)),
  'search.chosen': (v) => typeof v === 'boolean',
  'shields.enabled': (v) => typeof v === 'boolean',
  'shields.aggressive': (v) => typeof v === 'boolean',
  'shields.blockThirdPartyCookies': (v) => typeof v === 'boolean',
  'shields.httpsFirst': (v) => typeof v === 'boolean',
  'shields.doh': (v) => ['off', 'automatic', 'secure'].includes(v as string),
  'shields.fingerprinting': (v) => ['off', 'standard', 'strict'].includes(v as string),
  'shields.cookieBanners': (v) => typeof v === 'boolean',
  'shields.blockAds': (v) => typeof v === 'boolean',
  'search.suggestions': (v) => typeof v === 'boolean',
  'dev.mcp': (v) => typeof v === 'boolean',
  'ai.mode': (v) => ['off', 'cloud', 'byo', 'local'].includes(v as string),
  'ai.provider': (v) => ['gateway', 'anthropic', 'openai', 'google', 'openai-compatible', 'local'].includes(v as string),
  'ai.compatBaseUrl': (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v) && v.length < 300,
  'ai.gatewayUrl': (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v) && v.length < 300,
  'ai.saveConversations': (v) => typeof v === 'boolean',
  'ai.answerLanguage': (v) => ['auto', 'en', 'fr', 'rw', 'sw'].includes(v as string),
  'memory.enabled': (v) => typeof v === 'boolean',
  'memory.retentionDays': (v) => typeof v === 'number' && v >= 1 && v <= 3650,
  'memory.indexOnBattery': (v) => typeof v === 'boolean',
  'privacy.telemetry': (v) => typeof v === 'boolean',
  'privacy.privateCaptureProtection': (v) => typeof v === 'boolean',
  'privacy.lockPrivate': (v) => typeof v === 'boolean',
  'privacy.crashReports': (v) => typeof v === 'boolean',
  'onboarding.completed': (v) => typeof v === 'boolean',
  'agent.testerOptIn': (v) => typeof v === 'boolean',
  'agent.grantMinutes': (v) => typeof v === 'number' && v >= 5 && v <= 120,
  'sync.serverUrl': (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v) && v.length < 300,
  'sync.deviceName': (v) => typeof v === 'string' && v.length <= 60,
  'downloads.askWhere': (v) => typeof v === 'boolean',
};
