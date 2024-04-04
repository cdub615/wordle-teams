drop policy "Allow users to read their own record" on public.player_customer;

create policy "Allow users to read their own record"
on public.player_customer for select
using (auth.uid() = player_id);

alter publication supabase_realtime add table public.player_customer;