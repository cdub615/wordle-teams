set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_delete_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.teams
  set creator = null, player_ids = array_remove(player_ids, 'c50d0ae8-dbb6-45be-a12b-9651401cfd91')
  where creator = old.id;

  return old;
end;
$function$
;