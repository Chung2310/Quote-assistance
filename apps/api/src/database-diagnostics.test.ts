import assert from "node:assert/strict";
import test from "node:test";
import { databaseConnectionDiagnostics } from "./database-diagnostics.js";

test("extracts network causes without logging credentials or endpoints", () => {
  const cause = Object.assign(new Error("connect failed mongodb://user:secret@private-host/db"), { code: "ECONNREFUSED" });
  const error = new Error("mongodb://user:secret@private-host/db", { cause });
  error.name = "MongoNetworkError";
  assert.deepEqual(databaseConnectionDiagnostics(error), { errorName: "MongoNetworkError", connectionCodes: ["ECONNREFUSED"] });
});

test("extracts topology and nested DNS errors with cycle protection", () => {
  const error = Object.assign(new Error("Server selection failed"), {
    reason: { servers: new Map([["private-host:27017", { error: { cause: { code: "ENOTFOUND" } } }]]) },
  });
  error.cause = error;
  assert.deepEqual(databaseConnectionDiagnostics(error).connectionCodes, ["ENOTFOUND"]);
});

test("classifies authentication and drops unknown codes", () => {
  assert.deepEqual(databaseConnectionDiagnostics({ code: 18 }).connectionCodes, ["AUTHENTICATION_FAILED"]);
  assert.deepEqual(databaseConnectionDiagnostics({ code: "secret-string" }).connectionCodes, []);
  assert.deepEqual(databaseConnectionDiagnostics(null).connectionCodes, []);
});
