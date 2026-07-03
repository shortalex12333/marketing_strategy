import { NextResponse } from "next/server";
import { approveDraft, unapproveDraft, denyDraft, deriveFormat, scheduleNextAvailableSlot } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** POST /api/drafts/:id/approve — the CEO approves a draft for publishing.
 *  Sets approval_status = "approved" (the manual publisher picks these up on
 *  command), then assigns it the next real open li_schedule slot — approving
 *  a draft never implies "post it now," and the Schedule tab always shows a
 *  live upcoming date instead of whatever date the slot was seeded with weeks
 *  earlier. Reversible via DELETE (schedule slot is left as-is on unapprove;
 *  it'll just get reassigned forward again on the next approve). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const decision = new URL(req.url).searchParams.get("decision");
  try {
    const draft = decision === "deny" ? await denyDraft(id) : await approveDraft(id);
    if (!draft) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    if (decision !== "deny") {
      const format = (draft as { format?: string | null }).format || deriveFormat(draft);
      try {
        await scheduleNextAvailableSlot(id, format);
      } catch (schedErr) {
        // Approval itself succeeded — a scheduling hiccup shouldn't block it,
        // but surface it so it isn't silently lost.
        return NextResponse.json({
          ok: true, id, approval_status: draft.approval_status,
          warning: `approved, but schedule assignment failed: ${String(schedErr)}`,
        });
      }
    }
    return NextResponse.json({ ok: true, id, approval_status: draft.approval_status });
  } catch (e) {
    return NextResponse.json({ error: "decision failed", detail: String(e) }, { status: 500 });
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
