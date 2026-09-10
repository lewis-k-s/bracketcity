begin;

grant usage on schema private to supabase_auth_admin;
grant select on private.puzzle_managers to supabase_auth_admin;

create or replace function private.puzzle_manager_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_user_id uuid;
begin
	begin
		v_user_id := nullif(event ->> 'user_id', '')::uuid;
	exception
		when invalid_text_representation then
			return jsonb_build_object(
				'error', jsonb_build_object(
					'http_code', 403,
					'message', 'This account is not authorized.'
				)
			);
	end;

	if v_user_id is null or not exists (
		select 1
		from private.puzzle_managers
		where user_id = v_user_id
	) then
		return jsonb_build_object(
			'error', jsonb_build_object(
				'http_code', 403,
				'message', 'This account is not authorized.'
			)
		);
	end if;

	return jsonb_build_object('claims', event -> 'claims');
end;
$$;

revoke all on function private.puzzle_manager_access_token_hook(jsonb)
	from public, anon, authenticated;
grant execute on function private.puzzle_manager_access_token_hook(jsonb)
	to supabase_auth_admin;

commit;
