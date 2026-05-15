import { NextResponse } from "next/server";
import { getDraftOverride, putDraftOverride } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const o = await getDraftOverride(id);
  return NextResponse.json({ id, override: o });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { caption?: string; body?: string } = {};
  if (typeof body.caption === "string") patch.caption = body.caption;
  if (typeof body.body === "string") patch.body = body.body;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update — provide caption and/or body" }, { status: 400 });
  }
  const saved = await putDraftOverride(id, patch);
  return NextResponse.json({ ok: true, id, override: saved });
}
