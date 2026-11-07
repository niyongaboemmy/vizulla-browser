// Vizulla runtime feature flags (handbook §7).
//
// Every feature is behind a flag until its release gate. Defaults flip at the gate.
// Overrides, in order of precedence: --enable-features / --disable-features on the
// command line, the remote variations seed (kill switches), then the user's
// vizulla://flags toggles.

export type Release = 'R1' | 'R2' | 'R3A' | 'R3B';

export interface FeatureDef {
  name: string;
  release: Release;
  defaultEnabled: boolean;
  owner: string;
  /** Flags are removed within two releases of reaching 100% (handbook §7). */
  removeBy: string;
  description: string;
}

function feature(def: FeatureDef): FeatureDef {
  return def;
}

export const kVizullaVerticalTabs = feature({ name: 'VizullaVerticalTabs', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'Vertical tab list in the sidebar (TAB-01).' });
export const kVizullaSpaces = feature({ name: 'VizullaSpaces', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'Spaces: named sets of tabs and pins (TAB-02).' });
export const kVizullaAutoArchive = feature({ name: 'VizullaAutoArchive', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'Archive idle unpinned tabs (TAB-04).' });
export const kVizullaCommandBar = feature({ name: 'VizullaCommandBar', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'Command Bar replaces the omnibox (CMD-01).' });
export const kVizullaShields = feature({ name: 'VizullaShields', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'Ad and tracker blocking (SHD-01).' });
export const kVizullaAssistant = feature({ name: 'VizullaAssistant', release: 'R1', defaultEnabled: true, owner: 'AI', removeBy: '2028-06', description: 'Assistant panel: page/PDF Q&A with citations (PA-01/02).' });
export const kVizullaPrivacyDashboard = feature({ name: 'VizullaPrivacyDashboard', release: 'R1', defaultEnabled: true, owner: 'BRW', removeBy: '2028-06', description: 'vizulla://privacy (PRV-05).' });

export const kVizullaLocalRuntime = feature({ name: 'VizullaLocalRuntime', release: 'R2', defaultEnabled: true, owner: 'AI', removeBy: '2029-01', description: 'Sandboxed on-device ai_runtime utility process (AI-01).' });
export const kVizullaMemory = feature({ name: 'VizullaMemory', release: 'R2', defaultEnabled: true, owner: 'AI', removeBy: '2029-01', description: 'Opt-in Memory: encrypted local index of visited pages (MEM-01). Still off until the user opts in.' });
export const kVizullaNotes = feature({ name: 'VizullaNotes', release: 'R2', defaultEnabled: true, owner: 'BRW', removeBy: '2029-01', description: 'Notes panel with source-linked clips (MEM-06).' });
export const kVizullaMultiTab = feature({ name: 'VizullaMultiTab', release: 'R2', defaultEnabled: true, owner: 'AI', removeBy: '2029-01', description: 'Multi-tab synthesis (PA-05).' });
export const kVizullaNlCommands = feature({ name: 'VizullaNlCommands', release: 'R2', defaultEnabled: true, owner: 'BRW', removeBy: '2029-01', description: 'Natural-language commands mapped onto the command registry (CMD-05).' });
export const kVizullaSync = feature({ name: 'VizullaSync', release: 'R2', defaultEnabled: true, owner: 'CLD', removeBy: '2029-01', description: 'End-to-end encrypted sync (SYN-01).' });

// Agent code must not be on by default before G5 (P5-PLT-01). It is opt-in for testers.
export const kVizullaAgent = feature({ name: 'VizullaAgent', release: 'R3A', defaultEnabled: false, owner: 'AI', removeBy: '2029-12', description: 'Supervised Task Agent, Stage A: isolated session, navigate and interact (AGT-01..03).' });
export const kVizullaAgentStageB = feature({ name: 'VizullaAgentStageB', release: 'R3B', defaultEnabled: false, owner: 'SEC', removeBy: '2030-06', description: 'Agent Stage B: personal data and commit actions with confirmations (AGT-04, T3/T4).' });
export const kVizullaWebMcp = feature({ name: 'VizullaWebMcp', release: 'R3A', defaultEnabled: false, owner: 'AI', removeBy: '2030-06', description: 'WebMCP tool discovery on plan origins (AI-07, C6).' });

export const ALL_FEATURES: readonly FeatureDef[] = [
  kVizullaVerticalTabs, kVizullaSpaces, kVizullaAutoArchive, kVizullaCommandBar, kVizullaShields,
  kVizullaAssistant, kVizullaPrivacyDashboard, kVizullaLocalRuntime, kVizullaMemory, kVizullaNotes,
  kVizullaMultiTab, kVizullaNlCommands, kVizullaSync, kVizullaAgent, kVizullaAgentStageB, kVizullaWebMcp,
];

export interface FeatureOverrides {
  commandLine?: { enable: string[]; disable: string[] };
  /** Remote kill switches from the signed variations seed. */
  seed?: Record<string, boolean>;
  user?: Record<string, boolean>;
}

export class FeatureList {
  private readonly state = new Map<string, boolean>();

  constructor(private overrides: FeatureOverrides = {}) {
    this.recompute();
  }

  update(overrides: Partial<FeatureOverrides>): void {
    this.overrides = { ...this.overrides, ...overrides };
    this.recompute();
  }

  isEnabled(f: FeatureDef): boolean {
    return this.state.get(f.name) ?? f.defaultEnabled;
  }

  snapshot(): Record<string, boolean> {
    return Object.fromEntries(this.state);
  }

  private recompute(): void {
    const { commandLine, seed = {}, user = {} } = this.overrides;
    for (const f of ALL_FEATURES) {
      let on = f.defaultEnabled;
      if (f.name in user) on = user[f.name]!;
      if (f.name in seed) on = seed[f.name]!;
      if (commandLine?.enable.includes(f.name)) on = true;
      if (commandLine?.disable.includes(f.name)) on = false;
      this.state.set(f.name, on);
    }
    // Dependent features: Stage B requires Stage A.
    if (!this.state.get(kVizullaAgent.name)) this.state.set(kVizullaAgentStageB.name, false);
  }
}

export function parseFeatureSwitches(argv: readonly string[]): { enable: string[]; disable: string[] } {
  const pick = (prefix: string) =>
    argv.filter((a) => a.startsWith(prefix)).flatMap((a) => a.slice(prefix.length).split(',')).filter(Boolean);
  return { enable: pick('--enable-features='), disable: pick('--disable-features=') };
}
