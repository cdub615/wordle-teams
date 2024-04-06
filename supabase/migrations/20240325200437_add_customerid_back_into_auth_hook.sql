alter table public.player_customer drop column customer_portal_url;

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
    user_customer_id int;
  begin
    select membership_status, membership_variant, first_name, last_name, customer_id
    into user_member_status, user_member_variant, user_first_name, user_last_name, user_customer_id
    from public.players p
      left join public.player_customer pc on pc.player_id = p.id
    where p.id = (event->>'user_id')::uuid;

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

    if user_customer_id is not null then
      claims := jsonb_set(claims, '{user_customer_id}', to_jsonb(user_customer_id));
    else
      claims := jsonb_set(claims, '{user_customer_id}', 'null');
    end if;

    -- Update the 'claims' object in the original event
    event := jsonb_set(event, '{claims}', claims);

    -- Return the modified or original event
    return event;
  end;
$$;