-- Upload rate limits (#129). Serverless memory does not persist between
-- requests, so the upload route claims a slot here as part of the insert.
-- Only server routes holding the secret key call it; browsers have no access.

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

-- Claims a slot and stores the recording in one transaction, so a failed
-- insert rolls the claim back. Returns {"id"} when stored, or
-- {"retry_after"} with the seconds until a slot frees up.
create function public.upload_recording(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_recording jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  used integer;
  oldest timestamptz;
  new_id uuid;
begin
  -- Serializes concurrent claims for one key so both cannot take the last slot.
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

  delete from public.upload_rate_limits where created_at <= window_start;

  select count(*), min(created_at) into used, oldest
  from public.upload_rate_limits
  where key_hash = p_key_hash;

  if used >= p_limit then
    return jsonb_build_object('retry_after', greatest(1, ceil(extract(epoch from
      oldest + make_interval(secs => p_window_seconds) - now()))::integer));
  end if;

  insert into public.upload_rate_limits (key_hash) values (p_key_hash);

  insert into public.recordings (
    title, author_name, device_id, bpm, meter,
    duration_ms, note_count, notes, delete_token_hash
  ) values (
    p_recording->>'title',
    p_recording->>'author_name',
    p_recording->>'device_id',
    (p_recording->>'bpm')::integer,
    p_recording->'meter',
    (p_recording->>'duration_ms')::integer,
    (p_recording->>'note_count')::integer,
    p_recording->'notes',
    p_recording->>'delete_token_hash'
  ) returning id into new_id;

  return jsonb_build_object('id', new_id);
end;
$$;

revoke all on function public.upload_recording(text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.upload_recording(text, integer, integer, jsonb)
  to service_role;
