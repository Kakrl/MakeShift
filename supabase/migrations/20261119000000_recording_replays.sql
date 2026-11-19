-- Best-effort replay totals (#290); no per-attempt rows or automatic retries.
alter table public.recordings
  add column replay_count integer not null default 0 check (replay_count >= 0),
  add column last_replayed_at timestamptz;

create function public.record_recording_replay(
  p_recording_id uuid,
  p_listened_ms integer
) returns boolean
language sql
set search_path = ''
as $$
  with updated as (
    update public.recordings
    set replay_count = replay_count + 1,
        last_replayed_at = greatest(last_replayed_at, clock_timestamp())
    where id = p_recording_id
      and not hidden
      and duration_ms > 0
      and p_listened_ms >= case
        when duration_ms >= 30000 then 30000
        else ceil(duration_ms / 2.0)::integer
      end
    returning id
  )
  select exists(select 1 from updated);
$$;

revoke all on function public.record_recording_replay(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.record_recording_replay(uuid, integer)
  to service_role;

create view public.recording_recommendations
with (security_invoker = true)
as
select id, title, author_name, bpm, meter, duration_ms, note_count, octaves,
       created_at, replay_count,
       duration_ms >= 10000 as recommendation_eligible,
       case when duration_ms >= 10000 then replay_count else 0 end
         as recommendation_rank
from public.recordings
where not hidden;

revoke all on public.recording_recommendations from public, anon, authenticated;
grant select on public.recording_recommendations to service_role;

create index recordings_recommendations_idx
on public.recordings (
  (duration_ms >= 10000) desc,
  (case when duration_ms >= 10000 then replay_count else 0 end) desc,
  created_at desc,
  id desc
)
where not hidden;
