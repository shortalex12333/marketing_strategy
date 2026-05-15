/**
 * Bearer-token auth for write endpoints.
 *
 * Set CAPTURE_API_TOKEN in Vercel env. Local capture agent sends:
 *   Authorization: Bearer <token>
 *
 * Read endpoints are NOT gated here — rely on Vercel Deployment Protection
 * (turn on "Vercel Authentication" in project settings) to scope the UI to
 * your Vercel account.
 */
export function checkBearer(req: Request): { ok: boolean; reason?: string } {
  const expected = process.env.CAPTURE_API_TOKEN;
  if (!expected) {
    return { ok: false, reason: "CAPTURE_API_TOKEN env not set" };
  }
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: "missing bearer token" };
  if (match[1].trim() !== expected) return { ok: false, reason: "invalid token" };
  return { ok: true };
}
