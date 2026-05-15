import { Redis } from "@upstash/redis";
import type { CaptureRow, ScheduledPost } from "./types";

/**
 * Redis client.
 *
 * Reads env vars in this order:
 *   1. UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN     (Upstash Marketplace)
 *   2. KV_REST_API_URL          + KV_REST_API_TOKEN           (legacy Vercel KV alias)
 *
 * Connect the Upstash Redis integration via Vercel Marketplace; the URL+TOKEN
 * env vars are auto-provisioned. Local dev: copy from `vercel env pull`.
 */
function client(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Upstash credentials. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN."
    );
  }
  return new Redis({ url, token });
}

// ─── Posts (hash keyed by id) ────────────────────────────────────────

const POSTS_KEY = "posts";

export async function listPosts(): Promise<ScheduledPost[]> {
  const r = client();
  const all = await r.hgetall<Record<string, string | ScheduledPost>>(POSTS_KEY);
  if (!all) return [];
  const out: ScheduledPost[] = [];
  for (const v of Object.values(all)) {
    if (typeof v === "string") {
      try { out.push(JSON.parse(v)); } catch { /* skip malformed */ }
    } else if (v && typeof v === "object") {
      out.push(v as ScheduledPost);
    }
  }
  return out.sort((a, b) =>
    (a.published_at || "").localeCompare(b.published_at || "")
  );
}

export async function getPost(id: string): Promise<ScheduledPost | null> {
  const r = client();
  const v = await r.hget<string | ScheduledPost>(POSTS_KEY, id);
  if (!v) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v as ScheduledPost;
}

export async function putPost(p: ScheduledPost): Promise<void> {
  const r = client();
  await r.hset(POSTS_KEY, { [p.id]: JSON.stringify(p) });
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
  const raws = await r.lrange<string>(CAPTURES_KEY, 0, -1);
  const out: CaptureRow[] = [];
  for (const s of raws) {
    if (typeof s === "string") {
      try { out.push(JSON.parse(s)); } catch { /* skip */ }
    } else if (s && typeof s === "object") {
      out.push(s as unknown as CaptureRow);
    }
  }
  return out;
}

export async function appendCapture(c: CaptureRow): Promise<void> {
  const r = client();
  await r.rpush(CAPTURES_KEY, JSON.stringify(c));
  // Trim to last N to keep storage bounded
  await r.ltrim(CAPTURES_KEY, -MAX_CAPTURES, -1);
}
