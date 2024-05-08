create or replace function handle_downgrade_team_removal (player_id_input uuid) returns void as $$
DECLARE
    teams_to_keep int[];
    teams_to_remove int[];
BEGIN
    select array(
      select unnest(array_agg(id))
      from teams
      where player_id_input = any(player_ids)
      group by creator, created_at
      order by case when creator = player_id_input then 0 else 1 end, created_at
      limit 2
    )
    into teams_to_keep;

    select array(
      select unnest(array_agg(id))
      from teams
      where player_id_input = creator
        AND id != any(teams_to_keep)
    )
    into teams_to_remove;

    IF teams_to_keep IS NOT NULL AND array_length(teams_to_keep, 1) > 0 THEN
      UPDATE public.teams
      SET player_ids = array_remove(player_ids, player_id_input)
      WHERE player_id_input = any(player_ids)
        AND id != any(teams_to_keep);
    END IF;

    IF teams_to_remove IS NOT NULL AND array_length(teams_to_remove, 1) > 0 THEN
      DELETE FROM public.teams
      WHERE id = ANY(teams_to_remove);
    END IF;
END;
$$ language plpgsql security definer;