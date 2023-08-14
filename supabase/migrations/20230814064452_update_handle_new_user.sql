set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data->>'firstName', new.raw_user_meta_data->>'lastName');

  insert into public.players (id, email, first_name, last_name)
  values (new.id, new.email, new.raw_user_meta_data->>'firstName', new.raw_user_meta_data->>'lastName');

  return new;
end;
$function$
;