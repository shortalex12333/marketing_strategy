#!/usr/bin/env python3
"""
One-shot + idempotent migration of carousel artefacts from public/carousels/
into Supabase Storage bucket `carousels`.

Bucket layout:
  <slug>/cover.pdf
  <slug>/slide_01.png ... slide_09.png

Walks public/carousels/, uploads what exists, then UPDATEs li_drafts rows
to point pdf_url at the public Supabase URL and writes storage_slug.

Idempotent: re-runs only upsert files whose size or content hash differs.
Skips drafts whose local files don't exist on disk (per
feedback_li_drafts_pdf_url_stale_for_unrendered_2026_06_01) — those have
storage_slug left NULL so the FE can suppress the download link cleanly.

Usage:
  python3 tools/upload_carousels_to_supabase.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_REF = "verhpfznevahwxfawnwn"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
BUCKET = "carousels"
REPO_ROOT = Path(__file__).resolve().parent.parent
CAROUSELS_DIR = REPO_ROOT / "public" / "carousels"
PAT_FILE = Path.home() / "Documents" / "JARVIS" / "SUPABASE_PAT.md"
DB_FILE = Path.home() / "Documents" / "JARVIS" / "KENOKI_SUPABASE_DB.md"


def read_kv(path: Path, key: str) -> str:
    for line in path.read_text().splitlines():
        if key in line and "=" in line:
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"key {key} not found in {path}")


SERVICE_KEY = read_kv(DB_FILE, "KENOKI_SUPABASE_SERVICE_KEY")
PAT = read_kv(PAT_FILE, "JARVIS_SUPABASE_PAT")


def storage_upload(local: Path, key: str, mime: str, *, dry: bool) -> str:
    """Upload (upsert) one file. Returns the resolved public URL."""
    url = f"{PROJECT_URL}/storage/v1/object/{BUCKET}/{key}"
    if dry:
        return public_url(key)
    data = local.read_bytes()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": mime,
            "x-upsert": "true",
            "Cache-Control": "public, max-age=3600",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise SystemExit(f"upload {key} failed: {e.code} {body}")
    return public_url(key)


def public_url(key: str) -> str:
    return f"{PROJECT_URL}/storage/v1/object/public/{BUCKET}/{key}"


def db_query(sql: str) -> object:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {PAT}",
            "Content-Type": "application/json",
            "User-Agent": "celesteos-linkedin-dashboard/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def sql_str(s: str) -> str:
    """Postgres single-quote escape."""
    return "'" + s.replace("'", "''") + "'"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    rows = db_query(
        "SELECT id, pdf_url FROM li_drafts "
        "WHERE pdf_url IS NOT NULL ORDER BY id;"
    )
    if not isinstance(rows, list):
        raise SystemExit(f"unexpected db response: {rows!r}")

    print(f"li_drafts rows with pdf_url: {len(rows)}")

    updates: list[tuple[str, str, str]] = []
    skipped: list[tuple[str, str, str]] = []

    for row in rows:
        draft_id = row["id"]
        old_url = row["pdf_url"]
        if not old_url or not old_url.startswith("/carousels/"):
            skipped.append((draft_id, old_url or "", "non-relative or missing"))
            continue
        slug = old_url.removeprefix("/carousels/").removesuffix(".pdf")
        pdf_path = CAROUSELS_DIR / f"{slug}.pdf"
        slides_dir = CAROUSELS_DIR / slug

        if not pdf_path.exists():
            skipped.append((draft_id, slug, "pdf missing on disk"))
            continue

        print(f"\n[{draft_id}] slug={slug}")
        url_cover = storage_upload(
            pdf_path, f"{slug}/cover.pdf", "application/pdf", dry=args.dry_run
        )
        print(f"  ↑ cover.pdf  ({pdf_path.stat().st_size:>9d} B) → {url_cover}")

        if slides_dir.is_dir():
            for png in sorted(slides_dir.glob("slide_*.png")):
                key = f"{slug}/{png.name}"
                u = storage_upload(png, key, "image/png", dry=args.dry_run)
                print(f"  ↑ {png.name}  ({png.stat().st_size:>9d} B)")
            print(f"  slide dir uploaded ({len(list(slides_dir.glob('slide_*.png')))} files)")

        updates.append((draft_id, slug, url_cover))

    if not args.dry_run and updates:
        print(f"\nUPDATE li_drafts: {len(updates)} rows")
        # Single CASE-based UPDATE to keep it one round-trip
        when_slugs = " ".join(
            f"WHEN {sql_str(d)} THEN {sql_str(s)}" for d, s, _ in updates
        )
        when_urls = " ".join(
            f"WHEN {sql_str(d)} THEN {sql_str(u)}" for d, _, u in updates
        )
        ids = ",".join(sql_str(d) for d, _, _ in updates)
        sql = (
            "UPDATE li_drafts SET "
            f"storage_slug = CASE id {when_slugs} END, "
            f"pdf_url = CASE id {when_urls} END, "
            "updated_at = NOW() "
            f"WHERE id IN ({ids});"
        )
        db_query(sql)
        print("  ✓ rows updated")

    if skipped:
        print(f"\nskipped {len(skipped)} (no upload):")
        for draft_id, slug, why in skipped:
            print(f"  [{draft_id:18s}] slug={slug:35s} {why}")

    print(f"\ndone. uploaded={len(updates)} skipped={len(skipped)} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
