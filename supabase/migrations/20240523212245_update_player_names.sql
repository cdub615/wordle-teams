CREATE OR REPLACE FUNCTION update_player_names (
  email_to_update TEXT,
  new_first_name TEXT,
  new_last_name TEXT
)
RETURNS void
security definer
AS $$
BEGIN
    UPDATE public.players
    SET first_name = new_first_name, last_name = new_last_name
    WHERE email = email_to_update;
END;
$$ LANGUAGE plpgsql;