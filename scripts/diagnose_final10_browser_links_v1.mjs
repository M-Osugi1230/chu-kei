import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const LINKS_PATH = path.join(ROOT, 'artifacts', 'final10-browser-links-v1.json');
const QUALITY_PATH = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
const INTERNAL_PATTERN = /ir|investor|financial|library|result|report|presentation|document|material|settlement|earnings|決算|説明|資料|経営|統合報告|有価証券|株主|投資家/i;
if (!fs.existsSync(LINKS_PATH) || !fs.existsSync(QUALITY_PATH)) process.exit(0);
const links = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
const quality = JSON.parse(fs.readFileSync(QUALITY_PATH, 'utf8'));
const diagnostics = {};
for (const [code, company] of Object.entries(links.companies || {})) {
  const pdfMap = new Map();
  const internalMap = new Map();
  for (const page of company.pages || []) {
    for (const link of page.links || []) {
      if (/\.pdf(?:$|[?#])/i.test(link.url)) pdfMap.set(link.url, { text: link.text || '', url: link.url, sourcePage: page.url });
      else if (INTERNAL_PATTERN.test(`${link.text} ${link.url}`)) internalMap.set(link.url, { text: link.text || '', url: link.url, sourcePage: page.url });
    }
    for (const response of page.responses || []) {
      if (/pdf/i.test(response.contentType || '') || /\.pdf(?:$|[?#])/i.test(response.url)) pdfMap.set(response.url, { text: 'network response', url: response.url, sourcePage: page.url });
    }
  }
  diagnostics[code] = {
    name: company.name,
    startUrl: company.startUrl,
    pages: (company.pages || []).map(page => ({ url: page.url, title: page.title || '', error: page.error || null, linkCount: (page.links || []).length })),
    pdfLinks: [...pdfMap.values()].slice(0, 300),
    internalLinks: [...internalMap.values()].slice(0, 200),
  };
}
quality.final10ExpandedLinkDiagnostics = { version: 'final10-expanded-link-diagnostics-v1', companies: diagnostics };
fs.writeFileSync(QUALITY_PATH, `${JSON.stringify(quality, null, 2)}\n`);
console.log(JSON.stringify({ companies: Object.keys(diagnostics).length, pdfLinks: Object.values(diagnostics).reduce((sum, row) => sum + row.pdfLinks.length, 0), internalLinks: Object.values(diagnostics).reduce((sum, row) => sum + row.internalLinks.length, 0) }, null, 2));
