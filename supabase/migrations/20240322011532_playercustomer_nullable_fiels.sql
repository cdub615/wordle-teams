alter table public.player_customer
alter column customer_id
drop not null;

alter table public.player_customer
alter column customer_portal_url
drop not null;