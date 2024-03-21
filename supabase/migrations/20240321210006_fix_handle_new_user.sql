alter table public.player_customer
alter column id
set default uuid_generate_v4 ();

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.players (id, email, first_name, last_name)
  values (new.id, new.email, new.raw_user_meta_data->>'firstName', new.raw_user_meta_data->>'lastName');

  insert into public.player_customer (player_id, membership_status)
  values (new.id, 'new');

  return new;
end;
$function$
;