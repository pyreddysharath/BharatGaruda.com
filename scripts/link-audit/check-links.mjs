// Walks every entities/*/links.json, checks every url, and removes entries
// that are confidently dead (see lib/check-url.mjs for what counts).
// Mutates the in-memory data + returns a report; the caller decides when to
// write files back to disk.

import path from 'node:path';
import { listEntityDirs, loadLinksJson, saveLinksJson, forEachEntry } from './lib/data.mjs';
import { checkUrl } from './lib/check-url.mjs';

const CONCURRENCY = 6;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runLinkCheck(entitiesRoot) {
  const stateDirs = await listEntityDirs(entitiesRoot);
  const removed = []; // { state, category, title, url, reason }
  const uncertain = []; // reported only, never acted on

  for (const stateDir of stateDirs) {
    const loaded = await loadLinksJson(entitiesRoot, stateDir);
    if (!loaded) continue;
    const { file, data } = loaded;

    // Gather every entry with its url up front so we can check them all
    // concurrently, then remove afterwards (mutating arrays while iterating
    // them is error-prone).
    const entries = [];
    forEachEntry(data, (item, ctx) => {
      if (item && item.url) entries.push({ item, ctx });
    });

    const verdicts = await mapWithConcurrency(entries, CONCURRENCY, async ({ item }) => checkUrl(item.url));

    // Remove dead ones from the back of each array forward so indices
    // already visited don't shift under us.
    const toRemoveByArray = new Map(); // array -> Set(index)
    entries.forEach(({ item, ctx }, i) => {
      const verdict = verdicts[i];
      if (verdict.verdict === 'dead') {
        removed.push({ state: stateDir, category: `${ctx.sectionKey} → ${ctx.category}`, title: item.title, url: item.url, reason: verdict.reason });
        if (!toRemoveByArray.has(ctx.array)) toRemoveByArray.set(ctx.array, new Set());
        toRemoveByArray.get(ctx.array).add(ctx.index);
      } else if (verdict.verdict === 'uncertain') {
        uncertain.push({ state: stateDir, title: item.title, url: item.url, reason: verdict.reason });
      }
    });

    let changed = false;
    for (const [arr, indexSet] of toRemoveByArray) {
      const indices = [...indexSet].sort((a, b) => b - a);
      for (const idx of indices) arr.splice(idx, 1);
      changed = true;
    }

    if (changed) await saveLinksJson(file, data);
  }

  return { removed, uncertain };
}

// Allow running standalone: `node check-links.mjs <entitiesRoot>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const entitiesRoot = process.argv[2] || path.join(process.cwd(), 'site', 'entities');
  const { removed, uncertain } = await runLinkCheck(entitiesRoot);
  console.log(`Removed ${removed.length} dead link(s).`);
  removed.forEach((r) => console.log(`  - [${r.state}] ${r.title} (${r.url}) — ${r.reason}`));
  console.log(`${uncertain.length} link(s) could not be confirmed either way (left untouched).`);
}
