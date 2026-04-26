alter table public.profiles
add column if not exists telegram_id text unique,
add column if not exists telegram_username text,
add column if not exists telegram_first_name text,
add column if not exists telegram_last_name text,
add column if not exists telegram_photo_url text,
add column if not exists telegram_linked_at timestamptz;
