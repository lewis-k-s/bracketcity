begin;

create table public.puzzle_analytics (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	run_id uuid not null,
	puzzle_id text not null,
	puzzle_revision integer not null check (puzzle_revision >= 1),
	event_type text not null check (event_type in ('load', 'completion')),
	difficulty smallint check (difficulty between 1 and 4),
	difficulty_label text check (
		difficulty_label is null
		or difficulty_label ~ '^[a-z][a-z0-9-]*$'
	),
	score numeric,
	max_score numeric,
	elapsed_seconds integer,
	mistakes integer,
	hints_used integer,
	constraint puzzle_analytics_puzzle_id_check check (
		puzzle_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
	),
	constraint puzzle_analytics_difficulty_check check (
		(difficulty is null and difficulty_label is null)
		or (difficulty is not null and difficulty_label is not null)
	),
	constraint puzzle_analytics_event_fields_check check (
		(
			event_type = 'load'
			and score is null
			and max_score is null
			and elapsed_seconds is null
			and mistakes is null
			and hints_used is null
		)
		or (
			event_type = 'completion'
			and score is not null
			and max_score is not null
			and elapsed_seconds is not null
			and mistakes is not null
			and hints_used is not null
			and score >= 0
			and max_score > 0
			and score <= max_score
			and elapsed_seconds >= 0
			and mistakes >= 0
			and hints_used >= 0
		)
	),
	unique (run_id, event_type)
);

comment on table public.puzzle_analytics is
	'Anonymous, append-only puzzle run events without persistent visitor identifiers.';
comment on column public.puzzle_analytics.run_id is
	'Random identifier for one in-memory puzzle run. It is not reused across loads.';
comment on column public.puzzle_analytics.difficulty is
	'Numeric snapshot of declared difficulty: easy=1, medium=2, hard=3.';

create index puzzle_analytics_puzzle_idx
	on public.puzzle_analytics (puzzle_id, puzzle_revision, created_at);
create index puzzle_analytics_event_idx
	on public.puzzle_analytics (event_type, created_at);

alter table public.puzzle_analytics enable row level security;

revoke all on table public.puzzle_analytics from public, anon, authenticated;
grant insert (
	run_id,
	puzzle_id,
	puzzle_revision,
	event_type,
	difficulty,
	difficulty_label,
	score,
	max_score,
	elapsed_seconds,
	mistakes,
	hints_used
) on table public.puzzle_analytics to anon, authenticated;
grant all on table public.puzzle_analytics to service_role;
grant usage on sequence public.puzzle_analytics_id_seq to anon, authenticated;
grant all on sequence public.puzzle_analytics_id_seq to service_role;

create policy "released puzzle analytics can be inserted"
	on public.puzzle_analytics
	for insert
	to anon, authenticated
	with check (
		exists (
			select 1
			from public.puzzles
			where puzzles.puzzle_id = puzzle_analytics.puzzle_id
				and puzzles.revision = puzzle_analytics.puzzle_revision
				and puzzles.status = 'published'
				and puzzles.release_date <= (now() at time zone 'Europe/Madrid')::date
		)
	);

create view private.puzzle_usage_analytics
with (security_invoker = true)
as
select
	puzzle_id,
	puzzle_revision,
	difficulty,
	difficulty_label,
	count(*) filter (where event_type = 'load') as loads,
	count(*) filter (where event_type = 'completion') as completions,
	count(*) filter (where event_type = 'completion')::double precision
		/ nullif(count(*) filter (where event_type = 'load'), 0) as completion_rate
from public.puzzle_analytics
group by puzzle_id, puzzle_revision, difficulty, difficulty_label;

create view private.puzzle_difficulty_analytics
with (security_invoker = true)
as
select
	puzzle_id,
	puzzle_revision,
	difficulty,
	difficulty_label,
	count(*) as completions,
	avg((score / nullif(max_score, 0))::double precision) as mean_normalized_score,
	percentile_cont(0.5) within group (
		order by (score / nullif(max_score, 0))::double precision
	) as median_normalized_score,
	avg(elapsed_seconds) as mean_completion_seconds,
	avg(mistakes) as mean_mistakes,
	avg(hints_used) as mean_hints
from public.puzzle_analytics
where event_type = 'completion'
group by puzzle_id, puzzle_revision, difficulty, difficulty_label;

create or replace function public.get_puzzle_analytics(p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	with filtered_events as (
		select *
		from public.puzzle_analytics
		where p_days is null
			or created_at >= now() - make_interval(days => p_days)
	),
	summary as (
		select
			count(*) filter (where event_type = 'load') as loads,
			count(*) filter (where event_type = 'completion') as completions,
			count(*) filter (where event_type = 'completion')::double precision
				/ nullif(count(*) filter (where event_type = 'load'), 0) as completion_rate,
			avg(score) filter (where event_type = 'completion') as mean_score,
			avg(max_score) filter (where event_type = 'completion') as mean_max_score,
			avg(score / nullif(max_score, 0)) filter (where event_type = 'completion') as mean_normalized_score,
			percentile_cont(0.5) within group (
				order by score / nullif(max_score, 0)
			) filter (where event_type = 'completion') as median_normalized_score,
			avg(elapsed_seconds) filter (where event_type = 'completion') as mean_completion_seconds,
			avg(mistakes) filter (where event_type = 'completion') as mean_mistakes,
			avg(hints_used) filter (where event_type = 'completion') as mean_hints
		from filtered_events
	),
	puzzle_stats as (
		select
			puzzle_id,
			puzzle_revision,
			difficulty,
			difficulty_label,
			count(*) filter (where event_type = 'load') as loads,
			count(*) filter (where event_type = 'completion') as completions,
			count(*) filter (where event_type = 'completion')::double precision
				/ nullif(count(*) filter (where event_type = 'load'), 0) as completion_rate,
			avg(score) filter (where event_type = 'completion') as mean_score,
			avg(max_score) filter (where event_type = 'completion') as mean_max_score,
			avg(score / nullif(max_score, 0)) filter (where event_type = 'completion') as mean_normalized_score,
			percentile_cont(0.5) within group (
				order by score / nullif(max_score, 0)
			) filter (where event_type = 'completion') as median_normalized_score,
			avg(elapsed_seconds) filter (where event_type = 'completion') as mean_completion_seconds,
			avg(mistakes) filter (where event_type = 'completion') as mean_mistakes,
			avg(hints_used) filter (where event_type = 'completion') as mean_hints
		from filtered_events
		group by puzzle_id, puzzle_revision, difficulty, difficulty_label
	),
	difficulty_stats as (
		select
			difficulty,
			difficulty_label,
			count(*) filter (where event_type = 'load') as loads,
			count(*) filter (where event_type = 'completion') as completions,
			count(*) filter (where event_type = 'completion')::double precision
				/ nullif(count(*) filter (where event_type = 'load'), 0) as completion_rate,
			avg(score) filter (where event_type = 'completion') as mean_score,
			avg(max_score) filter (where event_type = 'completion') as mean_max_score,
			avg(score / nullif(max_score, 0)) filter (where event_type = 'completion') as mean_normalized_score,
			percentile_cont(0.5) within group (
				order by score / nullif(max_score, 0)
			) filter (where event_type = 'completion') as median_normalized_score,
			avg(elapsed_seconds) filter (where event_type = 'completion') as mean_completion_seconds,
			avg(mistakes) filter (where event_type = 'completion') as mean_mistakes,
			avg(hints_used) filter (where event_type = 'completion') as mean_hints
		from filtered_events
		group by difficulty, difficulty_label
	)
	select jsonb_build_object(
		'generatedAt', now(),
		'periodDays', p_days,
		'periodStart', case
			when p_days is null then null
			else now() - make_interval(days => p_days)
		end,
		'summary', jsonb_build_object(
			'loads', summary.loads,
			'completions', summary.completions,
			'completionRate', summary.completion_rate,
			'meanScore', summary.mean_score,
			'meanMaxScore', summary.mean_max_score,
			'meanNormalizedScore', summary.mean_normalized_score,
			'medianNormalizedScore', summary.median_normalized_score,
			'meanCompletionSeconds', summary.mean_completion_seconds,
			'meanMistakes', summary.mean_mistakes,
			'meanHints', summary.mean_hints
		),
		'puzzles', coalesce((
			select jsonb_agg(jsonb_build_object(
				'puzzleId', stats.puzzle_id,
				'puzzleRevision', stats.puzzle_revision,
				'title', puzzles.title,
				'releaseDate', puzzles.release_date,
				'difficulty', stats.difficulty,
				'difficultyLabel', stats.difficulty_label,
				'loads', stats.loads,
				'completions', stats.completions,
				'completionRate', stats.completion_rate,
				'meanScore', stats.mean_score,
				'meanMaxScore', stats.mean_max_score,
				'meanNormalizedScore', stats.mean_normalized_score,
				'medianNormalizedScore', stats.median_normalized_score,
				'meanCompletionSeconds', stats.mean_completion_seconds,
				'meanMistakes', stats.mean_mistakes,
				'meanHints', stats.mean_hints
			) order by puzzles.release_date desc nulls last, stats.puzzle_id, stats.puzzle_revision desc)
			from puzzle_stats stats
			left join public.puzzles puzzles on puzzles.puzzle_id = stats.puzzle_id
		), '[]'::jsonb),
		'difficulties', coalesce((
			select jsonb_agg(jsonb_build_object(
				'difficulty', stats.difficulty,
				'difficultyLabel', stats.difficulty_label,
				'loads', stats.loads,
				'completions', stats.completions,
				'completionRate', stats.completion_rate,
				'meanScore', stats.mean_score,
				'meanMaxScore', stats.mean_max_score,
				'meanNormalizedScore', stats.mean_normalized_score,
				'medianNormalizedScore', stats.median_normalized_score,
				'meanCompletionSeconds', stats.mean_completion_seconds,
				'meanMistakes', stats.mean_mistakes,
				'meanHints', stats.mean_hints
			) order by stats.difficulty nulls last, stats.difficulty_label)
			from difficulty_stats stats
		), '[]'::jsonb)
	)
	from summary;
$$;

comment on function public.get_puzzle_analytics(integer) is
	'Returns aggregate puzzle analytics for the manager dashboard without exposing event rows.';

revoke all on function public.get_puzzle_analytics(integer) from public, anon, authenticated;
grant execute on function public.get_puzzle_analytics(integer) to service_role;

revoke all on private.puzzle_usage_analytics from public, anon, authenticated;
revoke all on private.puzzle_difficulty_analytics from public, anon, authenticated;
grant select on private.puzzle_usage_analytics to service_role;
grant select on private.puzzle_difficulty_analytics to service_role;

commit;
