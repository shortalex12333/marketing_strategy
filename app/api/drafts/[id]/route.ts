import { NextResponse } from "next/server";
import { getDraft, patchDraft } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const draft = await getDraft(id);
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id,
      override: { caption: draft.caption, updated_at: draft.updated_at },
    });
  } catch (e) {
    return NextResponse.json({ error: "li_drafts query failed", detail: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { caption?: string; body?: string } = {};
  if (typeof body.caption === "string") patch.caption = body.caption;
  if (typeof body.body === "string") patch.body = body.body;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "nothing to update — provide caption and/or body" },
      { status: 400 }
    );
  }
  try {
    const saved = await patchDraft(id, patch);
    if (!saved) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      id,
      override: { caption: saved.caption, updated_at: saved.updated_at },
    });
  } catch (e) {
    return NextResponse.json({ error: "li_drafts patch failed", detail: String(e) }, { status: 500 });
  }
}
