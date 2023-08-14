create table "public"."daily_scores" (
    "id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "player_id" uuid not null,
    "date" timestamp with time zone not null,
    "answer" text,
    "guesses" text[] not null default '{}'::text[]
);


alter table "public"."daily_scores" enable row level security;

create table "public"."players" (
    "id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "first_name" text not null,
    "last_name" text not null,
    "email" text not null
);


alter table "public"."players" enable row level security;

create table "public"."teams" (
    "id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "creator" uuid not null,
    "name" text not null,
    "play_weekends" boolean not null default false,
    "player_ids" uuid[] not null default '{}'::uuid[],
    "n_a" smallint not null default '0'::smallint,
    "one_guess" smallint not null default '5'::smallint,
    "two_guesses" smallint not null default '3'::smallint,
    "three_guesses" smallint not null default '2'::smallint,
    "four_guesses" smallint not null default '1'::smallint,
    "five_guesses" smallint not null default '0'::smallint,
    "six_guesses" smallint not null default '-1'::smallint,
    "failed" smallint not null default '-3'::smallint,
    "invited" text[] not null default '{}'::text[]
);

alter table "public"."teams" enable row level security;

alter table "public"."profiles" drop column "firstname";

alter table "public"."profiles" drop column "lastname";

alter table "public"."profiles" add column "first_name" text;

alter table "public"."profiles" add column "last_name" text;

alter table "public"."profiles" enable row level security;

CREATE UNIQUE INDEX daily_scores_pkey ON public.daily_scores USING btree (id);

CREATE UNIQUE INDEX player_pkey ON public.players USING btree (id);

CREATE UNIQUE INDEX players_email_key ON public.players USING btree (email);

CREATE UNIQUE INDEX teams_pkey ON public.teams USING btree (id);

alter table "public"."daily_scores" add constraint "daily_scores_pkey" PRIMARY KEY using index "daily_scores_pkey";

alter table "public"."players" add constraint "player_pkey" PRIMARY KEY using index "player_pkey";

alter table "public"."players" add constraint "players_email_key" UNIQUE using index "players_email_key";

alter table "public"."teams" add constraint "teams_pkey" PRIMARY KEY using index "teams_pkey";

alter table "public"."teams" add constraint "teams_creator_fkey" FOREIGN KEY (creator) REFERENCES auth.users(id) not valid;

alter table "public"."teams" validate constraint "teams_creator_fkey";

alter table "public"."daily_scores" add constraint "daily_scores_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE not valid;

alter table "public"."daily_scores" validate constraint "daily_scores_player_id_fkey";

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

  insert into public.players (id, first_name, last_name)
  values (new.id, new.raw_user_meta_data->>'firstName', new.raw_user_meta_data->>'lastName');

  return new;
end;
$function$
;


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
to authenticated
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
to authenticated
using (true);


create policy "Enable users to update their own player"
on "public"."players"
as permissive
for update
to authenticated
using ((auth.uid() = id))
with check ((auth.uid() = id));


create policy "Enable read access for all users"
on "public"."profiles"
as permissive
for select
to public
using (true);


create policy "Enable users to update their own profile"
on "public"."profiles"
as permissive
for update
to authenticated
using ((auth.uid() = id))
with check ((auth.uid() = id));


create policy "Enable delete for team creators"
on "public"."teams"
as permissive
for delete
to authenticated
using ((auth.uid() = creator));


create policy "Enable insert for authenticated users only"
on "public"."teams"
as permissive
for insert
to authenticated
with check (true);


create policy "Enable update for team creators"
on "public"."teams"
as permissive
for update
to authenticated
using ((auth.uid() = creator))
with check ((auth.uid() = creator));


create policy "Enable users to read teams"
on "public"."teams"
as permissive
for select
to public
using (true);


drop policy "Enable read access for authenticated users" on "public"."daily_scores";

drop policy "Enable read access for authenticated users" on "public"."players";

create policy "Enable read access for authenticated users"
on "public"."daily_scores"
as permissive
for select
to public
using (true);


create policy "Enable read access for authenticated users"
on "public"."players"
as permissive
for select
to public
using (true);
