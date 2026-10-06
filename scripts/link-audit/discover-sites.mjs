// Cross-references each state's IGOD department listing against what's
// already in that state's links.json, and appends anything genuinely new
// into a clearly-labeled "Newly Added (Needs Review)" category — sorted
// alphabetically, with an auto-generated description and icon — so a human
// only has to re-file each one into the right existing category (or leave
// it) before merging the PR, rather than write it from scratch.

import path from 'node:path';
import {
  listEntityDirs,
  loadLinksJson,
  saveLinksJson,
  collectExistingUrls,
  normalizeUrl,
  writeIcon,
  sortCategoryAlphabetically,
} from './lib/data.mjs';
import { discoverStateDepartments } from './lib/igod.mjs';

const REVIEW_CATEGORY = 'Newly Added (Needs Review)';

export async function runDiscovery(entitiesRoot, stateCodes) {
  const stateDirs = await listEntityDirs(entitiesRoot);
  const added = []; // { state, title, url }

  for (const stateDir of stateDirs) {
    const code = stateCodes[stateDir];
    if (!code) continue; // no IGOD mapping for this entity (e.g. Pan-India)

    const loaded = await loadLinksJson(entitiesRoot, stateDir);
    if (!loaded) continue;
    const { file, data } = loaded;

    let departments;
    try {
      departments = await discoverStateDepartments(code);
    } catch (err) {
      console.error(`IGOD lookup failed for ${stateDir} (${code}): ${err.message}`);
      continue;
    }
    if (!departments.length) continue;

    const existingUrls = collectExistingUrls(data);
    const newOnes = departments.filter((d) => !existingUrls.has(normalizeUrl(d.url)));
    if (!newOnes.length) continue;

    data.stateWebsites = data.stateWebsites || {};
    const bucket = (data.stateWebsites[REVIEW_CATEGORY] = data.stateWebsites[REVIEW_CATEGORY] || []);
    const alreadyQueued = new Set(bucket.map((it) => normalizeUrl(it.url)));

    for (const dept of newOnes) {
      const norm = normalizeUrl(dept.url);
      if (alreadyQueued.has(norm)) continue; // duplicate discovery within this same run
      alreadyQueued.add(norm);
      const image = await writeIcon(entitiesRoot, stateDir, dept.title, '🏛️');
      bucket.push({
        title: dept.title,
        url: dept.url,
        desc: `Official site of ${dept.title}, found via India's Integrated Government Online Directory (IGOD). Description and category are auto-generated — please review before publishing.`,
        image,
      });
      added.push({ state: stateDir, title: dept.title, url: dept.url });
    }

    sortCategoryAlphabetically(bucket);
    await saveLinksJson(file, data);
  }

  return { added };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entitiesRoot = process.argv[2] || path.join(process.cwd(), 'site', 'entities');
  const stateCodesPath = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), 'state-codes.json');
  const stateCodes = JSON.parse(await (await import('node:fs/promises')).readFile(stateCodesPath, 'utf8'));
  const { added } = await runDiscovery(entitiesRoot, stateCodes);
  console.log(`Found ${added.length} new site(s).`);
  added.forEach((a) => console.log(`  - [${a.state}] ${a.title} (${a.url})`));
}
