"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AugmentedPost,
  CaptureRow,
} from "@/lib/types";

type Tab = "board" | "analytics" | "pages" | "drafts";

interface DmaPost {
  urn: string; type: string; caption: string;
  publishedAt: number | null; published: string;
  lifecycle: string; impressions: number; clicks: number;
  reactions: number; comments: number; ctr: string;
  // Joined server-side back to our own drafting pipeline where a match was
  // found — null/absent for legacy or unmatched posts, never assume full coverage.
  _internal_format?: string | null;
  _pain_class?: string | null;
  _draft_id?: string | null;
}

interface PageReport {
  fetched_at: string;
  org: string;
  posts: DmaPost[];
  by_type: Record<string, { n: number; impressions: number; clicks: number; reactions: number }>;
  visitors_360d: number | null;
  followers_360d: number | null;
  notes: string;
  _source?: string;
  _age_min?: number;
}

type MetricsWindow = "7d" | "30d" | "90d";
const WINDOW_DAYS: Record<MetricsWindow, number> = { "7d": 7, "30d": 30, "90d": 90 };

const HOUR_BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: "Night (00–06 UTC)", from: 0, to: 6 },
  { label: "Morning (06–11 UTC)", from: 6, to: 11 },
  { label: "Midday (11–14 UTC)", from: 11, to: 14 },
  { label: "Afternoon (14–18 UTC)", from: 14, to: 18 },
  { label: "Evening (18–24 UTC)", from: 18, to: 24 },
];
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PAIN_CLASS_LABEL: Record<string, { label: string; color: string }> = {
  "handover": { label: "Handover", color: "#5AABCC" },
  "vitamin-search": { label: "Search (vitamin)", color: "#6FBF8B" },
  "anti-feature-receipts": { label: "Anti-feature receipts", color: "#E0635F" },
  "vitamin-intelligence": { label: "Intelligence (vitamin)", color: "#6FBF8B" },
  "vitamin-onboarding": { label: "Onboarding (vitamin)", color: "#6FBF8B" },
  "unknown": { label: "Unclassified", color: "#666" },
};

function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

interface DraftSlide {
  n: number;
  mode: "dark" | "light";
  h?: string;
  b?: string;
  q?: string;
  c?: string;
  type?: string;
  card?: string;
  bg_variant?: string;
}

interface Draft {
  id: string;
  bank_id: string;
  ord: number;
  created_at?: string;
  format: string;
  hook: string;
  body?: string;
  doc_title?: string;
  usp: string;
  targets: string[];
  scenario: string;
  posting_day_proposal: string;
  posting_time_utc: string;
  char_count?: number;
  rationale: string;
  anchor: string;
  approval_status: string;
  render_required: boolean;
  render_status?: string;
  pdf_url?: string;
  storage_slug?: string;
  caption?: string;
  alt_text?: string;
  slides?: DraftSlide[];
  poll?: { question?: string; options?: string[] } | null;
  description?: string;
}

const CAROUSEL_BUCKET_URL =
  "https://verhpfznevahwxfawnwn.supabase.co/storage/v1/object/public/carousels";

interface DraftsResponse {
  version: string;
  source: string;
  fix_log: string[];
  drafts: Draft[];
}

interface ScheduleItem {
  post_id: string;
  bank_id: string;
  day: string;
  date: string;
  time_utc: string;
  hook: string;
  format: string;
  rationale: string;
  approval_status: string;
  doc_title?: string;
  pdf_url?: string | null;
  storage_slug?: string | null;
  created_at?: string | null;
}

interface ScheduleResponse {
  version: string;
  calendar: ScheduleItem[];
}

interface AppState {
  posts_count: number;
  captures_count: number;
  bank_count: number;
  avg_eqs: number | null;
  now_utc: string;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return s;
  }
}

function EqsBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="eqs-badge low">—</span>;
  const cls = value >= 50 ? "high" : value >= 20 ? "med" : "low";
  return <span className={`eqs-badge ${cls}`}>{value}</span>;
}

function CapturePills({
  captures,
}: {
  captures: AugmentedPost["captures"];
}) {
  const ckpts: Array<"30m" | "60m" | "6h" | "24h"> = ["30m", "60m", "6h", "24h"];
  return (
    <div className="pills">
      {ckpts.map((cp) => {
        const c = captures?.[cp];
        if (c) {
          return (
            <span
              key={cp}
              className={`pill ${c.error ? "error" : "done"}`}
              title={c.error || ""}
            >
              {cp} {c.error ? "⚠" : "✓"}
            </span>
          );
        }
        return (
          <span key={cp} className="pill pending">
            {cp}
          </span>
        );
      })}
    </div>
  );
}

/** One wedge of a pie/donut, cx/cy/r in SVG units, angles in degrees (0 = top, clockwise). */
function pieSlicePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const a0 = ((startDeg - 90) * Math.PI) / 180;
  const a1 = ((endDeg - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large},1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
}

/** A simple SVG line-chart path (and matching point list) for a series of numbers. */
function sparklinePath(values: number[], w: number, h: number, pad = 6): { path: string; points: { x: number; y: number }[] } {
  if (values.length === 0) return { path: "", points: [] };
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => ({
    x: pad + i * step,
    y: h - pad - ((v - min) / range) * (h - pad * 2),
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, points };
}

type PostHealth = "live" | "pending" | "stuck" | "dead";
const HEALTH_COLOR: Record<PostHealth, string> = {
  live: "#5cb88c", pending: "#c8a85c", stuck: "#c87b7b", dead: "#666",
};

export default function Page() {
  const [tab, setTab] = useState<Tab>("board");
  const [state, setState] = useState<AppState | null>(null);
  const [posts, setPosts] = useState<AugmentedPost[]>([]);
  const [analytics, setAnalytics] = useState<(CaptureRow & { eqs: number | null })[]>([]);
  const [drafts, setDrafts] = useState<DraftsResponse | null>(null);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("");
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [pageReport, setPageReport] = useState<PageReport | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>("30d");
  // When a calendar row's Comment/Posted button opens the draft, tell DraftDetail
  // which action to jump to.
  const [rowAuto, setRowAuto] = useState<"posted" | "comment" | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);

  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [pub, setPub] = useState("");

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch {}
  }, []);

  const loadPosts = useCallback(async () => {
    try {
      const r = await fetch("/api/scheduled-posts", { cache: "no-store" });
      if (r.ok) setPosts(await r.json());
    } catch {}
  }, []);

  const loadAnalytics = useCallback(async () => {
    const r = await fetch("/api/captures", { cache: "no-store" });
    if (r.ok) setAnalytics(await r.json());
  }, []);

  const loadDrafts = useCallback(async () => {
    const r = await fetch("/api/drafts", { cache: "no-store" });
    if (r.ok) setDrafts(await r.json());
  }, []);

  const loadSchedule = useCallback(async () => {
    const r = await fetch("/api/schedule", { cache: "no-store" });
    if (r.ok) setSchedule(await r.json());
  }, []);

  const loadPages = useCallback(async (force = false) => {
    setPagesLoading(true);
    try {
      const r = await fetch("/api/linkedin-pages" + (force ? "?refresh=1" : ""), { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        setPageReport(j);
        setPagesError(null);
      } else {
        // Previously: a failed fetch left the UI silently stuck on "Loading…"
        // forever, indistinguishable from still-in-progress. Surface it.
        setPagesError((j && (j.error || j._source)) || `Request failed (${r.status})`);
      }
    } catch (e) {
      setPagesError((e as Error).message || "Network error");
    } finally {
      setPagesLoading(false);
    }
  }, []);

  // "Trigger Changes" — bulk-revise every draft that has un-actioned comments.
  const [revising, setRevising] = useState(false);
  const triggerRevise = async () => {
    setRevising(true);
    try {
      const r = await fetch("/api/trigger-revise", { method: "POST" });
      const j = await r.json();
      if (r.ok)
        showToast(
          j.pending > 0
            ? `Trigger sent — ${j.pending} commented draft(s) will be revised within ~15 min`
            : "No drafts have new comments yet — nothing to revise"
        );
      else showToast(j.error || "Trigger failed", "error");
    } catch {
      showToast("Trigger failed", "error");
    } finally {
      setRevising(false);
    }
  };

  useEffect(() => {
    loadState();
    loadPosts();
    const i = setInterval(() => {
      loadState();
      loadPosts();
    }, 30_000);
    return () => clearInterval(i);
  }, [loadState, loadPosts]);

  useEffect(() => {
    if (tab === "analytics") {
      loadAnalytics();
      if (!pageReport) loadPages();
    }
    if (tab === "drafts" && !drafts) loadDrafts();
    if (tab === "board") {
      if (!schedule) loadSchedule();
      if (!drafts) loadDrafts();
    }
    if (tab === "pages" && !pageReport) loadPages();
  }, [tab, loadAnalytics, loadDrafts, loadSchedule, loadPages, drafts, schedule, pageReport]);

  const handleDraftSaved = (id: string, patch: { caption?: string; body?: string; approval_status?: string }) => {
    setDrafts((prev) =>
      prev ? { ...prev, drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : prev
    );
    // When a post is marked posted, mirror the status onto the schedule item so it
    // drops out of "left to post" immediately, and collapse the row.
    if (patch.approval_status) {
      setSchedule((s) =>
        s ? { ...s, calendar: s.calendar.map((c) => (c.post_id === id ? { ...c, approval_status: patch.approval_status! } : c)) } : s
      );
      setExpandedDraft((cur) => (cur === id ? null : cur));
    }
  };

  // Approve straight from a schedule row (no need to open the draft).
  const approveScheduled = async (postId: string) => {
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(postId)}/approve`, { method: "POST" });
      const j = await r.json();
      if (r.ok) {
        handleDraftSaved(postId, { approval_status: j.approval_status });
        showToast("Approved — queued to publish.");
      } else {
        showToast(j.error || "Approve failed", "error");
      }
    } catch (e) {
      showToast("Error: " + (e as Error).message, "error");
    }
  };

  // Deny straight from the board / a row.
  const denyScheduled = async (postId: string) => {
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(postId)}/approve?decision=deny`, { method: "POST" });
      const j = await r.json();
      if (r.ok) {
        handleDraftSaved(postId, { approval_status: j.approval_status });
        showToast("Denied.");
      } else {
        showToast(j.error || "Deny failed", "error");
      }
    } catch (e) {
      showToast("Error: " + (e as Error).message, "error");
    }
  };

  const submitPost = async () => {
    if (!url.trim()) {
      showToast("URL required", "error");
      return;
    }
    let publishedAt = pub;
    if (pub && !pub.endsWith("Z") && !pub.includes("+")) {
      publishedAt = new Date(pub).toISOString();
    }
    try {
      const r = await fetch("/api/scheduled-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          id: label.trim() || undefined,
          published_at: publishedAt || undefined,
        }),
      });
      const j = await r.json();
      if (j.warning) showToast(j.warning, "error");
      else showToast("Post scheduled. Local capture cron fires at +30m / +60m / +6h / +24h.");
      setUrl("");
      setLabel("");
      setPub("");
      loadState();
      loadPosts();
    } catch (e) {
      showToast("Error: " + (e as Error).message, "error");
    }
  };

  const deletePost = async (id: string) => {
    if (!confirm(`Remove ${id}? (Stops future captures; log rows remain.)`)) return;
    const r = await fetch(`/api/scheduled-posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (r.ok) {
      showToast("Removed " + id);
      loadPosts();
      loadState();
    } else {
      showToast("Delete failed", "error");
    }
  };

  // Analytics: classify each post's real capture health instead of trusting the
  // "not_yet_in_api (48h ingestion delay)" string at face value — several posts
  // stay in that state 10-40+ days past publish, which is a dead pipeline, not
  // a delay. live = a real non-error capture exists; dead = zero capture rows
  // ever; stuck = only errors, and older than the real 48h ingestion window;
  // pending = genuinely still inside that window.
  const postHealth = useMemo(() => {
    const now = Date.now();
    return posts.map((p) => {
      const hasReal = !!p._latest_capture && p._latest_capture.impressions != null && !p._latest_capture.error;
      const ageDays = (now - new Date(p.published_at).getTime()) / 86_400_000;
      let status: PostHealth;
      if (hasReal) status = "live";
      else if (p._captures_count === 0) status = "dead";
      else if (ageDays > 2) status = "stuck";
      else status = "pending";
      return { ...p, _status: status };
    });
  }, [posts]);

  const healthCounts = useMemo(() => {
    const c: Record<PostHealth, number> = { live: 0, pending: 0, stuck: 0, dead: 0 };
    for (const p of postHealth) c[p._status]++;
    return c;
  }, [postHealth]);

  // Per-post mean, not per-row — averaging across all 4900+ raw capture rows
  // over-weights whichever posts happened to get polled successfully more often.
  const avgEqsPerPost = useMemo(() => {
    const vals = postHealth.filter((p) => p._eqs != null).map((p) => p._eqs as number);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [postHealth]);

  const avgCtrPerPost = useMemo(() => {
    const vals = postHealth
      .filter((p) => (p._latest_capture?.impressions ?? 0) > 0 && p._latest_capture?.clicks != null)
      .map((p) => (p._latest_capture!.clicks as number) / (p._latest_capture!.impressions as number));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
  }, [postHealth]);

  // One trend line: total real (max-seen-per-post-per-day) impressions per day,
  // across live/pending posts only — excludes stuck/dead posts and the ~96% of
  // rows that are unchanged hourly re-polls of the same value.
  const trendByDay = useMemo(() => {
    const eligibleIds = new Set(postHealth.filter((p) => p._status !== "dead" && p._status !== "stuck").map((p) => p.id));
    const byPostDay = new Map<string, number>();
    for (const r of analytics) {
      if (!eligibleIds.has(r.post_id) || r.impressions == null) continue;
      const day = r.captured_at_utc.slice(0, 10);
      const key = `${r.post_id}|${day}`;
      byPostDay.set(key, Math.max(byPostDay.get(key) ?? 0, r.impressions));
    }
    const byDay = new Map<string, number>();
    for (const [key, val] of byPostDay) {
      const day = key.split("|")[1];
      byDay.set(day, (byDay.get(day) ?? 0) + val);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [analytics, postHealth]);

  // ─── Real LinkedIn post metrics (DMA API), windowed 7d/30d/90d ───────────
  // Everything below reads pageReport.posts — the official LinkedIn Data
  // Portability numbers (impressions/clicks/reactions/comments per real
  // published post), not the internal capture-pipeline health data above.
  const windowPosts = useMemo(() => {
    if (!pageReport) return [];
    const cutoff = Date.now() - WINDOW_DAYS[metricsWindow] * 86_400_000;
    return pageReport.posts.filter((p) => (p.publishedAt ?? 0) >= cutoff);
  }, [pageReport, metricsWindow]);

  const realAvgMetrics = useMemo(() => {
    const n = windowPosts.length;
    if (!n) return null;
    return {
      n,
      impressions: mean(windowPosts.map((p) => p.impressions)),
      clicks: mean(windowPosts.map((p) => p.clicks)),
      reactions: mean(windowPosts.map((p) => p.reactions)),
      comments: mean(windowPosts.map((p) => p.comments)),
      ctr: mean(windowPosts.filter((p) => p.impressions > 0).map((p) => (p.clicks / p.impressions) * 100)),
    };
  }, [windowPosts]);

  const realBestPost = useMemo(() => {
    if (!windowPosts.length) return null;
    return [...windowPosts].sort((a, b) => b.impressions - a.impressions)[0];
  }, [windowPosts]);

  // Best time of day: UTC-hour buckets from the real publishedAt timestamp.
  const realByHour = useMemo(() => {
    return HOUR_BUCKETS.map((b) => {
      const inBucket = windowPosts.filter((p) => {
        if (p.publishedAt == null) return false;
        const h = new Date(p.publishedAt).getUTCHours();
        return h >= b.from && h < b.to;
      });
      return { ...b, n: inBucket.length, avgImpressions: mean(inBucket.map((p) => p.impressions)) };
    }).sort((a, b) => (b.avgImpressions ?? -1) - (a.avgImpressions ?? -1));
  }, [windowPosts]);

  const realByWeekday = useMemo(() => {
    const byDay = new Map<number, DmaPost[]>();
    for (const p of windowPosts) {
      if (p.publishedAt == null) continue;
      const d = new Date(p.publishedAt).getUTCDay();
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p);
    }
    return WEEKDAY_LABELS.map((label, i) => {
      const ps = byDay.get(i) ?? [];
      return { label, n: ps.length, avgImpressions: mean(ps.map((p) => p.impressions)) };
    }).sort((a, b) => (b.avgImpressions ?? -1) - (a.avgImpressions ?? -1));
  }, [windowPosts]);

  // Best post type: prefer our own format taxonomy (carousel/poll/image/…)
  // where the enrichment join found a match, fall back to the DMA-derived
  // type for posts with no internal match, so coverage gaps don't just
  // silently drop posts from the ranking.
  const realByFormat = useMemo(() => {
    const byFmt = new Map<string, DmaPost[]>();
    for (const p of windowPosts) {
      const key = p._internal_format || p.type || "unknown";
      (byFmt.get(key) ?? byFmt.set(key, []).get(key)!).push(p);
    }
    const matched = windowPosts.filter((p) => p._internal_format).length;
    return {
      coverage: { matched, total: windowPosts.length },
      rows: [...byFmt.entries()]
        .map(([format, ps]) => ({ format, n: ps.length, avgImpressions: mean(ps.map((p) => p.impressions)) }))
        .sort((a, b) => (b.avgImpressions ?? -1) - (a.avgImpressions ?? -1)),
    };
  }, [windowPosts]);

  // Best angle (pain_class): only reaches posts whose draft also carries a
  // bank_id lineage — a real minority of posts. Surfaced with its coverage,
  // not hidden, and never dressed up as a full breakdown.
  const realByAngle = useMemo(() => {
    const withAngle = windowPosts.filter((p) => p._pain_class);
    const byClass = new Map<string, DmaPost[]>();
    for (const p of withAngle) {
      const key = p._pain_class!;
      (byClass.get(key) ?? byClass.set(key, []).get(key)!).push(p);
    }
    return {
      coverage: { matched: withAngle.length, total: windowPosts.length },
      rows: [...byClass.entries()]
        .map(([cls, ps]) => ({ cls, n: ps.length, avgImpressions: mean(ps.map((p) => p.impressions)) }))
        .sort((a, b) => (b.avgImpressions ?? -1) - (a.avgImpressions ?? -1)),
    };
  }, [windowPosts]);

  // Archive (formerly "Drafts"): every li_drafts row, newest first — not ord-sorted
  // (which buried undated new rows behind 235 older ones), with a status filter so
  // the founder isn't scrolling past denied/shelved/posted content by default.
  const sortedArchive = useMemo(() => {
    const all = drafts?.drafts ?? [];
    return [...all].sort((a, b) => {
      if (a.created_at && b.created_at) return b.created_at.localeCompare(a.created_at);
      if (a.created_at) return -1;
      if (b.created_at) return 1;
      return (b.ord ?? 0) - (a.ord ?? 0);
    });
  }, [drafts]);

  const filteredArchive = useMemo(() => {
    const q = archiveQuery.toLowerCase();
    return sortedArchive.filter((d) => {
      if (archiveStatus && !(d.approval_status || "").toLowerCase().startsWith(archiveStatus)) return false;
      if (!q) return true;
      return `${d.id} ${d.hook} ${d.doc_title ?? ""}`.toLowerCase().includes(q);
    });
  }, [sortedArchive, archiveQuery, archiveStatus]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span className="name">CELESTEOS · LINKEDIN</span>
          <span className="sub">LinkedIn module · Jarvis</span>
        </div>
        <div className="status">
          <span>{state ? `${state.posts_count} posts · ${state.captures_count} captures` : "—"}</span>
          <span className="now">
            {state ? "UTC " + new Date(state.now_utc).toLocaleTimeString("en-GB", { hour12: false }) : ""}
          </span>
        </div>
      </header>

      <nav className="tabs">
        {(["board", "analytics", "pages", "drafts"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "drafts" ? "Archive" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === "board" && (
          <>
            <details className="panel">
              <summary style={{ cursor: "pointer" }}><h2 style={{ display: "inline", margin: 0 }}>Submit a published post</h2></summary>
              <p className="small" style={{ marginTop: 10 }}>
                Paste the LinkedIn post URL immediately after publishing. The local capture agent fires at +30m / +60m / +6h / +24h.
              </p>
              <div className="form-row">
                <div className="form-group" style={{ flex: 3 }}>
                  <label>Post URL</label>
                  <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/feed/update/urn:li:activity:71XXXXXX…" />
                </div>
                <div className="form-group">
                  <label>Label (optional)</label>
                  <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="auto-generated if blank" />
                </div>
                <div className="form-group">
                  <label>Published at (UTC)</label>
                  <input type="datetime-local" value={pub} onChange={(e) => setPub(e.target.value)} />
                </div>
                <div className="form-group" style={{ flex: 0, minWidth: "auto" }}>
                  <label>&nbsp;</label>
                  <button onClick={submitPost}>Schedule</button>
                </div>
              </div>
            </details>
            {schedule ? (
              <Board
                items={schedule.calendar}
                onApprove={approveScheduled}
                onDeny={denyScheduled}
                onOpen={(id) => { setRowAuto(null); setExpandedDraft(id); }}
              />
            ) : (
              <div className="panel"><div className="empty">Loading board…</div></div>
            )}
          </>
        )}

        {tab === "analytics" && (
          <>
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Real LinkedIn post metrics · official Data Portability API</h2>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {(["7d", "30d", "90d"] as MetricsWindow[]).map((w) => (
                    <button
                      key={w}
                      className={metricsWindow === w ? "" : "ghost"}
                      onClick={() => setMetricsWindow(w)}
                    >
                      {w}
                    </button>
                  ))}
                  <button className="ghost" onClick={() => loadPages(true)} disabled={pagesLoading}>
                    {pagesLoading ? "Fetching…" : "Refresh"}
                  </button>
                </div>
              </div>
              {pageReport && (
                <p className="small" style={{ marginTop: 8 }}>
                  fetched {fmtDate(pageReport.fetched_at)} · source: {pageReport._source}
                  {pageReport._age_min != null ? ` · ${pageReport._age_min}m old` : ""}
                </p>
              )}
            </div>

            {!pageReport ? (
              pagesLoading ? (
                <div className="panel"><div className="empty">Fetching from LinkedIn (one feed call, rate-limited)…</div></div>
              ) : pagesError ? (
                <div className="panel">
                  <div className="empty" style={{ color: "var(--red)" }}>LinkedIn fetch failed: {pagesError}</div>
                  <p className="small" style={{ textAlign: "center", marginTop: 8 }}>
                    <button className="ghost" onClick={() => loadPages(true)}>Retry</button>
                  </p>
                </div>
              ) : (
                <div className="panel"><div className="empty">Loading…</div></div>
              )
            ) : windowPosts.length === 0 ? (
              <div className="panel">
                <div className="empty">
                  {`No real posts published in the last ${metricsWindow} (${pageReport.posts.length} total on record — try a wider window).`}
                </div>
              </div>
            ) : (
              <>
                <div className="stat-grid">
                  <Stat label="Posts in window" value={realAvgMetrics!.n} hint={`of ${pageReport.posts.length} total on record`} />
                  <Stat label="Avg impressions" value={realAvgMetrics!.impressions != null ? Math.round(realAvgMetrics!.impressions) : "—"} hint="per real published post" />
                  <Stat label="Avg CTR" value={realAvgMetrics!.ctr != null ? realAvgMetrics!.ctr.toFixed(1) + "%" : "—"} hint="clicks / impressions" />
                  <Stat label="Avg reactions + comments" value={realAvgMetrics!.reactions != null && realAvgMetrics!.comments != null ? (realAvgMetrics!.reactions + realAvgMetrics!.comments).toFixed(1) : "—"} hint="per post, real data" />
                </div>

                {realBestPost && (
                  <div className="panel">
                    <h2>Best post in window</h2>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <span className="tag">{realBestPost._internal_format || realBestPost.type}</span>
                        <p style={{ marginTop: 8 }}>{realBestPost.caption ? (realBestPost.caption.length > 160 ? realBestPost.caption.slice(0, 160) + "…" : realBestPost.caption) : <span className="small" style={{ color: "var(--text-2)" }}>(no caption / media-only)</span>}</p>
                        <a className="small mono" href={`https://www.linkedin.com/feed/update/${realBestPost.urn}`} target="_blank" rel="noopener noreferrer">{realBestPost.published} · open on LinkedIn</a>
                      </div>
                      <div className="mono small" style={{ textAlign: "right", color: "var(--text-2)" }}>
                        <div>{realBestPost.impressions} impressions</div>
                        <div>{realBestPost.clicks} clicks · {realBestPost.ctr} CTR</div>
                        <div>{realBestPost.reactions} reactions · {realBestPost.comments} comments</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="panel">
                  <h2>Best time to publish</h2>
                  <p className="small">Avg impressions per real post, grouped by when it actually went out (UTC).</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 12 }}>
                    <div>
                      <h3>By time of day</h3>
                      {realByHour.filter((b) => b.n > 0).length === 0 ? <div className="empty">No data in window.</div> : realByHour.map((b) => (
                        b.n > 0 && (
                          <div key={b.label} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span className="small">{b.label}</span>
                              <span className="mono small" style={{ color: "var(--teal)" }}>{b.avgImpressions != null ? Math.round(b.avgImpressions) : "—"} avg · n={b.n}</span>
                            </div>
                            <div style={{ background: "var(--bg-2)", borderRadius: 3, height: 6, marginTop: 3 }}>
                              <div style={{ width: `${Math.min(100, ((b.avgImpressions ?? 0) / (realByHour[0].avgImpressions || 1)) * 100)}%`, background: "var(--teal)", height: 6, borderRadius: 3 }} />
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                    <div>
                      <h3>By day of week</h3>
                      {realByWeekday.filter((d) => d.n > 0).length === 0 ? <div className="empty">No data in window.</div> : realByWeekday.map((d) => (
                        d.n > 0 && (
                          <div key={d.label} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span className="small">{d.label}</span>
                              <span className="mono small" style={{ color: "var(--teal)" }}>{d.avgImpressions != null ? Math.round(d.avgImpressions) : "—"} avg · n={d.n}</span>
                            </div>
                            <div style={{ background: "var(--bg-2)", borderRadius: 3, height: 6, marginTop: 3 }}>
                              <div style={{ width: `${Math.min(100, ((d.avgImpressions ?? 0) / (realByWeekday[0].avgImpressions || 1)) * 100)}%`, background: "var(--teal)", height: 6, borderRadius: 3 }} />
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                  <p className="small" style={{ marginTop: 10, color: "var(--text-2)" }}>
                    {`Small sample — ${realAvgMetrics!.n} real post${realAvgMetrics!.n === 1 ? "" : "s"} in this window. Treat as a directional signal, not a strong statistical result.`}
                  </p>
                </div>

                <div className="panel">
                  <h2>Best post type</h2>
                  <p className="small">
                    {`${realByFormat.coverage.matched} of ${realByFormat.coverage.total} posts matched back to our own format taxonomy; the rest fall back to LinkedIn's own content-type label.`}
                  </p>
                  <table>
                    <thead><tr><th>Format</th><th>Posts</th><th>Avg impressions</th></tr></thead>
                    <tbody>
                      {realByFormat.rows.map((r) => (
                        <tr key={r.format}>
                          <td><span className="tag">{r.format}</span></td>
                          <td className="mono">{r.n}</td>
                          <td className="mono" style={{ color: "var(--teal)" }}>{r.avgImpressions != null ? Math.round(r.avgImpressions) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="panel">
                  <h2>Best angle</h2>
                  {realByAngle.coverage.matched === 0 ? (
                    <div className="empty">
                      No posts in this window have a traceable pain-class lineage yet (bank_id → li_post_bank). This isn&rsquo;t buildable as a real breakdown until more published posts carry that link — showing nothing here rather than a misleading guess.
                    </div>
                  ) : (
                    <>
                      <p className="small" style={{ color: "var(--red)" }}>
                        {`Low sample: only ${realByAngle.coverage.matched} of ${realByAngle.coverage.total} posts in this window trace back to a classified angle. Directional only.`}
                      </p>
                      <table>
                        <thead><tr><th>Angle</th><th>Posts</th><th>Avg impressions</th></tr></thead>
                        <tbody>
                          {realByAngle.rows.map((r) => (
                            <tr key={r.cls}>
                              <td><span className="tag" style={{ color: PAIN_CLASS_LABEL[r.cls]?.color, borderColor: PAIN_CLASS_LABEL[r.cls]?.color }}>{PAIN_CLASS_LABEL[r.cls]?.label || r.cls}</span></td>
                              <td className="mono">{r.n}</td>
                              <td className="mono" style={{ color: "var(--teal)" }}>{r.avgImpressions != null ? Math.round(r.avgImpressions) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </>
            )}

            <h2 style={{ marginTop: 8, marginBottom: 12, color: "var(--text-2)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Internal capture-pipeline health · not LinkedIn performance data
            </h2>

            <div className="stat-grid">
              <Stat label="Avg EQS (per post)" value={avgEqsPerPost != null ? avgEqsPerPost.toFixed(1) : "—"} hint={`across ${healthCounts.live + healthCounts.pending} real posts, not per-row`} />
              <Stat label="Avg CTR" value={avgCtrPerPost != null ? avgCtrPerPost.toFixed(1) + "%" : "—"} hint="clicks / impressions, live posts only" />
              <Stat label="Capture health" value={`${healthCounts.live} live`} hint={`${healthCounts.stuck} stuck · ${healthCounts.dead} dead · ${healthCounts.pending} pending`} />
              <Stat label="Posts tracked" value={posts.length} hint="scheduled + captured" />
            </div>

            <div className="panel">
              <h2>Impressions per day · live &amp; pending posts</h2>
              <p className="small">Max-seen-per-post-per-day, summed across posts — not a raw hourly-poll count.</p>
              {trendByDay.length === 0 ? (
                <div className="empty">No real capture data yet.</div>
              ) : (() => {
                const w = 640, h = 180;
                const values = trendByDay.map(([, v]) => v);
                const { path, points } = sparklinePath(values, w, h);
                return (
                  <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", maxWidth: 640 }}>
                    <line x1={6} y1={h - 6} x2={w - 6} y2={h - 6} stroke="var(--border)" strokeWidth={1} />
                    <path d={path} fill="none" stroke="var(--teal)" strokeWidth={2.5} strokeLinecap="round" />
                    {points.length > 0 && (
                      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3.5} fill="var(--teal)" />
                    )}
                  </svg>
                );
              })()}
              <div className="small" style={{ marginTop: 6, color: "var(--text-2)" }}>
                {trendByDay[0]?.[0]} → {trendByDay[trendByDay.length - 1]?.[0]}
              </div>
            </div>

            <div className="panel">
              <h2>Capture-health mix</h2>
              {(() => {
                const total = healthCounts.live + healthCounts.pending + healthCounts.stuck + healthCounts.dead;
                if (total === 0) return <div className="empty">No posts tracked yet.</div>;
                let angle = 0;
                const segs = (["live", "pending", "stuck", "dead"] as PostHealth[]).map((k) => {
                  const frac = healthCounts[k] / total;
                  const start = angle, end = angle + frac * 360;
                  angle = end;
                  return { k, start, end, n: healthCounts[k] };
                }).filter((s) => s.n > 0);
                return (
                  <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                    <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }}>
                      {segs.map((s) => (
                        <path key={s.k} d={pieSlicePath(70, 70, 62, s.start, s.end)} fill={HEALTH_COLOR[s.k]} stroke="var(--bg-1)" strokeWidth={2} />
                      ))}
                    </svg>
                    <div>
                      {segs.map((s) => (
                        <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: HEALTH_COLOR[s.k], display: "inline-block" }} />
                          <span className="small" style={{ textTransform: "capitalize" }}>{s.k}</span>
                          <span className="mono small" style={{ color: "var(--text-2)" }}>{s.n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <p className="small" style={{ marginTop: 10, color: "var(--text-2)" }}>
Stuck = posts still showing not_yet_in_api past the real 48h ingestion window, a capture-pipeline failure, not a delay.
              </p>
            </div>

            <div className="panel">
              <h2>All scheduled posts</h2>
              <table>
                <thead>
                  <tr>
                    <th>Label</th><th>Status</th><th>Published</th><th>Captures</th><th>Impressions</th><th>EQS</th><th>URL</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {postHealth.length === 0 && (
                    <tr><td colSpan={8} className="empty">No scheduled posts yet.</td></tr>
                  )}
                  {postHealth.slice().reverse().map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.id}</td>
                      <td><span className="small" style={{ color: HEALTH_COLOR[p._status], textTransform: "capitalize" }}>{p._status}</span></td>
                      <td>{fmtDate(p.published_at)}</td>
                      <td><CapturePills captures={p.captures} /></td>
                      <td className="mono">{p._latest_capture?.impressions ?? "—"}</td>
                      <td><EqsBadge value={p._eqs} /></td>
                      <td>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="small mono">
                          {p.url.slice(0, 50)}…
                        </a>
                      </td>
                      <td><button className="danger" onClick={() => deletePost(p.id)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details className="panel">
              <summary style={{ cursor: "pointer" }}><h2 style={{ display: "inline", margin: 0 }}>Raw capture log (debug) · {analytics.length} rows</h2></summary>
              <table style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Captured at</th><th>Post</th><th>Checkpoint</th><th>Impressions</th><th>Reactions</th><th>Comments</th><th>Reposts</th><th>EQS</th><th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.length === 0 && (
                    <tr><td colSpan={9} className="empty">No captures logged yet.</td></tr>
                  )}
                  {analytics.slice().reverse().slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      <td className="mono small">{fmtDate(r.captured_at_utc)}</td>
                      <td className="mono">{r.post_id}</td>
                      <td className="mono">{r.checkpoint}</td>
                      <td className="mono">{r.impressions ?? "—"}</td>
                      <td className="mono">{r.reactions ?? "—"}</td>
                      <td className="mono">{r.comments ?? "—"}</td>
                      <td className="mono">{r.reposts ?? "—"}</td>
                      <td><EqsBadge value={r.eqs} /></td>
                      <td className="small" style={{ color: "var(--red)" }}>{r.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analytics.length > 500 && (
                <p className="small" style={{ marginTop: 8, color: "var(--text-2)" }}>
                  Showing the most recent 500 of {analytics.length} rows.
                </p>
              )}
            </details>
          </>
        )}

        {tab === "drafts" && (
          <>
            {drafts ? (
              <>
                <div className="panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0 }}>Archive · {filteredArchive.length} of {drafts.drafts.length}</h2>
                    <button onClick={triggerRevise} disabled={revising} title="Bulk-revise every draft that has new comments — the local agent applies your feedback and re-stages them">
                      {revising ? "Triggering…" : "⟳ Trigger Changes"}
                    </button>
                  </div>
                  <p className="small">Every draft ever generated, newest first — approved/scheduled ones live on Board; this is the full history including denied, killed, shelved, and posted content.</p>
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <div className="form-group" style={{ flex: 3 }}>
                      <input type="text" value={archiveQuery} onChange={(e) => setArchiveQuery(e.target.value)} placeholder="Search id / hook / title…" />
                    </div>
                    <div className="form-group" style={{ flex: 0, minWidth: 200 }}>
                      <select value={archiveStatus} onChange={(e) => setArchiveStatus(e.target.value)}>
                        <option value="">All statuses</option>
                        <option value="awaiting">Awaiting CEO</option>
                        <option value="approved">Approved</option>
                        <option value="denied">Denied</option>
                        <option value="posted">Posted</option>
                        <option value="killed">Killed</option>
                        <option value="shelved">Shelved</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="panel" style={{ padding: 0 }}>
                  {filteredArchive.length === 0 ? (
                    <div className="empty">No drafts match.</div>
                  ) : (
                    filteredArchive.map((d) => {
                      const st = (d.approval_status || "").toLowerCase();
                      const color = st.startsWith("posted") ? "var(--green)" : st === "approved" ? "var(--green)" : st === "denied" || st.startsWith("killed") ? "var(--red)" : "var(--text-2)";
                      return (
                        <div key={d.id} onClick={() => { setRowAuto(null); setExpandedDraft(d.id); }}
                          style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", alignItems: "center" }}>
                          <div>
                            <div className="mono small" style={{ color: "var(--teal)" }}>{d.id}</div>
                            <div style={{ fontSize: 13.5, marginTop: 2 }}>{d.hook}</div>
                          </div>
                          <div className="small" style={{ color, textAlign: "right", textTransform: "capitalize" }}>{d.approval_status}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="panel"><div className="empty">Loading drafts…</div></div>
            )}
          </>
        )}

        {tab === "pages" && (
          <>
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Raw LinkedIn feed · full history</h2>
                <button className="ghost" onClick={() => loadPages(true)} disabled={pagesLoading}>
                  {pagesLoading ? "Fetching…" : "Refresh from LinkedIn"}
                </button>
              </div>
              <p className="small" style={{ marginTop: 8 }}>
                Every post on record, unfiltered. For time-windowed breakdowns (best time/day/type/angle) see the Analytics tab.
              </p>
              {pageReport && (
                <p className="small" style={{ marginTop: 4 }}>
                  fetched {fmtDate(pageReport.fetched_at)} · source: {pageReport._source}
                  {pageReport._age_min != null ? ` · ${pageReport._age_min}m old` : ""} · org {pageReport.org}
                </p>
              )}
            </div>

            {!pageReport ? (
              pagesLoading ? (
                <div className="panel"><div className="empty">Fetching from LinkedIn (one feed call, rate-limited)…</div></div>
              ) : pagesError ? (
                <div className="panel">
                  <div className="empty" style={{ color: "var(--red)" }}>
                    LinkedIn fetch failed: {pagesError}
                  </div>
                  <p className="small" style={{ textAlign: "center", marginTop: 8 }}>
                    <button className="ghost" onClick={() => loadPages(true)}>Retry</button>
                  </p>
                </div>
              ) : (
                <div className="panel"><div className="empty">Loading…</div></div>
              )
            ) : (
              <>
                <div className="stat-grid">
                  <Stat label="Posts" value={pageReport.posts.length} hint="company page, last 360d" />
                  <Stat label="Visitors 360d" value={pageReport.visitors_360d ?? "—"} hint="unique page visitors" />
                  <Stat label="Followers 360d" value={pageReport.followers_360d ?? "0*"} hint="*member opt-in gated" />
                  <Stat label="Top post impr." value={pageReport.posts[0]?.impressions ?? 0} hint={pageReport.posts[0]?.type ?? ""} />
                </div>

                <div className="panel">
                  <h2>Every post · sorted by impressions</h2>
                  <table>
                    <thead><tr><th>Type</th><th>Caption</th><th>Published</th><th>Impr.</th><th>Clicks</th><th>React</th><th>Comm</th><th>CTR</th></tr></thead>
                    <tbody>
                      {pageReport.posts.map((p) => (
                        <tr key={p.urn}>
                          <td><span className="tag">{p.type}</span></td>
                          <td style={{ maxWidth: 420 }}>
                            <span title={p.caption}>{p.caption ? (p.caption.length > 90 ? p.caption.slice(0, 90) + "…" : p.caption) : <span className="small" style={{ color: "var(--text-2)" }}>(no caption / media-only)</span>}</span>
                          </td>
                          <td className="mono small">{p.published}</td>
                          <td className="mono">{p.impressions}</td>
                          <td className="mono">{p.clicks}</td>
                          <td className="mono">{p.reactions}</td>
                          <td className="mono">{p.comments}</td>
                          <td className="mono" style={{ color: "var(--teal)" }}>{p.ctr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="small" style={{ marginTop: 12, color: "var(--text-2)" }}>{pageReport.notes}</p>
                </div>
              </>
            )}
          </>
        )}

      </main>

      {expandedDraft && (() => {
        const draft = drafts?.drafts.find((d) => d.id === expandedDraft);
        const item = schedule?.calendar.find((c) => c.post_id === expandedDraft);
        const pdf = item?.pdf_url ?? null;
        const close = () => { setExpandedDraft(null); setRowAuto(null); };
        return (
          <div className="modal-overlay" onClick={close}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="modal-panel-head">
                <div style={{ display: "flex", gap: 8 }}>
                  {pdf && (
                    <>
                      <a href={pdf} target="_blank" rel="noopener noreferrer"><button>Download PDF</button></a>
                      <a href={pdf} target="_blank" rel="noopener noreferrer"><button className="ghost">View PDF</button></a>
                    </>
                  )}
                  <button className="ghost" onClick={() => setRowAuto("comment")}>Comment</button>
                </div>
                <button className="ghost" onClick={close}>Close ✕</button>
              </div>
              {draft ? (
                <DraftDetail draft={draft} onSaved={handleDraftSaved} onToast={showToast} autoOpen={rowAuto} />
              ) : drafts ? (
                <p className="small empty">No draft found for {expandedDraft}.</p>
              ) : (
                <p className="small empty">Loading…</p>
              )}
            </div>
          </div>
        );
      })()}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

const BOARD_FORMAT: Record<string, { label: string; color: string }> = {
  "carousel": { label: "Carousel", color: "#5AABCC" },
  "text-provocation": { label: "Text", color: "#C8A85C" },
  "image-text-component": { label: "Image", color: "#6FBF8B" },
  "image-text-branded": { label: "Image", color: "#6FBF8B" },
  "poll": { label: "Poll", color: "#B58CDA" },
  "founder-video-short": { label: "Video", color: "#7AA7E0" },
  "founder-video-long": { label: "Video", color: "#7AA7E0" },
};
const BOARD_WEIGHT: Record<string, { label: string; color: string }> = {
  painkiller: { label: "Painkiller", color: "#E0635F" },
  objection: { label: "Objection", color: "#C8A85C" },
  vitamin: { label: "Vitamin", color: "#6FBF8B" },
};

/** Simple scannable content board: one colour-coded tile per scheduled post,
 *  with media thumbnail, the angle, time-of-day, and Approve / Deny. */
function BoardCard({
  it, onApprove, onDeny, onOpen,
}: {
  it: ScheduleItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const fmt = BOARD_FORMAT[it.format] || { label: it.format, color: "var(--text-2)" };
  const parts = (it.rationale || "").split(" · ");
  const weight = (parts[0] || "").trim().toLowerCase();
  const chapter = (parts[1] || "").trim();
  const w = BOARD_WEIGHT[weight] || { label: weight || "—", color: "var(--text-2)" };
  const st = (it.approval_status || "").toLowerCase();
  const approved = st === "approved", denied = st === "denied", posted = st.startsWith("posted");
  // Two rendering conventions exist in storage, depending on which batch
  // produced the draft: carousels (pdf_url ending .pdf) render per-page
  // slide_NN.png alongside the PDF, so slide_01.png is the right preview.
  // Single-image formats (branded/chart, pdf_url ending .png) render ONE
  // file directly at pdf_url — there is no slide_01.png for those, so
  // hardcoding it 404's. Confirmed live 2026-07-05: every fresh-branded/
  // fresh-chart post showed a broken-image icon on Board because of this.
  const thumb = it.pdf_url && !it.pdf_url.endsWith(".pdf")
    ? it.pdf_url
    : it.storage_slug
      ? `${CAROUSEL_BUCKET_URL}/${it.storage_slug}/slide_01.png`
      : null;
  const dt = new Date(it.date + "T00:00:00");
  const dayLabel = isNaN(dt.getTime()) ? it.date : dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div style={{
      border: "1px solid var(--border)", borderTop: `3px solid ${fmt.color}`, borderRadius: 8,
      overflow: "hidden", background: "var(--bg-1)", opacity: denied ? 0.55 : 1,
    }}>
      <div onClick={() => onOpen(it.post_id)} title="Open full draft" style={{
        cursor: "pointer", height: 118, background: thumb ? "#0a0a0a" : `${fmt.color}1f`,
        display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
      }}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="mono" style={{ color: fmt.color, fontSize: 13, letterSpacing: 1 }}>{fmt.label.toUpperCase()}</span>
        )}
        <span className="mono" style={{ position: "absolute", top: 6, left: 6, fontSize: 10, background: "rgba(0,0,0,0.6)", color: fmt.color, padding: "2px 7px", borderRadius: 4 }}>{fmt.label}</span>
      </div>
      <div style={{ padding: "9px 11px" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>{dayLabel} · {(it.time_utc || "").slice(0, 5)}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.35, margin: "5px 0 9px", height: 51, overflow: "hidden" }}>{it.hook}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: w.color, flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 10, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {w.label}{chapter ? ` · ${chapter}` : ""}
          </span>
        </div>
        {posted ? (
          <span className="tag" style={{ color: "var(--green)", borderColor: "rgba(74,154,106,0.45)" }}>✓ Posted</span>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onApprove(it.post_id)} disabled={approved} style={{
              flex: 1, padding: "6px 0", fontSize: 12, borderRadius: 5,
              background: approved ? "rgba(74,154,106,0.3)" : "rgba(74,154,106,0.12)",
              border: "1px solid rgba(74,154,106,0.45)", color: "var(--green)", cursor: approved ? "default" : "pointer",
            }}>{approved ? "✓ Approved" : "Approve"}</button>
            <button onClick={() => onDeny(it.post_id)} disabled={denied} style={{
              flex: 1, padding: "6px 0", fontSize: 12, borderRadius: 5,
              background: denied ? "rgba(224,99,95,0.3)" : "rgba(224,99,95,0.10)",
              border: "1px solid rgba(224,99,95,0.4)", color: "#E0635F", cursor: denied ? "default" : "pointer",
            }}>{denied ? "✗ Denied" : "Deny"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Board({
  items, onApprove, onDeny, onOpen,
}: {
  items: ScheduleItem[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const counts = { approved: 0, denied: 0, posted: 0, pending: 0 };
  for (const it of items) {
    const s = (it.approval_status || "").toLowerCase();
    if (s.startsWith("posted")) counts.posted++;
    else if (s === "approved") counts.approved++;
    else if (s === "denied") counts.denied++;
    else counts.pending++;
  }

  // A draft's schedule date is a placeholder slot assigned at staging time —
  // it says nothing about how urgently it needs YOUR review. Sorting the
  // whole board chronologically buries brand-new batches behind months of
  // already-decided content (confirmed 2026-07-05: 50 fresh drafts, incl.
  // every chart post, sat behind 67 other schedule rows, invisible on a
  // top-down scan). Needs-review surfaces first, newest-created first;
  // already-decided content keeps the old chronological-by-post-date sort.
  const needsReview = items
    .filter((it) => {
      const s = (it.approval_status || "").toLowerCase();
      return s !== "approved" && s !== "denied" && !s.startsWith("posted");
    })
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const decided = items
    .filter((it) => !needsReview.includes(it))
    .sort((a, b) => (a.date + a.time_utc).localeCompare(b.date + b.time_utc));

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Content board · {items.length} posts</h2>
        <div className="mono small" style={{ color: "var(--text-2)" }}>
          {counts.pending} pending · <span style={{ color: "var(--green)" }}>{counts.approved} approved</span> · <span style={{ color: "#E0635F" }}>{counts.denied} denied</span> · {counts.posted} posted
        </div>
      </div>
      <p className="small" style={{ color: "var(--text-2)" }}>
        Colour bar = post type. Coloured dot = the angle (painkiller / objection / vitamin). Scan, then Approve or Deny each post.
      </p>

      {needsReview.length > 0 && (
        <>
          <h3 style={{ marginTop: 18, marginBottom: 4 }}>Needs your review · {needsReview.length} · newest first</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))", gap: 12, marginTop: 10 }}>
            {needsReview.map((it) => (
              <BoardCard key={it.post_id} it={it} onApprove={onApprove} onDeny={onDeny} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 22, marginBottom: 4 }}>Scheduled · {decided.length}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(225px, 1fr))", gap: 12, marginTop: 10 }}>
        {decided.map((it) => (
          <BoardCard key={it.post_id} it={it} onApprove={onApprove} onDeny={onDeny} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function DraftDetail({
  draft,
  onSaved,
  onToast,
  autoOpen,
}: {
  draft: Draft;
  onSaved: (id: string, patch: { caption?: string; body?: string; approval_status?: string }) => void;
  onToast: (msg: string, kind?: "success" | "error") => void;
  autoOpen?: "posted" | "comment" | null;
}) {
  const d = draft;
  const [caption, setCaption] = useState(d.caption || "");
  const [body, setBody] = useState(d.body || "");
  const [showSlides, setShowSlides] = useState(false);
  const [saving, setSaving] = useState(false);
  // Fidelity: "I posted this" — paste the live LinkedIn URL, one click marks the
  // draft posted AND records the li_posts row (with draft_id lineage for captures).
  const isPosted = (d.approval_status || "").toLowerCase().startsWith("posted");
  const [postedOpen, setPostedOpen] = useState(false);
  const [postedUrl, setPostedUrl] = useState("");
  const [marking, setMarking] = useState(false);
  // When opened from a calendar-row "Posted" / "Comment" button, jump straight
  // to that action instead of making the founder hunt for it.
  const commentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (autoOpen === "posted" && !isPosted) setPostedOpen(true);
    if (autoOpen === "comment") commentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoOpen, isPosted]);

  // Per-post comments — founder alignment notes. The autopilot reads these at
  // plan time to notice patterns and tune the skills.
  const [comments, setComments] = useState<
    { id: string; body: string; author: string; created_at: string }[]
  >([]);
  const [newComment, setNewComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/drafts/${encodeURIComponent(d.id)}/comments`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((j) => { if (live) setComments(j.comments || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [d.id]);

  const submitComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    setCommentBusy(true);
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const j = await r.json();
      if (r.ok && j.comment) {
        setComments((c) => [...c, j.comment]);
        setNewComment("");
        onToast("Comment added — the agent reads it at plan time", "success");
      } else {
        onToast(j.error || "Comment failed", "error");
      }
    } catch {
      onToast("Comment failed", "error");
    } finally {
      setCommentBusy(false);
    }
  };

  const removeComment = async (cid: string) => {
    setComments((c) => c.filter((x) => x.id !== cid));
    try {
      await fetch(
        `/api/drafts/${encodeURIComponent(d.id)}/comments?commentId=${encodeURIComponent(cid)}`,
        { method: "DELETE" }
      );
    } catch {}
  };

  const markPosted = async () => {
    if (!postedUrl.trim()) {
      onToast("Paste the live LinkedIn post URL first", "error");
      return;
    }
    setMarking(true);
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}/posted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: postedUrl.trim() }),
      });
      const j = await r.json();
      if (r.ok) {
        onSaved(d.id, { approval_status: j.approval_status });
        setPostedOpen(false);
        setPostedUrl("");
        onToast("Marked posted — captures will track this URL.");
      } else {
        onToast(j.error || "Mark-posted failed", "error");
      }
    } catch (e) {
      onToast("Error: " + (e as Error).message, "error");
    } finally {
      setMarking(false);
    }
  };

  const undoPosted = async () => {
    setMarking(true);
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}/posted`, { method: "DELETE" });
      const j = await r.json();
      if (r.ok) {
        onSaved(d.id, { approval_status: j.approval_status });
        onToast("Posted status undone.");
      } else {
        onToast(j.error || "Undo failed", "error");
      }
    } catch (e) {
      onToast("Error: " + (e as Error).message, "error");
    } finally {
      setMarking(false);
    }
  };

  // Approve — the CEO greenlights a draft for publishing (status → "approved").
  const isApproved = (d.approval_status || "").toLowerCase() === "approved";
  const [approving, setApproving] = useState(false);
  const approve = async () => {
    setApproving(true);
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}/approve`, { method: "POST" });
      const j = await r.json();
      if (r.ok) { onSaved(d.id, { approval_status: j.approval_status }); onToast("Approved — queued to publish."); }
      else onToast(j.error || "Approve failed", "error");
    } catch (e) { onToast("Error: " + (e as Error).message, "error"); }
    finally { setApproving(false); }
  };
  const unapprove = async () => {
    setApproving(true);
    try {
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}/approve`, { method: "DELETE" });
      const j = await r.json();
      if (r.ok) { onSaved(d.id, { approval_status: j.approval_status }); onToast("Approval removed."); }
      else onToast(j.error || "Unapprove failed", "error");
    } catch (e) { onToast("Error: " + (e as Error).message, "error"); }
    finally { setApproving(false); }
  };

  const slug = d.storage_slug ?? null;
  const cardImg = slug ? `${CAROUSEL_BUCKET_URL}/${slug}/slide_01.png` : null;

  const captionDirty = (d.caption || "") !== caption;
  const bodyDirty = (d.body || "") !== body;
  const dirty = captionDirty || bodyDirty;

  const save = async () => {
    setSaving(true);
    try {
      const patch: { caption?: string; body?: string } = {};
      if (captionDirty) patch.caption = caption;
      if (bodyDirty) patch.body = body;
      const r = await fetch(`/api/drafts/${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        onSaved(d.id, patch);
        onToast("Saved.");
      } else {
        onToast("Save failed", "error");
      }
    } catch (e) {
      onToast("Error: " + (e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${label} copied to clipboard.`);
    } catch {
      onToast("Copy failed — clipboard blocked", "error");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ color: "var(--teal)", fontSize: 12 }}>
            Post {d.ord} · {d.bank_id} · {d.format}
          </div>
          <h2 style={{ marginTop: 8, marginBottom: 6, textTransform: "none", letterSpacing: 0, fontSize: 16 }}>{d.hook}</h2>
          <div className="small">
            {d.posting_day_proposal} · {new Date(d.posting_time_utc).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })} UTC · {d.format}
          </div>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <span
            className="tag"
            style={
              isPosted
                ? { background: "rgba(74,154,106,0.12)", color: "var(--green, #4A9A6A)", borderColor: "rgba(74,154,106,0.45)" }
                : { background: "var(--bg-3)", color: "var(--amber)", borderColor: "rgba(200,168,92,0.4)" }
            }
          >
            {isPosted ? `✓ ${d.approval_status}` : d.approval_status}
          </span>
          {isPosted ? (
            <button className="small" onClick={undoPosted} disabled={marking}
              style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", textDecoration: "underline" }}>
              {marking ? "…" : "undo"}
            </button>
          ) : postedOpen ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={postedUrl}
                onChange={(e) => setPostedUrl(e.target.value)}
                placeholder="paste live LinkedIn URL…"
                style={{ width: 240, fontSize: 12, padding: "4px 8px", background: "var(--bg-3)",
                         border: "1px solid var(--border, #333)", borderRadius: 4, color: "inherit" }}
                onKeyDown={(e) => { if (e.key === "Enter") markPosted(); if (e.key === "Escape") setPostedOpen(false); }}
                autoFocus
              />
              <button className="small" onClick={markPosted} disabled={marking}
                style={{ background: "rgba(74,154,106,0.15)", border: "1px solid rgba(74,154,106,0.45)",
                         color: "var(--green, #4A9A6A)", borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}>
                {marking ? "…" : "Confirm"}
              </button>
              <button className="small" onClick={() => setPostedOpen(false)} disabled={marking}
                style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer" }}>
                ✕
              </button>
            </div>
          ) : (
            <button className="small" onClick={() => setPostedOpen(true)}
              style={{ background: "var(--bg-3)", border: "1px solid rgba(74,154,106,0.45)",
                       color: "var(--green, #4A9A6A)", borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}>
              Mark posted
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {isApproved ? (
          <>
            <span className="tag" style={{ background: "rgba(74,154,106,0.12)", color: "var(--green,#4A9A6A)", borderColor: "rgba(74,154,106,0.45)" }}>✓ approved</span>
            <button className="ghost" onClick={unapprove} disabled={approving}>{approving ? "…" : "Unapprove"}</button>
          </>
        ) : (
          <button onClick={approve} disabled={approving}
            style={{ background: "rgba(74,154,106,0.15)", border: "1px solid rgba(74,154,106,0.45)", color: "var(--green,#4A9A6A)", borderRadius: 4, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
            {approving ? "Approving…" : "✓ Approve"}
          </button>
        )}
        <a href={`/api/drafts/${encodeURIComponent(d.id)}/download?fmt=md`}>
          <button className="ghost">Download .md</button>
        </a>
        <a href={`/api/drafts/${encodeURIComponent(d.id)}/download?fmt=print`} target="_blank" rel="noopener noreferrer">
          <button className="ghost">Print / PDF</button>
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 14 }}>
        <div>
          <h3>Rationale</h3>
          <p className="small">{d.rationale}</p>
        </div>
        <div>
          <h3>Targets · Scenario</h3>
          <p className="small mono">{(d.targets ?? []).join(" · ")}</p>
          <p className="small">{d.scenario}</p>
          <p className="small mono" style={{ marginTop: 8, color: "var(--text-2)" }}>{d.anchor}</p>
        </div>
      </div>

      {d.format === "long-form text" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Body {body && `(${body.length} chars)`}</h3>
            <button className="ghost" onClick={() => copy(body, "Body")}>Copy body</button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            style={{
              width: "100%",
              fontFamily: "var(--sans)",
              fontSize: 13,
              lineHeight: 1.5,
              padding: 14,
              background: "var(--bg-0)",
              border: "1px solid var(--border)",
              color: "var(--text-0)",
              borderRadius: 4,
            }}
          />
        </div>
      )}

      {d.format === "carousel" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Carousel · {d.slides?.length || 0} slides · <span className="mono small">{d.doc_title}</span></h3>
            <div style={{ display: "flex", gap: 8 }}>
              {d.pdf_url && (
                <a href={d.pdf_url} target="_blank" rel="noopener noreferrer">
                  <button className="ghost">Download PDF</button>
                </a>
              )}
              <button className="ghost" onClick={() => setShowSlides(!showSlides)}>
                {showSlides ? "Hide slides" : "Show all 9 slides"}
              </button>
            </div>
          </div>
          {d.render_status && (
            <p className="small" style={{ color: d.render_status.includes("rendered") ? "var(--green)" : "var(--amber)" }}>
              Render: {d.render_status}
            </p>
          )}
          {!showSlides && cardImg && (
            <a href={cardImg} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImg} alt={`Slide 1 thumbnail: ${d.hook}`} style={{ maxWidth: 280, width: "100%", display: "block", borderRadius: 6, border: "1px solid var(--border)" }} />
            </a>
          )}
          {showSlides && d.slides && slug && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
              {d.slides.map((s) => {
                const imgUrl = `${CAROUSEL_BUCKET_URL}/${slug}/slide_${String(s.n).padStart(2, "0")}.png`;
                return (
                  <div key={s.n} style={{ background: "var(--bg-0)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                    <a href={imgUrl} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl} alt={`Slide ${s.n}: ${s.h || s.q || ""}`} style={{ width: "100%", display: "block" }} />
                    </a>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", padding: "6px 10px", borderTop: "1px solid var(--border)" }}>
                      Slide {s.n} · {s.mode}{s.bg_variant ? ` · ${s.bg_variant}` : ""}{s.card ? ` · card:${s.card}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {d.slides && d.slides.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 8px" }}>Slide copy · {d.slides.length} slides</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.slides.map((s) => (
              <div key={s.n} style={{ background: "var(--bg-0)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 12px" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>Slide {s.n}</div>
                {s.h && <div style={{ fontWeight: 600, fontSize: 13 }}>{s.h}</div>}
                {s.b && <div className="small" style={{ marginTop: 2 }}>{s.b}</div>}
                {s.q && <div className="small" style={{ fontStyle: "italic" }}>{s.q}</div>}
                {s.c && <div className="small">{s.c}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {d.format === "poll" && d.poll && (d.poll.question || (d.poll.options && d.poll.options.length > 0)) && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 8px" }}>Poll</h3>
          {d.poll.question && <p style={{ fontWeight: 600, margin: "0 0 6px" }}>{d.poll.question}</p>}
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {(d.poll.options || []).map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}

      {d.description && d.format.includes("video") && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Video script</h3>
            <button className="ghost" onClick={() => copy(d.description!, "Script")}>Copy</button>
          </div>
          <p className="small" style={{ lineHeight: 1.5, padding: 14, background: "var(--bg-0)", borderRadius: 4, border: "1px solid var(--border)", whiteSpace: "pre-wrap" }}>{d.description}</p>
        </div>
      )}

      {d.caption !== undefined && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Caption {caption && <span className="small">({caption.length} chars)</span>}</h3>
            <button className="ghost" onClick={() => copy(caption, "Caption")}>Copy caption</button>
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={8}
            style={{
              width: "100%",
              fontFamily: "var(--sans)",
              fontSize: 13,
              lineHeight: 1.5,
              padding: 14,
              background: "var(--bg-0)",
              border: "1px solid var(--border)",
              color: "var(--text-0)",
              borderRadius: 4,
            }}
          />
        </div>
      )}

      {d.alt_text && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Document-level alt text</h3>
            <button className="ghost" onClick={() => copy(d.alt_text!, "Alt text")}>Copy</button>
          </div>
          <p className="small" style={{ lineHeight: 1.5, padding: 14, background: "var(--bg-0)", borderRadius: 4, border: "1px solid var(--border)" }}>{d.alt_text}</p>
        </div>
      )}

      <div ref={commentRef} style={{ marginBottom: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <h3 style={{ margin: "0 0 8px" }}>
          Comments{" "}
          <span className="small" style={{ color: "var(--text-2)" }}>· alignment notes the agent reads at plan time</span>
        </h3>
        {comments.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            {comments.map((c) => (
              <div key={c.id} style={{ background: "var(--bg-0)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div className="small" style={{ lineHeight: 1.45 }}>{c.body}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", marginTop: 4 }}>{c.author} · {new Date(c.created_at).toLocaleString()}</div>
                </div>
                <button className="ghost" style={{ alignSelf: "flex-start", fontSize: 11 }} onClick={() => removeComment(c.id)} title="Delete comment">✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitComment(); }}
            rows={2}
            placeholder="Steer this post — 'hook too long', 'wrong persona', 'more like this'…  (⌘+Enter)"
            style={{ flex: 1, fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, padding: 10, background: "var(--bg-0)", border: "1px solid var(--border)", color: "var(--text-0)", borderRadius: 4 }}
          />
          <button onClick={submitComment} disabled={commentBusy || !newComment.trim()}>{commentBusy ? "…" : "Comment"}</button>
        </div>
      </div>

      {dirty && (
        <div style={{ display: "flex", gap: 10, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          <button className="ghost" onClick={() => { setCaption(d.caption || ""); setBody(d.body || ""); }}>Reset</button>
          <span className="small" style={{ alignSelf: "center", color: "var(--amber)" }}>
            unsaved {[captionDirty && "caption", bodyDirty && "body"].filter(Boolean).join(" + ")}
          </span>
        </div>
      )}
    </div>
  );
}
