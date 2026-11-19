-- Run only against a disposable empty PostgreSQL database with Supabase roles.
-- psql -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" -f tests/database/recording_replays.sql
-- All schema/data changes roll back. Migration files are resolved relative to this file.
begin;
\ir ../../supabase/migrations/20260930000000_create_recordings.sql
\ir ../../supabase/migrations/20261027000000_recording_meter.sql
\ir ../../supabase/migrations/20261031000000_upload_rate_limits.sql
\ir ../../supabase/migrations/20261109000000_recording_octaves.sql
\ir ../../supabase/migrations/20261113000000_recording_pedals.sql

insert into public.recordings (id, title, author_name, device_id, bpm,
  duration_ms, note_count, notes, delete_token_hash)
values ('00000000-0000-4000-8000-000000000001', 'Legacy', 'Fixture', 'fixture',
  120, 10000, 1, '[{"pitch":"C4","velocity":80,"startMs":0,"durationMs":10000}]', 'fixture');

\ir ../../supabase/migrations/20261119000000_recording_replays.sql

-- Match the table privileges supplied to service_role by Supabase's default grants.
grant select, update on public.recordings to service_role;

do $$
declare
  recording public.recordings%rowtype;
begin
  select * into strict recording from public.recordings
    where id = '00000000-0000-4000-8000-000000000001';
  assert recording.replay_count = 0 and recording.last_replayed_at is null,
    'Existing recordings must start with zero replays and no fabricated timestamp';
  assert recording.notes = '[{"pitch":"C4","velocity":80,"startMs":0,"durationMs":10000}]'::jsonb,
    'Migration must preserve existing notes';
  assert not has_function_privilege('anon', 'public.record_recording_replay(uuid,integer)', 'execute');
  assert not has_function_privilege('authenticated', 'public.record_recording_replay(uuid,integer)', 'execute');
  assert has_function_privilege('service_role', 'public.record_recording_replay(uuid,integer)', 'execute');
  assert not has_table_privilege('anon', 'public.recording_recommendations', 'select');
  assert not has_table_privilege('authenticated', 'public.recording_recommendations', 'select');
end;
$$;

insert into public.recordings (id, title, author_name, device_id, bpm,
  duration_ms, note_count, notes, delete_token_hash, replay_count, created_at, hidden)
values
 ('00000000-0000-4000-8000-000000000002', 'Long', 'Fixture', 'fixture', 120, 30000, 0, '[]', 'fixture', 10, '2026-01-01', false),
 ('00000000-0000-4000-8000-000000000003', 'Odd short', 'Fixture', 'fixture', 120, 9999, 0, '[]', 'fixture', 999, '2026-01-01', false),
 ('00000000-0000-4000-8000-000000000004', 'New short', 'Fixture', 'fixture', 120, 5000, 0, '[]', 'fixture', 0, '2026-01-02', false),
 ('00000000-0000-4000-8000-000000000005', 'Zero', 'Fixture', 'fixture', 120, 0, 0, '[]', 'fixture', 0, '2026-01-01', false),
 ('00000000-0000-4000-8000-000000000006', 'Hidden', 'Fixture', 'fixture', 120, 60000, 0, '[]', 'fixture', 1000, '2026-01-01', true),
 ('00000000-0000-4000-8000-000000000007', 'Half minute', 'Fixture', 'fixture', 120, 29999, 0, '[]', 'fixture', 0, '2026-01-01', false),
 ('00000000-0000-4000-8000-000000000008', 'Over minute', 'Fixture', 'fixture', 120, 60000, 0, '[]', 'fixture', 0, '2026-01-01', false);

set local role service_role;
do $$
begin
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000001', 4999);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000001', 5000);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000001', 5000),
    'Independent requests intentionally count again: no attempt table';
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000002', 29999);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000002', 30000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000003', 4999);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000003', 5000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000005', 30000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000006', 30000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000099', 30000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000007', 14999);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000007', 15000);
  assert not public.record_recording_replay('00000000-0000-4000-8000-000000000008', 29999);
  assert public.record_recording_replay('00000000-0000-4000-8000-000000000008', 30000);
end;
$$;
reset role;

do $$
declare
  total integer;
  replayed timestamptz;
  ordered_ids uuid[];
begin
  select replay_count, last_replayed_at into total, replayed from public.recordings
    where id = '00000000-0000-4000-8000-000000000001';
  assert total = 2 and replayed is not null and replayed <= clock_timestamp(),
    'Counter and replay timestamp must change together';
  assert (select last_replayed_at is null from public.recordings
    where id = '00000000-0000-4000-8000-000000000006');
  select array_agg(id) into ordered_ids from (
    select id from public.recording_recommendations
    order by recommendation_eligible desc, recommendation_rank desc, created_at desc, id desc
  ) ordered;
  assert ordered_ids[1] = '00000000-0000-4000-8000-000000000002'::uuid;
  assert ordered_ids[2] = '00000000-0000-4000-8000-000000000001'::uuid,
    'Exactly ten seconds qualifies ahead of short high-count songs';
  assert array_position(ordered_ids, '00000000-0000-4000-8000-000000000004'::uuid)
    < array_position(ordered_ids, '00000000-0000-4000-8000-000000000003'::uuid),
    'Short fillers use recency rather than replay counts';
  assert not ('00000000-0000-4000-8000-000000000006'::uuid = any(ordered_ids)),
    'Hidden recordings must not be recommended';
end;
$$;
rollback;
