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
          approval_status: r.approval_status,
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
