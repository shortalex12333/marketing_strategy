import { NextResponse } from "next/server";
import { listPosts, listCaptures } from "@/lib/supabase";
import { loadBank } from "@/lib/bank";
import { eqs } from "@/lib/eqs";
import type { BankEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Brief generator — picks N posts from the bank with rotation rules.
 * Rules:
 *   1. No two picks share the same USP code (U1–U5 / BRAND / INDUSTRY)
 *   2. No two picks share the same scenario number
 *   3. Primary stakeholders rotated
 *   4. Validated posts (anchor contains [VAL] or impression number) weighted +5
 *   5. Posts referenced in scheduled_posts within the last 14 days are excluded
 *      (if the post's hook line appears in any scheduled URL/label — best-effort)
 */

function uspCode(e: BankEntry): string {
  const m = /\bU([1-5])\b/.exec(e.usp);
  if (m) return `U${m[1]}`;
  const usp = e.usp.toLowerCase();
  if (usp.includes("brand") || usp.includes("founder")) return "BRAND";
  if (usp.includes("industry")) return "INDUSTRY";
  return "OTHER";
}

function primaryTarget(e: BankEntry): string {
  const m = /\b(CE|CAPT|CO|CS|PURSER|ENG2|BOSUN|JC|FM|OWN|YPM|SRV)\b/.exec(e.targets);
  return m ? m[1] : "?";
}

function scenarioCode(e: BankEntry): string {
  const m = /\b(\d+)\b/.exec(e.scenario);
  return m ? m[1] : "any";
}

function score(e: BankEntry): number {
  let s = 0;
  if (/\[VAL\]/i.test(e.anchor) || /imp\b/i.test(e.anchor)) s += 5;
  return s;
}

interface BriefPick extends BankEntry {
  usp_code: string;
  primary_target: string;
  scenario_code: string;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const modeRaw = String(body.mode || "recovery").toLowerCase();
  const n = modeRaw === "daily" ? 5 : modeRaw === "ramp" ? 4 : 3;
  const mode = modeRaw === "daily" ? "daily" : modeRaw === "ramp" ? "ramp" : "recovery";

  const [bank, posts, captures] = await Promise.all([
    loadBank(),
    listPosts(),
    listCaptures(),
  ]);

  // Exclude recently-shipped: we look at the last 14 days of scheduled posts;
  // if the bank entry hook appears in any scheduled post's URL/label, skip.
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentHooks = new Set<string>();
  const recentIds = new Set<string>();
  for (const p of posts) {
    if (new Date(p.published_at).getTime() >= cutoff) {
      const blob = `${p.id} ${p.url}`.toLowerCase();
      bank.forEach((b) => {
        if (
          blob.includes(b.id.toLowerCase()) ||
          (b.hook.length > 10 && blob.includes(b.hook.slice(0, 30).toLowerCase()))
        ) {
          recentIds.add(b.id);
          recentHooks.add(b.hook);
        }
      });
    }
  }

  // EQS-aware weighting (when captures exist): boost entries whose hook
  // appears in our top-EQS posts of the last 4 weeks.
  const fourWk = Date.now() - 28 * 24 * 60 * 60 * 1000;
  const recentCaps = captures.filter(
    (c) => new Date(c.captured_at_utc).getTime() >= fourWk
  );
  const eqsByPost: Record<string, number> = {};
  for (const c of recentCaps) {
    const e = eqs(c.impressions, c.reactions, c.comments, c.reposts, c.saves, c.clicks);
    if (e != null && (!eqsByPost[c.post_id] || e > eqsByPost[c.post_id])) {
      eqsByPost[c.post_id] = e;
    }
  }
  const sortedEQS = Object.values(eqsByPost).sort((a, b) => b - a);
  const medianEQS = sortedEQS.length
    ? sortedEQS[Math.floor(sortedEQS.length / 2)]
    : null;
  function bonusFromEQS(_e: BankEntry): number {
    // Without a structured link bank-id↔post-id, EQS feedback is approximate.
    // Reserved for future enhancement. v1: zero bonus.
    return 0;
  }

  const sorted = bank
    .filter((e) => !recentIds.has(e.id))
    .map((e) => ({ e, s: score(e) + bonusFromEQS(e) }))
    .sort((a, b) => b.s - a.s);

  const used = { usp: new Set<string>(), scenario: new Set<string>(), target: new Set<string>() };
  const picks: BriefPick[] = [];

  for (const { e } of sorted) {
    if (picks.length >= n) break;
    const u = uspCode(e);
    const s = scenarioCode(e);
    const t = primaryTarget(e);
    if (u !== "OTHER" && used.usp.has(u)) continue;
    if (s !== "any" && used.scenario.has(s)) continue;
    if (t !== "?" && used.target.has(t)) continue;
    picks.push({ ...e, usp_code: u, primary_target: t, scenario_code: s });
    used.usp.add(u); used.scenario.add(s); used.target.add(t);
  }

  return NextResponse.json({
    ok: true,
    mode,
    cadence: mode,
    picked: picks.length,
    median_eqs_trailing_4wk: medianEQS,
    picks,
  });
}

export async function GET() {
  return NextResponse.json({
    info: "POST { mode: 'recovery' | 'ramp' | 'daily' } to generate a brief",
  });
}
