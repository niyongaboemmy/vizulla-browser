import { defineInterface, v } from './schema';

export const AgentInterface = defineInterface('Agent', {
  getState: [],
  start: [v.string({ min: 3, max: 500 }), v.record(v.string({ max: 300 }), { maxKeys: 20 })],
  control: [v.literal('pause', 'resume', 'takeover', 'stop')],
});

export interface AgentStepView {
  label: string;
  origin: string;
  tier: number;
  state: 'pending' | 'active' | 'done';
}

export interface AgentTaskView {
  id: string;
  goal: string;
  status: 'planning' | 'awaiting-approval' | 'running' | 'paused' | 'awaiting-confirmation' | 'done' | 'stopped' | 'failed';
  steps: AgentStepView[];
  log: { at: number; kind: string; summary: string; verdict: string | null }[];
  session: 'isolated' | 'grant';
  planner: string;
  message: string | null;
}

export interface AgentPanelState {
  available: boolean;
  reason: string | null;
  stageB: boolean;
  task: AgentTaskView | null;
}
