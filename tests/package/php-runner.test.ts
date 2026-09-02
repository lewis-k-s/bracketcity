import assert from "node:assert/strict";
import test from "node:test";
import { selectPhpRuntime } from "../../scripts/test-php.ts";

test("PHP runner prefers local PHP and falls back only to pinned Docker", () => {
  assert.equal(selectPhpRuntime({ hasPhp: true, hasShell: true, hasDocker: true }), "local");
  assert.equal(selectPhpRuntime({ hasPhp: false, hasShell: true, hasDocker: true }), "docker");
  assert.equal(selectPhpRuntime({ hasPhp: true, hasShell: false, hasDocker: true }), "docker");
  assert.equal(selectPhpRuntime({ hasPhp: false, hasShell: false, hasDocker: false }), null);
});
