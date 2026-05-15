# CelesteOS LinkedIn Dashboard

Hybrid: UI + storage on Vercel · capture stays on your machine (residential IP, per skill §17.3 step 5).

Built by CLAWEDBOT01.

---

## Architecture

```
┌──────────────────────────┐
│   Vercel  (anywhere)     │
│  Next.js 16 App Router   │
│  Upstash Redis (state)   │◀──── POST captures ──┐
│  /api/* route handlers   │                       │
└──────────────────────────┘                       │
                                                    │
                                  ┌────────────────┴───────────┐
                                  │  Your machine               │
                                  │  cron → Playwright          │
                                  │  reads schedule from Vercel │
                                  │  POSTs captures → Vercel    │
                                  │  linkedin_auth.json LOCAL   │
                                  └─────────────────────────────┘
```

LinkedIn never sees a datacenter IP. Auth cookie never leaves your machine.

---

## Deploy (the 5 steps)

### 1. Push to GitHub (one-time)

```bash
cd ~/celesteos-linkedin-dashboard
gh repo create celesteos-linkedin-dashboard --private --source=. --remote=origin --push
```

### 2. Link to Vercel + first deploy (one-time)

```bash
vercel link            # follow prompts → new project under your account
vercel --prod          # first production deploy
```

### 3. Connect Upstash Redis (one-time, ~1 min)

In the Vercel dashboard for this project:

1. Storage → Browse Marketplace → search "Upstash"
2. Add **Upstash for Redis** (Free tier is sufficient)
3. Connect it to this project — Vercel auto-injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` as env vars

### 4. Set the capture API token (one-time)

```bash
# Generate a token
TOKEN=$(openssl rand -hex 32)
echo "Save this token: $TOKEN"

# Set on Vercel
vercel env add CAPTURE_API_TOKEN production
# (paste the token when prompted)

# Re-deploy so it picks up the new env
vercel --prod
```

### 5. Lock the dashboard (one-time, ~30 sec)

In Vercel dashboard for this project:

1. Settings → Deployment Protection → Vercel Authentication → enable for Production
2. Now only people you invite to your Vercel team (just you) can view the dashboard URL

Done. The dashboard is live at `https://celesteos-linkedin-dashboard.vercel.app` (or your custom domain).

---

## After deploy: point the local capture agent at Vercel

On your machine, in the existing CelesteOS-Teams tools dir:

```bash
cd ~/Documents/CelesteOS-Teams/Social_Presence/CELESTE/tools

cat > .env <<EOF
CELESTEOS_DASHBOARD_URL=https://celesteos-linkedin-dashboard.vercel.app
CELESTEOS_DASHBOARD_TOKEN=<paste the same token you set in step 4>
EOF
```

`linkedin_impression_capture_v2.py` (already in the tools dir) replaces v1.
Update the cron line to use v2:

```cron
*/15 * * * * cd ~/Documents/CelesteOS-Teams/Social_Presence/CELESTE/tools && /usr/bin/python3 linkedin_impression_capture_v2.py >> capture.log 2>&1
```

What changed in v2:
- Reads `scheduled_posts` from `${CELESTEOS_DASHBOARD_URL}/api/scheduled-posts` (instead of local JSON)
- POSTs each capture to `${CELESTEOS_DASHBOARD_URL}/api/captures` (instead of local CSV)
- Authenticates with `Authorization: Bearer ${CELESTEOS_DASHBOARD_TOKEN}`
- Still reads `linkedin_auth.json` locally (cookies never leave the machine)
- Still dumps DOM HTML locally on first run for selector debugging

---

## Endpoints (REST)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/state` | UI-gated | — | summary counts |
| GET | `/api/scheduled-posts` | UI-gated | — | augmented list with EQS |
| POST | `/api/scheduled-posts` | UI-gated | `{ url, id?, published_at? }` | the created post |
| GET | `/api/scheduled-posts/[id]` | UI-gated | — | one post |
| DELETE | `/api/scheduled-posts/[id]` | UI-gated | — | `{ ok: true }` |
| GET | `/api/captures` | UI-gated | — | all rows + EQS |
| POST | `/api/captures` | **Bearer** | capture row | `{ ok: true, row }` |
| GET | `/api/bank` | UI-gated | — | parsed bank entries |
| POST | `/api/briefs` | UI-gated | `{ mode: 'recovery' \| 'ramp' \| 'daily' }` | picks |

UI is gated by Vercel Deployment Protection. Capture POST is gated by Bearer token.

---

## Local dev

```bash
cd ~/celesteos-linkedin-dashboard
vercel env pull .env.local
npm run dev
# → http://localhost:3000
```

---

## Updating the post bank

The bank ships at `data/post_bank.md`. To refresh:

```bash
cp ~/Documents/CelesteOS-Teams/Social_Presence/CELESTE/post_bank_2026_05_14.md data/post_bank.md
git add data/post_bank.md
git commit -m "bank: refresh from source"
git push    # Vercel auto-deploys
```

---

## Cost

| Service | Tier | Why |
|---|---|---|
| Vercel | Hobby (free) | Plenty for solo use |
| Upstash Redis | Free | 10,000 commands/day · our usage is <100/day |
| GitHub | Free private repo | — |

**Estimated monthly cost: $0.**

---

## When LinkedIn rotates session cookies (every 30–60 days)

Re-run `python3 linkedin_auth_setup.py` locally. Nothing on Vercel changes.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "—" everywhere | Upstash not connected | Step 3 of deploy |
| POST to /api/captures returns 401 | Token mismatch | Verify `CAPTURE_API_TOKEN` (Vercel) === `CELESTEOS_DASHBOARD_TOKEN` (local) |
| GET /api/bank returns `[]` | data/post_bank.md missing | Check the file was committed; redeploy |
| Local agent reports "auth file not found" | First-time setup not done | Run `python3 linkedin_auth_setup.py` |
| Captures arriving but `impressions: null` | LinkedIn DOM selectors shifted | Check `_last_analytics_page.html` locally; refine regex in capture script |

---

## Authored

CLAWEDBOT01 · CelesteOS LinkedIn growth seat · per `~/.claude/projects/-Users-celeste7/memory/clawedbot01_identity.md`
