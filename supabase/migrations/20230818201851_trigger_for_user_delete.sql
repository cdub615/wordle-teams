create or replace trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute procedure public.handle_delete_user();