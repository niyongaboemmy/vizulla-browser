// Registers the services each phase adds on top of the Phase 1 browser core.
// Each installer checks its own feature flag.
import type { BrowserApp } from './browser_app';
import { AssistantService } from './ai/assistant_service';
import { installReader } from './reader_service';
import { installOnboarding } from './onboarding';
import { RuntimeService } from './ai/runtime/runtime_service';
import { MemoryService } from './memory/memory_service';
import { NotesService } from './notes/notes_service';
import { installAiFeatures } from './ai/ai_features';
import { SyncService } from './sync/sync_service';
import { installPlatformFeatures } from './shields/platform_features';
import { AgentController } from './agent/agent_controller';

export interface PhaseServices {
  assistant: AssistantService;
  runtime: RuntimeService;
  memory: MemoryService;
  notes: NotesService;
  sync: SyncService;
  agent: AgentController;
}

export function installPhaseServices(app: BrowserApp): PhaseServices {
  // Phase 2 (R1): assistant, reader, onboarding.
  const assistant = new AssistantService(app);
  installReader(app, assistant);
  installOnboarding(app);
  // Phase 4 (R2): on-device runtime, Memory, Notes, NL commands, grouping.
  const runtime = new RuntimeService(app, assistant);
  const memory = new MemoryService(app, assistant);
  const notes = new NotesService(app);
  installAiFeatures(app, runtime);
  const sync = new SyncService(app);
  installPlatformFeatures(app);
  // Phases 5-6 (R3): the supervised agent. Off unless the flag and tester opt-in are on.
  const agent = new AgentController(app, assistant);
  return { assistant, runtime, memory, notes, sync, agent };
}
