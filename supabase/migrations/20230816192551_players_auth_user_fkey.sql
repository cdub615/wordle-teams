drop table "public"."daily_scores";

create table "public"."daily_scores" (
    "id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "player_id" uuid not null,
    "date" timestamp with time zone not null,
    "answer" text,
    "guesses" text[] not null default '{}'::text[]
);

alter table "public"."daily_scores" enable row level security;

drop table "public"."players";

create table "public"."players" (
    "id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "first_name" text not null,
    "last_name" text not null,
    "email" text not null,
    constraint players_pkey primary key (id),
    constraint players_id_fkey foreign key (id) references auth.users (id) on delete cascade
);


alter table "public"."players" enable row level security;

CREATE UNIQUE INDEX daily_scores_pkey ON public.daily_scores USING btree (id);

CREATE UNIQUE INDEX player_pkey ON public.players USING btree (id);

CREATE UNIQUE INDEX players_email_key ON public.players USING btree (email);


alter table "public"."daily_scores" add constraint "daily_scores_pkey" PRIMARY KEY using index "daily_scores_pkey";

alter table "public"."daily_scores" add constraint "daily_scores_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE not valid;

alter table "public"."daily_scores" validate constraint "daily_scores_player_id_fkey";


create policy "Enable delete for users based on user_id"
on "public"."daily_scores"
as permissive
for delete
to authenticated
using ((auth.uid() = player_id));


create policy "Enable insert for authenticated users only"
on "public"."daily_scores"
as permissive
for insert
to authenticated
with check (true);


create policy "Enable read access for authenticated users"
on "public"."daily_scores"
as permissive
for select
to public
using (true);


create policy "Enable users to update their own scores"
on "public"."daily_scores"
as permissive
for update
to authenticated
using ((auth.uid() = player_id))
with check ((auth.uid() = player_id));


create policy "Enable read access for authenticated users"
on "public"."players"
as permissive
for select
to public
using (true);


create policy "Enable users to update their own player"
on "public"."players"
as permissive
for update
to authenticated
using ((auth.uid() = id))
with check ((auth.uid() = id));