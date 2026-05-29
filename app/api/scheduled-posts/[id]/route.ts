import { NextResponse } from "next/server";
import { deletePost, getPost, patchPost } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const post = await getPost(id);
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(post);
  } catch (e) {
    return NextResponse.json({ error: "li_posts query failed", detail: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const ok = await deletePost(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, removed: id });
  } catch (e) {
    return NextResponse.json({ error: "li_posts delete failed", detail: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { url?: string; published_at?: string } = {};
  if (body.url) patch.url = String(body.url);
  if (body.published_at) patch.published_at = String(body.published_at);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  try {
    const post = await patchPost(id, patch);
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, post });
  } catch (e) {
    return NextResponse.json({ error: "li_posts patch failed", detail: String(e) }, { status: 500 });
  }
}
