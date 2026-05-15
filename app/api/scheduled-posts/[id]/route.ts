import { NextResponse } from "next/server";
import { deletePost, getPost, putPost } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await deletePost(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, removed: id });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (body.published_at) post.published_at = String(body.published_at);
  if (body.url) post.url = String(body.url);
  await putPost(post);
  return NextResponse.json({ ok: true, post });
}
