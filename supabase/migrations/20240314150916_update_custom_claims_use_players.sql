drop table if exists public.user_member_statuses;
drop table if exists public.profiles;
drop function if exists update_user_metadata;
drop function if exists earliest_score_for_team;

drop type public.member_status;
create type public.member_status as enum ('new', 'free', 'pro');

alter table "public"."players" add column "customer_id" int;
alter table "public"."players" add column "membership_status" public.member_status;
alter table "public"."players" add column "membership_variant" int;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.players (id, email, first_name, last_name, membership_status)
  values (new.id, new.email, new.raw_user_meta_data->>'firstName', new.raw_user_meta_data->>'lastName', 'new');

  return new;
end;
$function$
;


create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
immutable
as $$
  declare
    claims jsonb;
    user_member_status public.member_status;
    user_member_variant int;
    user_first_name text;
    user_last_name text;
  begin
    select membership_status into user_member_status,
      membership_variant into user_member_variant,
      first_name into user_first_name,
      last_name into user_last_name
    from public.players
    where id = (event->>'user_id')::uuid;

    claims := event->'claims';

    if user_member_status is not null then
      claims := jsonb_set(claims, '{user_member_status}', to_jsonb(user_member_status));
    else
      claims := jsonb_set(claims, '{user_member_status}', 'null');
    end if;

    if user_member_variant is not null then
      claims := jsonb_set(claims, '{user_member_variant}', to_jsonb(user_member_variant));
    else
      claims := jsonb_set(claims, '{user_member_variant}', 'null');
    end if;

    if user_first_name is not null then
      claims := jsonb_set(claims, '{user_first_name}', to_jsonb(user_first_name));
    else
      claims := jsonb_set(claims, '{user_first_name}', 'null');
    end if;

    if user_last_name is not null then
      claims := jsonb_set(claims, '{user_last_name}', to_jsonb(user_last_name));
    else
      claims := jsonb_set(claims, '{user_last_name}', 'null');
    end if;

    -- Update the 'claims' object in the original event
    event := jsonb_set(event, '{claims}', claims);

    -- Return the modified or original event
    return event;
  end;
$$;

grant all
  on table public.players
to supabase_auth_admin;

create policy "Allow auth admin to read players" ON public.players
as permissive for select
to supabase_auth_admin
using (true)