// Orchestrates the weekly audit: dead-link removal, then new-site
// discovery, then writes a markdown summary the workflow uses as the PR
// body. Exits 0 with GITHUB_OUTPUT "changed=true"/"false" so the workflow
// knows whether to open a PR at all.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';
import { runLinkCheck } from './check-links.mjs';
import { runDiscovery } from './discover-sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const repoRoot = process.env.REPO_ROOT || path.resolve(__dirname, '..', '..');
  // Works whether the data lives at <repo>/site/entities or <repo>/entities;
  // set ENTITIES_DIR to override.
  const candidates = [
    process.env.ENTITIES_DIR && path.resolve(repoRoot, process.env.ENTITIES_DIR),
    path.join(repoRoot, 'site', 'entities'),
    path.join(repoRoot, 'entities'),
  ].filter(Boolean);
  const entitiesRoot = candidates.find((c) => existsSync(c));
  if (!entitiesRoot) {
    throw new Error('Could not find the entities folder. Looked in: ' + candidates.join(', '));
  }
  console.log('Using entities folder:', entitiesRoot);
  const stateCodes = JSON.parse(await readFile(path.join(__dirname, 'state-codes.json'), 'utf8'));

  console.log('--- Checking existing links for dead URLs ---');
  const { removed, uncertain } = await runLinkCheck(entitiesRoot);
  console.log(`Removed: ${removed.length}, uncertain (left alone): ${uncertain.length}`);

  console.log('--- Discovering new government sites via IGOD ---');
  const { added } = await runDiscovery(entitiesRoot, stateCodes);
  console.log(`Added: ${added.length}`);

  const changed = removed.length > 0 || added.length > 0;

  const lines = [];
  lines.push('## Weekly link audit');
  lines.push('');
  if (!changed) {
    lines.push('No dead links found and no new government sites discovered this week.');
  } else {
    if (removed.length) {
      lines.push(`### Removed ${removed.length} dead link(s)`);
      lines.push('');
      lines.push('| State | Category | Title | URL | Reason |');
      lines.push('|---|---|---|---|---|');
      for (const r of removed) {
        lines.push(`| ${r.state} | ${r.category} | ${r.title} | ${r.url} | ${r.reason} |`);
      }
      lines.push('');
    } else {
      lines.push('### No links needed removing');
      lines.push('');
    }
    if (added.length) {
      lines.push(`### Added ${added.length} newly-discovered site(s) — needs human review`);
      lines.push('');
      lines.push(
        'These were found via [IGOD](https://igod.gov.in) and filed under a **"Newly Added (Needs Review)"** category in each state\'s `links.json`, with an auto-generated description and icon. Please re-file each into the right existing category (or edit/remove it) before merging.'
      );
      lines.push('');
      lines.push('| State | Title | URL |');
      lines.push('|---|---|---|');
      for (const a of added) {
        lines.push(`| ${a.state} | ${a.title} | ${a.url} |`);
      }
      lines.push('');
    }
    if (uncertain.length) {
      lines.push(`<details><summary>${uncertain.length} link(s) could not be confirmed either way this run (left untouched)</summary>`);
      lines.push('');
      lines.push('| State | Title | URL | Reason |');
      lines.push('|---|---|---|---|');
      for (const u of uncertain) {
        lines.push(`| ${u.state} | ${u.title} | ${u.url} | ${u.reason} |`);
      }
      lines.push('');
      lines.push('</details>');
    }
  }

  const summaryPath = path.join(repoRoot, 'link-audit-summary.md');
  await writeFile(summaryPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Summary written to ${summaryPath}`);

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
