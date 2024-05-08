create or replace function handle_add_player_to_team (player_id_input uuid, team_id_input int) returns void as $$
DECLARE
    pro_member boolean;
    pid uuid;
    team_count int;
    invite_count int;
    invited_teams int[];
BEGIN
    select p.id, case when pc.membership_status = 'pro' then true else false end pro_member, count(distinct t.id) as team_count
    into pid, pro_member, team_count
    from public.players p
        left join public.player_customer pc on p.id = pc.player_id
        left join public.teams t on p.id = any(t.player_ids)
    where p.id = player_id_input
    group by p.id, pro_member;

    IF NOT pro_member AND team_count >= 2 THEN
        SELECT raw_app_meta_data->>'invites_pending_upgrade'
        INTO invite_count
        FROM auth.users
        WHERE id = player_id_input;

        IF invite_count IS NULL THEN
          invite_count := 1;
        ELSE
          invite_count := invite_count + 1;
        END IF;

        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', invite_count)
        WHERE id = invited_id;
    ELSE
        UPDATE public.teams
        SET player_ids = array_append(player_ids, player_id_input)
        WHERE id = team_id_input;
    END IF;
END;
$$ language plpgsql security definer;