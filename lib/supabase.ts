import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ScheduledPost, CaptureRow, CaptureSummary, Checkpoint, AugmentedPost } from "./types";
import { eqs } from "./eqs";

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
    const latest = list[list.length - 1] || null;
    const e = latest
      ? eqs(
          latest.impressions,
          latest.reactions,
          latest.comments,
          latest.reposts,
          latest.saves,
          latest.clicks
        )
      : null;
    return {
      ...p,
      _latest_capture: latest ? dbCaptureToSummary(latest) : null,
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
  created_at: string;
  updated_at: string;
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
