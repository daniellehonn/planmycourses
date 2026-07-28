-- Run this once in your Supabase project's SQL Editor (Supabase dashboard ->
-- SQL Editor -> New query -> paste -> Run) after creating the project.
--
-- One row per user holds their whole saved state: course list, plan
-- (quarter placements/pins/locks), and planning settings. Row Level
-- Security ensures a user can only ever read or write their own row —
-- this is what makes it safe to expose the anon key client-side.

create table if not exists public.user_data (
    user_id uuid primary key references auth.users(id) on delete cascade,
    course_data jsonb not null default '[]',
    plan_data jsonb not null default '{}',
    settings jsonb not null default '{}',
    updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users can read their own data"
    on public.user_data for select
    using (auth.uid() = user_id);

create policy "Users can insert their own data"
    on public.user_data for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own data"
    on public.user_data for update
    using (auth.uid() = user_id);

-- Optional but recommended: turn off "Confirm email" under Authentication ->
-- Providers -> Email while testing, so sign-up doesn't require clicking a
-- confirmation link first. Turn it back on before sharing this publicly.
