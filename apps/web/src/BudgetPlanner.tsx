import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, formatMoney } from "./api";
import type { CatalogItem } from "./types";
import "./budget-planner.css";

interface PlanLine {
  catalogItemId: string;
  sku: string;
  name: string;
  unit: string;
  unitPrice: number;
  currency: string;
  quantity: number | null;
  lineTotal: number | null;
  reason: string;
  quantityBasis?: "measured" | "estimated";
  quantityNote?: string;
}

interface PlanResult {
  scope: string;
  budget: number;
  currency: string;
  lines: PlanLine[];
  knownTotal: number | null;
  total: number | null;
  difference: number | null;
  questions: string[];
  missingProducts: string[];
  assumptions: string[];
  scenario?: { area?: number; floors?: number };
  provisional?: boolean;
  clarifications?: Array<{ question: string; answer: string }>;
  assumptionConfirmations?: boolean[];
}

interface SavedPlan {
  id: string;
  input: { description: string; budget: number; area?: number; floors?: number };
  result: PlanResult;
  createdAt: string;
}

const PRESETS = [
  { label: "Lắp PC văn phòng (15 triệu)", desc: "Lắp một bộ PC làm việc văn phòng, có Wi-Fi, RAM 16GB, SSD 500GB; không cần màn hình hoặc phụ kiện.", budget: "15000000" },
  { label: "Lắp PC chơi game (25 triệu)", desc: "Lắp một bộ PC chơi game 1080p, RAM 32GB, SSD 1TB; không cần màn hình hoặc phụ kiện.", budget: "25000000" },
  { label: "Cải tạo phòng ngủ 25m² (60 triệu)", desc: "Cải tạo sửa chữa một phòng ngủ 25m², sơn lại tường, làm trần thạch cao và lát sàn gỗ.", budget: "60000000" },
];

type BudgetIconName = "lightbulb" | "zap" | "package" | "help" | "clipboard" | "check" | "alert" | "close";

function BudgetIcon({ name, size = 16 }: { name: BudgetIconName; size?: number }) {
  let paths: ReactNode = null;
  switch (name) {
    case "lightbulb":
      paths = <><path d="M9 18h6M10 22h4M8.5 14.5a6 6 0 1 1 7 0c-1 .8-1.5 1.5-1.5 2.5h-4c0-1-.5-1.7-1.5-2.5Z" /></>;
      break;
    case "zap":
      paths = <path d="m13 2-3 8h7l-6 12 1.5-9H6l7-11Z" />;
      break;
    case "package":
      paths = <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m12 12 8-4.5M12 12 4 7.5M12 12v9M8 5.25l8 4.5" /></>;
      break;
    case "help":
      paths = <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 4.1 1.7c-1.1 1-1.8 1.4-1.8 2.8" /><path d="M12 17h.01" /></>;
      break;
    case "clipboard":
      paths = <><rect x="5" y="4" width="14" height="18" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M8 11h8M8 15h8M8 18h5" /></>;
      break;
    case "check":
      paths = <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>;
      break;
    case "alert":
      paths = <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>;
      break;
    case "close":
      paths = <path d="m6 6 12 12M18 6 6 18" />;
      break;
  }

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

export default function BudgetPlanner() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "view" | null>(null);
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [history, setHistory] = useState<SavedPlan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [saving, setSaving] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assumptionEdits, setAssumptionEdits] = useState<Record<number, string>>({});
  const [missingSelections, setMissingSelections] = useState<Record<string, string>>({});
  const [missingQuantities, setMissingQuantities] = useState<Record<string, string>>({});
  const [newProducts, setNewProducts] = useState<Record<string, { sku: string; name: string; unit: string; price: string }>>({});
  const [updateNotice, setUpdateNotice] = useState("");

  // Filters & search
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "in_budget" | "over_budget">("all");

  useEffect(() => {
    if (!dialogMode) return;
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dialogMode]);

  const closeDialog = () => {
    if (busy) return;
    setDialogMode(null);
    window.history.replaceState(null, "", "/tu-van-ngan-sach");
  };

  const resetEdits = () => {
    setUpdateNotice("");
    setQuantities({});
    setAnswers({});
    setAssumptionEdits({});
    setMissingSelections({});
    setMissingQuantities({});
    setNewProducts({});
  };

  const openCreate = () => {
    resetEdits();
    setDescription("");
    setBudget("");
    setResult(null);
    setSelectedId(null);
    setError("");
    window.history.replaceState(null, "", "/tu-van-ngan-sach");
    setDialogMode("create");
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setDescription(preset.desc);
    setBudget(preset.budget);
  };

  useEffect(() => {
    let live = true;
    api<{ plans: SavedPlan[] }>("/api/budget-plans")
      .then(({ plans }) => {
        if (!live) return;
        setHistory(plans);
        const requestedId = new URLSearchParams(window.location.search).get("plan");
        const selected = plans.find((plan) => plan.id === requestedId);
        if (selected) {
          setSelectedId(selected.id);
          setResult(selected.result);
          setDescription(selected.input.description);
          setBudget(String(selected.input.budget));
          setDialogMode("view");
        }
      })
      .catch((cause) => {
        if (live) setHistoryError(cause instanceof Error ? cause.message : "Không tải được lịch sử phương án.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (dialogMode !== "view") return;
    let live = true;
    api<{ items: CatalogItem[] }>("/api/catalog")
      .then(({ items }) => { if (live) setCatalog(items.filter((item) => item.active)); })
      .catch(() => { if (live) setCatalog([]); });
    return () => { live = false; };
  }, [dialogMode]);

  const openSaved = (plan: SavedPlan) => {
    resetEdits();
    window.history.replaceState(null, "", `/tu-van-ngan-sach?plan=${plan.id}`);
    setSelectedId(plan.id);
    setResult(plan.result);
    setError("");
    setDescription(plan.input.description);
    setBudget(String(plan.input.budget));
    setDialogMode("view");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const saved = await api<SavedPlan>("/api/budget-plans/suggest", {
        method: "POST",
        body: JSON.stringify({
          description: description.trim(),
          budget: Number(budget),
        }),
      });
      setResult(saved.result);
      resetEdits();
      setSelectedId(saved.id);
      window.history.replaceState(null, "", `/tu-van-ngan-sach?plan=${saved.id}`);
      setHistory((plans) => [saved, ...plans.filter((plan) => plan.id !== saved.id)].slice(0, 30));
      setDialogMode("view");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo phương án sơ bộ.");
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    if (!selectedId || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/budget-plans/${selectedId}/export`, { credentials: "include" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Không xuất được phương án Excel.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `phuong-an-${selectedId}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xuất được phương án Excel.");
    } finally {
      setExporting(false);
    }
  };

  const saveEdit = async (key: string, change: Record<string, unknown>) => {
    if (!selectedId || saving) return;
    setSaving(key);
    setError("");
    setUpdateNotice("");
    try {
      const saved = await api<SavedPlan>(`/api/budget-plans/${selectedId}`, { method: "PATCH", body: JSON.stringify(change) });
      setResult(saved.result);
      setHistory((plans) => plans.map((plan) => plan.id === saved.id ? saved : plan));
      if (change.action === "answer" || change.action === "recalculate") setUpdateNotice(saved.result.difference === null
        ? "Đã tính lại phương án. Hãy xử lý các mục còn thiếu để chốt chênh lệch ngân sách."
        : "Đã cập nhật sản phẩm, số lượng và chênh lệch ngân sách.");
      if (change.action === "missing" && change.newProduct) {
        api<{ items: CatalogItem[] }>("/api/catalog")
          .then(({ items }) => setCatalog(items.filter((item) => item.active)))
          .catch(() => {});
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được thay đổi.");
    } finally {
      setSaving("");
    }
  };

  // KPI Calculations
  const stats = useMemo(() => {
    const total = history.length;
    const inBudget = history.filter((p) => p.result.difference !== null && p.result.difference >= 0).length;
    const overBudget = history.filter((p) => p.result.difference !== null && p.result.difference < 0).length;
    const totalBudget = history.reduce((sum, p) => sum + (p.input.budget || 0), 0);
    const avgBudget = total > 0 ? Math.round(totalBudget / total) : 0;
    return { total, inBudget, overBudget, totalBudget, avgBudget };
  }, [history]);

  // Filtered plans
  const filteredPlans = useMemo(() => {
    return history.filter((plan) => {
      const isOver = plan.result.difference !== null && plan.result.difference < 0;
      if (filterType === "in_budget" && (plan.result.difference === null || isOver)) return false;
      if (filterType === "over_budget" && !isOver) return false;

      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const matchScope = (plan.result.scope || "").toLowerCase().includes(term);
      const matchDesc = (plan.input.description || "").toLowerCase().includes(term);
      const matchId = plan.id.toLowerCase().includes(term);
      const matchBudget = String(plan.input.budget).includes(term);
      return matchScope || matchDesc || matchId || matchBudget;
    });
  }, [history, filterType, search]);

  return (
    <div className="budget-page">
      {/* Header Hero Banner */}
      <section className="bp-header-banner">
        <div className="bp-header-copy">
          <h1>Tư vấn Ngân sách & Đề xuất Hạng mục</h1>
        </div>
        <div className="bp-header-actions">
          <button type="button" className="bp-create-btn" onClick={openCreate}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Tạo tư vấn ngân sách mới</span>
          </button>
        </div>
      </section>

      {/* KPI Metrics Grid */}
      <section className="bp-kpi-grid">
        <div className="bp-kpi-card">
          <div className="bp-kpi-top">
            <span className="bp-kpi-label">Tổng phương án</span>
            <div className="bp-kpi-icon tone-blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          </div>
          <div className="bp-kpi-body">
            <span className="bp-kpi-value">{stats.total}</span>
            <span className="bp-kpi-sub">Tổng ngân sách: {formatMoney(stats.totalBudget, "VND")}</span>
          </div>
        </div>

        <div className="bp-kpi-card">
          <div className="bp-kpi-top">
            <span className="bp-kpi-label">Trong ngân sách</span>
            <div className="bp-kpi-icon tone-green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="bp-kpi-body">
            <span className="bp-kpi-value" style={{ color: "#16a34a" }}>{stats.inBudget}</span>
            <span className="bp-kpi-sub">Phương án tối ưu, chi phí hợp lý</span>
          </div>
        </div>

        <div className="bp-kpi-card">
          <div className="bp-kpi-top">
            <span className="bp-kpi-label">Vượt ngân sách</span>
            <div className="bp-kpi-icon tone-amber">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
          </div>
          <div className="bp-kpi-body">
            <span className="bp-kpi-value" style={{ color: "#d97706" }}>{stats.overBudget}</span>
            <span className="bp-kpi-sub">Cần điều chỉnh khối lượng hoặc quy mô</span>
          </div>
        </div>

        <div className="bp-kpi-card">
          <div className="bp-kpi-top">
            <span className="bp-kpi-label">Ngân sách TB</span>
            <div className="bp-kpi-icon tone-purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
          </div>
          <div className="bp-kpi-body">
            <span className="bp-kpi-value">
              {formatMoney(stats.avgBudget, "VND")}
            </span>
            <span className="bp-kpi-sub">Mức đầu tư trung bình mỗi dự án</span>
          </div>
        </div>
      </section>

      {/* Main Content: Plans History */}
      <section className="bp-content-card">
        {/* Toolbar */}
        <div className="bp-toolbar">
          <div className="bp-search-box">
            <svg className="bp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="bp-search-input"
              placeholder="Tìm theo mô tả dự án, mã phương án, mức ngân sách..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="bp-filter-pills">
            <button
              type="button"
              className={`bp-filter-btn ${filterType === "all" ? "active" : ""}`}
              onClick={() => setFilterType("all")}
            >
              Tất cả <span className="bp-filter-count">{history.length}</span>
            </button>
            <button
              type="button"
              className={`bp-filter-btn ${filterType === "in_budget" ? "active" : ""}`}
              onClick={() => setFilterType("in_budget")}
            >
              Trong ngân sách <span className="bp-filter-count">{stats.inBudget}</span>
            </button>
            <button
              type="button"
              className={`bp-filter-btn ${filterType === "over_budget" ? "active" : ""}`}
              onClick={() => setFilterType("over_budget")}
            >
              Vượt ngân sách <span className="bp-filter-count">{stats.overBudget}</span>
            </button>
          </div>
        </div>

        {/* History Error if any */}
        {historyError && (
          <div style={{ margin: 20, padding: 14, background: "#fef2f2", color: "#b91c1c", borderRadius: 8 }}>
            {historyError}
          </div>
        )}

        {/* Plans Grid */}
        {filteredPlans.length === 0 ? (
          <div className="bp-empty-state">
            <div className="bp-empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
              </svg>
            </div>
            <h3>{history.length === 0 ? "Chưa có phương án tư vấn nào" : "Không tìm thấy phương án phù hợp"}</h3>
            <p>
              {history.length === 0
                ? "Bắt đầu với AI Trợ lý để lập phương án danh mục sản phẩm và dự toán tối ưu theo ngân sách."
                : "Thử tìm kiếm với từ khóa khác hoặc chuyển sang chế độ xem tất cả phương án."}
            </p>
            {history.length === 0 && (
              <button type="button" className="bp-create-btn" onClick={openCreate} style={{ marginTop: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Tạo phương án tư vấn đầu tiên</span>
              </button>
            )}
          </div>
        ) : (
          <div className="bp-plans-grid">
            {filteredPlans.map((plan) => {
              const diff = plan.result.difference;
              const isOver = diff !== null && diff < 0;
              const calculatedTotal = plan.result.total ?? plan.result.knownTotal ?? 0;
              const budgetRatio = plan.input.budget > 0 ? (calculatedTotal / plan.input.budget) * 100 : 0;
              const safeProgress = Math.min(Math.round(budgetRatio), 100);

              return (
                <div
                  key={plan.id}
                  className="bp-plan-card"
                  onClick={() => openSaved(plan)}
                >
                  <div className="bp-plan-card-top">
                    <span className="bp-plan-id-badge">
                      #{plan.id.slice(-6).toUpperCase()}
                    </span>
                    <span className="bp-plan-date">
                      {new Date(plan.createdAt).toLocaleDateString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <h3 className="bp-plan-scope">
                    {plan.result.scope || plan.input.description}
                  </h3>

                  <div className="bp-plan-tags">
                    <span className="bp-plan-tag">
                      <BudgetIcon name="package" size={14} /> {plan.result.lines.length} sản phẩm
                    </span>
                  </div>

                  <div className="bp-plan-financials">
                    <div className="bp-plan-fin-row">
                      <span>Ngân sách dự kiến:</span>
                      <strong>{formatMoney(plan.input.budget, "VND")}</strong>
                    </div>

                    <div className="bp-plan-fin-row">
                      <span>Tạm tính đề xuất:</span>
                      <strong style={{ color: isOver ? "#dc2626" : "#0f172a" }}>
                        {formatMoney(calculatedTotal, plan.result.currency || "VND")}
                      </strong>
                    </div>

                    <div className="bp-plan-progress-track">
                      <div
                        className={`bp-plan-progress-bar ${isOver ? "over" : "ok"}`}
                        style={{ width: `${safeProgress}%` }}
                      />
                    </div>
                  </div>

                  <div className="bp-plan-card-footer">
                    <span className={`bp-plan-diff-badge ${diff === null ? "pending" : isOver ? "over-budget" : "in-budget"}`}>
                      {diff === null
                        ? "Cần hoàn thiện"
                        : isOver
                          ? <><BudgetIcon name="alert" size={13} /> Vượt {formatMoney(-diff, "VND")}</>
                          : <><BudgetIcon name="check" size={13} /> Còn {formatMoney(diff, "VND")}</>}
                    </span>

                    <span className="bp-view-link">
                      <span>Xem phương án</span>
                      <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Dialog Modal: Create or View */}
      {dialogMode && (
        <dialog
          ref={dialog}
          className="budget-dialog"
          aria-labelledby="budget-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
        >
          {/* Dialog Header */}
          <header className="bp-dialog-header">
            <div className="bp-dialog-title-group">
              <div className="bp-dialog-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
                </svg>
              </div>
              <div>
                <h2 id="budget-dialog-title">
                  {dialogMode === "create" ? "Tạo Phương Án Tư Vấn Theo Ngân Sách" : "Chi Tiết Phương Án Đề Xuất"}
                </h2>
                <p>
                  {dialogMode === "create"
                    ? "Mô tả mục tiêu và ngân sách để nhận gợi ý sản phẩm phù hợp từ bảng giá."
                    : "Phương án tính toán sơ bộ đã được AI đề xuất và lưu trữ."}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="bp-dialog-close"
              aria-label="Đóng popup tư vấn"
              disabled={busy}
              onClick={closeDialog}
            >
              <BudgetIcon name="close" size={18} />
            </button>
          </header>

          {/* Dialog Body */}
          <div className="bp-dialog-body">
            {error && (
              <div style={{ padding: 12, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>
                {error}
              </div>
            )}
            {updateNotice && dialogMode === "view" && <div className="bp-update-notice" role="status">{updateNotice}</div>}

            {/* CREATE MODE */}
            {dialogMode === "create" && (
              <form className="bp-create-form" onSubmit={(event) => void submit(event)}>
                {/* Presets */}
                <div className="bp-presets-row">
                  <span className="bp-presets-label"><BudgetIcon name="lightbulb" size={15} /> Chọn nhanh kịch bản gợi ý mẫu:</span>
                  <div className="bp-presets-chips">
                    {PRESETS.map((preset, idx) => (
                      <button
                        type="button"
                        key={idx}
                        className="bp-preset-chip"
                        onClick={() => applyPreset(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div className="bp-form-group">
                  <label htmlFor="budget-description">
                    <span>1. Mô tả nhu cầu *</span>
                  </label>
                  <div className="bp-input-wrap">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ top: 14 }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <textarea
                      id="budget-description"
                      required
                      maxLength={3000}
                      rows={4}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Ví dụ: Lắp một bộ PC chơi game 1080p với RAM 32GB và SSD 1TB; hoặc cải tạo phòng ngủ 25m²."
                    />
                  </div>
                </div>

                {/* Parameters Grid */}
                <div className="bp-fields-grid">
                  <div className="bp-form-group">
                    <label>
                      <span>2. Ngân sách dự kiến (VND) *</span>
                    </label>
                    <div className="bp-input-wrap">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                      <input
                        required
                        type="number"
                        min="1"
                        max="1000000000000"
                        step="1"
                        value={budget}
                        onChange={(event) => setBudget(event.target.value)}
                        placeholder="Ví dụ: 100000000"
                      />
                    </div>
                  </div>

                </div>

                <div className="bp-ai-hint-box">
                  <span className="bp-ai-hint-icon"><BudgetIcon name="lightbulb" size={19} /></span>
                  <div>
                    <strong>Cơ chế tư vấn tự động của AI:</strong> Hệ thống sẽ so khớp yêu cầu với bảng giá hiện có của doanh nghiệp, tính toán định mức khối lượng ước tính và cân đối các hạng mục để đạt mức chi phí tối ưu nhất so với ngân sách bạn đã đặt ra.
                  </div>
                </div>

                <div className="bp-dialog-footer" style={{ padding: "16px 0 0", background: "transparent" }}>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={
                      busy ||
                      !description.trim() ||
                      !Number.isFinite(Number(budget)) ||
                      Number(budget) <= 0
                    }
                  >
                    {busy ? <span className="spinner" /> : <BudgetIcon name="zap" size={16} />}
                    <span>{busy ? "AI đang lập phương án…" : "Phân tích & Đề xuất phương án"}</span>
                  </button>
                </div>
              </form>
            )}

            {/* VIEW MODE */}
            {dialogMode === "view" && result && (
              <div className="bp-result-container" aria-live="polite">
                {/* Header Card */}
                <div className="bp-result-header-card">
                  <div className="bp-result-header-top">
                    <div>
                      <h3 className="bp-result-scope">{result.scope}</h3>
                      {selectedId && (
                        <span style={{ fontSize: 12, color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                          Mã phương án: #{selectedId.slice(-8).toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="bp-result-header-actions">
                      <span
                        className={`bp-plan-diff-badge ${result.difference === null ? "pending" : result.difference < 0 ? "over-budget" : "in-budget"}`}
                        style={{ fontSize: 12, padding: "5px 12px" }}
                      >
                        {result.difference === null
                          ? "Cần hoàn thiện"
                          : result.difference < 0
                            ? <><BudgetIcon name="alert" size={13} /> Vượt ngân sách {formatMoney(-result.difference, "VND")}</>
                            : <><BudgetIcon name="check" size={13} /> Trong ngân sách (Dư {formatMoney(result.difference, "VND")})</>}
                      </span>

                      <button
                        type="button"
                        className="button button-primary button-compact"
                        disabled={!selectedId || Boolean(saving) || exporting}
                        onClick={() => void saveEdit("recalculate", { action: "recalculate" })}
                      >
                        {saving === "recalculate" ? "Đang tính lại…" : "Tính lại phương án"}
                      </button>

                      <button
                        type="button"
                        className="button button-soft button-compact"
                        disabled={!selectedId || exporting || Boolean(saving)}
                        onClick={() => void exportExcel()}
                      >
                        {exporting ? "Đang xuất…" : "Xuất Excel"}
                      </button>

                      <button
                        type="button"
                        className="button button-soft button-compact"
                        onClick={openCreate}
                      >
                        + Tạo phương án khác
                      </button>
                    </div>
                  </div>

                </div>

                {/* Financial KPI Strip */}
                <div className="bp-result-kpi-grid">
                  <div className="bp-result-kpi-box">
                    <span className="bp-result-kpi-label">Ngân sách dự kiến</span>
                    <span className="bp-result-kpi-value">
                      {formatMoney(result.budget, "VND")}
                    </span>
                  </div>

                  <div className="bp-result-kpi-box highlight">
                    <span className="bp-result-kpi-label">Tạm tính đề xuất</span>
                    <span className="bp-result-kpi-value">
                      {result.total !== null
                        ? formatMoney(result.total, result.currency)
                        : result.knownTotal !== null
                          ? formatMoney(result.knownTotal, result.currency)
                          : "Chưa tính được"}
                    </span>
                  </div>

                  <div className="bp-result-kpi-box">
                    <span className="bp-result-kpi-label">Chênh lệch ngân sách</span>
                    <span
                      className="bp-result-kpi-value"
                      style={{
                        color:
                          result.difference !== null && result.difference < 0
                            ? "#dc2626"
                            : "#16a34a",
                      }}
                    >
                      {result.difference === null
                        ? "—"
                        : result.difference < 0
                          ? `Vượt ${formatMoney(-result.difference, "VND")}`
                          : `Còn ${formatMoney(result.difference, "VND")}`}
                    </span>
                  </div>

                  <div className="bp-result-kpi-box">
                    <span className="bp-result-kpi-label">Hạng mục đề xuất</span>
                    <span className="bp-result-kpi-value">
                      {result.lines.length} dòng
                    </span>
                  </div>
                </div>

                {/* Visual Budget Progress Bar */}
                {result.budget > 0 && (
                  <div className="bp-budget-bar-card">
                    <div className="bp-budget-bar-labels">
                      <span style={{ fontWeight: 700, color: "#1e293b" }}>
                        Mức sử dụng ngân sách của hạng mục đã chọn:
                      </span>
                      <span style={{ fontWeight: 800, color: result.difference !== null && result.difference < 0 ? "#dc2626" : "#0284c7" }}>
                        {result.total !== null
                          ? `${result.provisional || result.missingProducts.length || result.questions.length ? "~" : ""}${Math.round((result.total / result.budget) * 100)}%${result.provisional || result.missingProducts.length || result.questions.length ? " (tạm tính)" : ""}`
                          : result.knownTotal !== null
                            ? `~${Math.round((result.knownTotal / result.budget) * 100)}% (tạm tính)`
                            : "0%"}
                      </span>
                    </div>

                    <div className="bp-budget-meter">
                      <div
                        className={`bp-budget-meter-fill ${result.difference !== null && result.difference < 0
                          ? "over-budget"
                          : "in-budget"
                          }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              ((result.total ?? result.knownTotal ?? 0) / result.budget) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Table of Recommended Products */}
                <div className="bp-table-card">
                  <div className="bp-table-header">
                    <h3>Danh mục sản phẩm & dịch vụ do AI đề xuất</h3>
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      {result.lines.length} hạng mục phù hợp trong bảng giá
                    </span>
                  </div>

                  {result.lines.length === 0 ? (
                    <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
                      Chưa tìm được sản phẩm đủ phù hợp trong bảng giá hiện có.
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="bp-table">
                        <thead>
                          <tr>
                            <th style={{ width: 44, textAlign: "center" }}>STT</th>
                            <th>Sản phẩm / Dịch vụ</th>
                            <th>ĐVT</th>
                            <th style={{ textAlign: "right" }}>Đơn giá</th>
                            <th style={{ textAlign: "center" }}>Số lượng</th>
                            <th style={{ textAlign: "right" }}>Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.lines.map((line, idx) => (
                            <tr key={line.catalogItemId}>
                              <td style={{ textAlign: "center", color: "#94a3b8", fontWeight: 700 }}>
                                {idx + 1}
                              </td>

                              <td>
                                <div className="bp-item-cell">
                                  <strong>{line.name}</strong>
                                  <small>
                                    Mã: {line.sku} · Lý do: {line.reason}
                                  </small>
                                </div>
                              </td>

                              <td>{line.unit}</td>

                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                {formatMoney(line.unitPrice, line.currency)}
                              </td>

                              <td style={{ textAlign: "center" }}>
                                <div className="bp-inline-edit">
                                  <input
                                    type="number" min="0.01" max="1000000" step="any"
                                    aria-label={`Số lượng ${line.name}`}
                                    placeholder="Số lượng"
                                    value={quantities[line.catalogItemId] ?? line.quantity ?? ""}
                                    onChange={(event) => setQuantities((current) => ({ ...current, [line.catalogItemId]: event.target.value }))}
                                  />
                                  <button type="button" className="button button-soft button-compact"
                                    disabled={Boolean(saving) || !Number.isFinite(Number(quantities[line.catalogItemId] ?? line.quantity)) || Number(quantities[line.catalogItemId] ?? line.quantity) <= 0}
                                    onClick={() => void saveEdit(`quantity-${line.catalogItemId}`, { action: "quantity", catalogItemId: line.catalogItemId, quantity: Number(quantities[line.catalogItemId] ?? line.quantity) })}>
                                    Lưu
                                  </button>
                                </div>
                                {line.quantity === null || line.quantityBasis === "estimated" ? <span className="bp-qty-badge">{line.quantity === null ? "Cần xác định" : "Ước tính"}</span> : null}
                              </td>

                              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                {line.lineTotal === null
                                  ? "—"
                                  : formatMoney(line.lineTotal, line.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Followup Grid: Questions, Missing, Assumptions */}
                <div className="bp-followup-grid">
                  {(result.questions.length > 0 || (result.clarifications?.length ?? 0) > 0) && (
                    <div className="bp-followup-card questions">
                      <h4>
                        <BudgetIcon name="help" size={16} /> Thông tin cần làm rõ thêm:
                      </h4>
                      {result.questions.map((question) => (
                        <div className="bp-followup-item" key={question}>
                          <strong>{question}</strong>
                          <textarea rows={2} maxLength={500} placeholder="Nhập câu trả lời"
                            value={answers[question] ?? ""}
                            onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value }))} />
                          <button type="button" className="button button-soft button-compact" disabled={Boolean(saving) || !answers[question]?.trim()}
                            onClick={() => void saveEdit(`answer-${question}`, { action: "answer", question, answer: answers[question].trim() })}>{saving === `answer-${question}` ? "AI đang tính lại…" : "Lưu và tính lại"}</button>
                        </div>
                      ))}
                      {result.clarifications?.map((entry) => (
                        <div className="bp-followup-item" key={entry.question}>
                          <strong><BudgetIcon name="check" size={14} /> {entry.question}</strong><span>{entry.answer}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.missingProducts.length > 0 && (
                    <div className="bp-followup-card missing">
                      <h4>
                        <BudgetIcon name="package" size={16} /> Chưa có trong bảng giá:
                      </h4>
                      {result.missingProducts.map((name) => {
                        const selection = missingSelections[name] ?? "";
                        const product = newProducts[name] ?? { sku: "", name, unit: "", price: "" };
                        const quantity = missingQuantities[name]?.trim() ? Number(missingQuantities[name]) : null;
                        const validQuantity = quantity === null || (Number.isFinite(quantity) && quantity > 0);
                        return <div className="bp-followup-item" key={name}>
                          <strong>{name}</strong>
                          <select aria-label={`Sản phẩm thay thế cho ${name}`} value={selection}
                            onChange={(event) => setMissingSelections((current) => ({ ...current, [name]: event.target.value }))}>
                            <option value="">Chọn sản phẩm trong bảng giá</option>
                            {catalog.map((item) => <option key={item._id} value={item._id}>{item.sku} · {item.name} · {formatMoney(item.price, item.currency)}</option>)}
                            <option value="__new__">+ Thêm sản phẩm mới</option>
                          </select>
                          {selection === "__new__" && <div className="bp-new-product-fields">
                            <input aria-label="Mã SKU mới" placeholder="Mã SKU" maxLength={80} value={product.sku} onChange={(event) => setNewProducts((current) => ({ ...current, [name]: { ...product, sku: event.target.value } }))} />
                            <input aria-label="Tên sản phẩm mới" placeholder="Tên sản phẩm" maxLength={250} value={product.name} onChange={(event) => setNewProducts((current) => ({ ...current, [name]: { ...product, name: event.target.value } }))} />
                            <input aria-label="Đơn vị tính mới" placeholder="ĐVT" maxLength={40} value={product.unit} onChange={(event) => setNewProducts((current) => ({ ...current, [name]: { ...product, unit: event.target.value } }))} />
                            <input aria-label="Đơn giá mới" type="number" min="0" step="any" placeholder="Đơn giá VND" value={product.price} onChange={(event) => setNewProducts((current) => ({ ...current, [name]: { ...product, price: event.target.value } }))} />
                          </div>}
                          {selection && <>
                            <input aria-label={`Số lượng ${name}`} type="number" min="0.01" step="any" placeholder="Số lượng (có thể bổ sung sau)"
                              value={missingQuantities[name] ?? ""} onChange={(event) => setMissingQuantities((current) => ({ ...current, [name]: event.target.value }))} />
                            <button type="button" className="button button-soft button-compact"
                              disabled={Boolean(saving) || !validQuantity || (selection === "__new__" && (!product.sku.trim() || !product.name.trim() || !product.unit.trim() || product.price === "" || !Number.isFinite(Number(product.price)) || Number(product.price) < 0))}
                              onClick={() => void saveEdit(`missing-${name}`, { action: "missing", name, quantity, ...(selection === "__new__" ? { newProduct: { sku: product.sku.trim(), name: product.name.trim(), unit: product.unit.trim(), price: Number(product.price) } } : { catalogItemId: selection }) })}>
                              {selection === "__new__" ? "Thêm và áp dụng" : "Áp dụng sản phẩm"}
                            </button>
                          </>}
                        </div>;
                      })}
                    </div>
                  )}

                  {result.assumptions.length > 0 && (
                    <div className="bp-followup-card assumptions">
                      <h4>
                        <BudgetIcon name="clipboard" size={16} /> Giả định tính toán của AI:
                      </h4>
                      {result.assumptions.map((assumption, index) => (
                        <div className="bp-followup-item" key={index}>
                          <textarea rows={2} maxLength={250} aria-label={`Giả định ${index + 1}`}
                            value={assumptionEdits[index] ?? assumption}
                            onChange={(event) => setAssumptionEdits((current) => ({ ...current, [index]: event.target.value }))} />
                          <button type="button" className="button button-soft button-compact"
                            disabled={Boolean(saving) || !String(assumptionEdits[index] ?? assumption).trim() || (result.assumptionConfirmations?.[index] === true && (assumptionEdits[index] ?? assumption) === assumption)}
                            onClick={() => void saveEdit(`assumption-${index}`, { action: "assumption", index, text: (assumptionEdits[index] ?? assumption).trim() })}>
                            {result.assumptionConfirmations?.[index] ? "Lưu sửa đổi" : "Xác nhận giả định"}
                          </button>
                          {result.assumptionConfirmations?.[index] && <span className="bp-confirmed-mark"><BudgetIcon name="check" size={13} /> Đã xác nhận</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Caveat Note */}
                <div className="bp-caveat-note">
                  <strong>Lưu ý:</strong> Các khối lượng có nhãn "Ước tính" dựa trên giả định quy mô tiêu chuẩn. Thành tiền được tính theo đơn giá niêm yết trong bảng giá hiện hành. Trước khi ký hợp đồng hoặc thi công, cần khảo sát thực tế để xác nhận lại khối lượng, thuế VAT và chi phí phát sinh (nếu có).
                </div>
              </div>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
