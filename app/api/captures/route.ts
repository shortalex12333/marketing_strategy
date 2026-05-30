import { NextResponse } from "next/server";
import { listCaptures } from "@/lib/supabase";
import { eqs } from "@/lib/eqs";

export const dynamic = "force-dynamic";

/**
 * GET /api/captures — list captures (latest 5000) with EQS computed per row.
 *
 * POST handler removed 2026-05-30. The launchd capture script now writes
 * directly to li_captures via Supabase REST (see linkedin_api_capture.py).
 * No remaining caller hit POST, so the route + CAPTURE_API_TOKEN env var
 * + lib/auth.ts were retired.
 */
export async function GET() {
  try {
    const rows = await listCaptures();
    const enriched = rows.map((r) => ({
      ...r,
      eqs: eqs(r.impressions, r.reactions, r.comments, r.reposts, r.saves, r.clicks),
    }));
    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json({ error: "li_captures query failed", detail: String(e) }, { status: 500 });
  }
}
