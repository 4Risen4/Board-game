drop policy if exists "owners can delete any review" on public.reviews;

create policy "owners can delete any review"
on public.reviews
for delete
to authenticated
using (public.is_owner());
