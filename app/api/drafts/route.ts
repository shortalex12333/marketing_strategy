import { NextResponse } from "next/server";
import { listDrafts } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Prefer the real `format` column (added 2026-06-24 with the auto-poster). For
// legacy rows without it, derive from pdf_url / usp tag / slides[0].type so the
// reviewer still sees the right post type. Defaults to carousel.
function deriveFormat(row: {
  pdf_url?: string | null;
  usp?: string | null;
  slides?: unknown;
}): string {
  if (row.pdf_url) return "carousel";
  const m = (row.usp || "").match(/^\s*\[([^\]]+)\]/);
  const slides = Array.isArray(row.slides)
    ? (row.slides as Array<Record<string, unknown>>)
    : [];
  const s0 = slides[0] || {};
  const raw = String((m && m[1]) || s0.type || s0.t || "").toLowerCase();
  if (raw.includes("poll")) return "poll";
  if (raw.includes("video")) return "video";
  if (raw.includes("image") || raw.includes("component") || raw.includes("branded"))
    return "image";
  return "carousel";
}

export async function GET() {
  try {
    const rows = await listDrafts();
    return NextResponse.json({
      version: "supabase-jarvis-2026-05-29",
      source: "li_drafts (Jarvis Supabase project)",
      drafts: rows.map((r) => ({
        ...r,
        format: (r as { format?: string | null }).format || deriveFormat(r),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "li_drafts query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
