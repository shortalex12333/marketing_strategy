import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/supabase";

export const revalidate = 60;

/**
 * The roadmap view is reconstructed from li_drafts (which carries the slides
 * jsonb column). Previously this read data/roadmap.json directly; that file
 * is now superseded by the Supabase migration 2026-05-29.
 */
export async function GET() {
  try {
    const drafts = await listDrafts();
    const carousels = drafts.map((d) => ({
      id: d.id,
      hook: d.hook,
      usp: d.usp,
      caption: d.caption,
      slides: d.slides,
      ord: d.ord,
      targets: d.targets,
      scenario: d.scenario,
      anchor: d.anchor,
      bank_ref: d.bank_id,
      approval_status: d.approval_status,
    }));
    return NextResponse.json({
      version: "supabase-jarvis-2026-05-29",
      source: "li_drafts.slides (Jarvis Supabase project)",
      carousels,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "li_drafts query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
