create policy "Enable delete for users based on user_id"
on "public"."players"
as permissive
for delete
to public
using ((auth.uid() = id));


create policy "Enable insert for authenticated users only"
on "public"."players"
as permissive
for insert
to authenticated
with check (true);