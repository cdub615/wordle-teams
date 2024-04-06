CREATE POLICY "Allow service role to update player_customer" ON "player_customer"
FOR UPDATE
TO service_role
USING (true);

GRANT UPDATE ON "player_customer" TO service_role;