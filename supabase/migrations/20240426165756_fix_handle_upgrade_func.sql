create or replace function handle_upgrade_team_invites (player_id uuid) returns void as $$
DECLARE
  player_email text;
BEGIN
    SELECT email INTO player_email FROM public.players WHERE id = player_id;

    UPDATE public.teams
    SET invited = array_remove(invited, player_email),
        player_ids = array_append(player_ids, player_id)
    WHERE player_email = ANY(invited);

    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', 0)
    WHERE id = player_id;
END;
$$ language plpgsql security definer;