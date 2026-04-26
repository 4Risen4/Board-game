alter table public.reviews
add column if not exists is_owner_review boolean not null default false;

drop policy if exists "friends can create their own reviews" on public.reviews;
create policy "friends can create their own reviews"
on public.reviews for insert
to authenticated
with check (auth.uid() = user_id and (is_owner_review = false or public.is_owner()));

drop policy if exists "owners can delete games" on public.games;
create policy "owners can delete games"
on public.games for delete
to authenticated
using (public.is_owner());
