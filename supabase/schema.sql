create extension if not exists "pgcrypto";

create type public.app_role as enum ('owner', 'friend');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'friend',
  telegram_id text unique,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  telegram_photo_url text,
  telegram_linked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_name text not null,
  fun int not null check (fun between 1 and 10),
  difficulty int not null check (difficulty between 1 and 10),
  comment text,
  is_owner_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, user_id)
);

create table public.telegram_login_requests (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  mode text not null check (mode in ('signin', 'link')),
  user_id uuid references auth.users(id) on delete cascade,
  telegram_id text,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  telegram_photo_url text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'error')),
  error text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.reviews enable row level security;
alter table public.telegram_login_requests enable row level security;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create policy "profiles are visible to signed in users"
on public.profiles for select
to authenticated
using (true);

create policy "users can update their own profile name"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy "everyone signed in can read games"
on public.games for select
to authenticated
using (true);

create policy "owners can create games"
on public.games for insert
to authenticated
with check (public.is_owner());

create policy "owners can update games"
on public.games for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "owners can delete games"
on public.games for delete
to authenticated
using (public.is_owner());

create policy "everyone signed in can read reviews"
on public.reviews for select
to authenticated
using (true);

create policy "friends can create their own reviews"
on public.reviews for insert
to authenticated
with check (auth.uid() = user_id and (is_owner_review = false or public.is_owner()));

create policy "owners can manage all reviews"
on public.reviews for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do update set public = true;

create policy "signed in users can view covers"
on storage.objects for select
to authenticated
using (bucket_id = 'covers');

create policy "owners can upload covers"
on storage.objects for insert
to authenticated
with check (bucket_id = 'covers' and public.is_owner());

create policy "owners can update covers"
on storage.objects for update
to authenticated
using (bucket_id = 'covers' and public.is_owner())
with check (bucket_id = 'covers' and public.is_owner());

-- After your first e-mail login, run this once with your real e-mail:
-- update public.profiles set role = 'owner' where email = 'you@example.com';
