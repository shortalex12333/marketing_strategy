import { NextResponse } from "next/server";
import { markDraftPosted, markDraftUnposted } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

/** POST /api/drafts/:id/posted  {url, published_at?}
 *  The CEO posted the draft manually on LinkedIn → record it: upserts li_posts
 *  (WITH draft_id lineage so captures join back to the angle) and flips the
 *  draft's approval_status to "posted YYYY-MM-DD". */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url required — paste the live LinkedIn post URL" }, { status: 400 });
  }
  let publishedAt: string | undefined;
  if (body.published_at) {
    const d = new Date(String(body.published_at));
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "published_at is not a valid date" }, { status: 400 });
    }
    publishedAt = d.toISOString();
  }
  try {
    const draft = await markDraftPosted(id, url, publishedAt);
    if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, approval_status: draft.approval_status });
  } catch (e) {
    return NextResponse.json({ error: "mark-posted failed", detail: String(e) }, { status: 500 });
  }
}

/** DELETE /api/drafts/:id/posted — undo a mistaken click (status only; the
 *  li_posts row is real history — remove it via the posts tab if needed). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const draft = await markDraftUnposted(id);
    if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, approval_status: draft.approval_status });
  } catch (e) {
    return NextResponse.json({ error: "unmark-posted failed", detail: String(e) }, { status: 500 });
  }
}
