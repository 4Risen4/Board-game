# Моя полка игр: онлайн-версия

Это версия для публикации в интернете: Next.js + Supabase + Vercel.

## Что уже есть

- вход по e-mail через Supabase;
- роль `owner` для владельца;
- роль `friend` для друзей;
- владелец добавляет и редактирует игры;
- друзья добавляют оценки и комментарии;
- одна оценка от одного аккаунта на одну игру;
- обложки сохраняются в Supabase Storage в размере 1080x1080.

## Что нужно сделать

1. Создать проект Supabase.
2. Открыть Supabase SQL Editor и выполнить файл `supabase/schema.sql`.
3. Войти на сайт один раз своим e-mail.
4. В SQL Editor выполнить:

```sql
update public.profiles set role = 'owner' where email = 'your-email@example.com';
```

5. Создать файл `.env.local` по примеру `.env.example`.
6. Запустить локально:

```bash
npm install
npm run dev
```

7. Загрузить проект на GitHub и подключить GitHub-репозиторий к Vercel.
8. В Vercel добавить переменные:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

9. Нажать Deploy.
