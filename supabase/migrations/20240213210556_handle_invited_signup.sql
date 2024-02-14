drop function handle_invited_signup;

create or replace function handle_invited_signup (invited_email text, invited_id uuid) returns void as $$
BEGIN
    UPDATE public.teams
    SET invited = array_remove(invited, invited_email),
        player_ids = array_append(player_ids, invited_id)
    WHERE invited_email = ANY(invited);
END;
$$ language plpgsql security definer;


BEGIN;
  ALTER POLICY "Enable users to read teams they are a part of" ON "public"."teams" USING (auth.uid() = any (player_ids));
  ALTER POLICY "Enable users to read teams they are a part of" ON "public"."teams" TO authenticated;
  ALTER POLICY "Enable users to read teams they are a part of" ON "public"."teams" RENAME TO "Enable users to read teams they are a part of";
COMMIT;



create or replace function handle_delete_user() returns trigger as $$
begin
  update public.teams
  set player_ids = array_remove(player_ids, old.id), invited = array_remove(invited, old.email)
  where old.id = ANY(player_ids);

  update public.teams
  set creator = player_ids[1]
  where creator = old.id;

  return old;
end;
$$ language plpgsql security definer;



ALTER POLICY "Enable read access for all users" ON "public"."profiles" USING (auth.uid() = id);
ALTER POLICY "Enable read access for all users" ON "public"."profiles" TO authenticated;
ALTER POLICY "Enable read access for all users" ON "public"."profiles" RENAME TO "Enable users to read their own profile";


ALTER POLICY "Enable read access for authenticated users" ON "public"."players" USING (id = ANY(
    select UNNEST(player_ids)
    from public.teams
    where auth.uid() = ANY(player_ids)
  ));
ALTER POLICY "Enable read access for authenticated users" ON "public"."players" TO authenticated;
ALTER POLICY "Enable read access for authenticated users" ON "public"."players" RENAME TO "Enable users to read players on their teams";

DROP POLICY "Enable delete for users based on user_id" ON "public"."players";
DROP POLICY "Enable insert for authenticated users only" ON "public"."players";


ALTER POLICY "Enable read access for authenticated users" ON "public"."daily_scores" TO authenticated;