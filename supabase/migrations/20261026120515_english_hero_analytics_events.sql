create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  session_id uuid not null,
  event_name text not null check (event_name in ('page_view','section_view')),
  page_path text not null default '/',
  section_name text,
  referrer_host text
);
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant insert on public.analytics_events to anon, authenticated;
drop policy if exists "Public can record limited analytics events" on public.analytics_events;
create policy "Public can record limited analytics events"
on public.analytics_events for insert to anon, authenticated
with check (
  event_name in ('page_view','section_view')
  and length(page_path) <= 200
  and (section_name is null or length(section_name) <= 80)
  and (referrer_host is null or length(referrer_host) <= 120)
);
