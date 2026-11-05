-- Run once in Supabase SQL Editor to strip prices from maps already saved
update public.maps
set data = jsonb_set(
  replace(data::text, '$125 per qualified appointment, capped', 'Billed per qualified appointment, capped')::jsonb,
  '{packages}',
  (select coalesce(jsonb_agg(p - 'price'), '[]'::jsonb) from jsonb_array_elements(data->'packages') p)
),
updated_at = now();
