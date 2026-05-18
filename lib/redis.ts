import Redis from "ioredis";
import type { CaptureRow, ScheduledPost } from "./types";

/**
 * Redis client (TCP / ioredis).
 *
 * Reads REDIS_URL env var. Provisioned via Vercel Marketplace integration
 * (Redis Inc · "Redis" product).
 *
 * Notes:
 *   - Singleton across warm Function invocations on Vercel Fluid Compute.
 *   - Lazy connect so cold-start cost is paid on first command, not at import.
 *   - maxRetriesPerRequest=2 keeps p99 bounded; failures bubble up to the route.
 */

declare global {
  // eslint-disable-next-line no-var
  var _celesteRedis: Redis | undefined;
}

function client(): Redis {
  if (global._celesteRedis) return global._celesteRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL missing — connect a Redis database via Vercel Marketplace."
    );
  }
  global._celesteRedis = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    connectTimeout: 8000,
  });
  return global._celesteRedis;
}

// ─── Posts (hash keyed by id) ────────────────────────────────────────

const POSTS_KEY = "posts";

export async function listPosts(): Promise<ScheduledPost[]> {
  const r = client();
  const all = await r.hgetall(POSTS_KEY);
  if (!all) return [];
  const out: ScheduledPost[] = [];
  for (const v of Object.values(all)) {
    if (typeof v === "string") {
      try {
        out.push(JSON.parse(v));
      } catch {
        /* skip malformed */
      }
    }
  }
  return out.sort((a, b) =>
    (a.published_at || "").localeCompare(b.published_at || "")
  );
}

export async function getPost(id: string): Promise<ScheduledPost | null> {
  const r = client();
  const v = await r.hget(POSTS_KEY, id);
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function putPost(p: ScheduledPost): Promise<void> {
  const r = client();
  await r.hset(POSTS_KEY, p.id, JSON.stringify(p));
}

export async function deletePost(id: string): Promise<boolean> {
  const r = client();
  const n = await r.hdel(POSTS_KEY, id);
  return n > 0;
}

// ─── Captures (append-only list) ─────────────────────────────────────

const CAPTURES_KEY = "captures";
const MAX_CAPTURES = 5000;

export async function listCaptures(): Promise<CaptureRow[]> {
  const r = client();
  const raws = await r.lrange(CAPTURES_KEY, 0, -1);
  const out: CaptureRow[] = [];
  for (const s of raws) {
    if (typeof s === "string") {
      try {
        out.push(JSON.parse(s));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

// ─── Generic KV (used for LinkedIn report cache + rotated token) ─────

export async function kvGet(key: string): Promise<string | null> {
  return client().get(key);
}

export async function kvSet(key: string, val: string, ttlSec?: number): Promise<void> {
  if (ttlSec && ttlSec > 0) await client().set(key, val, "EX", ttlSec);
  else await client().set(key, val);
}

/** Best-effort lock: returns true if acquired. */
export async function kvLock(key: string, ttlSec: number): Promise<boolean> {
  const res = await client().set(key, "1", "EX", ttlSec, "NX");
  return res === "OK";
}

export async function appendCapture(c: CaptureRow): Promise<void> {
  const r = client();
  await r.rpush(CAPTURES_KEY, JSON.stringify(c));
  await r.ltrim(CAPTURES_KEY, -MAX_CAPTURES, -1);
}

// ─── Draft overrides (editable caption / body) ────────────────────────

const DRAFT_OVERRIDES_KEY = "draft_overrides";

export interface DraftOverride {
  caption?: string;
  body?: string;
  updated_at: string;
}

export async function getAllDraftOverrides(): Promise<Record<string, DraftOverride>> {
  const r = client();
  const all = await r.hgetall(DRAFT_OVERRIDES_KEY);
  if (!all) return {};
  const out: Record<string, DraftOverride> = {};
  for (const [k, v] of Object.entries(all)) {
    if (typeof v === "string") {
      try { out[k] = JSON.parse(v); } catch { /* skip */ }
    }
  }
  return out;
}

export async function getDraftOverride(id: string): Promise<DraftOverride | null> {
  const r = client();
  const v = await r.hget(DRAFT_OVERRIDES_KEY, id);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

export async function putDraftOverride(
  id: string,
  patch: Omit<DraftOverride, "updated_at">
): Promise<DraftOverride> {
  const r = client();
  const existing = (await getDraftOverride(id)) || { updated_at: new Date().toISOString() };
  const merged: DraftOverride = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await r.hset(DRAFT_OVERRIDES_KEY, id, JSON.stringify(merged));
  return merged;
}
