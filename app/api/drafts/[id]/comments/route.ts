import { NextResponse } from "next/server";
import { listComments, addComment, deleteComment } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/drafts/:id/comments — founder alignment notes on this draft. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const comments = await listComments(id);
    return NextResponse.json({ id, comments });
  } catch (e) {
    return NextResponse.json(
      { error: "list comments failed", detail: String(e) },
      { status: 500 }
    );
  }
}

/** POST /api/drafts/:id/comments  {body} — add a comment. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const payload = await req.json().catch(() => ({}));
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  try {
    const comment = await addComment(id, text);
    return NextResponse.json({ ok: true, comment });
  } catch (e) {
    return NextResponse.json(
      { error: "add comment failed", detail: String(e) },
      { status: 500 }
    );
  }
}

/** DELETE /api/drafts/:id/comments?commentId=… — remove one comment. */
export async function DELETE(req: Request, { params }: Ctx) {
  await params; // id is implied by the comment row; commentId is the key
  const commentId = new URL(req.url).searchParams.get("commentId");
  if (!commentId) {
    return NextResponse.json({ error: "commentId required" }, { status: 400 });
  }
  try {
    await deleteComment(commentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "delete comment failed", detail: String(e) },
      { status: 500 }
    );
  }
}
