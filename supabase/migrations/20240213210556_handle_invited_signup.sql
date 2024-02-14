drop function handle_invited_signup;

create or replace function handle_invited_signup (invited_email text, invited_id uuid) returns void as $$
BEGIN
    UPDATE public.teams
    SET invited = array_remove(invited, invited_email),
        player_ids = array_append(player_ids, invited_id)
    WHERE invited_email = ANY(invited);
END;
$$ language plpgsql security definer;



do $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable users to read teams') THEN
    ALTER POLICY "Enable users to read teams" ON "public"."teams" USING (auth.uid() = ANY(player_ids));
    ALTER POLICY "Enable users to read teams" ON "public"."teams" TO authenticated;
    ALTER POLICY "Enable users to read teams" ON "public"."teams" RENAME TO "Enable users to read teams they are a part of";
  END IF;
END $$;


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



do $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read access for all users') THEN
    ALTER POLICY "Enable read access for all users" ON "public"."profiles" USING (auth.uid() = id);
    ALTER POLICY "Enable read access for all users" ON "public"."profiles" TO authenticated;
    ALTER POLICY "Enable read access for all users" ON "public"."profiles" RENAME TO "Enable users to read their own profile";
  END IF;
END $$;

commit;

do $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read access for authenticated users') THEN
    ALTER POLICY "Enable read access for authenticated users" ON "public"."players" USING (id = ANY(
        select UNNEST(player_ids)
        from public.teams
        where auth.uid() = ANY(player_ids)
      ));
    ALTER POLICY "Enable read access for authenticated users" ON "public"."players" TO authenticated;
    ALTER POLICY "Enable read access for authenticated users" ON "public"."players" RENAME TO "Enable users to read players on their teams";
  END IF;
END $$;

commit;




DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON "public"."players";
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON "public"."players";


ALTER POLICY "Enable read access for authenticated users" ON "public"."daily_scores" TO authenticated;