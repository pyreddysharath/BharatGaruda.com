// Checks whether a single URL is still reachable, erring well on the side
// of NOT removing a link. Government sites frequently block bare bot
// requests (403), rate-limit (429), have flaky TLS/uptime (5xx, timeouts),
// or reject HEAD but accept GET — none of that means the site is actually
// gone, so only a small, high-confidence set of outcomes counts as "dead":
//
//   - DNS resolution failure (ENOTFOUND / EAI_AGAIN)   -> domain doesn't exist any more
//   - Connection refused (ECONNREFUSED)                -> nothing listening
//   - HTTP 404 or 410                                  -> page confirmed gone
//
// Everything else (timeouts, 403, 429, 5xx, other network errors,
// certificate errors) is reported as "uncertain" and left alone — a false
// "dead" verdict is far more costly here (silently deleting a real
// government link from a public directory) than leaving a possibly-stale
// link for a human to double-check.
//
// Each URL gets up to RETRIES attempts with a short backoff before being
// counted as dead, to absorb one-off blips within a single run.

const TIMEOUT_MS = 15000;
const RETRIES = 3;
const RETRY_DELAY_MS = 4000;
const DEAD_STATUS = new Set([404, 410]);
const DEAD_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const commonInit = {
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      // A normal browser UA — some government sites 403 anything that
      // looks like a bot/script by default.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  };
  try {
    let res;
    try {
      res = await fetch(url, { ...commonInit, method: 'HEAD' });
      // Some servers return a nonsense status (e.g. 405) for HEAD but are
      // fine on GET — fall back rather than trusting a HEAD-only failure.
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { ...commonInit, method: 'GET' });
      }
    } catch {
      res = await fetch(url, { ...commonInit, method: 'GET' });
    }
    clearTimeout(timer);
    return { ok: true, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    const code = err?.cause?.code || err?.code;
    return { ok: false, code, message: err?.message || String(err) };
  }
}

// Returns one of:
//   { verdict: 'alive' }
//   { verdict: 'dead', reason: '404' | '410' | 'ENOTFOUND' | ... }
//   { verdict: 'uncertain', reason: '...' }   (leave the link alone)
export async function checkUrl(url) {
  let lastResult = null;
  for (let i = 0; i < RETRIES; i++) {
    const result = await attempt(url);
    lastResult = result;
    if (result.ok) {
      if (DEAD_STATUS.has(result.status)) {
        // Give a confirmed-dead status one more chance across the retry
        // loop too, in case of a transient bad response.
        if (i < RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { verdict: 'dead', reason: String(result.status) };
      }
      // Any other status (2xx, 3xx already followed, 401/403/429/5xx/etc.)
      // counts as "site is there" for our purposes.
      return { verdict: 'alive' };
    }
    if (result.code && DEAD_ERROR_CODES.has(result.code)) {
      if (i < RETRIES - 1) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { verdict: 'dead', reason: result.code };
    }
    // Unknown/transient network error (timeout, TLS, reset, ...) — retry.
    if (i < RETRIES - 1) await sleep(RETRY_DELAY_MS);
  }
  return { verdict: 'uncertain', reason: lastResult?.code || lastResult?.message || 'unknown error' };
}
