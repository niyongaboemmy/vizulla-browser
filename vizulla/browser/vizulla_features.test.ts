import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, FeatureList, kVizullaAgent, kVizullaAgentStageB, kVizullaSpaces, parseFeatureSwitches } from './vizulla_features';

describe('feature flags (handbook §7)', () => {
  it('every flag is named kVizulla*, has an owner and a removal date', () => {
    for (const f of ALL_FEATURES) {
      expect(f.name.startsWith('Vizulla')).toBe(true);
      expect(f.owner).toMatch(/^(PLT|BRW|AI|SEC|CLD|REL|UX|PM)$/);
      expect(f.removeBy).toMatch(/^\d{4}-\d{2}$/);
    }
  });
  it('agent code is off by default before G5 (P5-PLT-01)', () => {
    const f = new FeatureList();
    expect(f.isEnabled(kVizullaAgent)).toBe(false);
    expect(f.isEnabled(kVizullaAgentStageB)).toBe(false);
  });
  it('precedence: command line > seed > user', () => {
    const f = new FeatureList({ user: { VizullaSpaces: false }, seed: { VizullaSpaces: true } });
    expect(f.isEnabled(kVizullaSpaces)).toBe(true);
    f.update({ commandLine: parseFeatureSwitches(['--disable-features=VizullaSpaces']) });
    expect(f.isEnabled(kVizullaSpaces)).toBe(false);
  });
  it('a remote kill switch beats a user opt-in; Stage B needs Stage A', () => {
    const f = new FeatureList({ user: { VizullaAgent: true, VizullaAgentStageB: true }, seed: { VizullaAgent: false } });
    expect(f.isEnabled(kVizullaAgent)).toBe(false);
    expect(f.isEnabled(kVizullaAgentStageB)).toBe(false);
  });
});
