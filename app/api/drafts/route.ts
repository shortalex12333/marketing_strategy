import { NextResponse } from "next/server";
import { listDrafts, deriveFormat } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
