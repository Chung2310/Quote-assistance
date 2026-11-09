import { userMessage } from "./user-message";

export type AiTask = {
  id: number;
  key?: string;
  label: string;
  detail: string;
  progress: number;
  status: "running" | "completed" | "failed";
  startedAt: number;
  stageStartedAt: number;
  stageProgress: number;
  estimated: boolean;
};
export type AiTaskDescription = { label: string; detail?: string; key?: string };
export type AiTaskHandle = { update: (progress: number, detail: string) => void; complete: () => void; fail: (error: unknown) => void; active: () => boolean };

export function createAiProgressStore(options: { now?: () => number; schedule?: (callback: () => void, delay: number) => () => void } = {}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delay) => { const timer = globalThis.setTimeout(callback, delay); return () => globalThis.clearTimeout(timer); });
  let nextId = 0;
  let tasks: AiTask[] = [];
  const listeners = new Set<() => void>();
  const completions = new Map<number, () => void>();
  const publish = (next: AiTask[]) => { tasks = next; listeners.forEach((listener) => listener()); };
  const remove = (id: number) => {
    completions.get(id)?.();
    completions.delete(id);
    publish(tasks.filter((task) => task.id !== id));
  };
  const begin = (description: AiTaskDescription): AiTaskHandle => {
    const existing = description.key ? tasks.find((task) => task.key === description.key && task.status === "running") : undefined;
    const id = existing?.id ?? ++nextId;
    if (!existing) {
      for (const task of tasks) if (task.status !== "running") { completions.get(task.id)?.(); completions.delete(task.id); }
      publish([...tasks.filter((task) => task.status === "running"), {
        id, ...description, detail: description.detail ?? "Đang xử lý yêu cầu…", progress: 3, stageProgress: 3,
        startedAt: now(), stageStartedAt: now(), status: "running", estimated: true,
      }]);
    }
    const change = (update: (task: AiTask) => AiTask) => {
      if (tasks.some((task) => task.id === id && task.status === "running")) publish(tasks.map((task) => task.id === id ? update(task) : task));
    };
    return {
      active: () => tasks.some((task) => task.id === id && task.status === "running"),
      update: (progress, detail) => change((task) => {
        if (detail === task.detail && progress <= task.stageProgress) return task;
        const value = Math.max(task.progress, Math.min(94, Math.max(0, Number.isFinite(progress) ? Math.round(progress) : 0)));
        return { ...task, progress: value, detail, stageProgress: value, stageStartedAt: now() };
      }),
      complete: () => {
        if (!tasks.some((task) => task.id === id && task.status === "running")) return;
        change((task) => ({ ...task, progress: 100, estimated: false, status: "completed", detail: "Đã hoàn tất." }));
        completions.set(id, schedule(() => remove(id), 800));
      },
      fail: (error) => change((task) => ({ ...task, status: "failed", detail: userMessage(error, "Chưa hoàn tất yêu cầu. Vui lòng thử lại.") })),
    };
  };
  return {
    begin,
    getSnapshot: () => tasks,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    tick: () => {
      let changed = false;
      const next = tasks.map((task) => {
        if (task.status !== "running") return task;
        const elapsed = Math.max(0, now() - task.stageStartedAt);
        const progress = Math.max(task.progress, Math.min(94, Math.floor(task.stageProgress + (95 - task.stageProgress) * (1 - Math.exp(-elapsed / 45_000)))));
        if (progress === task.progress) return task;
        changed = true;
        return { ...task, progress };
      });
      if (changed) publish(next);
    },
    dismiss: (id: number) => { if (tasks.find((task) => task.id === id)?.status !== "running") remove(id); },
    reset: () => { completions.forEach((cancel) => cancel()); completions.clear(); publish([]); },
  };
}

export const aiProgress = createAiProgressStore();

export function exportTaskDescription(url: string): AiTaskDescription {
  const parsed = new URL(url, "http://app.local");
  const path = parsed.pathname;
  const source = path.split("/")[3] ?? "";
  if (/^\/api\/contracts\//.test(path)) return { key: `export:contract:${source}`, label: "Đang tạo file hợp đồng" };
  if (/^\/api\/acceptance-records\//.test(path)) return /\/settlement(?:\/|\.)/.test(path)
    ? { key: `export:settlement:${source}`, label: "Đang tạo file quyết toán" }
    : { key: `export:acceptance:${source}`, label: "Đang tạo file nghiệm thu" };
  if (/^\/api\/budget-plans\//.test(path)) return { key: `export:budget:${source}`, label: "Đang tạo file phương án ngân sách" };
  if (/\/export\/retry$/.test(path)) return { key: `export:customer_quote:${source}`, label: "Đang tạo file báo giá khách" };
  return { key: source ? `export:${parsed.searchParams.get("draft") === "1" ? "estimate_draft" : "estimate"}:${source}` : undefined, label: "Đang tạo file dự toán" };
}

export function aiRequestDescription(url: string, method = "GET", body?: BodyInit | null): AiTaskDescription | null {
  const path = new URL(url, "http://app.local").pathname;
  let data: Record<string, unknown> = {};
  if (typeof body === "string") {
    try { const parsed: unknown = JSON.parse(body); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>; }
    catch { /* Let the request report invalid input. */ }
  }
  if (method === "POST" && /^\/api\/quote-requests\/[^/]+\/analyze$/.test(path)) return { label: "AI đang phân tích yêu cầu", detail: "Đang đối chiếu nhu cầu với thông tin sản phẩm và bảng giá…" };
  if (method === "POST" && path === "/api/customer-quotes/suggest") return { label: "AI đang gợi ý sản phẩm", detail: "Đang tìm các sản phẩm phù hợp với yêu cầu…" };
  if (method === "POST" && path === "/api/budget-plans/suggest") return { label: "AI đang lập phương án ngân sách", detail: "Đang lựa chọn sản phẩm và tính số lượng theo nhu cầu…" };
  if (method === "PATCH" && /^\/api\/budget-plans\/[^/]+$/.test(path) && ["answer", "recalculate"].includes(String(data.action))) return { label: "AI đang tính lại phương án", detail: "Đang xử lý thông tin bổ sung và cập nhật ngân sách…" };
  if (method === "PATCH" && /^\/api\/quotes\/[^/]+$/.test(path) && data.recalculateWithAi === true) return { label: "AI đang tính lại dự toán", detail: "Đang xử lý yêu cầu và các câu trả lời mới nhất…" };
  if (method === "POST" && path === "/api/quotes/from-customer") return { label: "Đang lập dự toán từ báo giá", detail: "Đang đối chiếu yêu cầu bổ sung và thông tin sản phẩm…" };
  if (method === "POST" && path === "/api/customer-quotes") return { label: "Đang tạo file báo giá khách", detail: "Đang lưu sản phẩm và chuẩn bị điền mẫu báo giá…" };
  if (method === "POST" && /^\/api\/quotes\/[^/]+\/export\/retry$/.test(path)) return exportTaskDescription(url);
  if (method === "GET" && /^\/api\/(?:quotes|contracts|acceptance-records|budget-plans)\/[^/]+\/(?:export|file|docx|settlement\/file|settlement\.xlsx)$/.test(path)) return exportTaskDescription(url);
  if (method === "POST" && path === "/api/price-list") return { label: "Đang đọc và nhập bảng giá", detail: "Đang nhận diện sản phẩm và thông số trong file…" };
  return null;
}
