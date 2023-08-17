drop policy "Enable update for team creators" on "public"."teams";

alter table "public"."players" alter column "first_name" drop not null;

alter table "public"."players" alter column "last_name" drop not null;

create policy "Enable update for team creators"
on "public"."teams"
as permissive
for update
to authenticated
using (((auth.uid() = creator) OR (auth.uid() = ANY (player_ids))))
with check (((auth.uid() = creator) OR (auth.uid() = ANY (player_ids))));
