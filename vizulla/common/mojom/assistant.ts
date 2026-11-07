import { defineInterface, v } from './schema';

export const AssistantInterface = defineInterface('Assistant', {
  getState: [],
  summarize: [v.literal('tldr', 'key-points', 'outline')],
  ask: [v.string({ min: 1, max: 4000 })],
  /** R2 multi-tab synthesis: up to 20 tabs (PA-05). */
  compare: [v.array(v.int({ min: 0 }), { max: 20 }), v.string({ max: 4000 })],
  revealCitation: [v.id(), v.string({ max: 32, pattern: /^[a-z0-9]+$/ })],
  escalate: [v.id()],
  stop: [],
  clear: [],
  sendToNotes: [v.id()],
});

export type MessageRole = 'user' | 'assistant';
export interface CitationRef {
  id: string;
  label: string;
  page?: number;
  tabId?: number;
  title?: string;
}
export interface AssistantMessage {
  id: string;
  role: MessageRole;
  text: string;
  citations: CitationRef[];
  status: 'streaming' | 'done' | 'error' | 'stopped';
  sourcing?: 'sourced' | 'partially-sourced' | 'unsourced';
  location?: 'on-device' | 'cloud';
  provider?: string;
  model?: string;
  error?: string;
  canEscalate?: boolean;
}
export interface AssistantState {
  tabId: number | null;
  url: string;
  title: string;
  mode: string;
  provider: string;
  location: 'on-device' | 'cloud' | 'off';
  busy: boolean;
  messages: AssistantMessage[];
  pageKind: 'html' | 'pdf' | 'internal' | 'none';
  notice?: string;
}
