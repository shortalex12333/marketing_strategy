import { NextResponse } from "next/server";
import { listAugmentedPosts, getPost, putPost } from "@/lib/supabase";
import type { ScheduledPost } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const augmented = await listAugmentedPosts();
    return NextResponse.json(augmented);
  } catch (e) {
    return NextResponse.json({ error: "li_posts query failed", detail: String(e) }, { status: 500 });
  }
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

  try {
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
  } catch (e) {
    return NextResponse.json({ error: "li_posts insert failed", detail: String(e) }, { status: 500 });
  }
}
