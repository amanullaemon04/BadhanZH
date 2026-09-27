-- This is an additional safety check for the V2 admin site.
-- Your existing donors/staff tables and policies can remain.
-- Run only if you want to ensure RLS is enabled.
alter table public.donors enable row level security;
alter table public.staff enable row level security;
