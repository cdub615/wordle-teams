
DO $$DECLARE
  steve_jobs_id uuid;
  bill_gates_id uuid;
  mark_zuckerberg_id uuid;
  tech_giants_id uuid;
  creator_id uuid;
BEGIN

  creator_id = (select id from auth.users where email = 'christianbwhite@gmail.com');

  steve_jobs_id = gen_random_uuid();
  bill_gates_id = gen_random_uuid();
  mark_zuckerberg_id = gen_random_uuid();
  tech_giants_id = gen_random_uuid();

  insert into players (id, first_name, last_name, email)
  values (steve_jobs_id, 'Steve', 'Jobs', 'bogusemail1@test.tst');

  insert into players (id, first_name, last_name, email)
  values (bill_gates_id, 'Bill', 'Gates', 'bogusemail2@test.tst');

  insert into players (id, first_name, last_name, email)
  values (mark_zuckerberg_id, 'Mark', 'Zuckerberg', 'bogusemail3@test.tst');

  insert into teams (id, creator, name, play_weekends)
  values (tech_giants_id, creator_id, 'Tech Giants', false);

  update teams set player_ids = array_append(player_ids, steve_jobs_id);
  update teams set player_ids = array_append(player_ids, bill_gates_id);
  update teams set player_ids = array_append(player_ids, mark_zuckerberg_id);



  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-1', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-2', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-3', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-4', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-5', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-6', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-7', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-8', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-9', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-10', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-11', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-12', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-13', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-14', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-15', '', '{"","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-16', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-17', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-18', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-19', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-20', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-21', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-22', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-23', '', '{"","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-24', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-25', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-26', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-27', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-28', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-29', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-30', '', '{"",""}', steve_jobs_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-1', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-2', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-3', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-4', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-5', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-6', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-7', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-8', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-9', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-10', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-11', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-12', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-13', '', '{"",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-14', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-15', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-16', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-17', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-18', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-19', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-20', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-21', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-22', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-23', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-24', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-25', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-26', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-27', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-28', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-29', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-30', '', '{"",""}', bill_gates_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-1', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-2', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-3', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-4', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-5', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-6', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-7', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-8', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-9', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-10', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-11', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-12', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-13', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-14', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-15', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-16', '', '{""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-17', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-18', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-19', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-20', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-21', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-22', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-23', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-24', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-25', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-26', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-27', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-28', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-29', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-6-30', '', '{"","","",""}', mark_zuckerberg_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-1', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-2', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-3', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-4', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-5', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-6', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-7', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-8', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-9', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-10', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-11', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-12', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-13', '', '{"","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-14', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-15', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-16', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-17', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-18', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-19', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-20', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-21', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-22', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-23', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-24', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-25', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-26', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-27', '', '{""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-28', '', '{"","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-29', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-30', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-31', '', '{"","","",""}', steve_jobs_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-1', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-2', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-3', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-4', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-5', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-6', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-7', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-8', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-9', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-10', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-11', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-12', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-13', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-14', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-15', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-16', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-17', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-18', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-19', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-20', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-21', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-22', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-23', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-24', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-25', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-26', '', '{"",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-27', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-28', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-29', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-30', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-31', '', '{"","","","","",""}', bill_gates_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-1', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-2', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-3', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-4', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-5', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-6', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-7', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-8', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-9', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-10', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-11', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-12', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-13', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-14', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-15', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-16', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-17', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-18', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-19', '', '{"","","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-20', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-21', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-22', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-23', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-24', '', '{"","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-25', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-26', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-27', '', '{""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-28', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-29', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-30', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-7-31', '', '{"","","","",""}', mark_zuckerberg_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-1', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-2', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-3', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-4', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-5', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-6', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-7', '', '{"",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-8', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-9', '', '{"","","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-10', '', '{"","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-11', '', '{"","","","",""}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-12', '', '{}', steve_jobs_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-13', '', '{}', steve_jobs_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-1', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-2', '', '{"","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-3', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-4', '', '{""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-5', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-6', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-7', '', '{"","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-8', '', '{"",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-9', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-10', '', '{"","","","","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-11', '', '{"","",""}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-12', '', '{}', bill_gates_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-13', '', '{}', bill_gates_id);




  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-1', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-2', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-3', '', '{""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-4', '', '{"","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-5', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-6', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-7', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-8', '', '{""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-9', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-10', '', '{"","","","",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-11', '', '{"",""}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-12', '', '{}', mark_zuckerberg_id);

  insert into daily_scores(id, date, answer, guesses, player_id)
  values (gen_random_uuid(), '2023-8-13', '', '{}', mark_zuckerberg_id);

END$$;