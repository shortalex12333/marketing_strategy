import { NextResponse } from "next/server";
import { listSchedule, listDrafts } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [rows, drafts] = await Promise.all([listSchedule(), listDrafts()]);
    const byId = new Map(drafts.map((d) => [d.id, d]));
    return NextResponse.json({
      version: "supabase-jarvis-2026-05-29",
      source: "li_schedule (Jarvis Supabase project)",
      calendar: rows.map((r) => {
        const d = byId.get(r.post_id);
        return {
          post_id: r.post_id,
          bank_id: d?.bank_id ?? "",
          date: r.date,
          time_utc: r.time_utc.slice(0, 5),
          day: r.day ?? "",
          slot_label: r.slot_label ?? "",
          // Source of truth is the joined draft's own approval_status — li_schedule's
          // copy of this field is never updated after a post is approved/denied/posted
          // (scheduleNextAvailableSlot() only touches date/time_utc/slot_label on
          // approve), so reading r.approval_status here silently went stale the moment
          // any post was approved. Fall back to the schedule row only if a draft is
          // somehow missing (shouldn't happen, but fails safe rather than crashing).
          approval_status: d?.approval_status ?? r.approval_status,
          hook: d?.hook ?? "(no draft found for this scheduled slot)",
          format: r.slot_label ?? "carousel",
          rationale: d?.rationale ?? "",
          doc_title: d?.doc_title ?? "",
          pdf_url: d?.pdf_url ?? null,
          storage_slug: d?.storage_slug ?? null,
        };
      }),
      checkpoints: [] as Array<{ date: string; label: string; action: string }>,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "li_schedule query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
