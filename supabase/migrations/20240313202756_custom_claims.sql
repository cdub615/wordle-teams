create type public.member_status as enum ('free', 'pro');

create table public.user_member_statuses (
  id        bigint generated by default as identity primary key,
  user_id   uuid references auth.users on delete cascade not null,
  status    member_status not null,
  unique (user_id, status)
);
comment on table public.user_member_statuses is 'Membership status for each user.';


-- Create the auth hook function
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
immutable
as $$
  declare
    claims jsonb;
    user_member_status public.member_status;
  begin
    select status into user_member_status from public.user_member_statuses where user_id = (event->>'user_id')::uuid;

    claims := event->'claims';

    if user_member_status is not null then
      -- Set the claim
      claims := jsonb_set(claims, '{user_member_status}', to_jsonb(user_member_status));
    else
      claims := jsonb_set(claims, '{user_member_status}', 'null');
    end if;

    -- Update the 'claims' object in the original event
    event := jsonb_set(event, '{claims}', claims);

    -- Return the modified or original event
    return event;
  end;
$$;

grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook
  from authenticated, anon;

grant all
  on table public.user_member_statuses
to supabase_auth_admin;

revoke all
  on table public.user_member_statuses
  from authenticated, anon;

create policy "Allow auth admin to read user member statuses" ON public.user_member_statuses
as permissive for select
to supabase_auth_admin
using (true)