-- Anonymous aggregate usage events. No browser-role access is granted here;
-- client write access must be introduced only with an explicit privacy/RLS design.
-- Version aligned with the connected Supabase migration history: 20261026120515.
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  session_id uuid not null,
  event_name text not null check (event_name in ('page_view', 'section_view')),
  page_path text not null default '/',
  section_name text,
  referrer_host text
);

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
revoke all on table public.analytics_events from anon, authenticated;
