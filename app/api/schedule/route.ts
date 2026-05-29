import { NextResponse } from "next/server";
import { listSchedule } from "@/lib/supabase";

export const revalidate = 60;

export async function GET() {
  try {
    const rows = await listSchedule();
    return NextResponse.json({
      version: "supabase-jarvis-2026-05-29",
      source: "li_schedule (Jarvis Supabase project)",
      calendar: rows.map((r) => ({
        post_id: r.post_id,
        date: r.date,
        time_utc: r.time_utc.slice(0, 5),
        day: r.day,
        slot_label: r.slot_label,
        approval_status: r.approval_status,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "li_schedule query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
