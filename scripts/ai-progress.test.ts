import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { aiProgress, aiRequestDescription, createAiProgressStore, exportTaskDescription } from "../apps/web/src/ai-progress.ts";
import { api, apiUploadWithProgress, createGeneratedExport, getLatestGeneratedFile, resetAiProgressTracking } from "../apps/web/src/api.ts";

afterEach(resetAiProgressTracking);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("all AI request families have popup labels while ordinary edits and reads do not", () => {
  for (const [url, method, data] of [
    ["/api/quote-requests/request/analyze", "POST", {}],
    ["/api/customer-quotes/suggest", "POST", {}],
    ["/api/budget-plans/suggest", "POST", {}],
    ["/api/budget-plans/plan", "PATCH", { action: "answer" }],
    ["/api/budget-plans/plan", "PATCH", { action: "recalculate" }],
    ["/api/quotes/quote", "PATCH", { recalculateWithAi: true }],
    ["/api/quotes/from-customer", "POST", {}],
    ["/api/customer-quotes", "POST", {}],
    ["/api/quotes/quote/export/retry", "POST", {}],
    ["/api/quotes/quote/export?draft=1&background=1", "GET", {}],
    ["/api/contracts/contract/file?background=1", "GET", {}],
    ["/api/acceptance-records/record/file?background=1", "GET", {}],
    ["/api/acceptance-records/record/settlement/file?background=1", "GET", {}],
    ["/api/acceptance-records/record/settlement.xlsx", "GET", {}],
    ["/api/budget-plans/plan/export?background=1", "GET", {}],
    ["/api/price-list", "POST", {}],
  ] as const) {
    const description = aiRequestDescription(url, method, JSON.stringify(data));
    assert.ok(description, `${method} ${url}`);
    assert.doesNotMatch(description.label, /\/api\/|openrouter|binding/i);
  }
  for (const [url, method, data] of [
    ["/api/catalog", "GET", {}], ["/api/quotes/quote", "PATCH", {}],
    ["/api/budget-plans/plan", "PATCH", { action: "quantity" }],
    ["/api/auth/login", "POST", {}], ["/api/export-jobs/job", "GET", {}],
  ] as const) assert.equal(aiRequestDescription(url, method, JSON.stringify(data)), null);
  assert.equal(aiRequestDescription("/api/quotes/quote", "PATCH", "null"), null);
});

test("export labels and identities distinguish each document type and its source", () => {
  assert.equal(exportTaskDescription("/api/quotes/a/export?draft=1").key, "export:estimate_draft:a");
  assert.equal(exportTaskDescription("/api/quotes/a/export").key, "export:estimate:a");
  assert.equal(exportTaskDescription("/api/contracts/b/file").key, "export:contract:b");
  assert.equal(exportTaskDescription("/api/acceptance-records/c/file").key, "export:acceptance:c");
  assert.equal(exportTaskDescription("/api/acceptance-records/c/settlement/file").key, "export:settlement:c");
  assert.equal(exportTaskDescription("/api/budget-plans/d/export").key, "export:budget:d");
});

test("estimated progress is monotonic, remains below 100 during long waits and finishes only on success", () => {
  let now = 0;
  const timers: Array<() => void> = [];
  const store = createAiProgressStore({ now: () => now, schedule: (callback) => { timers.push(callback); return () => {}; } });
  const task = store.begin({ label: "Đang tính" });
  assert.equal(store.getSnapshot()[0].progress, 3);
  now = 45_000; store.tick();
  const halfway = store.getSnapshot()[0].progress;
  assert.ok(halfway > 30 && halfway < 94);
  task.update(12, "Đang xử lý");
  assert.ok(store.getSnapshot()[0].progress >= halfway);
  now = 3_600_000; store.tick();
  assert.equal(store.getSnapshot()[0].progress, 94);
  store.dismiss(store.getSnapshot()[0].id);
  assert.equal(store.getSnapshot().length, 1);
  task.complete();
  assert.equal(store.getSnapshot()[0].progress, 100);
  assert.equal(store.getSnapshot()[0].status, "completed");
  timers[0]();
  assert.equal(store.getSnapshot().length, 0);
});

test("repeated job polls do not restart the progress clock or create duplicate tasks", () => {
  let now = 0;
  const store = createAiProgressStore({ now: () => now });
  const first = store.begin({ key: "export:one", label: "Đang tạo file" });
  first.update(30, "Đang xử lý");
  now = 30_000; store.tick();
  const before = store.getSnapshot()[0];
  store.begin({ key: "export:one", label: "Đang tạo file" }).update(30, "Đang xử lý");
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].stageStartedAt, 0);
  now = 60_000; store.tick();
  assert.ok(store.getSnapshot()[0].progress > before.progress);
  store.reset();
});

test("one completed concurrent task does not dismiss other work and failures never become 100%", () => {
  const store = createAiProgressStore({ schedule: () => () => {} });
  const first = store.begin({ label: "Một" });
  const second = store.begin({ label: "Hai" });
  first.complete();
  assert.equal(store.getSnapshot().filter((task) => task.status === "running").length, 1);
  second.fail(new Error("OpenRouter HTTP 402: insufficient credits"));
  const failure = store.getSnapshot().find((task) => task.status === "failed")!;
  assert.ok(failure.progress < 100);
  assert.doesNotMatch(failure.detail, /OpenRouter|402|credits/);
  store.dismiss(failure.id);
  assert.ok(!store.getSnapshot().some((task) => task.status === "failed"));
  store.reset();
});

test("AI API requests show running progress until their response arrives", async (t) => {
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((next) => { resolve = next; }));
  const result = api("/api/budget-plans/suggest", { method: "POST", body: JSON.stringify({ description: "50 m²" }) });
  assert.equal(aiProgress.getSnapshot()[0].status, "running");
  assert.ok(aiProgress.getSnapshot()[0].progress < 100);
  resolve(Response.json({ id: "plan", result: {} }));
  await result;
  assert.equal(aiProgress.getSnapshot()[0].status, "completed");
  assert.equal(aiProgress.getSnapshot()[0].progress, 100);
});

test("API and network failures stop progress and preserve actionable errors", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Dự toán còn thiếu mức VAT." }, { status: 422 }));
  await assert.rejects(api("/api/quotes/a", { method: "PATCH", body: JSON.stringify({ recalculateWithAi: true }) }), /còn thiếu/);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
  assert.match(aiProgress.getSnapshot()[0].detail, /còn thiếu/);
  mock.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api("/api/customer-quotes/suggest", { method: "POST" }), /kiểm tra mạng/);
  assert.equal(aiProgress.getSnapshot().length, 1);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
  assert.ok(aiProgress.getSnapshot()[0].progress < 100);
});

test("ordinary reads and saving quantities do not show the AI popup", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ items: [], quote: {} }));
  await api("/api/catalog");
  await api("/api/quotes/a", { method: "PATCH", body: JSON.stringify({ items: [] }) });
  assert.equal(aiProgress.getSnapshot().length, 0);
});

test("queued file creation stays running through polling and completes only with a saved file ID", async (t) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (callback: () => void) => { queueMicrotask(callback); return 0; } } });
  t.after(() => { if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    assert.equal(aiProgress.getSnapshot()[0].status, "running");
    assert.ok(aiProgress.getSnapshot()[0].progress < 100);
    return calls === 1 ? Response.json({ jobId: "job" }, { status: 202 })
      : calls === 2 ? Response.json({ job: { status: "queued" } })
      : calls === 3 ? Response.json({ job: { status: "running" } })
      : Response.json({ job: { status: "completed", fileId: "saved-file", filename: "hồ sơ.xlsx" } });
  });
  const file = await createGeneratedExport("/api/acceptance-records/record/settlement/file?background=1");
  assert.equal(file.id, "saved-file");
  assert.equal(calls, 4);
  assert.equal(aiProgress.getSnapshot()[0].key, "export:settlement:record");
  assert.equal(aiProgress.getSnapshot()[0].progress, 100);
});

test("customer quote creation keeps the popup open after the HTTP response until its background file is saved", async (t) => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ quote: { _id: "customer" } }, { status: 201 }) : new Promise<Response>((next) => { resolve = next; }));
  await api("/api/customer-quotes", { method: "POST", body: "{}" });
  assert.equal(calls, 2);
  assert.equal(aiProgress.getSnapshot()[0].status, "running");
  resolve(Response.json({ file: { id: "saved" }, job: { status: "completed" } }));
  await flush();
  assert.equal(aiProgress.getSnapshot()[0].status, "completed");
});

test("opening a queued customer export resumes progress and a failed job shows a clean error", async (t) => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ file: null, job: { id: "job", status: "running" } }) : new Promise<Response>((next) => { resolve = next; }));
  await getLatestGeneratedFile("customer", "customer_quote");
  assert.equal(aiProgress.getSnapshot()[0].key, "export:customer_quote:customer");
  resolve(Response.json({ file: null, job: { status: "failed", error: "OpenRouter bodyKeys=private HTTP 402" } }));
  await flush();
  const task = aiProgress.getSnapshot()[0];
  assert.equal(task.status, "failed");
  assert.doesNotMatch(task.detail, /OpenRouter|private|bodyKeys|402/);
});

test("uploading 100% of bytes does not finish AI file processing", async (t) => {
  class UploadRequest extends EventTarget {
    static latest: UploadRequest;
    upload = new EventTarget();
    withCredentials = false;
    status = 200;
    responseText = JSON.stringify({ imported: { inserted: 2 } });
    constructor() { super(); UploadRequest.latest = this; }
    open() {}
    setRequestHeader() {}
    send() {}
    getResponseHeader() { return "application/json"; }
  }
  const oldRequest = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: UploadRequest });
  t.after(() => { if (oldRequest) Object.defineProperty(globalThis, "XMLHttpRequest", oldRequest); else Reflect.deleteProperty(globalThis, "XMLHttpRequest"); });
  let uploaded = 0;
  const result = apiUploadWithProgress("/api/price-list", new Blob(["data"]), {}, (value) => { uploaded = value; });
  const request = UploadRequest.latest;
  request.upload.dispatchEvent(Object.assign(new Event("progress"), { lengthComputable: true, loaded: 100, total: 100 }));
  assert.equal(uploaded, 100);
  assert.equal(aiProgress.getSnapshot()[0].status, "running");
  assert.equal(aiProgress.getSnapshot()[0].progress, 35);
  request.dispatchEvent(new Event("load"));
  await result;
  assert.equal(aiProgress.getSnapshot()[0].progress, 100);
});

test("missing saved files and polling timeouts fail without reporting 100%", async (t) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (callback: () => void) => { queueMicrotask(callback); return 0; } } });
  t.after(() => { if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); });
  let calls = 0;
  const mock = t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ jobId: "job" }, { status: 202 }) : Response.json({ job: { status: "completed" } }));
  await assert.rejects(createGeneratedExport("/api/contracts/a/file?background=1"), /chưa sẵn sàng/);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
  assert.ok(aiProgress.getSnapshot()[0].progress < 100);
  mock.mock.mockImplementation(async () => Response.json({ jobId: "job" }, { status: 202 }));
  await assert.rejects(createGeneratedExport("/api/contracts/a/file?background=1", 0), /vẫn đang xử lý/);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
  assert.ok(aiProgress.getSnapshot()[0].progress < 100);
});

test("aborted uploads stop progress and surface a retryable message", async (t) => {
  class UploadRequest extends EventTarget {
    static latest: UploadRequest;
    upload = new EventTarget();
    constructor() { super(); UploadRequest.latest = this; }
    open() {}
    setRequestHeader() {}
    send() {}
  }
  const oldRequest = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: UploadRequest });
  t.after(() => { if (oldRequest) Object.defineProperty(globalThis, "XMLHttpRequest", oldRequest); else Reflect.deleteProperty(globalThis, "XMLHttpRequest"); });
  const result = apiUploadWithProgress("/api/price-list", new Blob(["data"]), {}, () => {});
  UploadRequest.latest.dispatchEvent(new Event("abort"));
  await assert.rejects(result, /đã bị hủy/);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
});

test("malformed customer quote responses do not finish or start a background watcher", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}); });
  await assert.rejects(api("/api/customer-quotes", { method: "POST", body: "{}" }), /Chưa nhận được báo giá/);
  assert.equal(calls, 1);
  assert.equal(aiProgress.getSnapshot()[0].status, "failed");
});

test("logout clears progress and detaches background watchers", async (t) => {
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", async (input) => String(input).includes("/generated-export-files/") ? new Promise<Response>((next) => { resolve = next; })
    : String(input).endsWith("/logout") ? new Response(null, { status: 204 }) : Response.json({ quote: { _id: "customer" } }));
  await api("/api/customer-quotes", { method: "POST", body: "{}" });
  assert.equal(aiProgress.getSnapshot()[0].status, "running");
  await api("/api/auth/logout", { method: "POST" });
  assert.equal(aiProgress.getSnapshot().length, 0);
  resolve(Response.json({ job: { status: "completed" }, file: { id: "old-account-file" } }));
  await flush();
  assert.equal(aiProgress.getSnapshot().length, 0);
});
