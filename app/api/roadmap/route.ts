import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
      slot: d.ord ?? 0,
      proposed_day: "",
      hook: d.hook ?? "",
      usp: d.usp ?? "",
      caption: d.caption ?? "",
      slides: Array.isArray(d.slides) ? d.slides : [],
      ord: d.ord,
      targets: d.targets ?? [],
      scenario: d.scenario ?? "",
      anchor: d.anchor ?? "",
      atmosphere: "",
      emphasis_word: "",
      why_engages: d.rationale ?? "",
      anti_sameness: "",
      bank_ref: d.bank_id ?? "",
      approval_status: d.approval_status,
    }));
    return NextResponse.json({
      version: "supabase-jarvis-2026-05-29",
      source: "li_drafts.slides (Jarvis Supabase project)",
      wave: 2,
      status: "in progress",
      format: "9-slide carousel",
      cadence: "1/week",
      moodboard_atmospheres: {
        red: "cost / consequence — the price of doing nothing",
        amber: "ticking-clock urgency — the moment before the cost lands",
        teal: "the mode-flip — the system arriving",
        green: "resolution — slide 8/9 only, the after-state",
      },
      carousels,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "li_drafts query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
