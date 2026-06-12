import { NextResponse } from "next/server";
import { triggerRevise, countPendingRevisions } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** GET — how many drafts have un-actioned comments (for the button badge). */
export async function GET() {
  try {
    return NextResponse.json({ pending: await countPendingRevisions() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST — founder pressed "Trigger Changes": write the signal the local engine
 *  polls, and report how many drafts it will revise. */
export async function POST() {
  try {
    const r = await triggerRevise();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: "trigger failed", detail: String(e) }, { status: 500 });
  }
}
