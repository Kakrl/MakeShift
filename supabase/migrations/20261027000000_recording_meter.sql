-- Quarter-note BPM is unchanged; legacy recordings use 4/4.
alter table public.recordings add column meter jsonb not null
  default '{"numerator":4,"denominator":4}'::jsonb;
alter table public.recordings add constraint recordings_meter_check check (
  jsonb_typeof(meter) = 'object'
  and jsonb_typeof(meter->'numerator') = 'number'
  and jsonb_typeof(meter->'denominator') = 'number'
  and meter ? 'numerator' and meter ? 'denominator'
  and (meter->>'numerator')::numeric between 1 and 32
  and (meter->>'numerator')::numeric = trunc((meter->>'numerator')::numeric)
  and (meter->>'denominator')::numeric in (1,2,4,8,16,32)
);
