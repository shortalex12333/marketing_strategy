import { NextResponse } from "next/server";
import { appendCapture, getPost, listCaptures, putPost } from "@/lib/redis";
import { checkBearer } from "@/lib/auth";
import { eqs } from "@/lib/eqs";
import type { CaptureRow, Checkpoint } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_CHECKPOINTS: Checkpoint[] = ["30m", "60m", "6h", "24h"];

export async function GET() {
  const rows = await listCaptures();
  const enriched = rows.map((r) => ({
    ...r,
    eqs: eqs(r.impressions, r.reactions, r.comments, r.reposts, r.saves, r.clicks),
  }));
  return NextResponse.json(enriched);
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

  await appendCapture(row);

  // Also stamp the checkpoint into the post's captures map for the UI pills
  const post = await getPost(row.post_id);
  if (post) {
    post.captures = post.captures || {};
    post.captures[checkpoint as Checkpoint] = {
      captured_at: row.captured_at_utc,
      impressions: row.impressions,
      reactions: row.reactions,
      comments: row.comments,
      reposts: row.reposts,
      saves: row.saves,
      clicks: row.clicks,
      error: row.error || null,
    };
    await putPost(post);
  }

  return NextResponse.json({ ok: true, row });
}
