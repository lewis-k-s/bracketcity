begin;

create table public.puzzles (
  release_date date primary key,
  puzzle_id text not null unique,
  schema_version integer not null default 1 check (schema_version = 1),
  revision integer not null default 1 check (revision >= 1),
  locale text not null,
  title text not null,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  definition jsonb not null,
  status text not null default 'published' check (status in ('published', 'trash')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (puzzle_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (jsonb_typeof(definition) = 'object'),
  check ((definition ->> 'schemaVersion')::integer = schema_version),
  check (definition ->> 'id' = puzzle_id),
  check (definition ->> 'releaseDate' = release_date::text),
  check (definition ->> 'locale' = locale),
  check (coalesce((definition ->> 'revision')::integer, 1) = revision),
  check (definition ? 'finalText' and length(definition ->> 'finalText') > 0),
  check (definition ? 'root' and jsonb_typeof(definition -> 'root') = 'array'),
  check (definition ? 'clues' and jsonb_typeof(definition -> 'clues') = 'object')
);

comment on table public.puzzles is
  'Canonical Nexo puzzle definitions migrated from WordPress and managed independently.';
comment on column public.puzzles.status is
  'Published rows can become public on their Europe/Madrid release date. Trash rows are never public.';

create index puzzles_public_release_idx
  on public.puzzles (release_date desc)
  where status = 'published';

alter table public.puzzles enable row level security;

revoke all on table public.puzzles from public, anon, authenticated;
grant select on table public.puzzles to anon, authenticated;
grant all on table public.puzzles to service_role;

create policy "released puzzles are public"
  on public.puzzles
  for select
  to anon, authenticated
  using (
    status = 'published'
    and release_date <= (now() at time zone 'Europe/Madrid')::date
  );

commit;
