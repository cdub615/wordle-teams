create or replace function update_monthly_winners(winners_data jsonb[])
returns void
language plpgsql
security definer
as $$
begin
  -- Delete existing entries for the months we're updating
  delete from monthly_winners
  where (team_id::text, year::text, month::text) in (
    select
      (winner->>'team_id'),
      (winner->>'year'),
      (winner->>'month')
    from unnest(winners_data) as winner
  );

  -- Insert new winners
  insert into monthly_winners (team_id, player_id, year, month)
  select
    (winner->>'team_id')::int,
    (winner->>'winner_id')::uuid,
    (winner->>'year')::int,
    (winner->>'month')::int
  from unnest(winners_data) as winner
  where winner->>'winner_id' is not null;
end;
$$;