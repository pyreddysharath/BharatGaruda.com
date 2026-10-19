// Non-destructive audit: check existing government URLs and report suspicious
// responses. Never remove entries from any links.json automatically.
import path from 'node:path';
import { listEntityDirs, loadLinksJson, forEachEntry } from './lib/data.mjs';
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
  const suspected = [];
  const uncertain = [];

  for (const stateDir of stateDirs) {
    const loaded = await loadLinksJson(entitiesRoot, stateDir);
    if (!loaded) continue;
    const entries = [];
    forEachEntry(loaded.data, (item, ctx) => {
      if (item?.url) entries.push({ item, ctx });
    });
    const verdicts = await mapWithConcurrency(entries, CONCURRENCY, ({ item }) => checkUrl(item.url));
    entries.forEach(({ item, ctx }, i) => {
      const verdict = verdicts[i];
      const record = {
        state: stateDir,
        category: `${ctx.sectionKey} → ${ctx.category}`,
        title: item.title,
        url: item.url,
        reason: verdict.reason,
      };
      if (verdict.verdict === 'dead') suspected.push(record);
      else if (verdict.verdict === 'uncertain') uncertain.push(record);
    });
  }
  return { suspected, uncertain };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entitiesRoot = process.argv[2] || path.join(process.cwd(), 'entities');
  const { suspected, uncertain } = await runLinkCheck(entitiesRoot);
  console.log(`Flagged ${suspected.length} potentially unavailable link(s); none removed.`);
  suspected.forEach((r) => console.log(`  - [${r.state}] ${r.title} (${r.url}) — ${r.reason}`));
  console.log(`${uncertain.length} uncertain link(s); none removed.`);
}
