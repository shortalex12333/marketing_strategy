# CelesteOS LinkedIn Dashboard — API Reference

The dashboard exposes a small JSON API for fetching tracked LinkedIn posts, their analytics history, and the underlying content catalogue.

- **Base URL:** `https://marketing-strategy-nine.vercel.app`
- **Storage:** Redis (Upstash via Vercel Marketplace), keyed by post id
- **Server runtime:** Next.js 16 API routes on Vercel Fluid Compute

---

## Authentication

There are two layers — read endpoints and the one write endpoint that ingests captures.

### Read endpoints (everything except `POST /api/captures`)

No bearer token. The deployment relies on **Vercel Deployment Protection** (project setting → "Vercel Authentication") to scope access to the owning Vercel account. Anyone logged into the right Vercel account at `vercel.com` can hit the routes; nobody else gets through Vercel's edge.

This means: you can `curl` from your own machine while logged into Vercel, but you cannot share the bare URL with a third party and expect them to reach it.

### `POST /api/captures` — bearer-token gated

This is the one endpoint that accepts inbound data (the hourly launchd job pushes here). Header:

```
Authorization: Bearer <CAPTURE_API_TOKEN>
```

`CAPTURE_API_TOKEN` is set as a Vercel env var (production). The same token lives locally as `CELESTEOS_DASHBOARD_TOKEN` in `~/Library/Application Support/celesteos-capture/.env`. Mismatched tokens return `401 unauthorized`.

To rotate: `vercel env rm CAPTURE_API_TOKEN production --yes && vercel env add CAPTURE_API_TOKEN production` then redeploy.

---

## Endpoint summary

| Method | Path | What it does | Auth |
|---|---|---|---|
| GET | `/api/state` | Aggregate counters: posts, captures, bank size, avg EQS | open |
| GET | `/api/scheduled-posts` | All tracked posts with latest capture + EQS | open |
| GET | `/api/scheduled-posts/[id]` | One tracked post by id | open |
| POST | `/api/scheduled-posts` | Register a tracked post (idempotent on URL) | open |
| DELETE | `/api/scheduled-posts/[id]` | Remove a tracked post | open |
| PATCH | `/api/scheduled-posts/[id]` | Update fields on a tracked post | open |
| GET | `/api/captures` | Every capture row, oldest first, with EQS appended | open |
| POST | `/api/captures` | Append a capture row, stamp the post's checkpoint slot | **bearer** |
| GET | `/api/roadmap` | Static `data/roadmap.json` (carousel plan) | open |
| GET | `/api/bank` | Parsed candidate post bank | open |
| GET | `/api/drafts` | Static `data/drafts.json` (rendered carousels) | open |
| GET | `/api/drafts/[id]` | One draft by id | open |
| PATCH | `/api/drafts/[id]` | Mutate a draft | open |
| GET | `/api/schedule` | Static `data/schedule.json` (publish schedule) | open |
| GET | `/api/briefs` | Generated daily briefs | open |
| POST | `/api/briefs` | Generate a new brief | open |
| GET | `/api/linkedin-pages` | Org-page diagnostic. Supports `?refresh=1` (cron) | open |

"Open" means open at the Next.js route — Vercel Deployment Protection still gates the project as a whole.

---

## `GET /api/scheduled-posts` — the main read

Returns every tracked post, augmented with the latest capture row and an Engagement Quality Score (EQS).

```bash
curl https://marketing-strategy-nine.vercel.app/api/scheduled-posts
```

Response (array of `AugmentedPost`):

```json
[
  {
    "id": "P-001",
    "url": "https://www.linkedin.com/feed/update/urn:li:activity:7463255071766659073",
    "published_at": "2026-05-21T15:51:00.000Z",
    "captures": {
      "24h": {
        "captured_at": "2026-05-26T13:00:04Z",
        "impressions": 30,
        "reactions": 1,
        "comments": 0,
        "reposts": 0,
        "saves": 0,
        "clicks": 12,
        "error": null
      }
    },
    "_latest_capture": {
      "captured_at": "2026-05-26T13:00:04Z",
      "impressions": 30,
      "reactions": 1,
      "comments": 0,
      "reposts": 0,
      "saves": 0,
      "clicks": 12,
      "error": null
    },
    "_captures_count": 22,
    "_eqs": 833.33
  }
]
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Friendly id you assign (e.g. `P-001`). Stable across captures. |
| `url` | string | The exact LinkedIn post URL you submitted. |
| `published_at` | ISO8601 | UTC publish time. Comes from LinkedIn's `publishedAt`. |
| `captures` | `{ [checkpoint]: CaptureSummary }` | Up to four checkpoints: `30m`, `60m`, `6h`, `24h`. Each slot holds the latest capture stamped against that checkpoint. |
| `_latest_capture` | `CaptureSummary \| null` | Most recent capture across all checkpoints. |
| `_captures_count` | number | Total capture rows on file for this post. |
| `_eqs` | number \| null | Engagement Quality Score on the latest capture. Null if no impressions. |

---

## `GET /api/captures` — full trend log

Returns every capture row ever ingested, ordered oldest first, with EQS appended per row.

```bash
curl https://marketing-strategy-nine.vercel.app/api/captures
```

Response (array of `CaptureRow & { eqs }`):

```json
[
  {
    "captured_at_utc": "2026-05-25T18:17:13Z",
    "post_id": "P-001",
    "post_url": "https://www.linkedin.com/feed/update/...",
    "minutes_since_publish": 6386,
    "checkpoint": "24h",
    "impressions": 23,
    "reactions": 1,
    "comments": 0,
    "reposts": 0,
    "saves": 0,
    "clicks": 12,
    "raw_text": "",
    "error": "",
    "eqs": 1086.96
  }
]
```

Notes:

- `minutes_since_publish` is computed at capture time, not at read time.
- `checkpoint` is one of `30m`, `60m`, `6h`, `24h` — mapped from `minutes_since_publish` by the hourly capture job.
- Empty strings in `error` mean no error; non-empty values indicate LinkedIn-side issues (`rate-limited`, `not_yet_in_api`, etc.).
- This list grows by N tracked-post rows per hour. Filter client-side by `post_id` to chart per-post.

---

## `GET /api/state` — at-a-glance counters

```bash
curl https://marketing-strategy-nine.vercel.app/api/state
```

```json
{
  "posts_count": 2,
  "captures_count": 22,
  "bank_count": 68,
  "avg_eqs": 712.04,
  "now_utc": "2026-05-27T21:30:00.000Z"
}
```

Cheap aggregate — useful as a health check and as a top-banner widget.

---

## `POST /api/scheduled-posts` — register a tracked post

Idempotent on URL: posting the same `url` twice returns `{ "warning": "already scheduled", "post": <existing> }` rather than duplicating.

```bash
curl -X POST https://marketing-strategy-nine.vercel.app/api/scheduled-posts \
  -H "content-type: application/json" \
  -d '{
    "url": "https://www.linkedin.com/feed/update/urn:li:activity:7464744664512774144",
    "id": "P-028",
    "published_at": "2026-05-25T18:30:16.000Z"
  }'
```

Body fields:

| Field | Required | Notes |
|---|---|---|
| `url` | yes | The LinkedIn post URL (any format LinkedIn returns). |
| `id` | no | Friendly id; auto-derived from the URN if omitted. |
| `published_at` | no | ISO8601 UTC. Omit and the server stamps `now()`. |

Success: `200 { "ok": true, "post": <ScheduledPost> }`.

---

## `POST /api/captures` — push a capture row (auth required)

The only write endpoint that needs the bearer token. The hourly launchd job uses this; you almost never call it by hand.

```bash
curl -X POST https://marketing-strategy-nine.vercel.app/api/captures \
  -H "Authorization: Bearer $CELESTEOS_DASHBOARD_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "post_id": "P-028",
    "post_url": "https://www.linkedin.com/posts/...",
    "checkpoint": "24h",
    "captured_at_utc": "2026-05-27T21:00:00.000Z",
    "minutes_since_publish": 2730,
    "impressions": 68,
    "reactions": 0,
    "comments": 0,
    "reposts": 0,
    "saves": 0,
    "clicks": 54
  }'
```

Body fields:

| Field | Required | Constraint |
|---|---|---|
| `post_id` | yes | Must already exist in `/api/scheduled-posts` for the checkpoint stamp to land — the row is appended to captures regardless, but the post's per-checkpoint slot updates only if `getPost(post_id)` returns a record. |
| `checkpoint` | yes | Must be one of `30m`, `60m`, `6h`, `24h`. Other values return `400`. |
| `post_url` | no | String, defaults to empty. |
| `captured_at_utc` | no | Defaults to `now()`. |
| `minutes_since_publish` | no | Defaults to 0. |
| `impressions`, `clicks`, `reactions`, `comments`, `reposts`, `saves` | no | Number or null. |
| `raw_text` | no | Truncated to 1000 chars. Useful for debugging when scraping fallback. |
| `error` | no | Non-empty signals an in-band failure (rate limit, ingest delay, etc.). |

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, row }` | Appended + stamped |
| 400 | `{ error: "post_id and checkpoint required" }` | Missing fields |
| 400 | `{ error: "invalid checkpoint; must be one of 30m, 60m, 6h, 24h" }` | Bad checkpoint |
| 401 | `{ error: "unauthorized", reason }` | Missing/wrong bearer or `CAPTURE_API_TOKEN` env not set on Vercel |

---

## Engagement Quality Score (EQS)

Computed per capture row, surfaced both per-row in `/api/captures` and on `_eqs` for the latest row in `/api/scheduled-posts`.

```
EQS = ((saves × 5) + (reposts × 4) + (comments × 3) + (clicks × 2) + (reactions × 1)) / impressions × 1000
```

- Returns `null` when impressions ≤ 0.
- Rounded to 2 decimals.
- Source: `lib/eqs.ts`.

A higher EQS means more action per impression. Direct comparison across posts is fair when impressions are non-trivial (>20).

---

## Common workflows

### Watch a single post's trajectory

```bash
curl -s https://marketing-strategy-nine.vercel.app/api/captures \
  | jq '.[] | select(.post_id == "P-028") | {captured: .captured_at_utc, imp: .impressions, clk: .clicks, eqs}'
```

### Find the best-performing post by EQS

```bash
curl -s https://marketing-strategy-nine.vercel.app/api/scheduled-posts \
  | jq 'sort_by(-(._eqs // 0))[0]'
```

### Sanity check the deployment

```bash
curl -s https://marketing-strategy-nine.vercel.app/api/state | jq
# expect: posts_count > 0, captures_count growing each hour
```

### Register a freshly-published post

```bash
URL="https://www.linkedin.com/feed/update/urn:li:activity:<NEW_ID>"
curl -X POST https://marketing-strategy-nine.vercel.app/api/scheduled-posts \
  -H "content-type: application/json" \
  -d "{\"url\":\"$URL\",\"id\":\"P-NEXT\"}"
# Next hourly launchd capture will pick it up and start filling captures.
```

---

## How the data gets here

```
┌──────────────────────┐    LinkedIn DMA API     ┌─────────────────────┐
│ launchd job          │ ────────────────────▶   │ org-page posts +    │
│ com.celesteos.       │                          │ analytics endpoints │
│   linkedin-capture   │ ◀────────────────────   │                     │
│ (hourly on :00)      │                          └─────────────────────┘
└──────────┬───────────┘
           │
           │ POST /api/captures
           │ Bearer <CAPTURE_API_TOKEN>
           ▼
┌──────────────────────┐
│ Vercel (this repo)   │
│ Next.js API routes   │ ──▶ Upstash Redis (posts hash + captures list)
└──────────┬───────────┘
           │
           │ GET /api/scheduled-posts
           ▼
┌──────────────────────┐
│ You, anywhere with   │
│ a logged-in browser  │
│ or curl              │
└──────────────────────┘
```

The local capture runtime lives at `~/Library/Application Support/celesteos-capture/` (outside `~/Documents/` to bypass macOS TCC). Source of truth for that script is mirrored in `Social_Presence/CELESTE/tools/` for handover; the live copy is the one in Application Support.

---

## Caveats

- **Captures with `error` set hold no metrics.** Filter `where !error` if you want the clean signal.
- **`POST /api/scheduled-posts` is open.** If Vercel Deployment Protection is ever turned off, the route would accept writes from anyone. Keep protection on.
- **Empty captures list is not "no data" — it's "no captures pushed yet."** Trigger the launchd job manually: `launchctl kickstart -k gui/$(id -u)/com.celesteos.linkedin-capture`.
- **The `test` row in `/api/captures` with `post_id: "test"`** is a pre-wiring auth probe from 2026-05-27. Harmless; filter client-side or leave it.
- **Vercel function cache holds env vars until next cold start or redeploy.** After rotating `CAPTURE_API_TOKEN`, run `vercel --prod` to flush.

---

## Source files (for future engineers)

| Concern | File |
|---|---|
| Bearer auth | `lib/auth.ts` |
| Redis client + helpers | `lib/redis.ts` |
| EQS formula | `lib/eqs.ts` |
| Types | `lib/types.ts` |
| Posts listing route | `app/api/scheduled-posts/route.ts` |
| Capture write route | `app/api/captures/route.ts` |
| State aggregator | `app/api/state/route.ts` |
| LinkedIn diagnostic cron | `app/api/linkedin-pages/route.ts` (Vercel cron `0 6 * * *`) |
| Local capture runtime | `~/Library/Application Support/celesteos-capture/linkedin_api_capture.py` (out of repo, mirrored in Social_Presence) |
