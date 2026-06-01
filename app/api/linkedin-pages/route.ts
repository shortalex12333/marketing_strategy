import { NextResponse } from "next/server";
import { buildPageReport } from "@/lib/linkedin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * In-memory cache replaces the Redis kvGet/kvSet/kvLock dance.
 * Module-level state survives across warm function invocations on Vercel
 * Fluid Compute. On cold start the cache rebuilds; the linkedin feed API
 * is gated to ≤1/60s upstream so the worst case is a single rebuild per
 * cold-start request. Low traffic = lock not needed.
 */

const FRESH_MS = 6 * 60 * 60 * 1000;
interface CachedReport {
  fetched_at?: string;
  [k: string]: unknown;
}
let _cache: CachedReport | null = null;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  const ageMs = _cache?.fetched_at
    ? Date.now() - new Date(_cache.fetched_at).getTime()
    : Infinity;

  if (_cache && ageMs < FRESH_MS && !force) {
    return NextResponse.json({ ..._cache, _source: "cache", _age_min: Math.round(ageMs / 60000) });
  }

  try {
    const report = await Promise.race([
      buildPageReport(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("LinkedIn DMA fetch timeout (25s)")), 25_000)
      ),
    ]);
    _cache = report as CachedReport;
    return NextResponse.json({ ..._cache, _source: "live" });
  } catch (e) {
    if (_cache) {
      return NextResponse.json({
        ..._cache,
        _source: "stale (live fetch failed)",
        _error: String(e),
      });
    }
    return NextResponse.json(
      {
        error: String(e),
        _source: "no cache yet",
        _hint:
          "LinkedIn DMA API may be rate-limited or upstream-slow. Retry in a few minutes; the next successful fetch fills the 6h cache.",
      },
      { status: 502 }
    );
  }
}
