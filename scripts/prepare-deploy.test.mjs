import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const configuration = {
  VPS_HOST: "example.com", VPS_USER: "deploy", VPS_SSH_KEY: "fake-key", VPS_KNOWN_HOSTS: "fake-host",
  VPS_SSH_PORT: "22", VPS_APP_PORT: "3013", VPS_CONTAINER_NAME: "bao-gia", VPS_BIND_ADDRESS: "127.0.0.1",
  IMAGE: "ghcr.io/test/app@sha256:" + "a".repeat(64), GHCR_USER: "test", GHCR_TOKEN: "fake-token",
  MONGODB_URI: "mongodb://db:27017/test", SESSION_SECRET: "x".repeat(32),
};
function prepare(overrides, check) {
  const dir = mkdtempSync(join(tmpdir(), "quote-deploy-test-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/prepare-deploy.mjs", dir], { env: { ...process.env, ...configuration, ...overrides }, encoding: "utf8" });
    check(result, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("writes literal secrets without shell evaluation or logging", () => {
  const secret = "literal-$HOME-`hostname`-$(whoami)=value";
  prepare({ MONGODB_PASSWORD: secret }, (result, dir) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(join(dir, "app.env"), "utf8").includes("MONGODB_PASSWORD=" + secret + "\n"));
    assert.equal(result.stdout, "");
  });
});
test("missing SSH configuration fails with its name", () => {
  prepare({ VPS_HOST: "" }, (result) => { assert.notEqual(result.status, 0); assert.match(result.stderr, /VPS_HOST/); });
});
test("rejects multiline env injection without exposing secret", () => {
  const secret = "sensitive-value\nPORT=9999";
  prepare({ MONGODB_PASSWORD: secret }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MONGODB_PASSWORD must be a single line/);
    assert.ok(!result.stderr.includes("sensitive-value"));
  });
});
