-- Tidee Moments accounts: one profile per user, holding only a display name and the plan.
-- Photos are never stored here (or anywhere off the person's device).
--
-- Run once in Supabase → SQL Editor → New query → paste → Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  plan text not null default 'free' check (plan in ('free', 'lifetime')),
  paid_at timestamptz,
  lemon_order_id text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- People can read their own profile, and nobody else's.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- People can change their own display name — and ONLY that: the plan columns can't be updated
-- by the browser (column privileges below), so nobody can mark themselves as paid. The payment
-- webhook updates the plan with the service-role key, which bypasses these rules.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

-- A profile is created automatically for every new account, with the name typed at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
