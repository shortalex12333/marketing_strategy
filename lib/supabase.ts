import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ScheduledPost, CaptureRow, CaptureSummary, Checkpoint, AugmentedPost } from "./types";
import { eqs } from "./eqs";
import type { PageReport, DmaPost } from "./linkedin";

/**
 * Supabase client (server-side, service role).
 *
 * Single Jarvis Supabase project (shared with Kenoki, NOT CelesteOS).
 * Service role key bypasses RLS — only use from API routes, never expose to client.
 *
 * Tables (all `li_` prefixed in the shared public schema):
 *   - li_drafts      · in-progress carousel content
 *   - li_schedule    · calendar entries
 *   - li_posts       · published posts with LinkedIn URN
 *   - li_captures    · hourly analytics rows
 *   - li_post_bank   · candidate post premises (parsed from markdown — populated later)
 */

declare global {
  // eslint-disable-next-line no-var
  var _jarvisSupabase: SupabaseClient | undefined;
}

export function supa(): SupabaseClient {
  if (global._jarvisSupabase) return global._jarvisSupabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — set in Vercel env vars (Jarvis Supabase project)."
    );
  }
  global._jarvisSupabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return global._jarvisSupabase;
}

// ─── Posts (li_posts) ────────────────────────────────────────────────

interface DbPost {
  id: string;
  draft_id: string | null;
  url: string;
  urn: string | null;
  published_at: string;
  doc_title: string | null;
  alt_text: string | null;
  created_at: string;
}

interface DbCapture {
  id: number;
  post_id: string;
  captured_at_utc: string;
  minutes_since_publish: number | null;
  impressions: number | null;
  clicks: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  engagement_rate: number | null;
  error: string | null;
}

function dbPostToScheduled(p: DbPost): ScheduledPost {
  return {
    id: p.id,
    url: p.url,
    published_at: p.published_at,
    captures: {},
  };
}

function checkpointFor(minutes: number | null): Checkpoint {
  if (minutes == null) return "24h";
  if (minutes < 45) return "30m";
  if (minutes < 90) return "60m";
  if (minutes < 450) return "6h";
  return "24h";
}

function dbCaptureToSummary(c: DbCapture): CaptureSummary {
  return {
    captured_at: c.captured_at_utc,
    impressions: c.impressions,
    reactions: c.reactions,
    comments: c.comments,
    reposts: c.reposts,
    saves: c.saves,
    clicks: c.clicks,
    error: c.error || null,
  };
}

export async function listPosts(): Promise<ScheduledPost[]> {
  const { data, error } = await supa()
    .from("li_posts")
    .select("*")
    .order("published_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(dbPostToScheduled);
}

export async function getPost(id: string): Promise<ScheduledPost | null> {
  const { data, error } = await supa().from("li_posts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? dbPostToScheduled(data) : null;
}

export async function putPost(p: ScheduledPost): Promise<void> {
  const m = /activity[-:](\d+)/.exec(p.url);
  const urn = m ? `urn:li:activity:${m[1]}` : null;
  const { error } = await supa().from("li_posts").upsert(
    {
      id: p.id,
      url: p.url,
      urn,
      published_at: p.published_at,
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

/** Fidelity: the CEO posted a draft manually on LinkedIn and pastes the live URL.
 *  ONE call does both writes so the loop stays coherent:
 *    1. upsert li_posts WITH draft_id — the lineage that lets captures join back to
 *       the draft's angle (the old manual flow left draft_id NULL, orphaning perf data);
 *    2. flip li_drafts.approval_status → "posted YYYY-MM-DD" so the dashboard
 *       shows the draft as complete.
 *  Returns the refreshed draft. Undo = markDraftUnposted (status only — the
 *  li_posts row + its captures are real history and are kept). */
export async function markDraftPosted(
  draftId: string,
  url: string,
  publishedAt?: string
): Promise<DbDraft | null> {
  const m = /activity[-:](\d+)/.exec(url);
  const urn = m ? `urn:li:activity:${m[1]}` : null;
  const published_at = publishedAt || new Date().toISOString();
  const { error: postErr } = await supa().from("li_posts").upsert(
    { id: draftId, draft_id: draftId, url, urn, published_at },
    { onConflict: "id" }
  );
  if (postErr) throw postErr;
  const stamp = `posted ${published_at.slice(0, 10)}`;
  const { data, error } = await supa()
    .from("li_drafts")
    .update({ approval_status: stamp, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

/** Undo a mistaken "posted" click: status back to awaiting CEO. Keeps the li_posts
 *  row (it may already have captures; delete it explicitly via the posts tab). */
export async function markDraftUnposted(draftId: string): Promise<DbDraft | null> {
  const { data, error } = await supa()
    .from("li_drafts")
    .update({ approval_status: "awaiting CEO", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

export async function deletePost(id: string): Promise<boolean> {
  const { error, count } = await supa()
    .from("li_posts")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function patchPost(
  id: string,
  patch: { url?: string; published_at?: string }
): Promise<ScheduledPost | null> {
  const update: Partial<DbPost> = {};
  if (patch.url !== undefined) update.url = patch.url;
  if (patch.published_at !== undefined) update.published_at = patch.published_at;
  const { data, error } = await supa()
    .from("li_posts")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? dbPostToScheduled(data) : null;
}

// ─── Captures (li_captures) ──────────────────────────────────────────

export async function listCaptures(): Promise<CaptureRow[]> {
  const { data, error } = await supa()
    .from("li_captures")
    .select("*")
    .order("captured_at_utc", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data || []).map((c: DbCapture) => ({
    captured_at_utc: c.captured_at_utc,
    post_id: c.post_id,
    post_url: "",
    minutes_since_publish: c.minutes_since_publish ?? 0,
    checkpoint: checkpointFor(c.minutes_since_publish),
    impressions: c.impressions,
    reactions: c.reactions,
    comments: c.comments,
    reposts: c.reposts,
    saves: c.saves,
    clicks: c.clicks,
    raw_text: "",
    error: c.error || "",
  }));
}

export async function appendCapture(c: CaptureRow): Promise<void> {
  const { error } = await supa().from("li_captures").upsert(
    {
      post_id: c.post_id,
      captured_at_utc: c.captured_at_utc,
      minutes_since_publish: c.minutes_since_publish,
      impressions: c.impressions,
      clicks: c.clicks,
      reactions: c.reactions,
      comments: c.comments,
      reposts: c.reposts,
      saves: c.saves,
      engagement_rate: null,
      error: c.error || null,
    },
    { onConflict: "post_id,captured_at_utc" }
  );
  if (error) throw error;
}

export async function listAugmentedPosts(): Promise<AugmentedPost[]> {
  const posts = await listPosts();
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const { data: caps, error } = await supa()
    .from("li_captures")
    .select("*")
    .in("post_id", ids)
    .order("captured_at_utc", { ascending: true });
  if (error) throw error;
  const byPost: Record<string, DbCapture[]> = {};
  for (const c of (caps || []) as DbCapture[]) {
    (byPost[c.post_id] ||= []).push(c);
  }
  return posts.map((p) => {
    const list = byPost[p.id] || [];
    // Prefer the latest row that actually has impressions (skipping
    // rate-limited / not_yet_in_api error rows). Fall back to the
    // last row if every reading is an error so the UI still shows something.
    const latestValid = [...list]
      .reverse()
      .find((c) => c.impressions != null && !c.error) || list[list.length - 1] || null;
    const e = latestValid
      ? eqs(
          latestValid.impressions,
          latestValid.reactions,
          latestValid.comments,
          latestValid.reposts,
          latestValid.saves,
          latestValid.clicks
        )
      : null;
    return {
      ...p,
      _latest_capture: latestValid ? dbCaptureToSummary(latestValid) : null,
      _captures_count: list.length,
      _eqs: e,
    };
  });
}

// ─── Drafts (li_drafts) ──────────────────────────────────────────────

export interface DbDraft {
  id: string;
  bank_id: string | null;
  hook: string;
  doc_title: string;
  alt_text: string | null;
  caption: string | null;
  description: string | null;
  slides: unknown;
  ord: number | null;
  usp: string | null;
  targets: string[] | null;
  scenario: string | null;
  rationale: string | null;
  anchor: string | null;
  approval_status: string;
  render_required: boolean;
  render_status: string;
  pdf_url: string | null;
  storage_slug: string | null;
  created_at: string;
  updated_at: string;
  format?: string | null;
  poll?: unknown;
  posted_at?: string | null;
  li_activity_urn?: string | null;
  post_error?: string | null;
}

export async function listDrafts(): Promise<DbDraft[]> {
  const { data, error } = await supa()
    .from("li_drafts")
    .select("*")
    .order("ord", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data || []) as DbDraft[];
}

export async function getDraft(id: string): Promise<DbDraft | null> {
  const { data, error } = await supa()
    .from("li_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

export async function patchDraft(
  id: string,
  patch: { caption?: string; body?: string }
): Promise<DbDraft | null> {
  const update: Partial<DbDraft> & { updated_at?: string } = {};
  if (patch.caption !== undefined) update.caption = patch.caption;
  // The `body` field doesn't exist in li_drafts; the dashboard's "body" maps to caption.
  // Kept for backwards-compat with the existing PATCH contract; ignored if caption already set.
  if (patch.body !== undefined && update.caption === undefined) {
    update.caption = patch.body;
  }
  if (Object.keys(update).length === 0) return getDraft(id);
  update.updated_at = new Date().toISOString();
  const { data, error } = await supa()
    .from("li_drafts")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

/** CEO approves a draft for publishing → approval_status = "approved".
 *  The manual publisher (a Claude Code session) picks up "approved" drafts on
 *  command, posts to the company page, and writes li_posts. Reversible. */
export async function approveDraft(id: string): Promise<DbDraft | null> {
  const { data, error } = await supa()
    .from("li_drafts")
    .update({ approval_status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

/** Undo approval — status back to "awaiting CEO". */
export async function unapproveDraft(id: string): Promise<DbDraft | null> {
  const { data, error } = await supa()
    .from("li_drafts")
    .update({ approval_status: "awaiting CEO", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

/** CEO denies a draft — approval_status = "denied" (drops out of the publish queue). */
export async function denyDraft(id: string): Promise<DbDraft | null> {
  const { data, error } = await supa()
    .from("li_drafts")
    .update({ approval_status: "denied", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbDraft) || null;
}

// ─── Per-draft comments (li_draft_comments) ──────────────────────────
// The founder leaves alignment notes on a SPECIFIC draft ("make the hook
// quieter", "wrong persona", "love this — more like it"). The autopilot reads
// these at plan time to notice patterns and tune the skills. The table is
// created out-of-band (sql/li_draft_comments.sql); these functions degrade
// gracefully to empty if it isn't there yet, so the dashboard never crashes
// before the migration is applied.
export interface DbComment {
  id: string;
  draft_id: string;
  body: string;
  author: string;
  created_at: string;
}

export async function listComments(draftId: string): Promise<DbComment[]> {
  const { data, error } = await supa()
    .from("li_draft_comments")
    .select("*")
    .eq("draft_id", draftId)
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42P01") return []; // table not created yet — graceful
    throw error;
  }
  return (data || []) as DbComment[];
}

export async function addComment(
  draftId: string,
  body: string,
  author = "founder"
): Promise<DbComment | null> {
  const { data, error } = await supa()
    .from("li_draft_comments")
    .insert({ draft_id: draftId, body, author })
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data as DbComment) || null;
}

export async function deleteComment(commentId: string): Promise<boolean> {
  const { error } = await supa()
    .from("li_draft_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw error;
  return true;
}

// ─── Trigger Changes (bulk revise from comments) ─────────────────────
// A draft is "pending revision" when it has a comment newer than its last
// update. "Trigger Changes" writes a signal the local engine polls; on the next
// poll it bulk-revises every pending draft and re-stages it 'awaiting CEO'.
export async function countPendingRevisions(): Promise<number> {
  const { data: comments, error } = await supa()
    .from("li_draft_comments")
    .select("draft_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (error.code === "42P01") return 0;
    throw error;
  }
  if (!comments?.length) return 0;
  const latest = new Map<string, string>();
  for (const c of comments as { draft_id: string; created_at: string }[]) {
    const cur = latest.get(c.draft_id);
    if (!cur || c.created_at > cur) latest.set(c.draft_id, c.created_at);
  }
  const { data: drafts } = await supa()
    .from("li_drafts")
    .select("id, updated_at, approval_status")
    .in("id", [...latest.keys()]);
  let n = 0;
  for (const d of (drafts || []) as { id: string; updated_at: string; approval_status: string }[]) {
    const lc = latest.get(d.id);
    if (lc && lc > (d.updated_at || "") && !(d.approval_status || "").toLowerCase().startsWith("posted")) n++;
  }
  return n;
}

export async function triggerRevise(): Promise<{ requested_at: string; pending: number }> {
  const requested_at = new Date().toISOString();
  const { error } = await supa().storage
    .from("carousels")
    .upload("_signals/revise_trigger.json", JSON.stringify({ requested_at }), {
      upsert: true,
      contentType: "application/json",
    });
  if (error) throw error;
  const pending = await countPendingRevisions();
  return { requested_at, pending };
}

// ─── Schedule (li_schedule) ──────────────────────────────────────────

export interface DbSchedule {
  post_id: string;
  date: string;
  time_utc: string;
  day: string | null;
  slot_label: string | null;
  approval_status: string;
}

export async function listSchedule(): Promise<DbSchedule[]> {
  const { data, error } = await supa()
    .from("li_schedule")
    .select("*")
    .order("date", { ascending: true });
  if (error) throw error;
  return (data || []) as DbSchedule[];
}

// ─── Post bank (li_post_bank) ────────────────────────────────────────

import type { BankEntry } from "./types";

interface DbPostBank {
  bank_id: string;
  hook: string;
  usp: string | null;
  pain_class: string | null;
  facet: string | null;
  md_ref: string | null;
  description: string | null;
  status: string;
}

/** bank_id -> pain_class (e.g. "handover", "vitamin-search") for the small
 *  subset of published posts whose draft carries a bank_id lineage. Kept
 *  separate from listBank() because that function already discards
 *  pain_class while reshaping description into angle/why_it_lands. */
export async function listBankPainClasses(): Promise<Record<string, string>> {
  const { data, error } = await supa().from("li_post_bank").select("bank_id,pain_class");
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const r of (data || []) as { bank_id: string; pain_class: string | null }[]) {
    if (r.pain_class) map[r.bank_id] = r.pain_class;
  }
  return map;
}

export async function listBank(): Promise<BankEntry[]> {
  const { data, error } = await supa()
    .from("li_post_bank")
    .select("*")
    .order("bank_id", { ascending: true });
  if (error) throw error;
  return (data || []).map((b: DbPostBank) => {
    const desc = b.description || "";
    const sepIdx = desc.indexOf(" | ");
    return {
      id: b.bank_id,
      hook: b.hook,
      usp: b.usp || "",
      targets: "",
      scenario: b.facet || "",
      angle: sepIdx > 0 ? desc.slice(0, sepIdx) : desc,
      why_it_lands: sepIdx > 0 ? desc.slice(sepIdx + 3) : "",
      anchor: b.md_ref || "",
    };
  });
}

// ─── Format inference (shared) ────────────────────────────────────────

// Prefer the real `format` column (added 2026-06-24 with the auto-poster). For
// legacy rows without it, derive from pdf_url / usp tag / slides[0].type so the
// reviewer still sees the right post type. Defaults to carousel.
export function deriveFormat(row: {
  pdf_url?: string | null;
  usp?: string | null;
  slides?: unknown;
}): string {
  if (row.pdf_url) return "carousel";
  const m = (row.usp || "").match(/^\s*\[([^\]]+)\]/);
  const slides = Array.isArray(row.slides)
    ? (row.slides as Array<Record<string, unknown>>)
    : [];
  const s0 = slides[0] || {};
  const raw = String((m && m[1]) || s0.type || s0.t || "").toLowerCase();
  if (raw.includes("poll")) return "poll";
  if (raw.includes("video")) return "video";
  if (raw.includes("image") || raw.includes("component") || raw.includes("branded"))
    return "image";
  return "carousel";
}

// ─── Schedule assignment on approve ───────────────────────────────────

// A rotating time-of-day set, matching the spread already used across the
// live 100-day cycle (avoids every post landing at the same hour).
const SLOT_TIMES = ["08:30:00", "12:10:00", "17:40:00", "07:25:00", "13:50:00", "16:20:00", "09:05:00"];

/** Assigns (or reassigns) the next open li_schedule slot for a draft that was
 *  just approved — so approving a draft never implies "post it now," and the
 *  Schedule tab always shows a real upcoming date instead of whatever stale
 *  date the slot was originally seeded with weeks earlier.
 *
 *  Rule: next open day after the latest already-scheduled date, skipping an
 *  extra day if that would put the same coarse format back-to-back with the
 *  immediately preceding slot (mirrors MATRIX.md's "no same format/execution
 *  twice in a row" variety rule). Reuses the draft's existing li_schedule row
 *  (by post_id) if one exists — updates its date rather than creating a
 *  duplicate; otherwise inserts a new row.
 */
export async function scheduleNextAvailableSlot(draftId: string, format: string): Promise<void> {
  const { data: rows, error } = await supa()
    .from("li_schedule")
    .select("post_id,date,slot_label")
    .order("date", { ascending: false })
    .limit(20);
  if (error) throw error;
  const latest = (rows || []).find((r) => r.post_id !== draftId);
  const today = new Date().toISOString().slice(0, 10);
  const base = latest?.date && latest.date > today ? latest.date : today;
  const next = new Date(base + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  if (latest?.slot_label && latest.slot_label === format) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  const nextDate = next.toISOString().slice(0, 10);
  const time = SLOT_TIMES[(rows || []).length % SLOT_TIMES.length];

  const { data: existing } = await supa()
    .from("li_schedule")
    .select("post_id")
    .eq("post_id", draftId)
    .maybeSingle();

  if (existing) {
    const { error: updErr } = await supa()
      .from("li_schedule")
      .update({ date: nextDate, time_utc: time, slot_label: format })
      .eq("post_id", draftId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supa()
      .from("li_schedule")
      .insert({ post_id: draftId, date: nextDate, time_utc: time, slot_label: format, approval_status: "planned" });
    if (insErr) throw insErr;
  }
}

// ─── Real-metrics enrichment (DMA posts → our own drafting pipeline) ────────

/** Normalize free text for fuzzy caption matching: lowercase, strip URLs and
 *  punctuation, collapse whitespace, take a fixed-length prefix. LinkedIn's
 *  DMA commentary occasionally differs from our stored hook by a trailing
 *  hashtag block or a re-wrapped line break, so exact equality is too strict. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

/** Attaches _internal_format / _pain_class / _draft_id to each real DMA post
 *  by matching it back to the li_posts/li_drafts row it came from. Coverage
 *  is partial by design — draft_id lineage only reaches ~75% of published
 *  posts, and pain_class only reaches those whose draft also carries a
 *  bank_id — callers must show the resulting sample size, not assume full
 *  coverage. */
export async function enrichPageReport(report: PageReport): Promise<PageReport> {
  const [dbPosts, drafts, painClasses] = await Promise.all([
    supa()
      .from("li_posts")
      .select("id,draft_id")
      .then(({ data, error }) => {
        if (error) throw error;
        return (data || []) as { id: string; draft_id: string | null }[];
      }),
    listDrafts(),
    listBankPainClasses(),
  ]);

  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const candidates: { draftId: string; key: string }[] = [];
  for (const p of dbPosts) {
    if (!p.draft_id) continue;
    const d = draftById.get(p.draft_id);
    if (!d) continue;
    const key = normalizeForMatch(d.hook || d.caption || "");
    if (key.length >= 12) candidates.push({ draftId: d.id, key });
  }

  function findMatch(caption: string): string | null {
    const key = normalizeForMatch(caption);
    if (key.length < 12) return null;
    const hit = candidates.find((c) => key.startsWith(c.key) || c.key.startsWith(key));
    return hit ? hit.draftId : null;
  }

  const posts: DmaPost[] = report.posts.map((p) => {
    const draftId = findMatch(p.caption);
    const d = draftId ? draftById.get(draftId) : undefined;
    const format = d ? deriveFormat(d) : null;
    const painClass = d?.bank_id ? painClasses[d.bank_id] ?? null : null;
    return { ...p, _internal_format: format, _pain_class: painClass, _draft_id: draftId };
  });

  return { ...report, posts };
}

// ─── Durable report cache (Supabase Storage, survives cold starts) ──────────
// In-memory caching alone doesn't work on Vercel for a low-traffic route: a
// cold instance's module state resets, so nearly every real request missed
// the 6h freshness window and re-ran the full 60-90s DMA fetch chain (or hit
// its timeout — see the linkedin-pages route, this was the perpetual-502
// root cause). Persisting the last good report to storage means a cold
// instance serves it instantly instead of refetching or failing.
//
// Uses a dedicated "dashboard-cache" bucket, not "carousels" — that bucket's
// allowed_mime_types is locked to application/pdf|image/png|image/jpeg (it
// serves rendered carousel assets to the CEO's browser), so a JSON upload
// there 400s every time. dashboard-cache is private (service-role only,
// never rendered in a browser) and scoped to application/json.
const CACHE_BUCKET = "dashboard-cache";
const CACHE_PATH = "linkedin_pages_report.json";

export async function loadCachedReport(): Promise<PageReport | null> {
  const { data, error } = await supa().storage.from(CACHE_BUCKET).download(CACHE_PATH);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as PageReport;
  } catch {
    return null;
  }
}

export async function saveCachedReport(report: PageReport): Promise<void> {
  await supa()
    .storage.from(CACHE_BUCKET)
    .upload(CACHE_PATH, JSON.stringify(report), { upsert: true, contentType: "application/json" });
}
