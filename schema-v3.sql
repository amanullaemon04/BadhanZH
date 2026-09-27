-- V3 migration for Hall Blood Donor
-- Run once in Supabase SQL Editor.
alter table public.donors add column if not exists city text not null default 'Dhaka';
update public.donors set city='Dhaka' where city is null or trim(city)='';
-- Website rule: available=true is still shown as unavailable until 3 calendar months
-- have passed since last_donation. This is a directory rule, not medical clearance.
