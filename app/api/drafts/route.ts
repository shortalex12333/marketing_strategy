import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getAllDraftOverrides } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface Draft {
  id: string;
  caption?: string;
  body?: string;
  [k: string]: unknown;
}

export async function GET() {
  try {
    const fp = path.join(process.cwd(), "data", "drafts.json");
    const text = fs.readFileSync(fp, "utf8");
    const data = JSON.parse(text);

    // Merge Redis-stored caption/body overrides on top of the static defaults
    let overrides: Record<string, { caption?: string; body?: string; updated_at: string }> = {};
    try {
      overrides = await getAllDraftOverrides();
    } catch {
      // Redis down — return defaults
    }

    const drafts: Draft[] = (data.drafts || []).map((d: Draft) => {
      const o = overrides[d.id];
      if (!o) return d;
      return {
        ...d,
        caption: o.caption ?? d.caption,
        body: o.body ?? d.body,
        edited_at: o.updated_at,
      };
    });

    return NextResponse.json({ ...data, drafts });
  } catch (e) {
    return NextResponse.json(
      { error: "drafts.json missing or invalid", detail: String(e) },
      { status: 500 }
    );
  }
}
