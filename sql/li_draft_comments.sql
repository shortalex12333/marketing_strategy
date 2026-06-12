-- Per-draft founder comments — alignment notes the autopilot reads at plan time
-- to notice patterns and tune the skills. Run once in the Jarvis Supabase
-- SQL editor (project verhpfznevahwxfawnwn). Idempotent.

create table if not exists public.li_draft_comments (
  id         uuid primary key default gen_random_uuid(),
  draft_id   text not null references public.li_drafts(id) on delete cascade,
  body       text not null,
  author     text not null default 'founder',
  created_at timestamptz not null default now()
);

create index if not exists li_draft_comments_draft_id_idx
  on public.li_draft_comments (draft_id);

-- RLS on; service role (dashboard + autopilot) bypasses it. No anon policy =
-- the anon key sees nothing (defense-in-depth, matches the other li_ tables).
alter table public.li_draft_comments enable row level security;
grant all on public.li_draft_comments to service_role;
