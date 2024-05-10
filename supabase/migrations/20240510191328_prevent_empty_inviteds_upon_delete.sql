create or replace function handle_delete_user() returns trigger as $$
begin
  update public.teams
  set player_ids = array_remove(player_ids, old.id), invited = array_remove(invited, old.email)
  where old.id = ANY(player_ids);

  update public.teams
  set invited = array_remove(invited, '');

  update public.teams
  set creator = player_ids[1]
  where creator = old.id;

  return old;
end;
$$ language plpgsql security definer;