// `--vz-self-test`: a release smoke check run by CI on the PACKAGED app on every
// OS. It exercises what packaging can break (utility processes, the PDF library,
// bundled resources, keychain) and exits 0 only if everything works.
import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import type { BrowserApp } from '@vz/browser/browser_app';
import type { PhaseServices } from '@vz/browser/services';
import { extractPdf } from '@vz/browser/ai/context/pdf_extract';

function tinyPdf(text: string): Uint8Array {
  const content = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

export async function runSelfTest(browser: BrowserApp, s: PhaseServices): Promise<void> {
  const results: Record<string, string> = {};
  const step = async (name: string, fn: () => Promise<boolean>) => {
    try {
      results[name] = (await fn()) ? 'ok' : 'FAILED';
    } catch (e) {
      results[name] = `FAILED: ${(e as Error).message}`;
    }
  };
  await step('version', async () => !!app.getVersion());
  await step('ai_runtime', async () => {
    const page = ['Rwanda grows Arabica coffee at high altitude.', 'A cappuccino costs about 2,000 Rwandan francs in Kigali.', 'The main harvest runs from March to July.'];
    const chunks = page.map((text, i) => ({ id: `c${i + 1}`, text, headings: [], origin: 'https://selftest.invalid', trust: 'UNTRUSTED_WEB' as const }));
    return (await s.runtime.generate({ kind: 'ask', question: 'How much does a cappuccino cost?' }, chunks)).includes('[c2]');
  });
  await step('intent', async () => (await s.runtime.classify('mute this tab'))[0]?.label === 'command');
  await step('pdf', async () => (await extractPdf(tinyPdf('Vizulla self test page'))).blocks.some((b) => b.text.includes('self test')));
  await step('memory_index', async () => {
    await s.memory.call('add', { kind: 'save', url: 'https://selftest.invalid/', title: 'Self test', visitedAt: Date.now(), chunks: ['Kigali coffee self test'] });
    const hits = (await s.memory.call('search', { query: 'kigali coffee', limit: 1 })) as { url: string }[];
    await s.memory.call('wipe');
    return hits[0]?.url === 'https://selftest.invalid/';
  });
  await step('shields', async () => browser.profile.shields.status(-1, '').engineVersion >= 0);
  await step('webui', async () => browser.pages.hosts.includes('settings') && browser.pages.hosts.includes('newtab'));
  const ok = Object.values(results).every((r) => r === 'ok');
  const line = `VZ_SELF_TEST ${JSON.stringify({ ok, version: app.getVersion(), chromium: process.versions.chrome, results })}\n`;
  process.stdout.write(line);
  // GUI apps on Windows don't reliably expose stdout to CI: also write to a file when asked.
  if (process.env.VZ_SELF_TEST_OUT) writeFileSync(process.env.VZ_SELF_TEST_OUT, line);
  app.exit(ok ? 0 : 1);
}
