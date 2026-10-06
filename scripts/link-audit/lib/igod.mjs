// Discovers government department websites from India's own official
// "Integrated Government Online Directory" (igod.gov.in), per state/UT, so
// new entries are found mechanically rather than guessed by an AI.
//
// IGOD is server-rendered HTML (confirmed by inspection), two levels deep
// for a state:
//   /sg/<CODE>/categories                 -> list of sector/category pages
//   /sg/<CODE>/<sectorCode>/organizations -> list of departments + their
//                                             official external website
//
// IMPORTANT — read before relying on this in production:
// This parser was written from a description of IGOD's rendered page
// content (this environment could not load and inspect IGOD's raw HTML/DOM
// directly), not from its actual markup. The category-link and
// department-link heuristics below are deliberately broad (any <a href>
// matching the right URL shape / pointing off-site) so they have the best
// chance of surviving small markup differences, but they have NOT been
// run against the live site. Treat the first several scheduled runs as a
// trial: check the opened PRs closely, and adjust the two CSS-selector
// constants below (CATEGORY_LINK_SELECTOR / ORG_LINK_SELECTOR) if they
// come back empty or noisy — a quick "view source" on one /categories and
// one /organizations page will show the real element/class names to
// target.

import * as cheerio from 'cheerio';

// Overridable for local testing (see README's "Local testing" section) —
// production always uses the real IGOD site.
const BASE = process.env.IGOD_BASE_URL || 'https://igod.gov.in';
const REQUEST_DELAY_MS = 1500; // be a polite, slow crawler on a government server
const TIMEOUT_MS = 20000;

// Broad by design — see note above.
const CATEGORY_LINK_SELECTOR = 'a[href*="/organizations"]';
const ORG_LINK_SELECTOR = 'a[href^="http"]';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A small blocklist of link text that shows up in IGOD's own chrome
// (nav/footer) rather than as an actual department entry, so those never
// get proposed as a "new government site".
const NON_DEPARTMENT_TEXT = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'sitemap', 'help',
  'faq', 'login', 'sign in', 'feedback', 'terms', 'privacy policy',
  'disclaimer', 'accessibility', 'skip to main content', 'external link',
  'external link that opens in a new window',
]);

function looksLikeDepartmentName(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.length < 4 || t.length > 140) return false;
  if (NON_DEPARTMENT_TEXT.has(t.toLowerCase())) return false;
  return true;
}

function isIgodInternalUrl(href) {
  try {
    return new URL(href, BASE).hostname.endsWith('igod.gov.in');
  } catch {
    return true; // relative/unparseable -> treat as internal, skip it
  }
}

// Returns [{ title, url }] for every department this state's IGOD page(s)
// list with an external (non-igod.gov.in) website.
export async function discoverStateDepartments(stateCode) {
  const found = new Map(); // url -> title (dedup within this state)

  const categoriesHtml = await getHtml(`${BASE}/sg/${stateCode}/categories`);
  if (!categoriesHtml) return [];
  const $cat = cheerio.load(categoriesHtml);

  const orgPageUrls = new Set();
  $cat(CATEGORY_LINK_SELECTOR).each((_, el) => {
    const href = $cat(el).attr('href');
    if (!href) return;
    const abs = new URL(href, BASE).toString();
    if (abs.includes('/organizations') && abs.includes(`/sg/${stateCode}/`)) {
      orgPageUrls.add(abs);
    }
  });

  // Some states' /categories page may itself already be an /organizations
  // listing (a single-sector state, or IGOD collapsing the level) — handle
  // that by also scanning the categories page directly for org links.
  if (orgPageUrls.size === 0) orgPageUrls.add(`${BASE}/sg/${stateCode}/categories`);

  for (const pageUrl of orgPageUrls) {
    await sleep(REQUEST_DELAY_MS);
    const html = pageUrl.endsWith('/categories') ? categoriesHtml : await getHtml(pageUrl);
    if (!html) continue;
    const $ = cheerio.load(html);
    $(ORG_LINK_SELECTOR).each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href) return;
      if (isIgodInternalUrl(href)) return;
      const title = $el.text().replace(/\s+/g, ' ').trim();
      if (!looksLikeDepartmentName(title)) return;
      let abs;
      try {
        abs = new URL(href, BASE).toString();
      } catch {
        return;
      }
      if (!found.has(abs)) found.set(abs, title);
    });
  }

  return [...found.entries()].map(([url, title]) => ({ title, url }));
}
