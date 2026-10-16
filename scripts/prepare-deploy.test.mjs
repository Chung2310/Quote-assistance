import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const configuration = {
  SSH_HOST: "example.com", SSH_USER: "deploy", SSH_KEY: "fake-key", SSH_PORT: "22",
  IMAGE: "ghcr.io/test/app@sha256:" + "a".repeat(64), GHCR_USER: "test", GHCR_TOKEN: "fake-token",
  ENV_FILE: "MONGODB_URI=mongodb://db:27017/test\nSESSION_SECRET=" + "x".repeat(32),
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
  prepare({ ENV_FILE: configuration.ENV_FILE + '\nMONGODB_PASSWORD="' + secret + '"' }, (result, dir) => {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(join(dir, "app.env"), "utf8").includes("MONGODB_PASSWORD=" + secret + "\n"));
    assert.equal(result.stdout, "");
  });
});
test("missing SSH configuration fails with its name", () => {
  prepare({ SSH_HOST: "" }, (result) => { assert.notEqual(result.status, 0); assert.match(result.stderr, /SSH_HOST/); });
});
test("extracts Docker network without exposing it as application configuration", () => {
  prepare({ ENV_FILE: configuration.ENV_FILE + "\nDOCKER_NETWORK=project_default" }, (result, dir) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, "docker-network"), "utf8"), "project_default");
    assert.ok(!readFileSync(join(dir, "app.env"), "utf8").includes("DOCKER_NETWORK="));
  });
});
test("rejects multiline env injection without exposing secret", () => {
  const secret = "sensitive-value\nPORT=9999";
  prepare({ ENV_FILE: configuration.ENV_FILE + '\nMONGODB_PASSWORD="' + secret + '"' }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Docker env values must be single-line/);
    assert.ok(!result.stderr.includes("sensitive-value"));
  });
});
test("parses dotenv quotes, comments and CRLF and preserves configured port", () => {
  prepare({ ENV_FILE: '# config\r\nMONGODB_URI="mongodb://db:27017/test"\r\nSESSION_SECRET="' + "s".repeat(32) + '"\r\nPORT=8080 # custom\r\nNODE_ENV=development\r\n' }, (result, dir) => {
    assert.equal(result.status, 0, result.stderr);
    const content = readFileSync(join(dir, "app.env"), "utf8");
    assert.ok(content.includes("PORT=8080\n"));
    assert.ok(content.includes("NODE_ENV=production\n"));
    assert.ok(content.includes("MONGODB_URI=mongodb://db:27017/test\n"));
    assert.equal(readFileSync(join(dir, "app-port"), "utf8"), "8080");
  });
});
test("defaults to port 3013 and rejects invalid ports or missing application config", () => {
  prepare({}, (result, dir) => { assert.equal(result.status, 0); assert.equal(readFileSync(join(dir, "app-port"), "utf8"), "3013"); });
  for (const ENV_FILE of ["PORT=3013", configuration.ENV_FILE + "\nPORT=0", configuration.ENV_FILE + "\nPORT=99999"]) {
    prepare({ ENV_FILE }, (result) => { assert.notEqual(result.status, 0); });
  }
});
