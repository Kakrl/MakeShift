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
