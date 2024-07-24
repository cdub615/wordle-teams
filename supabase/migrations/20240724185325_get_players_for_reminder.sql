CREATE OR REPLACE FUNCTION get_players_for_reminder()
RETURNS SETOF players
LANGUAGE sql
AS $$
  SELECT *
  FROM players
  WHERE reminder_delivery_time <= (CURRENT_TIMESTAMP AT TIME ZONE time_zone)::time
    AND reminder_delivery_time >= ((CURRENT_TIMESTAMP - INTERVAL '1 hour') AT TIME ZONE time_zone)::time
    AND (last_board_entry_reminder IS NULL OR last_board_entry_reminder < DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE time_zone))
  ORDER BY last_board_entry_reminder ASC;
$$;