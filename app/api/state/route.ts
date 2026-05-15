import { NextResponse } from "next/server";
import { listPosts, listCaptures } from "@/lib/redis";
import { loadBank } from "@/lib/bank";
import { eqs } from "@/lib/eqs";

export const dynamic = "force-dynamic";

export async function GET() {
  const [posts, captures] = await Promise.all([listPosts(), listCaptures()]);
  const valid = captures
    .map((r) =>
      eqs(r.impressions, r.reactions, r.comments, r.reposts, r.saves, r.clicks)
    )
    .filter((n): n is number => n !== null);
  const avg = valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100 : null;
  const bank = loadBank();
  return NextResponse.json({
    posts_count: posts.length,
    captures_count: captures.length,
    bank_count: bank.length,
    avg_eqs: avg,
    now_utc: new Date().toISOString(),
  });
}
