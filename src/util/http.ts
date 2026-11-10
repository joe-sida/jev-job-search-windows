/**
 * fetch with a timeout, a polite user agent, an on-disk cache for GET
 * responses, and a small concurrency limiter. Everything that reads the
 * web goes through here.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DISCOVER, PATHS } from "../config.js";

const USER_AGENT = "jev-job-search/1.6 (+https://github.com/qbeka/jev-job-search)";

export type GetOptions = {
  timeoutMs?: number;
  /** Cache TTL in milliseconds. 0 disables caching. */
  cacheMs?: number;
  headers?: Record<string, string>;
};

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const cacheMs = opts.cacheMs ?? 0;
  const cacheFile = cacheMs > 0 ? path.join(PATHS.cache, "http", createHash("sha1").update(url).digest("hex")) : null;
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const { at, body } = JSON.parse(readFileSync(cacheFile, "utf8")) as { at: number; body: string };
      if (Date.now() - at < cacheMs) return body;
    } catch {
      /* fall through to a live fetch */
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DISCOVER.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9, */*;q=0.8", ...opts.headers },
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text();
    if (!res.ok) throw new HttpError(`GET ${url} returned ${res.status}`, res.status, url);
    if (cacheFile) {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), body }));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where a link ends up once its redirects have been followed. The public lists hand out shortened
 * links that hide which board a posting is on, and the board decides whether the tool can apply at
 * all. Cached on disk, because a shortened link's destination does not change. A link that cannot
 * be followed comes back unchanged, so a posting is never lost to a redirector having a bad day.
 */
export async function resolveUrl(url: string, opts: { timeoutMs?: number; cacheMs?: number } = {}): Promise<string> {
  const cacheMs = opts.cacheMs ?? DISCOVER.linkCacheMs;
  const cacheFile = cacheMs > 0 ? path.join(PATHS.cache, "links", createHash("sha1").update(url).digest("hex")) : null;
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const { at, to } = JSON.parse(readFileSync(cacheFile, "utf8")) as { at: number; to: string };
      if (Date.now() - at < cacheMs) return to;
    } catch {
      /* fall through and follow it again */
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DISCOVER.fetchTimeoutMs);
  const headers = { "User-Agent": USER_AGENT };
  try {
    // HEAD first, which a redirector answers without sending a page. Some answer only a GET, and
    // then the body is dropped unread: the destination is the response's own URL, not its content.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", headers, signal: controller.signal });
    if (!res.ok || res.url === url) {
      res = await fetch(url, { redirect: "follow", headers, signal: controller.signal });
      await res.body?.cancel();
    }
    const to = res.url || url;
    if (cacheFile) {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), to }));
    }
    return to;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(url: string, opts: GetOptions = {}): Promise<T> {
  const text = await getText(url, opts);
  return JSON.parse(text) as T;
}

/** Runs `fn` over `items` with at most `limit` in flight. Rejections are returned, not thrown. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i] as T, i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
