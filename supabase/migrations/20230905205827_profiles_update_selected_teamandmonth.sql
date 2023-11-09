alter table "public"."profiles" add column "selected_month" text;

alter table "public"."profiles" add column "selected_team" bigint;

alter table "public"."profiles" add constraint "profiles_selected_team_fkey" FOREIGN KEY (selected_team) REFERENCES teams(id) ON DELETE SET NULL not valid;

alter table "public"."profiles" validate constraint "profiles_selected_team_fkey";