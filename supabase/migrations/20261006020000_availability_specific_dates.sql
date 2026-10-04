-- ============================================================================
-- availability_rules — optional specific dates
-- ============================================================================
-- A rule was weekly only ("Tuesdays, 5pm to 8pm"). Sellers also need to offer
-- one particular day ("Saturday 11 October, 10am to noon").
--
-- `specific_date` null  -> repeats every week on `day_of_week`, as before.
-- `specific_date` set   -> applies on that date only. `day_of_week` is kept in
--                          step with it so every existing reader stays correct.
alter table public.availability_rules
	add column specific_date date;

alter table public.availability_rules
	add constraint availability_rule_date_matches_day
	check (specific_date is null or extract(dow from specific_date)::smallint = day_of_week);
