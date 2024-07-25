CREATE OR REPLACE FUNCTION get_players_for_reminder()
RETURNS SETOF players
LANGUAGE sql
AS $$
  SELECT *
  FROM players
  WHERE time_zone IS NOT NULL
    AND reminder_delivery_time <= (CURRENT_TIMESTAMP AT TIME ZONE time_zone)::time
    AND reminder_delivery_time >= ((CURRENT_TIMESTAMP - INTERVAL '1 hour') AT TIME ZONE time_zone)::time
    AND (last_board_entry_reminder IS NULL OR last_board_entry_reminder < DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE time_zone))
    AND reminder_delivery_methods IS NOT NULL AND array_length(reminder_delivery_methods, 1) > 0
  ORDER BY last_board_entry_reminder ASC;
$$;