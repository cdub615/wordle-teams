create or replace function update_user_metadata() returns trigger as $$
BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(jsonb_set(raw_user_meta_data, '{firstName}', to_jsonb(NEW.first_name), true), '{lastName}', to_jsonb(NEW.last_name), true)
    WHERE id = NEW.id;

    UPDATE public.players
    SET first_name = NEW.first_name,
        last_name = NEW.last_name
    WHERE id = NEW.id;

    RETURN NEW;
END;
$$ language plpgsql security definer;



create or replace trigger update_user_metadata_trigger
after
update on public.profiles for each row
execute procedure update_user_metadata();