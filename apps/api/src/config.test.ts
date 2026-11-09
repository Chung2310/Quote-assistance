import test from "node:test";
import assert from "node:assert/strict";

test("all AI features keep GPT-6 Luna regardless of environment model settings", async (t) => {
  const keys = ["OPENROUTER_MODEL", "OPENROUTER_FILE_MODEL", "OPENROUTER_DOCUMENT_MODEL", "OPENROUTER_API_KEY"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.OPENROUTER_API_KEY = "test-key-from-environment";
  for (const [index, value] of [undefined, "", "another-provider/another-model"].entries()) {
    for (const key of keys.slice(0, 3)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const url = new URL("./config.js", import.meta.url);
    url.searchParams.set("model-settings-test", String(index));
    const { config } = await import(url.href);
    assert.equal(config.openRouterModel, "openai/gpt-6-luna");
    assert.equal(config.openRouterFileModel, "openai/gpt-6-luna");
    assert.equal(config.openRouterDocumentModel, "openai/gpt-6-luna");
    assert.equal(config.openRouterApiKey, "test-key-from-environment");
  }
});
