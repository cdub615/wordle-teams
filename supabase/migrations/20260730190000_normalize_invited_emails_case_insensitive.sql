-- Fix: team invites silently failed to join when the inviter typed the email in a different case
-- than the invitee's (always-lowercase) auth email. teams.invited stored the address as-typed and
-- handle_invited_signup matched it case-sensitively (invited_email = ANY(invited)). See wordle-teams-5no.
--
-- Primary fix is normalizing emails to lowercase at the write boundary (invitePlayer). This migration
-- (1) normalizes existing teams.invited data to deduped-lowercase, and (2) hardens the join RPC to
-- match/remove case-insensitively as defense-in-depth.

-- (1) One-time normalization of existing data (idempotent).
UPDATE public.teams t
SET invited = COALESCE((
  SELECT array_agg(e ORDER BY e)
  FROM (SELECT DISTINCT lower(trim(x)) AS e FROM unnest(t.invited) x WHERE trim(x) <> '') s
), '{}')
WHERE t.invited IS NOT NULL
  AND t.invited <> COALESCE((
    SELECT array_agg(e ORDER BY e)
    FROM (SELECT DISTINCT lower(trim(x)) AS e FROM unnest(t.invited) x WHERE trim(x) <> '') s
  ), '{}');

-- (2) Case-insensitive handle_invited_signup (mirrors 20240517174331 with lower() matching + removal).
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
        left join public.teams t on exists (select 1 from unnest(t.invited) e where lower(e) = lower(p.email))
    where p.id = invited_id
    group by p.id, pro_member;

    IF NOT pro_member AND team_count > 2 THEN
        SELECT team_count - 2 into team_count_above_two;

        SELECT ARRAY(
            SELECT id FROM public.teams
            WHERE exists (select 1 from unnest(invited) e where lower(e) = lower(invited_email))
            LIMIT 2
        )
        INTO invited_teams;

        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('invites_pending_upgrade', team_count_above_two)
        WHERE id = invited_id;

        UPDATE public.teams
        SET invited = COALESCE((SELECT array_agg(e) FROM unnest(invited) e WHERE lower(e) <> lower(invited_email)), '{}'),
            player_ids = array_append(player_ids, invited_id)
        WHERE id = ANY(invited_teams);
    ELSE
        UPDATE public.teams
        SET invited = COALESCE((SELECT array_agg(e) FROM unnest(invited) e WHERE lower(e) <> lower(invited_email)), '{}'),
            player_ids = array_append(player_ids, invited_id)
        WHERE exists (select 1 from unnest(invited) e where lower(e) = lower(invited_email));
    END IF;

    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || '{"invited": false}'::jsonb
    WHERE id = invited_id;
END;
$$ language plpgsql security definer;
