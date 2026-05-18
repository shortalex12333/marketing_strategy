"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AugmentedPost,
  BankEntry,
  CaptureRow,
} from "@/lib/types";

type Tab = "dashboard" | "schedule" | "roadmap" | "pages" | "posts" | "analytics" | "bank" | "briefs" | "drafts";

interface PageReport {
  fetched_at: string;
  org: string;
  posts: Array<{
    urn: string; type: string; caption: string; published: string;
    lifecycle: string; impressions: number; clicks: number;
    reactions: number; comments: number; ctr: string;
  }>;
  by_type: Record<string, { n: number; impressions: number; clicks: number; reactions: number }>;
  visitors_360d: number | null;
  followers_360d: number | null;
  notes: string;
  _source?: string;
  _age_min?: number;
}

interface RoadmapSlide {
  n: number;
  mode: "dark" | "light";
  h?: string;
  b?: string;
  card?: string;
  atmosphere?: string;
  emphasis?: string;
  bg_variant?: string;
  lightVariant?: string;
}

interface RoadmapCarousel {
  slot: string;
  id: string;
  bank_ref: string;
  hook: string;
  pillar: string;
  usp: string;
  targets: string[];
  scenario: string;
  proposed_day: string;
  atmosphere: string;
  emphasis_word: string;
  why_engages: string;
  anti_sameness: string;
  caption: string;
  slides: RoadmapSlide[];
}

interface RoadmapResponse {
  version: string;
  wave: number;
  format: string;
  cadence: string;
  source: string;
  status: string;
  moodboard_atmospheres: Record<string, string>;
  carousels: RoadmapCarousel[];
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
  caption?: string;
  alt_text?: string;
  slides?: DraftSlide[];
}

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
}

interface Checkpoint {
  date: string;
  label: string;
  action: string;
}

interface ScheduleResponse {
  version: string;
  phase: string;
  cadence_rule: string;
  primary_account: string;
  company_page_role: string;
  calendar: ScheduleItem[];
  checkpoints: Checkpoint[];
  next_brief_due: string;
}

interface AppState {
  posts_count: number;
  captures_count: number;
  bank_count: number;
  avg_eqs: number | null;
  now_utc: string;
}

interface BriefResponse {
  ok: boolean;
  mode: string;
  picks: (BankEntry & {
    usp_code: string;
    primary_target: string;
    scenario_code: string;
  })[];
  median_eqs_trailing_4wk: number | null;
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

export default function Page() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [state, setState] = useState<AppState | null>(null);
  const [posts, setPosts] = useState<AugmentedPost[]>([]);
  const [analytics, setAnalytics] = useState<(CaptureRow & { eqs: number | null })[]>([]);
  const [bank, setBank] = useState<BankEntry[]>([]);
  const [bankQuery, setBankQuery] = useState("");
  const [uspFilter, setUspFilter] = useState("");
  const [briefMode, setBriefMode] = useState<"recovery" | "ramp" | "daily">("recovery");
  const [latestBrief, setLatestBrief] = useState<BriefResponse | null>(null);
  const [drafts, setDrafts] = useState<DraftsResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapResponse | null>(null);
  const [pageReport, setPageReport] = useState<PageReport | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [expandedRoadmap, setExpandedRoadmap] = useState<string | null>(null);
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

  const loadBank = useCallback(async () => {
    const r = await fetch("/api/bank");
    if (r.ok) setBank(await r.json());
  }, []);

  const loadDrafts = useCallback(async () => {
    const r = await fetch("/api/drafts");
    if (r.ok) setDrafts(await r.json());
  }, []);

  const loadSchedule = useCallback(async () => {
    const r = await fetch("/api/schedule");
    if (r.ok) setSchedule(await r.json());
  }, []);

  const loadPages = useCallback(async (force = false) => {
    setPagesLoading(true);
    try {
      const r = await fetch("/api/linkedin-pages" + (force ? "?refresh=1" : ""), { cache: "no-store" });
      if (r.ok) setPageReport(await r.json());
    } finally {
      setPagesLoading(false);
    }
  }, []);

  const loadRoadmap = useCallback(async () => {
    const r = await fetch("/api/roadmap");
    if (r.ok) setRoadmap(await r.json());
  }, []);

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
    if (tab === "analytics") loadAnalytics();
    if (tab === "bank") loadBank();
    if (tab === "drafts" && !drafts) loadDrafts();
    if (tab === "schedule") {
      if (!schedule) loadSchedule();
      if (!drafts) loadDrafts();
    }
    if (tab === "roadmap" && !roadmap) loadRoadmap();
    if (tab === "pages" && !pageReport) loadPages();
  }, [tab, loadAnalytics, loadBank, loadDrafts, loadSchedule, loadRoadmap, loadPages, drafts, schedule, roadmap, pageReport]);

  const handleDraftSaved = (id: string, patch: { caption?: string; body?: string }) => {
    if (!drafts) return;
    setDrafts({
      ...drafts,
      drafts: drafts.drafts.map((d) =>
        d.id === id ? { ...d, ...patch } : d
      ),
    });
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

  const generateBrief = async () => {
    try {
      const r = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: briefMode }),
      });
      const j: BriefResponse = await r.json();
      if (j.ok) {
        setLatestBrief(j);
        showToast(`Brief generated — ${j.picks.length} picks.`);
      } else {
        showToast("Brief gen failed", "error");
      }
    } catch (e) {
      showToast("Error: " + (e as Error).message, "error");
    }
  };

  const filteredBank = useMemo(() => {
    const q = bankQuery.toLowerCase();
    return bank.filter((e) => {
      const blob = `${e.id} ${e.hook} ${e.usp} ${e.targets} ${e.scenario} ${e.angle} ${e.anchor}`.toLowerCase();
      if (q && !blob.includes(q)) return false;
      if (uspFilter) {
        const u = (e.usp || "").toUpperCase();
        if (!u.includes(uspFilter)) return false;
      }
      return true;
    });
  }, [bank, bankQuery, uspFilter]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span className="name">CELESTEOS · LINKEDIN</span>
          <span className="sub">CLAWEDBOT01</span>
        </div>
        <div className="status">
          <span>{state ? `${state.posts_count} posts · ${state.captures_count} captures` : "—"}</span>
          <span className="now">
            {state ? "UTC " + new Date(state.now_utc).toLocaleTimeString("en-GB", { hour12: false }) : ""}
          </span>
        </div>
      </header>

      <nav className="tabs">
        {(["dashboard", "schedule", "roadmap", "pages", "posts", "analytics", "bank", "briefs", "drafts"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === "dashboard" && (
          <>
            <div className="stat-grid">
              <Stat label="Posts scheduled" value={state?.posts_count ?? "—"} hint="Tracked by impression-capture agent" />
              <Stat label="Captures logged" value={state?.captures_count ?? "—"} hint="Rows in Upstash Redis" />
              <Stat label="Avg EQS" value={state?.avg_eqs ?? "—"} hint="Across all captures · per skill §18.4" />
              <Stat label="Bank entries" value={state?.bank_count ?? "—"} hint="USP × stakeholder × scenario" />
            </div>

            <div className="panel">
              <h2>Submit a published post</h2>
              <p className="small">
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
            </div>

            <div className="panel">
              <h2>Recently scheduled · capture status</h2>
              {posts.length === 0 ? (
                <div className="empty">No scheduled posts yet. Submit one above.</div>
              ) : (
                posts.slice().reverse().slice(0, 5).map((p) => (
                  <div key={p.id} style={{ borderBottom: "1px solid var(--border)", padding: "14px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ flex: 1 }}>
                        <div className="mono" style={{ color: "var(--teal)", fontSize: 12 }}>{p.id}</div>
                        <div style={{ fontSize: 13, color: "var(--text-1)", margin: "4px 0" }}>
                          <a href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>
                        </div>
                        <div className="small">Published: {fmtDate(p.published_at)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <CapturePills captures={p.captures} />
                        <div style={{ marginTop: 8 }}>
                          {p._latest_capture && (
                            <div className="small">
                              impressions: <span className="mono">{p._latest_capture.impressions ?? "—"}</span>
                            </div>
                          )}
                          <div style={{ marginTop: 4 }}>EQS: <EqsBadge value={p._eqs} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {tab === "posts" && (
          <div className="panel">
            <h2>All scheduled posts</h2>
            <table>
              <thead>
                <tr>
                  <th>Label</th><th>Published</th><th>Captures</th><th>Impressions</th><th>EQS</th><th>URL</th><th></th>
                </tr>
              </thead>
              <tbody>
                {posts.length === 0 && (
                  <tr><td colSpan={7} className="empty">No scheduled posts yet.</td></tr>
                )}
                {posts.slice().reverse().map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
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
        )}

        {tab === "analytics" && (
          <div className="panel">
            <h2>Capture log · all rows from Upstash</h2>
            <table>
              <thead>
                <tr>
                  <th>Captured at</th><th>Post</th><th>Checkpoint</th><th>Impressions</th><th>Reactions</th><th>Comments</th><th>Reposts</th><th>EQS</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {analytics.length === 0 && (
                  <tr><td colSpan={9} className="empty">No captures logged yet.</td></tr>
                )}
                {analytics.slice().reverse().map((r, i) => (
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
          </div>
        )}

        {tab === "bank" && (
          <div className="panel">
            <h2>Post bank · {bank.length} entries</h2>
            <input type="text" className="bank-search" value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} placeholder="Search hook / USP / stakeholder / scenario / anchor…" />
            <div className="form-row" style={{ marginBottom: 12 }}>
              <label className="small">USP:</label>
              <select value={uspFilter} onChange={(e) => setUspFilter(e.target.value)}>
                <option value="">All</option>
                {["U1", "U2", "U3", "U4", "U5", "BRAND", "INDUSTRY", "OTHER"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="bank-list">
              {filteredBank.length === 0 ? (
                <div className="empty">No entries match.</div>
              ) : (
                filteredBank.map((e) => {
                  const uspTag = (e.usp.match(/U[1-5]|BRAND|INDUSTRY/) || ["OTHER"])[0];
                  return (
                    <div key={e.id} className="bank-card">
                      <div className="id">{e.id}</div>
                      <div className="hook">{e.hook}</div>
                      <div className="meta">
                        <span className={`tag tag-${uspTag.toLowerCase()}`}>{uspTag}</span>
                        <span>{e.targets}</span>
                        <span>{e.scenario ? "Sc: " + e.scenario.slice(0, 30) : ""}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === "briefs" && (
          <>
            <div className="panel">
              <h2>Generate a new brief</h2>
              <div className="form-row">
                <div className="form-group" style={{ flex: 0, minWidth: 180 }}>
                  <label>Cadence</label>
                  <select value={briefMode} onChange={(e) => setBriefMode(e.target.value as never)}>
                    <option value="recovery">Recovery (3 picks)</option>
                    <option value="ramp">Ramp (4 picks)</option>
                    <option value="daily">Daily (5 picks)</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 0, minWidth: "auto" }}>
                  <label>&nbsp;</label>
                  <button onClick={generateBrief}>Generate</button>
                </div>
              </div>
            </div>
            {latestBrief && (
              <div className="panel">
                <h2>Latest brief · {latestBrief.mode}</h2>
                {latestBrief.median_eqs_trailing_4wk != null && (
                  <p className="small">Median EQS (trailing 4w): {latestBrief.median_eqs_trailing_4wk}</p>
                )}
                <table>
                  <thead>
                    <tr><th>#</th><th>ID</th><th>USP</th><th>Target</th><th>Sc</th><th>Hook</th></tr>
                  </thead>
                  <tbody>
                    {latestBrief.picks.map((p, i) => (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td className="mono">{p.id}</td>
                        <td><span className={`tag tag-${p.usp_code.toLowerCase()}`}>{p.usp_code}</span></td>
                        <td>{p.primary_target}</td>
                        <td>{p.scenario_code}</td>
                        <td>{p.hook}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details style={{ marginTop: 12 }}>
                  <summary className="small" style={{ cursor: "pointer" }}>Full pick details</summary>
                  {latestBrief.picks.map((p, i) => (
                    <div key={p.id} style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                      <h3>Pick {i + 1} · {p.id} — {p.hook}</h3>
                      <ul className="small">
                        <li><strong>USP:</strong> {p.usp}</li>
                        <li><strong>Targets:</strong> {p.targets}</li>
                        <li><strong>Scenario:</strong> {p.scenario}</li>
                        <li><strong>Angle:</strong> {p.angle}</li>
                        <li><strong>Why it lands:</strong> {p.why_it_lands}</li>
                        <li><strong>Anchor:</strong> {p.anchor}</li>
                      </ul>
                    </div>
                  ))}
                </details>
              </div>
            )}
          </>
        )}

        {tab === "drafts" && (
          <>
            {drafts ? (
              <>
                <div className="panel">
                  <h2>First-5 post drafts · {drafts.version}</h2>
                  <p className="small">Source: <span className="mono">{drafts.source}</span></p>
                  {drafts.fix_log && drafts.fix_log.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="small" style={{ cursor: "pointer" }}>Fix log ({drafts.fix_log.length} review fixes applied)</summary>
                      <ul className="small" style={{ marginTop: 8 }}>
                        {drafts.fix_log.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                {drafts.drafts.map((d) => (
                  <div className="panel" key={d.id}>
                    <DraftDetail draft={d} onSaved={handleDraftSaved} onToast={showToast} />
                  </div>
                ))}
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
                <h2 style={{ margin: 0 }}>CelesteOS Page Analytics · live from LinkedIn (DMA API)</h2>
                <button className="ghost" onClick={() => loadPages(true)} disabled={pagesLoading}>
                  {pagesLoading ? "Fetching…" : "Refresh from LinkedIn"}
                </button>
              </div>
              {pageReport && (
                <p className="small" style={{ marginTop: 8 }}>
                  fetched {fmtDate(pageReport.fetched_at)} · source: {pageReport._source}
                  {pageReport._age_min != null ? ` · ${pageReport._age_min}m old` : ""} · org {pageReport.org}
                </p>
              )}
            </div>

            {!pageReport ? (
              <div className="panel"><div className="empty">{pagesLoading ? "Fetching from LinkedIn (one feed call, rate-limited)…" : "Loading…"}</div></div>
            ) : (
              <>
                <div className="stat-grid">
                  <Stat label="Posts" value={pageReport.posts.length} hint="company page, last 360d" />
                  <Stat label="Visitors 360d" value={pageReport.visitors_360d ?? "—"} hint="unique page visitors" />
                  <Stat label="Followers 360d" value={pageReport.followers_360d ?? "0*"} hint="*member opt-in gated" />
                  <Stat label="Top post impr." value={pageReport.posts[0]?.impressions ?? 0} hint={pageReport.posts[0]?.type ?? ""} />
                </div>

                <div className="panel">
                  <h2>Segment by post type (reverse-engineer what works)</h2>
                  <table>
                    <thead><tr><th>Type</th><th>Posts</th><th>Total impr.</th><th>Avg impr./post</th><th>Total clicks</th><th>Total reactions</th></tr></thead>
                    <tbody>
                      {Object.entries(pageReport.by_type)
                        .sort((a, b) => (b[1].impressions / b[1].n) - (a[1].impressions / a[1].n))
                        .map(([t, v]) => (
                          <tr key={t}>
                            <td><span className="tag">{t}</span></td>
                            <td className="mono">{v.n}</td>
                            <td className="mono">{v.impressions}</td>
                            <td className="mono" style={{ color: "var(--teal)" }}>{Math.round(v.impressions / v.n)}</td>
                            <td className="mono">{v.clicks}</td>
                            <td className="mono">{v.reactions}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
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

        {tab === "roadmap" && (
          <>
            {roadmap ? (
              <>
                <div className="panel">
                  <h2>Wave {roadmap.wave} · Carousel Roadmap · {roadmap.status}</h2>
                  <p className="small"><strong>Format:</strong> {roadmap.format}</p>
                  <p className="small"><strong>Cadence:</strong> {roadmap.cadence}</p>
                  <p className="small"><strong>Source:</strong> <span className="mono">{roadmap.source}</span></p>
                  <details style={{ marginTop: 14 }}>
                    <summary className="small" style={{ cursor: "pointer" }}>Moodboard atmospheres</summary>
                    <ul className="small" style={{ marginTop: 8 }}>
                      {Object.entries(roadmap.moodboard_atmospheres).map(([k, v]) => (
                        <li key={k}><strong style={{ color: k === "red" ? "var(--red)" : k === "amber" ? "var(--amber)" : k === "teal" ? "var(--teal)" : k === "green" ? "var(--green)" : "var(--text-1)" }}>{k}:</strong> {v}</li>
                      ))}
                    </ul>
                  </details>
                </div>

                <div className="panel">
                  <h2>The 12 · click any row to expand the full storyline</h2>
                  {roadmap.carousels.map((c) => {
                    const isOpen = expandedRoadmap === c.id;
                    const atmoColours = (s: string) =>
                      s.includes("red") ? "var(--red)" :
                      s.includes("amber") ? "var(--amber)" :
                      s.includes("teal") ? "var(--teal)" :
                      s.includes("green") ? "var(--green)" : "var(--text-2)";
                    return (
                      <div key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <div
                          onClick={() => setExpandedRoadmap(isOpen ? null : c.id)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "70px 110px 200px 1fr 140px",
                            gap: 12,
                            padding: "14px 4px",
                            cursor: "pointer",
                            alignItems: "center",
                          }}
                        >
                          <div className="mono" style={{ color: isOpen ? "var(--teal)" : "var(--text-1)" }}>
                            {isOpen ? "▼ " : "▶ "}{c.slot}
                          </div>
                          <div className="mono small">{c.proposed_day}</div>
                          <div className="small mono">{c.usp}</div>
                          <div style={{ fontSize: 13 }}>
                            {c.hook.length > 65 ? c.hook.slice(0, 65) + "…" : c.hook}
                          </div>
                          <div className="small mono" style={{ color: atmoColours(c.atmosphere) }}>
                            {c.atmosphere.split(" ")[0]}
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "16px 4px 28px", background: "var(--bg-0)", borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 16 }}>
                              <div>
                                <h3>Why it engages</h3>
                                <p className="small">{c.why_engages}</p>
                                <h3 style={{ marginTop: 14 }}>Anti-sameness</h3>
                                <p className="small">{c.anti_sameness}</p>
                              </div>
                              <div>
                                <h3>Targets · scenario</h3>
                                <p className="small mono">{c.targets.join(" · ")}</p>
                                <p className="small">{c.scenario}</p>
                                <h3 style={{ marginTop: 14 }}>Atmosphere · emphasis</h3>
                                <p className="small mono" style={{ color: atmoColours(c.atmosphere) }}>{c.atmosphere}</p>
                                <p className="small">{c.emphasis_word}</p>
                                <p className="small mono" style={{ color: "var(--text-2)", marginTop: 8 }}>bank: {c.bank_ref}</p>
                              </div>
                            </div>

                            <h3 style={{ marginBottom: 10 }}>9-slide arc</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 16 }}>
                              {c.slides.map((s) => {
                                const cardBg = s.mode === "dark" ? "var(--bg-1)" : "var(--bg-3)";
                                const atmoColour =
                                  s.atmosphere === "red" ? "rgba(192,80,58,0.25)" :
                                  s.atmosphere === "amber" ? "rgba(196,137,59,0.25)" :
                                  s.atmosphere === "teal" ? "rgba(90,171,204,0.25)" :
                                  s.atmosphere === "green" ? "rgba(74,148,104,0.25)" :
                                  null;
                                return (
                                  <div key={s.n} style={{
                                    background: cardBg,
                                    border: "1px solid var(--border)",
                                    borderLeft: atmoColour ? `3px solid ${atmoColour.replace("0.25", "1")}` : "1px solid var(--border)",
                                    borderRadius: 6,
                                    padding: 14,
                                    minHeight: 130,
                                    fontSize: 12,
                                    position: "relative",
                                  }}>
                                    {atmoColour && (
                                      <div style={{
                                        position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
                                        background: `radial-gradient(ellipse at 50% 60%, ${atmoColour} 0%, transparent 70%)`,
                                        pointerEvents: "none",
                                      }} />
                                    )}
                                    <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 8, position: "relative" }}>
                                      Slide {s.n} · {s.mode}
                                      {s.atmosphere && <span style={{ color: atmoColours(s.atmosphere), marginLeft: 6 }}>· {s.atmosphere}</span>}
                                      {s.card && <span style={{ marginLeft: 6 }}>· card:{s.card}</span>}
                                      {s.lightVariant && <span style={{ marginLeft: 6 }}>· {s.lightVariant}</span>}
                                    </div>
                                    <div style={{ position: "relative", fontWeight: 500, lineHeight: 1.3, marginBottom: 6 }}>{s.h}</div>
                                    {s.b && <div className="small" style={{ position: "relative", lineHeight: 1.4 }}>{s.b}</div>}
                                    {s.emphasis && (
                                      <div className="small mono" style={{ position: "relative", marginTop: 6, color: "var(--teal)", fontStyle: "italic" }}>
                                        emph: <em>{s.emphasis}</em>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <h3 style={{ marginBottom: 8 }}>Caption</h3>
                            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans)", background: "var(--bg-1)", padding: 14, borderRadius: 4, fontSize: 12, lineHeight: 1.5, color: "var(--text-1)" }}>{c.caption}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="panel"><div className="empty">Loading roadmap…</div></div>
            )}
          </>
        )}

        {tab === "schedule" && (
          <>
            {schedule ? (
              <>
                <div className="panel">
                  <h2>{schedule.phase}</h2>
                  <p className="small"><strong>Cadence rule:</strong> {schedule.cadence_rule}</p>
                  <p className="small"><strong>Primary account:</strong> {schedule.primary_account}</p>
                  <p className="small"><strong>Company page role:</strong> {schedule.company_page_role}</p>
                  <p className="small" style={{ marginTop: 12 }}><strong>Next brief due:</strong> {schedule.next_brief_due}</p>
                </div>

                <div className="panel">
                  <h2>Calendar · the proposed 5 · click any row to expand</h2>
                  {schedule.calendar.map((item) => {
                    const draft = drafts?.drafts.find((d) => d.id === item.post_id);
                    const isOpen = expandedDraft === item.post_id;
                    return (
                      <div key={item.post_id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <div
                          onClick={() => setExpandedDraft(isOpen ? null : item.post_id)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "90px 110px 90px 130px 1fr 120px",
                            gap: 12,
                            padding: "14px 4px",
                            cursor: "pointer",
                            alignItems: "center",
                          }}
                        >
                          <div className="mono" style={{ color: isOpen ? "var(--teal)" : "var(--text-1)" }}>
                            {isOpen ? "▼ " : "▶ "}{item.day.slice(0, 3)}
                          </div>
                          <div className="mono small">{item.date}</div>
                          <div className="mono small">{item.time_utc}</div>
                          <div className="small">{item.format}</div>
                          <div style={{ fontSize: 13 }}>
                            {item.hook.length > 90 ? item.hook.slice(0, 90) + "…" : item.hook}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span className="tag" style={{ color: "var(--amber)", borderColor: "rgba(200,168,92,0.4)" }}>
                              {item.approval_status}
                            </span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "8px 4px 24px", background: "var(--bg-0)", borderTop: "1px solid var(--border)" }}>
                            {draft ? (
                              <DraftDetail draft={draft} onSaved={handleDraftSaved} onToast={showToast} />
                            ) : drafts ? (
                              <p className="small empty">No draft found for {item.post_id}.</p>
                            ) : (
                              <p className="small empty">Loading…</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="panel">
                  <h2>Recovery checkpoints</h2>
                  {schedule.checkpoints.map((cp) => (
                    <div key={cp.date} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                      <div className="mono" style={{ color: "var(--teal)", fontSize: 12 }}>{cp.date} · {cp.label}</div>
                      <div className="small" style={{ marginTop: 4, lineHeight: 1.5 }}>{cp.action}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="panel"><div className="empty">Loading schedule…</div></div>
            )}
          </>
        )}
      </main>

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

function DraftDetail({
  draft,
  onSaved,
  onToast,
}: {
  draft: Draft;
  onSaved: (id: string, patch: { caption?: string; body?: string }) => void;
  onToast: (msg: string, kind?: "success" | "error") => void;
}) {
  const d = draft;
  const [caption, setCaption] = useState(d.caption || "");
  const [body, setBody] = useState(d.body || "");
  const [showSlides, setShowSlides] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = d.pdf_url ? d.pdf_url.replace("/carousels/", "").replace(".pdf", "") : null;
  const cardImg = slug ? `/carousels/${slug}/slide_01.png` : null;

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
        <div style={{ textAlign: "right" }}>
          <span className="tag" style={{ background: "var(--bg-3)", color: "var(--amber)", borderColor: "rgba(200,168,92,0.4)" }}>
            {d.approval_status}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 14 }}>
        <div>
          <h3>Rationale</h3>
          <p className="small">{d.rationale}</p>
        </div>
        <div>
          <h3>Targets · Scenario</h3>
          <p className="small mono">{d.targets.join(" · ")}</p>
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
                const imgUrl = `/carousels/${slug}/slide_${String(s.n).padStart(2, "0")}.png`;
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
