alter table public.players
drop column if exists customer_id,
drop column if exists membership_status,
drop column if exists membership_variant;

create table if not exists
  public.player_customer (
    id uuid not null,
    player_id uuid not null,
    customer_id integer not null,
    customer_portal_url text not null,
    membership_status public.member_status not null,
    membership_variant integer null,
    constraint player_customer_player_id_fkey foreign key (player_id) references public.players (id) on delete cascade
  ) tablespace pg_default;

CREATE UNIQUE INDEX player_customer_pkey ON public.player_customer USING btree (id);

alter table "public"."player_customer" add constraint "player_customer_pkey" PRIMARY KEY using index "player_customer_pkey";

alter table "public"."player_customer" enable row level security;

grant all
  on table public.player_customer
  to supabase_auth_admin;

revoke all
  on table public.player_customer
  from authenticated, anon;

create policy "Allow auth admin to read player customer table" ON public.player_customer
as permissive for select
to supabase_auth_admin
using (true);


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
    user_customer_portal_url text;
  begin
    select membership_status, membership_variant, first_name, last_name, customer_portal_url
    into user_member_status, user_member_variant, user_first_name, user_last_name, user_customer_portal_url
    from public.players p
      join public.player_customer pc on pc.player_id = p.id
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

    if user_customer_portal_url is not null then
      claims := jsonb_set(claims, '{user_customer_portal_url}', to_jsonb(user_customer_portal_url));
    else
      claims := jsonb_set(claims, '{user_customer_portal_url}', 'null');
    end if;

    -- Update the 'claims' object in the original event
    event := jsonb_set(event, '{claims}', claims);

    -- Return the modified or original event
    return event;
  end;
$$;

ALTER TYPE "public"."member_status" ADD VALUE 'cancelled';
ALTER TYPE "public"."member_status" ADD VALUE 'expired';