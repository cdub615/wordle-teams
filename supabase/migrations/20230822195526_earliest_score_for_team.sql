create or replace function earliest_score_for_team(teamId int8)
returns timestamptz
language sql
as $$
  select date
  from daily_scores d
    join (select player_ids from teams where id = 1) p on d.player_id = any(p.player_ids)
  order by d.date
  limit 1;
$$;