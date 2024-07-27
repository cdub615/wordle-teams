CREATE OR REPLACE FUNCTION get_players_for_reminder()
RETURNS SETOF players
LANGUAGE sql
AS $$
  SELECT p.*
  FROM players p
    LEFT JOIN daily_scores s ON p.id = s.player_id
      AND DATE(s.date AT TIME ZONE p.time_zone) =
          DATE(CURRENT_TIMESTAMP AT TIME ZONE p.time_zone)
  WHERE p.time_zone IS NOT NULL
    AND p.reminder_delivery_time <= (CURRENT_TIMESTAMP AT TIME ZONE p.time_zone)::time
    AND p.reminder_delivery_time >= ((CURRENT_TIMESTAMP - INTERVAL '1 hour') AT TIME ZONE p.time_zone)::time
    AND (p.last_board_entry_reminder IS NULL OR p.last_board_entry_reminder < DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE p.time_zone))
    AND p.reminder_delivery_methods IS NOT NULL AND array_length(p.reminder_delivery_methods, 1) > 0
    AND s.player_id IS NULL
  ORDER BY p.last_board_entry_reminder ASC;
$$;
