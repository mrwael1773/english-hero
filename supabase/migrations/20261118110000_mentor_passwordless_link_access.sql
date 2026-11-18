-- Passwordless mentor access through a revocable, expiring bearer link.
-- The raw token is returned only once by an owner-only provisioning function.
create table if not exists public.mentor_link_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint mentor_link_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mentor_link_tokens_expiry check (expires_at > created_at)
);

alter table public.mentor_link_tokens enable row level security;
revoke all on public.mentor_link_tokens from public, anon, authenticated;

create or replace function public.issue_mentor_link_token(p_expires_in_days integer default 30)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'Expiry must be between 1 and 90 days';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.mentor_link_tokens(token_hash, expires_at)
  values (
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    now() + make_interval(days => p_expires_in_days)
  );

  return v_token;
end;
$$;

revoke all on function public.issue_mentor_link_token(integer) from public, anon, authenticated;
grant execute on function public.issue_mentor_link_token(integer) to postgres;

comment on table public.mentor_link_tokens is
  'Stores only SHA-256 hashes of mentor bearer-link tokens. Raw tokens are returned once at issuance.';
