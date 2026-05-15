/**
 * Engagement Quality Score (EQS) — per skill §18.4
 * EQS = ((saves × 5) + (reposts × 4) + (comments × 3) + (clicks × 2) + (reactions × 1))
 *       / impressions × 1000
 */
export function eqs(
  impressions: number | null | undefined,
  reactions: number | null | undefined = 0,
  comments: number | null | undefined = 0,
  reposts: number | null | undefined = 0,
  saves: number | null | undefined = 0,
  clicks: number | null | undefined = 0,
): number | null {
  const imp = Number(impressions || 0);
  if (imp <= 0) return null;
  const score =
    Number(saves || 0) * 5 +
    Number(reposts || 0) * 4 +
    Number(comments || 0) * 3 +
    Number(clicks || 0) * 2 +
    Number(reactions || 0) * 1;
  return Math.round((score / imp) * 1000 * 100) / 100;
}
