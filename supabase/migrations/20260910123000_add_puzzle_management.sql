begin;

comment on table public.puzzles is
	'Canonical Entre Paréntesis puzzle definitions migrated from WordPress and managed independently.';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.puzzle_managers (
	user_id uuid primary key references auth.users (id) on delete cascade,
	created_at timestamptz not null default now()
);

comment on table private.puzzle_managers is
	'Invite-only allowlist for Entre Paréntesis puzzle managers.';

create table private.puzzle_history (
	history_id bigint generated always as identity primary key,
	release_date date not null,
	puzzle_id text not null,
	revision integer not null,
	status text not null,
	definition jsonb not null,
	operation text not null check (operation in ('update', 'trash', 'restore')),
	actor_id uuid not null references auth.users (id),
	archived_at timestamptz not null default now()
);

comment on table private.puzzle_history is
	'Append-only snapshots taken before every puzzle change.';

revoke all on all tables in schema private from public, anon, authenticated;
grant select on private.puzzle_managers to service_role;
grant select, insert on private.puzzle_history to service_role;

create or replace function public.is_puzzle_manager(candidate_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select exists (
		select 1
		from private.puzzle_managers
		where user_id = candidate_user_id
	);
$$;

revoke all on function public.is_puzzle_manager(uuid) from public, anon, authenticated;
grant execute on function public.is_puzzle_manager(uuid) to service_role;

create or replace function public.admin_save_puzzle(
	p_definition jsonb,
	p_overwrite boolean,
	p_expected_revision integer,
	p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_date date;
	v_revision integer;
	v_current public.puzzles%rowtype;
begin
	if not public.is_puzzle_manager(p_actor_id) then
		raise exception using errcode = 'P0001', message = 'MANAGER_REQUIRED';
	end if;
	if jsonb_typeof(p_definition) <> 'object'
		or coalesce(p_definition ->> 'releaseDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
	then
		raise exception using errcode = 'P0001', message = 'INVALID_PUZZLE';
	end if;
	v_date := (p_definition ->> 'releaseDate')::date;
	v_revision := coalesce((p_definition ->> 'revision')::integer, 1);

	select * into v_current
	from public.puzzles
	where release_date = v_date
	for update;

	if found then
		if not p_overwrite then
			raise exception using errcode = 'P0001', message = 'DATE_EXISTS';
		end if;
		if v_current.status <> 'published' then
			raise exception using errcode = 'P0001', message = 'PUZZLE_TRASHED';
		end if;
		if p_expected_revision is null or p_expected_revision <> v_current.revision then
			raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT';
		end if;
		if p_definition ->> 'id' <> v_current.puzzle_id or v_revision <= v_current.revision then
			raise exception using errcode = 'P0001', message = 'INVALID_CORRECTION';
		end if;

		insert into private.puzzle_history (
			release_date, puzzle_id, revision, status, definition, operation, actor_id
		) values (
			v_current.release_date, v_current.puzzle_id, v_current.revision,
			v_current.status, v_current.definition, 'update', p_actor_id
		);

		update public.puzzles
		set puzzle_id = p_definition ->> 'id',
			schema_version = (p_definition ->> 'schemaVersion')::integer,
			revision = v_revision,
			locale = p_definition ->> 'locale',
			title = coalesce(nullif(p_definition ->> 'title', ''), p_definition ->> 'id'),
			difficulty = nullif(p_definition ->> 'difficulty', ''),
			definition = p_definition,
			updated_at = now()
		where release_date = v_date;
	else
		if p_overwrite then
			raise exception using errcode = 'P0001', message = 'PUZZLE_NOT_FOUND';
		end if;
		if (select count(*) from public.puzzles where status = 'published') >= 1000 then
			raise exception using errcode = 'P0001', message = 'PUZZLE_LIMIT';
		end if;
		insert into public.puzzles (
			release_date, puzzle_id, schema_version, revision, locale,
			title, difficulty, definition, status
		) values (
			v_date,
			p_definition ->> 'id',
			(p_definition ->> 'schemaVersion')::integer,
			v_revision,
			p_definition ->> 'locale',
			coalesce(nullif(p_definition ->> 'title', ''), p_definition ->> 'id'),
			nullif(p_definition ->> 'difficulty', ''),
			p_definition,
			'published'
		);
	end if;

	return jsonb_build_object('ok', true, 'date', v_date, 'revision', v_revision);
end;
$$;

create or replace function public.admin_set_puzzle_status(
	p_release_date date,
	p_status text,
	p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_current public.puzzles%rowtype;
	v_operation text;
begin
	if not public.is_puzzle_manager(p_actor_id) then
		raise exception using errcode = 'P0001', message = 'MANAGER_REQUIRED';
	end if;
	if p_status not in ('published', 'trash') then
		raise exception using errcode = 'P0001', message = 'INVALID_STATUS';
	end if;

	select * into v_current
	from public.puzzles
	where release_date = p_release_date
	for update;
	if not found then
		raise exception using errcode = 'P0001', message = 'PUZZLE_NOT_FOUND';
	end if;
	if v_current.status = p_status then
		raise exception using errcode = 'P0001', message = 'STATUS_UNCHANGED';
	end if;
	if p_status = 'published'
		and (select count(*) from public.puzzles where status = 'published') >= 1000
	then
		raise exception using errcode = 'P0001', message = 'PUZZLE_LIMIT';
	end if;

	v_operation := case when p_status = 'trash' then 'trash' else 'restore' end;
	insert into private.puzzle_history (
		release_date, puzzle_id, revision, status, definition, operation, actor_id
	) values (
		v_current.release_date, v_current.puzzle_id, v_current.revision,
		v_current.status, v_current.definition, v_operation, p_actor_id
	);
	update public.puzzles
	set status = p_status, updated_at = now()
	where release_date = p_release_date;

	return jsonb_build_object('ok', true, 'date', p_release_date, 'status', p_status);
end;
$$;

revoke all on function public.admin_save_puzzle(jsonb, boolean, integer, uuid)
	from public, anon, authenticated;
grant execute on function public.admin_save_puzzle(jsonb, boolean, integer, uuid)
	to service_role;
revoke all on function public.admin_set_puzzle_status(date, text, uuid)
	from public, anon, authenticated;
grant execute on function public.admin_set_puzzle_status(date, text, uuid)
	to service_role;

commit;
