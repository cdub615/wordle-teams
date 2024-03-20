create table if not exists
  public.webhook_events (
    id bigint generated by default as identity,
    created_at timestamp with time zone not null default now(),
    event_name text not null,
    body jsonb not null,
    processed boolean not null default false,
    processing_error text null,
    player_id uuid not null,
    constraint webhook_events_pkey primary key (id),
    constraint webhook_events_player_id_fkey foreign key (player_id) references players (id) on update cascade on delete cascade
  ) tablespace pg_default;