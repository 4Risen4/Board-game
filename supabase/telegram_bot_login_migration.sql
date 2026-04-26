create table if not exists public.telegram_login_requests (
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

alter table public.telegram_login_requests enable row level security;
