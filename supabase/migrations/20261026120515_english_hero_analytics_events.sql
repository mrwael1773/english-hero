-- Reconstructed from the live table schema and applied migration history.
-- This legacy table is retained for historical compatibility. A later
-- school-privacy hardening migration removes public client insert access.
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  session_id uuid not null,
  event_name text not null check (event_name = any (array['page_view'::text, 'section_view'::text])),
  page_path text not null default '/',
  section_name text,
  referrer_host text,
  constraint analytics_events_page_path_length check (length(page_path) <= 200),
  constraint analytics_events_section_name_length check (section_name is null or length(section_name) <= 80),
  constraint analytics_events_referrer_host_length check (referrer_host is null or length(referrer_host) <= 120)
);

alter table public.analytics_events enable row level security;

drop policy if exists "Public can record limited analytics events" on public.analytics_events;
create policy "Public can record limited analytics events"
  on public.analytics_events for insert
  to anon, authenticated
  with check (
    event_name = any (array['page_view'::text, 'section_view'::text])
    and length(page_path) <= 200
    and (section_name is null or length(section_name) <= 80)
    and (referrer_host is null or length(referrer_host) <= 120)
  );

grant insert on table public.analytics_events to anon, authenticated;
