create or replace function update_user_meta_data()
returns trigger
security definer
as $$
BEGIN
    IF NEW.first_name != OLD.first_name OR NEW.last_name != OLD.last_name THEN
      UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{firstName}', to_jsonb(NEW.first_name))
      WHERE id = NEW.id;

      UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{lastName}', to_jsonb(NEW.last_name))
      WHERE id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ language plpgsql;

create or replace trigger update_user_meta_data_trigger
after
update on public.players for each row
execute function update_user_meta_data();