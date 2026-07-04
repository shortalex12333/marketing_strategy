import { NextResponse } from "next/server";
import { buildPageReport, type PageReport } from "@/lib/linkedin";
import { enrichPageReport, loadCachedReport, saveCachedReport } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Two-tier cache: in-memory (fast path on a warm Fluid Compute instance) +
 * Supabase Storage (durable across cold starts).
 *
 * The in-memory-only version of this route was permanently broken in
 * production: buildPageReport() fetches per-post analytics sequentially with
 * a 2.5s privacy-budget sleep between calls (~60-90s wall time for the real
 * ~20-post feed), but this route raced it against a 25s internal timeout —
 * so live fetches ALWAYS lost the race, and a low-traffic route rarely stays
 * on the same warm instance long enough for the in-memory cache to matter
 * either. Net effect: every request hit "no cache yet" 502, confirmed live
 * 2026-07-04. Fixed by (a) giving the real fetch its actual room to finish
 * (maxDuration=300 was already set — the internal race was the bug, not the
 * function timeout), and (b) persisting the last good report to storage so
 * a cold instance serves it instantly instead of refetching or failing.
 */

const FRESH_MS = 6 * 60 * 60 * 1000;
let _memCache: PageReport | null = null;

function age(fetchedAt: string): number {
  return Date.now() - new Date(fetchedAt).getTime();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  if (!_memCache) {
    _memCache = await loadCachedReport().catch(() => null);
  }

  const memAge = _memCache ? age(_memCache.fetched_at) : Infinity;
  if (_memCache && memAge < FRESH_MS && !force) {
    return NextResponse.json({ ..._memCache, _source: "cache", _age_min: Math.round(memAge / 60000) });
  }

  try {
    const raw = await Promise.race([
      buildPageReport(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("LinkedIn DMA fetch timeout (280s)")), 280_000)
      ),
    ]);
    const report = await enrichPageReport(raw).catch((e) => {
      // Enrichment is a nice-to-have join, not the reason this route exists —
      // never let it turn a real fetch into a failed response.
      console.error("enrichPageReport failed, serving un-enriched", e);
      return raw;
    });
    _memCache = report;
    saveCachedReport(report).catch((e) => console.error("saveCachedReport failed", e));
    return NextResponse.json({ ...report, _source: "live" });
  } catch (e) {
    if (_memCache) {
      return NextResponse.json({
        ..._memCache,
        _source: "stale (live fetch failed)",
        _error: String(e),
      });
    }
    return NextResponse.json(
      {
        error: String(e),
        _source: "no cache yet",
        _hint:
          "LinkedIn DMA API may be rate-limited or upstream-slow. Retry in a few minutes; the next successful fetch fills the durable cache.",
      },
      { status: 502 }
    );
  }
}
