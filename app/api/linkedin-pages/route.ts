import { NextResponse } from "next/server";
import { buildPageReport, REPORT_KEY } from "@/lib/linkedin";
import { kvGet, kvSet, kvLock } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FRESH_MS = 6 * 60 * 60 * 1000; // serve cache <6h old; gates feed API to ≤1/6h

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";

  let cached: { fetched_at?: string } | null = null;
  try {
    const raw = await kvGet(REPORT_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch { /* ignore */ }

  const ageMs = cached?.fetched_at
    ? Date.now() - new Date(cached.fetched_at).getTime()
    : Infinity;

  if (cached && ageMs < FRESH_MS && !force) {
    return NextResponse.json({ ...cached, _source: "cache", _age_min: Math.round(ageMs / 60000) });
  }

  // Stale (or forced). Lock so concurrent requests don't double-hit the
  // 1-req/60s feed endpoint. Loser serves stale cache.
  const got = await kvLock("linkedin:pages:lock", 180);
  if (!got) {
    if (cached) return NextResponse.json({ ...cached, _source: "stale (refresh in progress)" });
    return NextResponse.json({ error: "refresh in progress, no cache yet" }, { status: 503 });
  }

  try {
    const report = await buildPageReport();
    await kvSet(REPORT_KEY, JSON.stringify(report), 7 * 24 * 3600);
    return NextResponse.json({ ...report, _source: "live" });
  } catch (e) {
    if (cached) {
      return NextResponse.json({
        ...cached,
        _source: "stale (live fetch failed)",
        _error: String(e),
      });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
