import { NextResponse } from "next/server";
import { getDraft, type DbDraft } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

type Slide = { n?: number; h?: string; b?: string; q?: string; c?: string };
type Poll = { question?: string; options?: string[] };

function slidesOf(d: DbDraft): Slide[] {
  return Array.isArray(d.slides) ? (d.slides as Slide[]) : [];
}
function pollOf(d: DbDraft): Poll | null {
  const p = (d as { poll?: unknown }).poll;
  return p && typeof p === "object" ? (p as Poll) : null;
}
function fmtOf(d: DbDraft): string {
  return (d as { format?: string | null }).format || "";
}

/** A complete, human-readable export of one draft (caption + slides + poll +
 *  script), so the CEO can read/inspect/download even before it is rendered. */
function toMarkdown(d: DbDraft): string {
  const L: string[] = [];
  L.push(`# ${d.doc_title || d.hook}`, "");
  L.push(`- **id:** ${d.id}`);
  L.push(`- **format:** ${fmtOf(d)}`);
  L.push(`- **status:** ${d.approval_status}`);
  if (d.rationale) L.push(`- **rationale:** ${d.rationale}`);
  L.push("", `**Hook:** ${d.hook}`, "");
  if (d.caption) L.push("## Caption", "", d.caption, "");
  const slides = slidesOf(d);
  if (slides.length) {
    L.push("## Slides", "");
    for (const s of slides) {
      L.push(`**Slide ${s.n ?? ""}.** ${s.h ?? ""}`);
      if (s.b) L.push(s.b);
      if (s.q) L.push(`> ${s.q}`);
      if (s.c) L.push(s.c);
      L.push("");
    }
  }
  const poll = pollOf(d);
  if (poll?.question) {
    L.push("## Poll", "", `**${poll.question}**`);
    for (const o of poll.options || []) L.push(`- [ ] ${o}`);
    L.push("");
  }
  if (d.description) L.push("## Script / notes", "", d.description, "");
  if (d.alt_text) L.push(`*Alt text:* ${d.alt_text}`);
  return L.join("\n");
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

/** Printable HTML — opens the browser print dialog so the CEO can "Save as PDF". */
function toPrintableHtml(d: DbDraft): string {
  const slides = slidesOf(d);
  const poll = pollOf(d);
  const block: string[] = [];
  block.push(`<h1>${esc(d.doc_title || d.hook)}</h1>`);
  block.push(`<p class="meta">${esc(d.id)} · ${esc(fmtOf(d))} · ${esc(d.approval_status)}</p>`);
  block.push(`<p class="hook"><strong>${esc(d.hook)}</strong></p>`);
  if (d.caption) block.push(`<h2>Caption</h2><p>${esc(d.caption).replace(/\n/g, "<br>")}</p>`);
  if (slides.length) {
    block.push(`<h2>Slides</h2>`);
    for (const s of slides) {
      block.push(`<div class="slide"><div class="n">Slide ${s.n ?? ""}</div>`);
      if (s.h) block.push(`<div class="h">${esc(s.h)}</div>`);
      if (s.b) block.push(`<div class="b">${esc(s.b)}</div>`);
      if (s.q) block.push(`<div class="q">${esc(s.q)}</div>`);
      if (s.c) block.push(`<div class="b">${esc(s.c)}</div>`);
      block.push(`</div>`);
    }
  }
  if (poll?.question) {
    block.push(`<h2>Poll</h2><p><strong>${esc(poll.question)}</strong></p><ul>`);
    for (const o of poll.options || []) block.push(`<li>${esc(o)}</li>`);
    block.push(`</ul>`);
  }
  if (d.description) block.push(`<h2>Script / notes</h2><p>${esc(d.description).replace(/\n/g, "<br>")}</p>`);
  if (d.alt_text) block.push(`<p class="alt"><em>Alt text:</em> ${esc(d.alt_text)}</p>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.id)}</title>
<style>
  body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#1a1a1a}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 6px;color:#2B7BA3}
  .meta{font:11px/1.4 monospace;color:#777;margin:0 0 14px}
  .hook{font-size:15px;margin:0 0 8px}
  .slide{border:1px solid #ddd;border-radius:6px;padding:8px 12px;margin:6px 0}
  .slide .n{font:10px monospace;color:#999} .slide .h{font-weight:600} .slide .b{font-size:13px} .slide .q{font-style:italic;font-size:13px}
  .alt{color:#777;font-size:12px;margin-top:18px}
  @media print{body{margin:0}}
</style></head><body>${block.join("")}
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;
}

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const fmt = new URL(req.url).searchParams.get("fmt") || "md";
  try {
    const d = await getDraft(id);
    if (!d) return NextResponse.json({ error: "draft not found" }, { status: 404 });
    if (fmt === "print") {
      return new NextResponse(toPrintableHtml(d), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new NextResponse(toMarkdown(d), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.md"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "download failed", detail: String(e) }, { status: 500 });
  }
}
