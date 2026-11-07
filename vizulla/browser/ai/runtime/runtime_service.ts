// RuntimeService: the sandboxed on-device AI runtime (Track A). Lazy start, idle
// unload after 5 minutes (AI-08), crash restart + retry (REL-02). The assistant's
// on-device engine and the intent classifier run here, never in the browser process.
import { app, powerMonitor } from 'electron';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import type { BrowserApp } from '../../browser_app';
import type { AssistantService } from '../assistant_service';
import { UtilityHost } from '../../utility/utility_host';
import { deviceProfile, ModelManager } from './model_manager';
import { kVizullaLocalRuntime } from '../../vizulla_features';
import type { Chunk } from '../context/chunker';
import type { Task } from '../context/prompt';

export class RuntimeService {
  readonly host: UtilityHost;
  readonly models: ModelManager;
  profile = deviceProfile({ totalMemBytes: totalmem(), cpus: cpus().length, arch: process.arch });

  constructor(private readonly app: BrowserApp, assistant: AssistantService) {
    this.host = new UtilityHost({ modulePath: app.joinOut('utility', 'ai_runtime.js'), serviceName: 'Vizulla AI Runtime', idleMs: Number(process.env.VZ_RUNTIME_IDLE_MS ?? 5 * 60_000), timeoutMs: 30_000 });
    this.models = new ModelManager(join(app.profile.dir, 'Models'));
    app.profile.register('runtime', this, () => this.host.unload());
    void app_gpu().then((gpu) => (this.profile = deviceProfile({ totalMemBytes: totalmem(), cpus: cpus().length, arch: process.arch, gpu })));
    // Memory pressure: drop the runtime (it restarts on the next request).
    powerMonitor.on('suspend', () => this.host.unload());
    if (app.profile.features.isEnabled(kVizullaLocalRuntime)) {
      assistant.local = { run: (task: Task, chunks: Chunk[]) => this.generate(task, chunks), generative: false };
    }
  }

  generate(task: Task, chunks: Chunk[]): Promise<string> {
    return this.host.call<string>('generate', { task, chunks: chunks.map((c) => ({ id: c.id, text: c.text })) });
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.host.call<number[][]>('embed', { texts });
  }

  classify(text: string): Promise<{ label: string; confidence: number }[]> {
    return this.host.call('classify', { text });
  }

  async status() {
    return { running: this.host.running, pid: this.host.pid, stats: this.host.stats, profile: this.profile, detail: this.host.running ? await this.host.call('status') : null };
  }
}

async function app_gpu(): Promise<string> {
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { deviceString?: string; vendorId?: number }[] };
    return info.gpuDevice?.map((d) => d.deviceString ?? '').join(' ') ?? '';
  } catch {
    return '';
  }
}
