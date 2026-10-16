import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMongoNetwork } from "./resolve-mongo-network.mjs";

const mongo = { name: "/mongo-db", ports: { "27017/tcp": [{ HostPort: "27018" }] }, networks: { project_default: { IPAddress: "172.20.0.2", Aliases: ["mongodb"] } } };
test("routes loopback host port to the MongoDB container and preserves credentials", () => {
  const result = resolveMongoNetwork("MONGODB_URI=mongodb://user:p%40ss@localhost:27018/app?authSource=admin\nPORT=3013\n", [mongo]);
  assert.equal(result.network, "project_default");
  assert.ok(result.envText.includes("mongodb://user:p%40ss@mongo-db:27017/app?authSource=admin"));
  assert.ok(result.envText.includes("PORT=3013"));
});
test("discovers a Compose service alias network", () => {
  assert.equal(resolveMongoNetwork("MONGODB_URI=mongodb://mongodb/app", [mongo]).network, "project_default");
});
test("keeps external MongoDB unchanged", () => {
  const envText = "MONGODB_URI=mongodb+srv://user:pass@cluster.example/app";
  assert.deepEqual(resolveMongoNetwork(envText, [mongo]), { network: "", envText });
});
test("fails closed on missing or ambiguous loopback mapping", () => {
  const envText = "MONGODB_URI=mongodb://localhost:27018/app";
  assert.throws(() => resolveMongoNetwork(envText, []), /unique MongoDB container/);
  assert.throws(() => resolveMongoNetwork(envText, [mongo, { ...mongo, name: "/another-db" }]), /unique MongoDB container/);
});
test("uses container IP on default bridge", () => {
  const result = resolveMongoNetwork("MONGODB_URI=mongodb://127.0.0.1:27018/app", [{ ...mongo, networks: { bridge: { IPAddress: "172.17.0.2" } } }]);
  assert.equal(result.network, "bridge");
  assert.ok(result.envText.includes("172.17.0.2:27017"));
});
