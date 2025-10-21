-- 1) Add the new array column (nullable for safe migration)
ALTER TABLE public.monthly_winners
  ADD COLUMN has_seen_celebration_players uuid[] DEFAULT '{}'::uuid[];

-- 2) Populate the array column:
-- If the boolean was true, set array to contain player_id; otherwise keep empty array.
UPDATE public.monthly_winners
SET has_seen_celebration_players =
  CASE
    WHEN has_seen_celebration = true THEN ARRAY[player_id]::uuid[]
    ELSE '{}'::uuid[]
  END;

-- 3) (Optional) Ensure no NULLs remain and set NOT NULL + default if desired.
-- Validate first (run the SELECT to confirm):
-- SELECT COUNT(*) FROM public.monthly_winners WHERE has_seen_celebration_players IS NULL;
-- If zero, you may run the following to lock in a NOT NULL constraint and default:
-- ALTER TABLE public.monthly_winners ALTER COLUMN has_seen_celebration_players SET DEFAULT '{}'::uuid[];
-- ALTER TABLE public.monthly_winners ALTER COLUMN has_seen_celebration_players SET NOT NULL;

-- 4) Drop the old boolean column
ALTER TABLE public.monthly_winners
  DROP COLUMN has_seen_celebration;

-- 5) Rename the new column to the original name
ALTER TABLE public.monthly_winners
  RENAME COLUMN has_seen_celebration_players TO has_seen_celebration;

-- 6) If you want an index on the array for faster contains queries:
-- CREATE INDEX idx_monthly_winners_has_seen_celebration_gin ON public.monthly_winners USING gin (has_seen_celebration);
