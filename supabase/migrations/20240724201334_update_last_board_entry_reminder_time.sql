CREATE OR REPLACE FUNCTION update_last_board_entry_reminder(player_id_param UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE players
  SET last_board_entry_reminder = (CURRENT_TIMESTAMP AT TIME ZONE time_zone)
  WHERE id = player_id_param;
$$;