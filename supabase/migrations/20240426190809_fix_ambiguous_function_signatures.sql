drop function if exists handle_add_player_to_team (player_id uuid, team_id int);
drop function if exists handle_upgrade_team_invites (player_id uuid);
drop function if exists handle_downgrade_team_removal (player_id uuid);


create or replace function handle_add_player_to_team (player_id_input uuid, team_id_input int) returns void as $$
DECLARE
    pro_member boolean;
    pid int;
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


create or replace function handle_upgrade_team_invites (player_id_input uuid) returns void as $$
DECLARE
  player_email text;
BEGIN
    SELECT email INTO player_email FROM public.players WHERE id = player_id_input;

    UPDATE public.teams
    SET invited = array_remove(invited, player_email),
        player_ids = array_append(player_ids, player_id_input)
    WHERE player_email = ANY(invited);

    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', 0)
    WHERE id = player_id_input;
END;
$$ language plpgsql security definer;



create or replace function handle_downgrade_team_removal (player_id_input uuid) returns void as $$
DECLARE
    teams_to_keep int[];
    teams_to_remove int[];
BEGIN
    select id
    into teams_to_keep
    from teams
    where player_id_input = any(player_ids)
    order by case when creator = player_id_input then 0 else 1 end, created_at
    limit 2;

    select id
    into teams_to_remove
    from teams
    where player_id_input = creator
      AND id != any(teams_to_keep);

    UPDATE public.teams
    SET player_ids = array_remove(player_ids, player_id_input)
    WHERE player_id_input = any(player_ids)
      AND id != any(teams_to_keep);

    IF teams_to_remove IS NOT NULL THEN
      DELETE FROM public.teams
      WHERE id = ANY(teams_to_remove);
    END IF;
END;
$$ language plpgsql security definer;

