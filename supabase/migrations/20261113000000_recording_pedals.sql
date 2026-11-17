-- Optional v1 performance controls. Null preserves legacy note-only recordings.
-- The API validates event contents, order, limits and note-order correspondence.
alter table public.recordings add column pedals jsonb;
alter table public.recordings add constraint recordings_pedals_check check (
  pedals is null or coalesce((
    jsonb_typeof(pedals) = 'object'
    and pedals ?& array['version', 'events', 'noteOrder']
    and jsonb_typeof(pedals->'version') = 'number'
    and pedals->>'version' = '1'
    and jsonb_typeof(pedals->'events') = 'array'
    and jsonb_typeof(pedals->'noteOrder') = 'array'
  ), false)
);

-- Store pedals in the same transaction as the rate-limited upload.
create or replace function public.upload_recording(
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
    duration_ms, note_count, octaves, notes, pedals, delete_token_hash
  ) values (
    p_recording->>'title',
    p_recording->>'author_name',
    p_recording->>'device_id',
    (p_recording->>'bpm')::integer,
    p_recording->'meter',
    (p_recording->>'duration_ms')::integer,
    (p_recording->>'note_count')::integer,
    coalesce(
      (p_recording->>'octaves')::smallint,
      public.recording_octaves(p_recording->'notes')
    ),
    p_recording->'notes',
    p_recording->'pedals',
    p_recording->>'delete_token_hash'
  ) returning id into new_id;

  return jsonb_build_object('id', new_id);
end;
$$;
