create policy "Allow users to read their own record" on public.player_customer for
select
  to authenticated using (
    player_id = auth.uid()
  );