-- Polar migration: drop the Lemon Squeezy identity columns and guard webhook replays.
-- See docs/superpowers/specs/2026-07-31-polar-migration-design.md and wordle-teams-j8c.
--
-- Polar identifies customers and products with UUIDs, while player_customer.customer_id and
-- membership_variant are both int. Rather than retype them, both columns are dropped:
--
--   customer_id        existed only to feed getCustomerPortalUrl. Polar's Create Customer
--                      Session endpoint accepts external_customer_id, and the app sets that to
--                      the player's own id, so Polar's customer UUID never needs storing.
--   membership_variant was plumbed through utils.ts, the User type, and the JWT claims, but
--                      nothing ever branched on it. Every gate in the app is on 'pro'.
--
-- ORDERING IS LOAD-BEARING. custom_access_token_hook selects both columns. If they are dropped
-- while the old definition is still installed, the hook throws on every token issuance and
-- EVERY LOGIN BREAKS. The replacement must therefore land before the drops, in this file, in
-- this order. This project has already had one login-lockout incident (wordle-teams-jvt).

-- (1) Replace the auth hook FIRST, so it stops selecting the columns about to be dropped.
--     Mirrors 20240325200437 with user_member_variant and user_customer_id removed; the
--     left join and the immutable volatility are carried over unchanged deliberately, to keep
--     this migration to exactly one concern.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
immutable
as $$
  declare
    claims jsonb;
    user_member_status public.member_status;
    user_first_name text;
    user_last_name text;
  begin
    select membership_status, first_name, last_name
    into user_member_status, user_first_name, user_last_name
    from public.players p
      left join public.player_customer pc on pc.player_id = p.id
    where p.id = (event->>'user_id')::uuid;

    claims := event->'claims';

    if user_member_status is not null then
      claims := jsonb_set(claims, '{user_member_status}', to_jsonb(user_member_status));
    else
      claims := jsonb_set(claims, '{user_member_status}', 'null');
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

-- (2) Only now is it safe to drop the columns. 'if exists' keeps the migration re-runnable.
alter table public.player_customer drop column if exists customer_id;
alter table public.player_customer drop column if exists membership_variant;

-- (3) webhook_id must become text before it can hold a Polar webhook id.
--
--     The column was typed uuid because Lemon Squeezy's meta.webhook_id happened to be a UUID.
--     Polar follows the Standard Webhooks spec, which explicitly does NOT require one — the
--     spec's own example id is `msg_2KWPBgLlAfxdpx2AI54pPJ85f4W`, which a uuid cast rejects.
--     Left as uuid, any non-UUID id would throw on insert, return 500, and put Polar into an
--     infinite retry loop against an event that can never be stored.
--
--     This column holds an opaque identifier minted by an external provider, so its format is
--     that provider's business and text is the honest type regardless of what Polar emits today.
alter table public.webhook_events alter column webhook_id type text using webhook_id::text;

-- (4) Idempotency guard for webhook replays. Standard Webhooks retries on any non-2xx, so the
--     same webhook-id can arrive more than once and must not be processed twice.
--
--     Deduplicate before indexing: existing Lemon Squeezy rows may already contain repeats from
--     past retries, and a unique index cannot be created over them. The rows removed here are
--     redundant records of the same delivery. Ordering by processed first, then id, keeps the
--     row that was actually handled — a retry set can contain one processed row and one that
--     failed, and keeping the earliest blindly could discard the successful one.
delete from public.webhook_events
where id in (
  select id
  from (
    select id,
           row_number() over (partition by webhook_id order by processed desc, id asc) as rn
    from public.webhook_events
    where webhook_id is not null
  ) ranked
  where rn > 1
);

--     Partial, so the legacy rows with a null webhook_id stay exempt rather than being indexed.
create unique index if not exists webhook_events_webhook_id_key
  on public.webhook_events (webhook_id)
  where webhook_id is not null;
