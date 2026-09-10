import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260910123000_add_puzzle_management.sql", import.meta.url),
  "utf8"
);
const authGateMigration = readFileSync(
  new URL("../supabase/migrations/20260910160000_gate_auth_tokens_to_puzzle_managers.sql", import.meta.url),
  "utf8"
);
const edgeFunction = readFileSync(
  new URL("../supabase/functions/puzzle-admin/index.ts", import.meta.url),
  "utf8"
);
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/supabase.yml", import.meta.url), "utf8");

test("puzzle manager membership and history stay outside the exposed schema", () => {
  assert.match(migration, /create schema if not exists private/u);
  assert.match(migration, /create table private\.puzzle_managers/u);
  assert.match(migration, /create table private\.puzzle_history/u);
  assert.match(migration, /revoke all on all tables in schema private from public, anon, authenticated/u);
});

test("only the service role can call puzzle management database functions", () => {
  assert.match(migration, /revoke all on function public\.admin_save_puzzle[\s\S]+from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.admin_save_puzzle[\s\S]+to service_role/u);
  assert.match(migration, /revoke all on function public\.admin_set_puzzle_status[\s\S]+from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.admin_set_puzzle_status[\s\S]+to service_role/u);
});

test("the management function verifies identity, authorization, and puzzle validity", () => {
  assert.match(edgeFunction, /auth\.auth\.getUser\(token\)/u);
  assert.match(edgeFunction, /admin\.rpc\("is_puzzle_manager"/u);
  assert.match(edgeFunction, /validatePuzzle\(body\.definition/u);
  assert.doesNotMatch(edgeFunction, /verify_jwt\s*=\s*false/u);
});

test("Auth disables account creation without disabling invited-user email login", () => {
  assert.match(config, /\[auth\][\s\S]*?enable_signup = false/u);
  assert.match(config, /\[auth\.email\][\s\S]*?enable_signup = true/u);
  assert.match(config, /\[functions\.puzzle-admin\]\nverify_jwt = true/u);
});

test("Auth issues access tokens only to allowlisted puzzle managers", () => {
  assert.match(authGateMigration, /from private\.puzzle_managers/u);
  assert.match(authGateMigration, /grant select on private\.puzzle_managers to supabase_auth_admin/u);
  assert.match(authGateMigration, /grant execute on function private\.puzzle_manager_access_token_hook\(jsonb\)[\s\S]+to supabase_auth_admin/u);
  assert.match(authGateMigration, /'http_code', 403/u);
  assert.match(config, /\[auth\.hook\.custom_access_token\][\s\S]*?enabled = true/u);
  assert.match(config, /pg-functions:\/\/postgres\/private\/puzzle_manager_access_token_hook/u);
  assert.match(workflow, /supabase db push[\s\S]*hook_custom_access_token_enabled/u);
  assert.match(workflow, /api\.supabase\.com\/v1\/projects\/\$SUPABASE_PROJECT_REF\/config\/auth/u);
});
