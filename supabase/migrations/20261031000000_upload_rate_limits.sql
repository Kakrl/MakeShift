-- Upload rate limits (#129). Serverless memory does not persist between
-- requests, so the upload route claims a slot here before inserting. Only
-- server routes holding the secret key call it; browsers have no access.

create table public.upload_rate_limits (
  key_hash text not null check (char_length(key_hash) = 64),
  created_at timestamptz not null default now()
);

comment on table public.upload_rate_limits is
  'One row per accepted upload inside the current window; server access only.';
comment on column public.upload_rate_limits.key_hash is
  'SHA-256 hex digest of the client network key; never the IP address.';

create index upload_rate_limits_key_idx
  on public.upload_rate_limits (key_hash, created_at);
create index upload_rate_limits_created_at_idx
  on public.upload_rate_limits (created_at);

alter table public.upload_rate_limits enable row level security;

revoke all on table public.upload_rate_limits from anon, authenticated;

-- Records an upload and returns 0 while the key is under the limit.
-- Otherwise records nothing and returns the seconds until a slot frees up.
create function public.claim_upload_slot(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  used integer;
  oldest timestamptz;
begin
  -- Serializes concurrent claims for one key so both cannot take the last slot.
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

  delete from public.upload_rate_limits where created_at <= window_start;

  select count(*), min(created_at) into used, oldest
  from public.upload_rate_limits
  where key_hash = p_key_hash;

  if used >= p_limit then
    return greatest(1, ceil(extract(epoch from
      oldest + make_interval(secs => p_window_seconds) - now()))::integer);
  end if;

  insert into public.upload_rate_limits (key_hash) values (p_key_hash);
  return 0;
end;
$$;

revoke all on function public.claim_upload_slot(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_upload_slot(text, integer, integer)
  to service_role;
