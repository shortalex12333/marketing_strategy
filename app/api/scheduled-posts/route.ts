import { NextResponse } from "next/server";
import { listPosts, putPost, getPost } from "@/lib/redis";
import { listCaptures } from "@/lib/redis";
import { eqs } from "@/lib/eqs";
import type { AugmentedPost, CaptureRow, ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await listPosts();
  const captures = await listCaptures();

  const byPost: Record<string, CaptureRow[]> = {};
  for (const c of captures) {
    (byPost[c.post_id] ||= []).push(c);
  }

  const augmented: AugmentedPost[] = posts.map((p) => {
    const list = (byPost[p.id] || []).slice().sort((a, b) =>
      a.captured_at_utc.localeCompare(b.captured_at_utc)
    );
    const latest = list[list.length - 1] || null;
    const e = latest
      ? eqs(
          latest.impressions,
          latest.reactions,
          latest.comments,
          latest.reposts,
          latest.saves,
          latest.clicks
        )
      : null;
    return {
      ...p,
      _latest_capture: latest
        ? {
            captured_at: latest.captured_at_utc,
            impressions: latest.impressions,
            reactions: latest.reactions,
            comments: latest.comments,
            reposts: latest.reposts,
            saves: latest.saves,
            clicks: latest.clicks,
            error: latest.error || null,
          }
        : null,
      _captures_count: list.length,
      _eqs: e,
    };
  });

  return NextResponse.json(augmented);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const url = (body.url || "").trim();
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const m = /activity[-:](\d+)/.exec(url);
  const id =
    (body.id && String(body.id).trim()) ||
    body.label ||
    (m ? `post-${m[1]}` : `post-${Date.now()}`);

  const existing = await getPost(id);
  if (existing && existing.url === url) {
    return NextResponse.json({ warning: "already scheduled", post: existing });
  }

  const pub =
    body.published_at && String(body.published_at).trim()
      ? String(body.published_at)
      : new Date().toISOString();

  const post: ScheduledPost = {
    id,
    url,
    published_at: pub,
    captures: {},
  };
  await putPost(post);
  return NextResponse.json({ ok: true, post });
}
