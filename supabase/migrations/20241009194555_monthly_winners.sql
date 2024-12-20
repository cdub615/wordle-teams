CREATE TABLE public.monthly_winners (
    id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    player_id UUID NOT NULL,
    team_id INT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    has_seen_celebration BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT monthly_winners_pkey PRIMARY KEY (id),
    CONSTRAINT monthly_winners_player_id_fkey FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
    CONSTRAINT monthly_winners_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
  ) TABLESPACE pg_default;



-- Enable Row-Level Security on the monthly_winners table
ALTER TABLE public.monthly_winners ENABLE ROW LEVEL SECURITY;

-- Create a policy to allow users to select only their own rows
CREATE POLICY select_own_rows ON public.monthly_winners FOR
SELECT
  USING (
    (auth.uid() = player_id)
  );
