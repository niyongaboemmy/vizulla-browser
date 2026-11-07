import { describe, expect, it } from 'vitest';
import { route, sensitivityOf, type RouteInput, type TaskKind } from './model_router';

const base: RouteInput = { mode: 'byo', provider: 'anthropic', task: 'qa', sensitivity: 'normal', deviceHasLocalProfile: true, privateWindow: false, compatIsLocal: false, generativeLocalAvailable: false };

describe('ModelRouter (table-driven, P4-AI-05)', () => {
  const modes = ['off', 'local', 'cloud', 'byo'] as const;
  const tasks: TaskKind[] = ['intent', 'group_tabs', 'embed', 'classify', 'short_summary', 'qa', 'summary', 'agent_plan', 'multi_tab_synthesis', 'long_doc_qa', 'selection'];
  for (const mode of modes)
    for (const task of tasks)
      for (const sensitivity of ['normal', 'high'] as const)
        for (const deviceHasLocalProfile of [true, false])
          for (const privateWindow of [false, true]) {
            const r = route({ ...base, mode, task, sensitivity, deviceHasLocalProfile, privateWindow });
            it(`${mode}/${task}/${sensitivity}/${deviceHasLocalProfile ? 'dev' : 'nodev'}/${privateWindow ? 'priv' : 'reg'} → ${r.kind}`, () => {
              expect(r.reason).toBeTruthy();
              if (mode === 'off') expect(r.kind).toBe('refuse');
              // Invariants: sensitive or private never goes to a remote cloud.
              if (mode !== 'off' && (sensitivity === 'high' || privateWindow)) expect(r.kind === 'local' || r.kind === 'refuse').toBe(true);
              // Local-only mode never goes to the cloud.
              if (mode === 'local') expect(r.kind === 'cloud').toBe(false);
              if (r.kind === 'cloud' && mode === 'cloud') expect(r.provider).toBe('gateway');
            });
          }
  it('a localhost OpenAI-compatible endpoint is allowed for sensitive pages in BYO', () => {
    expect(route({ ...base, provider: 'openai-compatible', compatIsLocal: true, sensitivity: 'high' })).toMatchObject({ kind: 'cloud', provider: 'openai-compatible' });
  });
  it('classifies sensitive URLs', () => {
    expect(sensitivityOf('https://www.equitybank.co.rw/')).toBe('high');
    expect(sensitivityOf('https://shop.example/checkout')).toBe('high');
    expect(sensitivityOf('https://news.example/article')).toBe('normal');
    expect(sensitivityOf('not a url')).toBe('high');
  });
});
