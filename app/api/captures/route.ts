import { NextResponse } from "next/server";
import { appendCapture, listCaptures } from "@/lib/supabase";
import { checkBearer } from "@/lib/auth";
import { eqs } from "@/lib/eqs";
import type { CaptureRow, Checkpoint } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_CHECKPOINTS: Checkpoint[] = ["30m", "60m", "6h", "24h"];

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

export async function POST(req: Request) {
  const auth = checkBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.post_id || !body.checkpoint) {
    return NextResponse.json({ error: "post_id and checkpoint required" }, { status: 400 });
  }

  const checkpoint = String(body.checkpoint);
  if (!VALID_CHECKPOINTS.includes(checkpoint as Checkpoint)) {
    return NextResponse.json(
      { error: `invalid checkpoint; must be one of ${VALID_CHECKPOINTS.join(", ")}` },
      { status: 400 }
    );
  }

  const row: CaptureRow = {
    captured_at_utc: body.captured_at_utc || new Date().toISOString(),
    post_id: String(body.post_id),
    post_url: String(body.post_url || ""),
    minutes_since_publish: Number(body.minutes_since_publish || 0),
    checkpoint,
    impressions: body.impressions == null ? null : Number(body.impressions),
    reactions: body.reactions == null ? null : Number(body.reactions),
    comments: body.comments == null ? null : Number(body.comments),
    reposts: body.reposts == null ? null : Number(body.reposts),
    saves: body.saves == null ? null : Number(body.saves),
    clicks: body.clicks == null ? null : Number(body.clicks),
    raw_text: String(body.raw_text || "").slice(0, 1000),
    error: String(body.error || ""),
  };

  try {
    await appendCapture(row);
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: "li_captures insert failed", detail: String(e) }, { status: 500 });
  }
}
