// Shared helpers for reading/writing this repo's entities/*/links.json
// files and walking every site entry inside them.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// A links.json has this shape:
// {
//   "stateWebsites": { "<Category>": [ {title, url, desc, image, abbrFull?}, ... ], ... },
//   "stateServices": { "<Category>": [ ... ], ... }
// }
// Both top-level keys are optional (some entities only have one).
export const SECTION_KEYS = ['stateWebsites', 'stateServices'];

export async function listEntityDirs(entitiesRoot) {
  const names = await readdir(entitiesRoot, { withFileTypes: true });
  return names
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function loadLinksJson(entitiesRoot, stateDir) {
  const file = path.join(entitiesRoot, stateDir, 'links.json');
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf8');
  try {
    return { file, data: JSON.parse(raw) };
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
}

export async function saveLinksJson(file, data) {
  // Keep the same 2-space indentation as the rest of the repo's JSON, and a
  // trailing newline so the diff in the PR stays clean.
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Runs `fn(item, {section, category, array, index})` for every site entry in
// a links.json's stateWebsites/stateServices, across every category.
export function forEachEntry(data, fn) {
  for (const sectionKey of SECTION_KEYS) {
    const section = data[sectionKey];
    if (!section) continue;
    for (const [category, arr] of Object.entries(section)) {
      if (!Array.isArray(arr)) continue;
      arr.forEach((item, index) => fn(item, { sectionKey, category, array: arr, index }));
    }
  }
}

// Collects every URL already present anywhere in a links.json, normalized
// for host+path comparison (drops protocol, "www.", trailing slash, query
// string) so http vs https / trailing-slash variants aren't treated as new.
export function collectExistingUrls(data) {
  const set = new Set();
  forEachEntry(data, (item) => {
    if (item && item.url) set.add(normalizeUrl(item.url));
  });
  return set;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, '');
    let p = u.pathname.replace(/\/+$/, '');
    return `${host}${p}`.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

export function slug(label) {
  return String(label)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ICON_TMPL = (label, emoji) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${escapeXml(label)}">
  <text x="24" y="33" font-size="28" text-anchor="middle">${emoji}</text>
</svg>
`;

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Writes an icons/<slug>.svg next to a state's links.json, matching the
// simple emoji-text icon style already used across this repo's existing
// entries (see gen_icons.py), and returns the relative "entities/..." path
// to store in the JSON entry's "image" field.
export async function writeIcon(entitiesRoot, stateDir, title, emoji = '🏛️') {
  const iconSlug = slug(title);
  const iconDir = path.join(entitiesRoot, stateDir, 'icons');
  if (!existsSync(iconDir)) await mkdir(iconDir, { recursive: true });
  const iconPath = path.join(iconDir, `${iconSlug}.svg`);
  await writeFile(iconPath, ICON_TMPL(title, emoji), 'utf8');
  return `entities/${stateDir}/icons/${iconSlug}.svg`;
}

export function sortCategoryAlphabetically(arr) {
  arr.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
}
