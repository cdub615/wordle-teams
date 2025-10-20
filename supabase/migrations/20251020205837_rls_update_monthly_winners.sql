create policy "update_monthly_winners"
on "public"."monthly_winners"
as PERMISSIVE
for UPDATE
to authenticated
using (
  (true = true)
);
