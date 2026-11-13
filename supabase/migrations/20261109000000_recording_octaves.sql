-- Smallest C-to-C sheet holding the notes, like recordingOctaves.
create or replace function public.recording_octaves(p_notes jsonb)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    greatest(1, ceil((max(midi) - floor(min(midi) / 12) * 12) / 12.0)),
    1
  )::smallint
  from (
    select
      (m[3]::numeric + 1) * 12
        + (array[0, 2, 4, 5, 7, 9, 11])[position(m[1] in 'CDEFGAB')]
        + (case m[2] when '#' then 1 when 'b' then -1 else 0 end) as midi
    from (
      select regexp_match(n ->> 'pitch', '^([A-G])([#b]?)(-?[0-9]+)$') as m
      from jsonb_array_elements(
        case jsonb_typeof(p_notes) when 'array' then p_notes else '[]' end
      ) as n
    ) parsed
    where m is not null
  ) pitches
  where midi between 0 and 127;
$$;

revoke all on function public.recording_octaves(jsonb)
  from public, anon, authenticated;
grant execute on function public.recording_octaves(jsonb) to service_role;

alter table public.recordings add column octaves smallint not null default 1
  check (octaves between 1 and 11);

update public.recordings set octaves = public.recording_octaves(notes);

create index recordings_visible_oldest_idx
  on public.recordings (created_at, id)
  where not hidden;
create index recordings_visible_longest_idx
  on public.recordings (duration_ms desc, id desc)
  where not hidden;

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
    duration_ms, note_count, octaves, notes, delete_token_hash
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
    p_recording->>'delete_token_hash'
  ) returning id into new_id;

  return jsonb_build_object('id', new_id);
end;
$$;
