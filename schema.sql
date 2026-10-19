-- Venue Planner: optional cloud sync schema for Supabase (PostgreSQL).
-- Run this once in the SQL editor of your Supabase project, then put the project URL
-- and anon key in config.js. Each venue is stored as one row named "venue:<id>".

create table if not exists public.layouts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  data        jsonb not null,
  is_autosave boolean not null default false,
  updated_at  timestamptz not null default now(),
  constraint layouts_user_id_name_key unique (user_id, name)
);

-- Row level security: signed-in users can only see and change their own rows.
alter table public.layouts enable row level security;

drop policy if exists "Users can read their own layouts" on public.layouts;
create policy "Users can read their own layouts"
  on public.layouts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own layouts" on public.layouts;
create policy "Users can insert their own layouts"
  on public.layouts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own layouts" on public.layouts;
create policy "Users can update their own layouts"
  on public.layouts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own layouts" on public.layouts;
create policy "Users can delete their own layouts"
  on public.layouts for delete
  to authenticated
  using (auth.uid() = user_id);
