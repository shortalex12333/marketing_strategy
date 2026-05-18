import { kvGet, kvSet } from "./redis";

/**
 * LinkedIn Pages Data Portability (DMA) fetch + transpose.
 *
 * Rate-safety: the ONLY hard limit is dmaFeedContentsExternal = 1 req / 60s.
 * The route layer gates live fetches behind a 6h Redis freshness window, so
 * the feed endpoint is hit ≤ ~1×/6h regardless of UI traffic.
 *
 * Token: prefers a rotated token in Redis (linkedin:access_token), falls back
 * to LINKEDIN_ACCESS_TOKEN env. On 401 it refreshes via the refresh token and
 * writes the new token to Redis (no redeploy needed for 60-day expiry).
 */

const API = "https://api.linkedin.com/rest";
const VERSION = "202605";
const ACCESS_KEY = "linkedin:access_token";
const REFRESH_KEY = "linkedin:refresh_token";

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

async function currentToken(): Promise<string> {
  return (await kvGet(ACCESS_KEY)) || env("LINKEDIN_ACCESS_TOKEN");
}

async function refreshToken(): Promise<string> {
  const refresh = (await kvGet(REFRESH_KEY)) || env("LINKEDIN_REFRESH_TOKEN");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: env("LINKEDIN_CLIENT_ID"),
    client_secret: env("LINKEDIN_CLIENT_SECRET"),
  });
  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token refresh failed ${r.status}`);
  const j = await r.json();
  await kvSet(ACCESS_KEY, j.access_token, 50 * 24 * 3600);
  if (j.refresh_token) await kvSet(REFRESH_KEY, j.refresh_token, 360 * 24 * 3600);
  return j.access_token as string;
}

async function liGet(
  path: string,
  retryAuth = true
): Promise<{ status: number; json: unknown }> {
  const tok = await currentToken();
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": VERSION,
    },
  });
  const text = await res.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  if (res.status === 401 && retryAuth) {
    await refreshToken();
    return liGet(path, false);
  }
  return { status: res.status, json };
}

const enc = (u: string) => encodeURIComponent(u);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Derive a human post type from the DMA post `content` union. */
function postType(p: Record<string, unknown>): string {
  const c = p.content as Record<string, unknown> | undefined;
  if (!c) return "text";
  if (c.poll) return "poll";
  if (c.multiImage) return "multi-image";
  if (c.article || c.reference) return "article";
  if (c.carousel) return "carousel (sponsored)";
  if (c.celebration) return "celebration";
  const m = c.media as Record<string, unknown> | undefined;
  if (m) {
    const id = String(
      (m.media as string) || (m.id as string) || JSON.stringify(m)
    ).toLowerCase();
    if (id.includes("document")) return "document (carousel/PDF)";
    if (id.includes("video")) return "video";
    if (id.includes("image")) return "image";
    return "media";
  }
  return "text";
}

/** Extract readable caption from the DMA "little text" commentary field. */
function caption(p: Record<string, unknown>): string {
  const c = p.commentary as unknown;
  if (!c) return "";
  if (typeof c === "string") return c;
  if (typeof c === "object" && c && "text" in c) {
    return String((c as { text: unknown }).text ?? "");
  }
  return "";
}

interface PageReport {
  fetched_at: string;
  org: string;
  posts: Array<{
    urn: string;
    type: string;
    caption: string;
    publishedAt: number | null;
    published: string;
    lifecycle: string;
    impressions: number;
    clicks: number;
    reactions: number;
    comments: number;
    ctr: string;
  }>;
  by_type: Record<string, { n: number; impressions: number; clicks: number; reactions: number }>;
  visitors_360d: number | null;
  followers_360d: number | null;
  notes: string;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return 0;
}

export async function buildPageReport(): Promise<PageReport> {
  const org = process.env.LINKEDIN_ORG_ID || "104807997";
  const orgUrn = `urn:li:organization:${org}`;
  const pageUrn = `urn:li:organizationalPage:${org}`;
  const now = Date.now();
  const start = now - 360 * 24 * 3600 * 1000;
  const ti = `(timeRange:(start:${start},end:${now}))`;

  // 1. ONE feed call
  const feed = await liGet(
    `/dmaFeedContentsExternal?author=${enc(orgUrn)}&maxPaginationCount=100&q=postsByAuthor`
  );
  if (feed.status !== 200) throw new Error(`feed ${feed.status}: ${JSON.stringify(feed.json).slice(0, 200)}`);
  const urns: string[] = ((feed.json as { elements?: { id: string }[] }).elements || []).map((e) => e.id);
  if (!urns.length) {
    return {
      fetched_at: new Date().toISOString(), org, posts: [], by_type: {},
      visitors_360d: null, followers_360d: null,
      notes: "No posts visible (or 48h ingestion delay).",
    };
  }

  const ids = "List(" + urns.map(enc).join(",") + ")";
  const postsRes = await liGet(`/dmaPosts?ids=${ids}&viewContext=READER`);
  const postsMap = (postsRes.json as { results?: Record<string, Record<string, unknown>> }).results || {};
  const smRes = await liGet(`/dmaSocialMetadata?ids=${ids}`);
  const smMap = (smRes.json as { results?: Record<string, Record<string, unknown>> }).results || {};

  const posts: PageReport["posts"] = [];
  for (let i = 0; i < urns.length; i++) {
    const u = urns[i];
    const p = postsMap[u] || {};
    const sm = smMap[u] || {};
    const rsum = (sm.reactionSummaries as Record<string, { count?: number }>) || {};
    const reactions = Object.values(rsum).reduce((a, r) => a + (r.count || 0), 0);
    const comments = ((sm.commentSummary as { count?: number }) || {}).count || 0;

    let impressions = 0, clicks = 0;
    const an = await liGet(
      `/dmaOrganizationalPageContentAnalytics?q=trend&sourceEntity=${enc(u)}` +
      `&metricTypes=List(IMPRESSIONS,CLICKS,REACTIONS,COMMENTS)&timeIntervals=${ti}`
    );
    if (an.status === 200) {
      for (const el of (an.json as { elements?: Array<Record<string, unknown>> }).elements || []) {
        const t = el.type as string;
        const tc = ((el.metric as Record<string, unknown>)?.value as Record<string, unknown>)?.totalCount as Record<string, unknown> | undefined;
        const v = num(tc?.long ?? tc?.bigDecimal);
        if (t === "IMPRESSIONS") impressions += v;
        if (t === "CLICKS") clicks += v;
      }
    }
    const pubAt = (p.publishedAt as number) ?? null;
    posts.push({
      urn: u,
      type: postType(p),
      caption: caption(p).replace(/\s+/g, " ").trim(),
      publishedAt: pubAt,
      published: pubAt ? new Date(pubAt).toISOString().slice(0, 10) : "—",
      lifecycle: String(p.lifecycleState ?? "—"),
      impressions, clicks, reactions, comments,
      ctr: impressions ? ((clicks / impressions) * 100).toFixed(1) + "%" : "—",
    });
    if (i < urns.length - 1) await sleep(2500); // privacy-budget spacing
  }

  // segment aggregate by post type
  const by_type: PageReport["by_type"] = {};
  for (const p of posts) {
    const b = (by_type[p.type] ||= { n: 0, impressions: 0, clicks: 0, reactions: 0 });
    b.n++; b.impressions += p.impressions; b.clicks += p.clicks; b.reactions += p.reactions;
  }

  await sleep(2500);
  const foll = await liGet(
    `/dmaOrganizationalPageEdgeAnalytics?q=trend&organizationalPage=${enc(pageUrn)}` +
    `&analyticsType=FOLLOWER&timeIntervals=${ti}`
  );
  await sleep(2500);
  const vis = await liGet(
    `/dmaOrganizationalPageEdgeAnalytics?q=dimension&organizationalPage=${enc(pageUrn)}` +
    `&analyticsType=VISITOR&dimensionType=JOB_FUNCTION&timeRange=(start:${start},end:${now})`
  );
  const sumEls = (j: unknown): number | null => {
    const els = (j as { elements?: Array<Record<string, unknown>> })?.elements;
    if (!els) return null;
    return els.reduce((a, e) => {
      const tc = (e.value as Record<string, unknown>)?.totalCount as Record<string, unknown> | undefined;
      return a + num(tc?.long);
    }, 0);
  };

  posts.sort((a, b) => b.impressions - a.impressions);

  const report: PageReport = {
    fetched_at: new Date().toISOString(),
    org,
    posts,
    by_type,
    followers_360d: foll.status === 200 ? sumEls(foll.json) : null,
    visitors_360d: vis.status === 200 ? sumEls(vis.json) : null,
    notes:
      "Company page only. Data up to 48h delayed. Sub-threshold analytics " +
      "return 0 with small privacy randomisation. Followers gated by member opt-in.",
  };
  return report;
}

export const REPORT_KEY = "linkedin:pages:report";
