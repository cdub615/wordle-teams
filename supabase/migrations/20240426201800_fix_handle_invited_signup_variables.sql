create or replace function handle_invited_signup (invited_email text, invited_id uuid) returns void as $$
DECLARE
    pro_member boolean;
    pid uuid;
    team_count int;
    team_count_above_two int;
    invited_teams int[];
BEGIN
    select p.id, case when pc.membership_status = 'pro' then true else false end pro_member, count(distinct t.id) as team_count
    into pid, pro_member, team_count
    from public.players p
        left join public.player_customer pc on p.id = pc.player_id
        left join public.teams t on p.email = any(t.invited)
    where p.id = invited_id
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