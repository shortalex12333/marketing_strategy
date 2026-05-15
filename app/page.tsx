"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AugmentedPost,
  BankEntry,
  CaptureRow,
} from "@/lib/types";

type Tab = "dashboard" | "posts" | "analytics" | "bank" | "briefs" | "drafts" | "schedule";

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
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
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
    if (tab === "schedule" && !schedule) loadSchedule();
  }, [tab, loadAnalytics, loadBank, loadDrafts, loadSchedule, drafts, schedule]);

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
        {(["dashboard", "schedule", "posts", "analytics", "bank", "briefs", "drafts"] as Tab[]).map((t) => (
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div className="mono" style={{ color: "var(--teal)", fontSize: 12 }}>
                          Post {d.ord} · {d.bank_id} · {d.format}
                        </div>
                        <h2 style={{ marginTop: 8, marginBottom: 6, textTransform: "none", letterSpacing: 0, fontSize: 16 }}>{d.hook}</h2>
                        <div className="small" style={{ marginBottom: 12 }}>
                          {d.posting_day_proposal} · {fmtDate(d.posting_time_utc)} UTC · {d.format}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="tag" style={{ background: "var(--bg-3)", color: "var(--amber)", borderColor: "rgba(200,168,92,0.4)" }}>
                          {d.approval_status}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
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

                    {d.format === "long-form text" && d.body && (
                      <div style={{ marginTop: 14 }}>
                        <h3>Body ({d.char_count} chars)</h3>
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans)", background: "var(--bg-0)", padding: 14, borderRadius: 4, fontSize: 13, lineHeight: 1.5, color: "var(--text-0)" }}>{d.body}</pre>
                      </div>
                    )}

                    {d.format === "carousel" && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                          <h3 style={{ margin: 0 }}>Carousel · {d.slides?.length || 0} slides · doc title: <span className="mono">{d.doc_title}</span></h3>
                          <div style={{ display: "flex", gap: 8 }}>
                            {d.pdf_url && (
                              <a href={d.pdf_url} target="_blank" rel="noopener noreferrer">
                                <button className="ghost">Download PDF</button>
                              </a>
                            )}
                            <button className="ghost" onClick={() => setExpandedDraft(expandedDraft === d.id ? null : d.id)}>
                              {expandedDraft === d.id ? "Hide slides" : "Show slides"}
                            </button>
                          </div>
                        </div>
                        {d.render_status && (
                          <p className="small" style={{ color: d.render_status.includes("rendered") ? "var(--green)" : "var(--amber)" }}>
                            Render: {d.render_status}
                          </p>
                        )}
                        {expandedDraft === d.id && d.slides && (() => {
                          const slug = d.pdf_url ? d.pdf_url.replace("/carousels/", "").replace(".pdf", "") : null;
                          return (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
                              {d.slides.map((s) => {
                                const imgUrl = slug ? `/carousels/${slug}/slide_${String(s.n).padStart(2, "0")}.png` : null;
                                return (
                                  <div key={s.n} style={{
                                    background: "var(--bg-0)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    overflow: "hidden",
                                  }}>
                                    {imgUrl ? (
                                      <a href={imgUrl} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={imgUrl} alt={`Slide ${s.n}: ${s.h || s.q || ""}`} style={{ width: "100%", display: "block" }} />
                                      </a>
                                    ) : (
                                      <div style={{
                                        background: s.mode === "dark" ? "var(--bg-0)" : "var(--bg-3)",
                                        padding: 14,
                                        minHeight: 140,
                                        fontSize: 12,
                                      }}>
                                        <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 8 }}>
                                          Slide {s.n} · {s.mode}
                                        </div>
                                        {s.q ? (
                                          <>
                                            <div style={{ fontStyle: "italic", marginBottom: 6 }}>&ldquo;{s.q}&rdquo;</div>
                                            <div className="small">{s.c}</div>
                                          </>
                                        ) : (
                                          <>
                                            <div style={{ fontWeight: 500, marginBottom: 6, lineHeight: 1.3 }}>{s.h}</div>
                                            {s.b && <div className="small" style={{ lineHeight: 1.4 }}>{s.b}</div>}
                                          </>
                                        )}
                                      </div>
                                    )}
                                    <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", padding: "6px 10px", borderTop: "1px solid var(--border)" }}>
                                      Slide {s.n} · {s.mode}{s.bg_variant ? ` · ${s.bg_variant}` : ""}{s.card ? ` · card:${s.card}` : ""}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {d.caption && (
                      <div style={{ marginTop: 14 }}>
                        <h3>Caption</h3>
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans)", background: "var(--bg-0)", padding: 14, borderRadius: 4, fontSize: 12, lineHeight: 1.5, color: "var(--text-1)" }}>{d.caption}</pre>
                      </div>
                    )}

                    {d.alt_text && (
                      <div style={{ marginTop: 14 }}>
                        <h3>Document-level alt text</h3>
                        <p className="small" style={{ lineHeight: 1.5 }}>{d.alt_text}</p>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="panel"><div className="empty">Loading drafts…</div></div>
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
                  <h2>Calendar · the proposed 5</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th><th>Date</th><th>Time</th><th>Format</th><th>Hook</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.calendar.map((item) => (
                        <tr key={item.post_id}>
                          <td>{item.day}</td>
                          <td className="mono">{item.date}</td>
                          <td className="mono">{item.time_utc} UTC</td>
                          <td className="small">{item.format}</td>
                          <td>{item.hook.length > 60 ? item.hook.slice(0, 60) + "…" : item.hook}</td>
                          <td>
                            <span className="tag" style={{ color: "var(--amber)", borderColor: "rgba(200,168,92,0.4)" }}>
                              {item.approval_status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
