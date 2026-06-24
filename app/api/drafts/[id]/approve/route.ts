import { NextResponse } from "next/server";
import { approveDraft, unapproveDraft } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** POST /api/drafts/:id/approve — the CEO approves a draft for publishing.
 *  Sets approval_status = "approved" (the manual publisher picks these up on
 *  command). Reversible via DELETE. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const draft = await approveDraft(id);
    if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, approval_status: draft.approval_status });
  } catch (e) {
    return NextResponse.json({ error: "approve failed", detail: String(e) }, { status: 500 });
  }
}

/** DELETE /api/drafts/:id/approve — undo approval, back to "awaiting CEO". */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const draft = await unapproveDraft(id);
    if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, approval_status: draft.approval_status });
  } catch (e) {
    return NextResponse.json({ error: "unapprove failed", detail: String(e) }, { status: 500 });
  }
}
