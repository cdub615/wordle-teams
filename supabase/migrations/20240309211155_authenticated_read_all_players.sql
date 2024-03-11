DROP POLICY "Enable users to read players on their teams" ON "public"."players";

create policy select_players_policy on public.players for
select
  to authenticated using (true);