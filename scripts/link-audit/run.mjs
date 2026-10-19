// Weekly audit: report suspect links without deleting them, discover new
// government links via IGOD, and propose new entries in a reviewable PR.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runLinkCheck } from './check-links.mjs';
import { runDiscovery } from './discover-sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const safeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

async function main() {
  const repoRoot = process.env.REPO_ROOT || path.resolve(__dirname, '..', '..');
  const candidates = [
    process.env.ENTITIES_DIR && path.resolve(repoRoot, process.env.ENTITIES_DIR),
    path.join(repoRoot, 'site', 'entities'),
    path.join(repoRoot, 'entities'),
  ].filter(Boolean);
  const entitiesRoot = candidates.find((p) => existsSync(p));
  if (!entitiesRoot) throw new Error('Entities directory not found: ' + candidates.join(', '));
  console.log('Using entities folder:', entitiesRoot);
  const stateCodes = JSON.parse(await readFile(path.join(__dirname, 'state-codes.json'), 'utf8'));

  const { suspected, uncertain } = await runLinkCheck(entitiesRoot);
  console.log(`Suspected unavailable: ${suspected.length}; uncertain: ${uncertain.length}; removed: 0`);

  // Existing discovery code checks for duplicate URLs and queues newly
  // discovered government sites in "Newly Added (Needs Review)".
  const { added } = await runDiscovery(entitiesRoot, stateCodes);
  console.log(`New IGOD government links queued for review: ${added.length}`);

  const lines = [
    '## Weekly government link audit',
    '',
    '**No existing links were removed automatically.** Suspected failures require manual verification.',
    '',
    `### New government links: ${added.length} (review before merging)`,
    '',
  ];
  if (added.length) {
    lines.push('New links were discovered through [IGOD](https://igod.gov.in) and placed in **Newly Added (Needs Review)**. Verify the URL and category before merging.', '');
    lines.push('| State | Title | URL |', '|---|---|---|');
    for (const a of added) lines.push(`| ${safeCell(a.state)} | ${safeCell(a.title)} | ${safeCell(a.url)} |`);
  } else lines.push('No new government links discovered this run.');

  lines.push('', `### Potentially unavailable links: ${suspected.length} (retained)`, '');
  if (suspected.length) {
    lines.push('These responses may be temporary or bot-specific. Check manually; none were deleted.', '');
    lines.push('| State | Category | Title | URL | Reason |', '|---|---|---|---|---|');
    for (const r of suspected) lines.push(`| ${safeCell(r.state)} | ${safeCell(r.category)} | ${safeCell(r.title)} | ${safeCell(r.url)} | ${safeCell(r.reason)} |`);
  } else lines.push('No potentially unavailable links flagged.');

  lines.push('', `<details><summary>Uncertain link checks: ${uncertain.length} (retained)</summary>`, '');
  if (uncertain.length) {
    lines.push('| State | Category | Title | URL | Reason |', '|---|---|---|---|---|');
    for (const r of uncertain) lines.push(`| ${safeCell(r.state)} | ${safeCell(r.category)} | ${safeCell(r.title)} | ${safeCell(r.url)} | ${safeCell(r.reason)} |`);
  } else lines.push('None.');
  lines.push('', '</details>', '');

  await writeFile(path.join(repoRoot, 'link-audit-summary.md'), lines.join('\n'), 'utf8');
  if (process.env.GITHUB_OUTPUT) {
    // Only new links modify repository data. Link failures never trigger PRs.
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${added.length > 0}\n`);
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
