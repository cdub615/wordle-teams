create or replace function handle_invited_signup (invited_email text, invited_id uuid) returns void as $$
DECLARE
    pro_member boolean;
    pid int;
    team_count int;
    team_count_above_two int;
    invited_teams int[];
BEGIN
    select p.id, case when pc.membership_status = 'pro' then true else false end pro_member, count(distinct t.id) as team_count
    into pid, pro_member, team_count
    from public.players p
        left join public.player_customer pc on p.id = pc.player_id
        left join public.teams t on p.email = any(t.invited)
    where p.id = player_id
    group by p.id, pro_member;

    IF NOT pro_member AND team_count > 2 THEN
        SELECT team_count - 2 into team_count_above_two;

        SELECT ARRAY(SELECT id FROM public.teams WHERE invited_email = ANY(invited) LIMIT 2)
        INTO invited_teams;

        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', team_count_above_two)
        WHERE id = invited_id;

        UPDATE public.teams
        SET invited = array_remove(invited, invited_email),
            player_ids = array_append(player_ids, invited_id)
        WHERE id = ANY(invited_teams);
    ELSE
        UPDATE public.teams
        SET invited = array_remove(invited, invited_email),
            player_ids = array_append(player_ids, invited_id)
        WHERE invited_email = ANY(invited);
    END IF;
END;
$$ language plpgsql security definer;


create or replace function handle_add_player_to_team (player_id uuid, team_id int) returns void as $$
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
    where p.id = player_id
    group by p.id, pro_member;

    IF NOT pro_member AND team_count >= 2 THEN
        SELECT raw_app_meta_data->>'invites_pending_upgrade'
        INTO invite_count
        FROM auth.users
        WHERE id = player_id;

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
        SET player_ids = array_append(player_ids, player_id)
        WHERE id = team_id;
    END IF;
END;
$$ language plpgsql security definer;


create or replace function handle_upgrade_team_invites (player_id uuid, player_email text) returns void as $$
BEGIN
    UPDATE public.teams
    SET invited = array_remove(invited, player_email),
        player_ids = array_append(player_ids, player_id)
    WHERE player_email = ANY(invited);

    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', 0)
    WHERE id = player_id;
END;
$$ language plpgsql security definer;



create or replace function handle_downgrade_team_removal (player_id uuid) returns void as $$
DECLARE
    teams_to_keep int[];
    teams_to_remove int[];
BEGIN
    select id
    into teams_to_keep
    from teams
    where player_id = any(player_ids)
    order by case when creator = player_id then 0 else 1 end, created_at
    limit 2;

    select id
    into teams_to_remove
    from teams
    where player_id = creator
      AND id != any(teams_to_keep);

    UPDATE public.teams
    SET player_ids = array_remove(player_ids, player_id)
    WHERE player_id = any(player_ids)
      AND id != any(teams_to_keep);

    IF teams_to_remove IS NOT NULL THEN
      DELETE FROM public.teams
      WHERE id = ANY(teams_to_remove);
    END IF;
END;
$$ language plpgsql security definer;