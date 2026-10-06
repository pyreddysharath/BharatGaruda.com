# Weekly link audit

Runs automatically every Monday via `.github/workflows/link-audit.yml`
(also runnable on demand from the Actions tab — "Run workflow"). It never
pushes straight to `main`: every run that finds something to change opens a
**pull request** for you to review and merge (or edit/close).

## What it does

1. **Dead-link removal** (`check-links.mjs`) — visits every URL in every
   `site/entities/*/links.json` and removes an entry only when it's
   confidently gone: DNS no longer resolves, connection refused, or the
   page itself returns 404/410 (each checked with 3 retries first). A
   timeout, 403, 429, or 5xx is reported but **not** removed — government
   sites block bots and have flaky uptime often enough that auto-deleting
   on those would do more harm than good. Anything ambiguous shows up in a
   collapsed table in the PR body for you to check by hand.

2. **New-site discovery** (`discover-sites.mjs` + `lib/igod.mjs`) —
   crawls each state's page on India's own
   [Integrated Government Online Directory](https://igod.gov.in) (IGOD),
   diffs its department list against what's already in that state's
   `links.json`, and appends anything new into a
   **`"Newly Added (Needs Review)"`** category (alphabetically sorted,
   with an auto-generated description and a generic icon). Nothing is
   auto-filed into your real categories (Education, Transport, etc.) —
   re-categorizing a new entry, or deciding it doesn't belong, is left to
   you in the PR review.

   IGOD was chosen over an AI web-search approach specifically because
   it's India's own mechanically-diffable government directory — no LLM
   API key, no per-run cost, and far lower risk of proposing an
   unofficial or incorrect URL for a public-facing directory site.

## ⚠️ Before you trust this in production

The IGOD scraper (`lib/igod.mjs`) was written from a description of the
site's rendered content — this environment couldn't load and inspect
IGOD's actual page markup directly. The two CSS selectors it uses
(`CATEGORY_LINK_SELECTOR`, `ORG_LINK_SELECTOR` near the top of that file)
are deliberately broad so they'll likely still work even if the exact
class names differ from what was assumed, but they are **untested against
the live site**. Please:

- Trigger it once by hand (Actions tab → "Weekly link audit" →
  "Run workflow") and read the resulting PR closely before relying on the
  schedule.
- If it opens with zero new sites found (and you know a state has
  departments IGOD lists that aren't in your data yet), open
  `https://igod.gov.in/sg/<STATE_CODE>/categories` in a browser, view
  source, and tighten the two selectors in `lib/igod.mjs` to match what
  you see.
- State/UT → IGOD code mapping lives in `state-codes.json`; it follows
  ISO 3166-2:IN codes (the same scheme your existing "All Telangana
  Government Departments" link already uses: `igod.gov.in/sg/TS/...`).

## Local testing

```bash
cd scripts/link-audit
npm install
REPO_ROOT=../.. node run.mjs
```

This writes changes straight into `site/entities/**` and a
`link-audit-summary.md` at the repo root (the same file the workflow uses
as the PR body) — use `git diff` / `git checkout` to inspect or discard a
local test run.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | Orchestrator: runs the check, then the discovery, writes the PR summary. |
| `check-links.mjs` | Dead-link removal. |
| `discover-sites.mjs` | New-site discovery + filing into the review category. |
| `lib/check-url.mjs` | The actual HTTP liveness check + retry/backoff policy. |
| `lib/igod.mjs` | IGOD HTML scraper. |
| `lib/data.mjs` | Shared `links.json` read/write/walk/sort/icon helpers. |
| `state-codes.json` | `entities/<folder>` → IGOD state/UT code mapping. |
