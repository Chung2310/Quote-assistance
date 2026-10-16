import { test } from "node:test";
import assert from "node:assert/strict";
import { redactLogs } from "./redact-container-logs.mjs";

test("redacts config values, encoded credentials and MongoDB URIs", () => {
  const env = { MONGODB_URI: "mongodb://alice:pass%40word@db/app", SESSION_SECRET: "private-session-secret", OPENROUTER_API_KEY: "test-api-key", MONGODB_PASSWORD: "abc" };
  const result = redactLogs("MongoServerError: Authentication failed\nmongodb://alice:pass%40word@db/app\nalice pass@word pass%40word private-session-secret test-api-key abc", env);
  assert.ok(result.includes("MongoServerError: Authentication failed"));
  for (const value of ["alice", "pass@word", "pass%40word", "private-session-secret", "test-api-key", "abc"]) assert.ok(!result.includes(value));
});
test("preserves useful startup errors and neutralizes workflow commands", () => {
  const result = redactLogs("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'missing'\n::error::untrusted\nSEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set", {});
  assert.ok(result.includes("ERR_MODULE_NOT_FOUND"));
  assert.ok(result.includes("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD"));
  assert.ok(result.split("\n").every((line) => line.startsWith("[container] ")));
});
