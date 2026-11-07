// Generates vizulla/test/data/sample.pdf: a 2-page text PDF for assistant tests.
import { writeFileSync, mkdirSync } from 'node:fs';
const pages = [
  ['Vizulla Field Report', 'Kigali has more than one million residents.', 'The city is known for its clean streets and hills.'],
  ['Transport', 'Moto taxis are the fastest way to cross the city.', 'A typical moto ride costs about 500 Rwandan francs.'],
];
const objs = [];
objs.push('<< /Type /Catalog /Pages 2 0 R >>');
objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
const fontId = 3 + pages.length * 2;
pages.forEach((lines, i) => {
  const content = `BT /F1 14 Tf 72 720 Td ${lines.map((l, k) => `${k ? '0 -24 Td ' : ''}(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ')} ET`;
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
});
objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
let out = '%PDF-1.4\n';
const offsets = [];
objs.forEach((o, i) => {
  offsets.push(out.length);
  out += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = out.length;
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
mkdirSync('vizulla/test/data', { recursive: true });
writeFileSync('vizulla/test/data/sample.pdf', out, 'latin1');
console.log('wrote sample.pdf', out.length, 'bytes');
