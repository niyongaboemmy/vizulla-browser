// Interfaces between browser-owned WebUI surfaces and the browser process.
// Shell: the window chrome (vizulla://chrome). Overlay: browser-owned popups
// above page content (vizulla://overlay). Events flow back over `vz:event`.
import { defineInterface, v } from './schema';

const tabId = v.int({ min: 0, max: 2 ** 31 });
const rect = v.object({ x: v.number(), y: v.number(), width: v.number({ min: 0 }), height: v.number({ min: 0 }) });
const point = v.object({ x: v.number(), y: v.number() });
const color = v.literal('indigo', 'teal', 'amber', 'rose', 'violet', 'emerald', 'sky', 'slate');
const icon = v.literal('briefcase', 'book', 'home', 'star', 'code', 'heart', 'globe', 'music', 'cart', 'flask');
const spaceInput = v.object({ name: v.optional(v.string({ max: 40 })), color: v.optional(color), icon: v.optional(icon) });

export const ShellInterface = defineInterface('Shell', {
  getState: [],
  newTab: [v.optional(v.string({ max: 8192 }))],
  closeTab: [tabId],
  activateTab: [tabId],
  navigate: [tabId, v.string({ max: 8192 })],
  goBack: [tabId],
  goForward: [tabId],
  reload: [tabId, v.optional(v.bool())],
  stop: [tabId],
  setPinned: [tabId, v.bool()],
  setMuted: [tabId, v.bool()],
  moveTab: [tabId, v.int({ min: 0, max: 100000 }), v.optional(v.string({ max: 64 }))],
  moveTabToSpace: [tabId, v.id()],
  showTabMenu: [tabId, v.optional(point)],
  showSpaceMenu: [v.id(), v.optional(point)],
  showAppMenu: [v.optional(point)],
  switchSpace: [v.id()],
  createSpace: [v.optional(spaceInput)],
  editSpace: [v.id()],
  updateSpace: [v.id(), spaceInput],
  deleteSpace: [v.id()],
  reorderSpaces: [v.array(v.id(), { max: 50 })],
  createGroup: [v.array(tabId, { max: 500 }), v.optional(v.string({ max: 60 }))],
  updateGroup: [v.id(), v.object({ title: v.optional(v.string({ max: 60 })), color: v.optional(color), collapsed: v.optional(v.bool()) })],
  ungroup: [v.id()],
  setContentBounds: [rect, v.optional(rect)],
  setSidebar: [v.object({ collapsed: v.optional(v.bool()), width: v.optional(v.int({ min: 180, max: 480 })) })],
  setPanel: [v.optional(v.literal('assistant', 'notes', 'agent')), v.optional(v.int({ min: 300, max: 760 }))],
  openCommandBar: [v.literal('palette', 'address', 'tab-search', 'ask'), v.optional(rect)],
  runCommand: [v.string({ max: 64 }), v.optional(v.json({ maxBytes: 4096 }))],
  dismissToast: [v.id()],
  toastAction: [v.id()],
  find: [tabId, v.string({ max: 500 }), v.object({ forward: v.bool(), findNext: v.bool() })],
  stopFind: [tabId],
  restoreArchived: [v.int({ min: 0 })],
  openShieldsPanel: [rect],
  windowControl: [v.literal('minimize', 'maximize', 'close')],
  agentControl: [v.literal('pause', 'resume', 'takeover', 'stop')],
});

export const OverlayInterface = defineInterface('Overlay', {
  ready: [],
  getState: [],
  runCommand: [v.string({ max: 64 })],
  close: [v.optional(v.json({ maxBytes: 65536 }))],
  // Command Bar
  query: [v.string({ max: 2048 }), v.literal('palette', 'address', 'tab-search', 'ask')],
  accept: [v.string({ max: 2048 }), v.optional(v.string({ max: 128 })), v.object({ newTab: v.optional(v.bool()), route: v.optional(v.string({ max: 32 })) })],
  // Dialog results
  dialogResult: [v.id(), v.json({ maxBytes: 65536 })],
  // Shields panel
  setShieldsForSite: [v.bool()],
});

/** Generic page handler for vizulla:// pages: each method is host-checked in the browser. */
export const PagesInterface = defineInterface('Pages', {
  getInitialData: [],
  invoke: [v.string({ max: 64, pattern: /^[a-zA-Z][\w.]*$/ }), v.optional(v.json({ maxBytes: 262144 }))],
});
