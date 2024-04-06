CREATE POLICY "Allow service role to update" ON "your_table_name"
FOR UPDATE
TO service_role
USING (true);

GRANT UPDATE ON "your_table_name" TO service_role;