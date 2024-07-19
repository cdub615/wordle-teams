ALTER TABLE players
ADD COLUMN time_zone TEXT,
ADD COLUMN has_pwa BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN last_board_entry_reminder TIMESTAMP WITH TIME ZONE,
ADD COLUMN reminder_delivery_methods TEXT[] NOT NULL DEFAULT ARRAY['email']
ADD COLUMN reminder_delivery_time TIME NOT NULL DEFAULT '10:00:00';

CREATE OR REPLACE FUNCTION is_valid_timezone(tz TEXT) RETURNS BOOLEAN AS $$
BEGIN
  RETURN tz IS NULL OR EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = tz
  );
END;
$$ LANGUAGE plpgsql;

-- Add a check constraint to ensure valid time zones (optional but recommended)
ALTER TABLE players
ADD CONSTRAINT valid_time_zone CHECK (is_valid_timezone(time_zone));


-- Index for notification_time
CREATE INDEX idx_players_board_entry_reminder_time ON players (board_entry_reminder_time);

-- Index for last_reminder_sent
CREATE INDEX idx_players_last_board_entry_reminder ON players (last_board_entry_reminder);

-- Index for time_zone
CREATE INDEX idx_players_time_zone ON players (time_zone);

-- Composite index for notification_time and time_zone
CREATE INDEX idx_players_board_entry_reminder_time_time_zone ON players (board_entry_reminder_time, time_zone);

-- Composite index for last_reminder_sent and time_zone
CREATE INDEX idx_players_last_board_entry_reminder_time_zone ON players (last_board_entry_reminder, time_zone);