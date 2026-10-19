import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ApiError, api, apiUploadWithProgress, formatDate, formatMoney, responseBlobWithProgress } from "./api";
import type { Analysis, AnalysisItem, CatalogItem, Quote, QuoteRequest, QuoteStatus, SuggestedProduct, SubscriptionPlanSummary, User } from "./types";
import AdminApp from "./AdminApp";
import LandingPage from "./LandingPage";
import PriceListPanel from "./PriceListPanel";
import FilePreview, { type PreviewFile } from "./FilePreview";
import { QuoteTemplatePanel, type TemplateDetails } from "./QuoteTemplate";
import { NotificationProvider, NotificationToast, TaskProgress, useAppNotification, useConfirmation, useNotification, type ConfirmOptions, type Notify, type TaskProgressState } from "./Feedback";
import "./settings.css";
import "./quote-supplement.css";

type Section = "home" | "quotes" | "catalog" | "templates" | "profile";
interface CompanyEmailSettings { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string; passwordSet: boolean }
interface CompanyEmailForm { host: string; port: string; secure: boolean; user: string; password: string; from: string }
interface CompanyStoredFile { _id?: string; originalFilename: string; mimeType: string; bytes: number; createdAt: string }
interface SubscriptionUsage {
  plan: SubscriptionPlanSummary;
  subscriptionExpiresAt: string | null;
  quotes: { used: number; limit: number | null; remaining: number | null; periodStart: string; periodEnd: string };
  templates: { used: number; limit: number | null; remaining: number | null };
}
interface SupplementalProductDraft { id: string; informationField?: string; name: string; description: string; unit: string; quantity: string; unitPrice: string }
type ShippingMode = "unconfirmed" | "free" | "paid";
type TaxMode = "unconfirmed" | "zero" | "rate";

const statusLabels: Record<QuoteStatus, string> = { draft: "Bản nháp", needs_info: "Thiếu thông tin", pending_review: "Chờ duyệt", approved: "Đã duyệt", rejected: "Cần chỉnh sửa" };
const statusStyles: Record<QuoteStatus, string> = { draft: "neutral", needs_info: "amber", pending_review: "blue", approved: "green", rejected: "rose" };
const roleLabels = { user: "Tài khoản doanh nghiệp", admin: "Quản trị hệ thống" };

type RegistrationField = "companyName" | "taxId" | "address" | "phone" | "businessEmail" | "representativeName" | "password";
type RegistrationDraft = Record<RegistrationField, string>;
const emptyRegistration: RegistrationDraft = {
  companyName: "", taxId: "", address: "", phone: "", businessEmail: "", representativeName: "",
  password: "",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    quote: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    check: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19v2h16v-2" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
    file: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></>,
    copy: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}

function StatusPill({ status }: { status: QuoteStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}><span className="status-dot" />{statusLabels[status]}</span>;
}

function normalizedMissingInformation(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function isTaxMissingInformation(value: string) {
  return /\b(vat|thue|tax)\b/.test(normalizedMissingInformation(value));
}

function isShippingMissingInformation(value: string) {
  return /\b(van chuyen|shipping|phi giao hang|delivery fee)\b/.test(normalizedMissingInformation(value));
}

function isSupplementalProductInformation(value: string) {
  const text = normalizedMissingInformation(value);
  return /\b(san pham|mat hang|hang muc|nhan cong|vat tu|don gia|gia|ma hang|ma san pham|product|item|labor|material|sku|price|pricing|mosaic|op lat|gach|trang tri|decoration|finishing|installation|thi cong|lap dat)\b/.test(text);
}

function canSupplementMissingInformation(value: string) {
  if (isTaxMissingInformation(value) || isShippingMissingInformation(value)) return false;
  return !isSupplementalProductInformation(value);
}

const supplementalUnitOptions = ["cái", "bộ", "m", "m²", "m³", "kg", "tấn", "bao", "viên", "tấm", "thùng", "lít", "gói", "hộp", "cuộn", "công", "ngày", "giờ", "lần"];

function normalizedSupplementalUnit(value: string) {
  const text = normalizedMissingInformation(value).replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    "m2": "m²", "met vuong": "m²", "mét vuông": "m²", "m3": "m³", "met khoi": "m³", "mét khối": "m³",
    "met": "m", "meter": "m", "cai": "cái", "bo": "bộ", "vien": "viên", "tam": "tấm", "thung": "thùng",
    "lit": "lít", "goi": "gói", "hop": "hộp", "cuon": "cuộn", "cong": "công", "ngay": "ngày", "gio": "giờ", "lan": "lần",
  };
  return aliases[text] ?? value.trim();
}

function suggestedNameFromMissingField(field: string) {
  const separator = field.indexOf(":");
  if (separator >= 0 && field.slice(separator + 1).trim()) return field.slice(separator + 1).trim().slice(0, 250);
  const name = field.replace(/^\s*(?:chua tim thay|khong tim thay|khong co|thieu|can bo sung|bo sung|chon)\s+/i, "").trim();
  return /\b(san pham|mat hang|hang muc|ma hang)\b/i.test(normalizedMissingInformation(name)) && name.split(/\s+/).length <= 3 ? "" : name.slice(0, 250);
}

function createSupplementalProductDraft(informationField?: string, suggestion?: Partial<SuggestedProduct>, useManualDefaults = true): SupplementalProductDraft {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `new-${id}`,
    ...(informationField ? { informationField } : {}),
    name: suggestion?.name?.trim() ?? (informationField ? suggestedNameFromMissingField(informationField) : ""),
    description: suggestion?.description?.trim() ?? "",
    unit: normalizedSupplementalUnit(suggestion?.unit?.trim() || (useManualDefaults ? "cái" : "")),
    quantity: suggestion?.quantity && suggestion.quantity > 0 ? String(suggestion.quantity) : useManualDefaults ? "1" : "",
    unitPrice: "",
  };
}

function hasSupplementalProductContent(product: SupplementalProductDraft) {
  return Boolean(product.name.trim() || product.description.trim() || product.unit.trim() || product.quantity.trim() || product.unitPrice.trim());
}

function supplementalProductFields(product: SupplementalProductDraft) {
  return {
    informationField: product.informationField ?? "",
    name: product.name.trim(),
    description: product.description.trim(),
    unit: product.unit.trim(),
    quantity: product.quantity.trim(),
    unitPrice: product.unitPrice.trim(),
  };
}

async function confirmSession(expectedUser: User) {
  let sessionUser: User;
  try {
    ({ user: sessionUser } = await api<{ user: User }>("/api/auth/me"));
  } catch {
    throw new Error("Đăng nhập thành công nhưng phiên chưa được lưu. Hãy kiểm tra cookie và cấu hình HTTPS trên máy chủ.");
  }
  if (sessionUser.id !== expectedUser.id || sessionUser.role !== expectedUser.role) {
    throw new Error("Máy chủ chưa xác nhận đúng phiên đăng nhập. Vui lòng thử lại.");
  }
  return sessionUser;
}

function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [section, setSection] = useState<Section>("home");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const { notification, notify, dismiss } = useNotification();
  const { confirm, dialog: confirmationDialog } = useConfirmation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [requestedPlanCode, setRequestedPlanCode] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const deletingQuoteRef = useRef(false);
  useEffect(() => {
    api<{ user: User }>("/api/auth/me").then(({ user: signedIn }) => {
      if (signedIn.role === "admin") {
        window.location.replace("/quan-tri");
        return;
      }
      const requestedPlan = new URLSearchParams(window.location.search).get("plan");
      const requestedPaidPlan = requestedPlan && requestedPlan !== "free" && /^[a-z][a-z0-9-]{0,60}$/i.test(requestedPlan) ? requestedPlan : null;
      if (requestedPaidPlan) { setRequestedPlanCode(requestedPaidPlan); setSection("profile"); }
      if (window.location.pathname !== "/ung-dung") window.history.replaceState(null, "", "/ung-dung");
      setUser(signedIn);
    }).catch(() => {
      setUser(null);
    }).finally(() => setCheckingSession(false));
  }, []);
  const handleLogin = (signedIn: User, planCode?: string) => {
    window.history.replaceState(null, "", "/ung-dung");
    const requestedPaidPlan = planCode && planCode !== "free" && /^[a-z][a-z0-9-]{0,60}$/i.test(planCode) ? planCode : null;
    setRequestedPlanCode(requestedPaidPlan);
    if (requestedPaidPlan) setSection("profile");
    setUser(signedIn);
  };
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const result = await api<SubscriptionUsage>("/api/usage");
      setUsage(result);
      setUser((current) => current ? { ...current, plan: result.plan } : current);
      setUsageError(null);
    } catch (cause) {
      setUsageError(cause instanceof Error ? cause.message : "Không thể kiểm tra hạn mức gói.");
    } finally {
      setUsageLoading(false);
    }
  }, []);
  const handleBillingPaid = useCallback(() => { void loadUsage(); }, [loadUsage]);
  const signedInUserId = user?.id;
  useEffect(() => {
    if (!signedInUserId) {
      setUsage(null);
      setUsageLoading(true);
      setUsageError(null);
      return;
    }
    void loadUsage();
  }, [signedInUserId, refreshKey, loadUsage]);
  const canCreateQuote = Boolean(usage && !usageLoading && !usageError && (usage.quotes.limit === null || (usage.quotes.remaining ?? 0) > 0));
  const quoteBlockedMessage = usageLoading
    ? "Đang kiểm tra hạn mức gói…"
    : usageError
      ? "Không thể kiểm tra hạn mức gói. Hãy tải lại để tiếp tục tạo báo giá."
      : usage && usage.quotes.limit !== null && (usage.quotes.remaining ?? 0) <= 0
        ? `Bạn đã dùng hết ${usage.quotes.limit.toLocaleString("vi-VN")} lượt tạo báo giá trong tháng này.`
        : "Không thể xác định hạn mức gói hiện tại.";
  const quoteUsageLabel = usage
    ? usage.quotes.limit === null
      ? `Đã tạo ${usage.quotes.used.toLocaleString("vi-VN")} báo giá tháng này · Không giới hạn`
      : `Đã dùng ${usage.quotes.used.toLocaleString("vi-VN")} / ${usage.quotes.limit.toLocaleString("vi-VN")} lượt tháng này`
    : "";
  const createQuote = () => {
    if (!canCreateQuote) {
      notify(quoteBlockedMessage, "error");
      return;
    }
    setCreatingQuote(true);
  };
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); setSection("home"); window.location.replace("/"); };
  if (checkingSession) return <div className="splash"><img className="brand-logo-image brand-logo-image-splash brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Baogia — Trợ lý báo giá" /><span>Đang mở không gian làm việc…</span></div>;
  if (!user) return <NotificationProvider notify={notify}><><Login onLogin={handleLogin} onNotify={notify} />{notification && <NotificationToast notification={notification} onDismiss={dismiss} />}{confirmationDialog}</></NotificationProvider>;
  const openQuote = (id: string) => setQuoteId(id);
  const removeQuote = async (quote: Quote) => {
    if (deletingQuoteRef.current) return;
    deletingQuoteRef.current = true;
    try {
      if (!await confirm({
        title: "Xóa báo giá này?",
        message: `${quote.quoteNumber} · ${quote.customerName}\nThao tác này không thể hoàn tác.`,
        confirmLabel: "Xóa báo giá",
        tone: "danger",
      })) return;
      await api(`/api/quotes/${quote._id}`, { method: "DELETE" });
      setQuoteId(null);
      refresh();
      notify(`Đã xóa báo giá ${quote.quoteNumber}.`, "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không thể xóa báo giá. Vui lòng thử lại.", "error");
    } finally {
      deletingQuoteRef.current = false;
    }
  };

  return <NotificationProvider notify={notify}><div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Baogia — Trợ lý báo giá" /></div>
      <nav className="side-nav">
        <NavButton icon="home" label="Tổng quan" active={!quoteId && section === "home"} onClick={() => { setQuoteId(null); setSection("home"); }} />
        <NavButton icon="quote" label="Báo giá" active={!quoteId && section === "quotes"} onClick={() => { setQuoteId(null); setSection("quotes"); }} />
        <NavButton icon="file" label="Mẫu báo giá" active={!quoteId && section === "templates"} onClick={() => { setQuoteId(null); setSection("templates"); }} />
        <NavButton icon="box" label="Bảng giá" active={!quoteId && section === "catalog"} onClick={() => { setQuoteId(null); setSection("catalog"); }} />
      </nav>
      <div className="sidebar-bottom">
        <button className={`profile-button ${!quoteId && section === "profile" ? "active" : ""}`} onClick={() => { setQuoteId(null); setSection("profile"); }} title="Trang cá nhân"><span className="avatar"><Icon name="user" size={17} /></span><span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span><Icon name="arrow" size={17} /></button>
      </div>
    </aside>
    <div className="main-column">
      <main className="main-content">{quoteId ? <QuoteDetail key={quoteId} id={quoteId} user={user} onBack={() => setQuoteId(null)} onChanged={refresh} onToast={notify} confirm={confirm} onDeleteQuote={removeQuote} /> : section === "home" ? <Dashboard key={refreshKey} canCreate={canCreateQuote} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} canReview onOpen={openQuote} onCreate={createQuote} onNavigate={setSection} onDeleteQuote={(quote) => void removeQuote(quote)} /> : section === "quotes" ? <QuoteWorkspace key={refreshKey} canCreate={canCreateQuote} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} onOpen={openQuote} onCreate={createQuote} onDeleteQuote={(quote) => void removeQuote(quote)} /> : section === "templates" ? <div className="page-stack templates-page"><section className="page-heading-row"><div><h1>Mẫu báo giá</h1><p className="muted">Khai báo và cập nhật mẫu mặc định của doanh nghiệp.</p></div></section><QuoteTemplatePanel canManage templateUsage={usage?.templates ?? null} usageLoading={usageLoading} usageError={Boolean(usageError)} onRefreshUsage={() => void loadUsage()} onUsageChanged={() => void loadUsage()} /></div> : section === "catalog" ? <PriceListPanel key={refreshKey} onToast={notify} /> : <AccountProfile user={user} onToast={notify} onSignOut={() => void signOut()} confirm={confirm} subscriptionExpiresAt={usage?.subscriptionExpiresAt ?? null} requestedPlanCode={requestedPlanCode} onInitialPlanHandled={() => setRequestedPlanCode(null)} onBillingPaid={handleBillingPaid} />}</main>
      <main className="main-content">{quoteId ? <QuoteDetail key={quoteId} id={quoteId} user={user} onBack={() => setQuoteId(null)} onChanged={refresh} onToast={notify} confirm={confirm} onDeleteQuote={removeQuote} /> : section === "home" ? <Dashboard key={refreshKey} canCreate={canCreateQuote} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} canReview onOpen={openQuote} onCreate={createQuote} onNavigate={setSection} onDeleteQuote={(quote) => void removeQuote(quote)} /> : section === "quotes" ? <QuoteWorkspace key={refreshKey} canCreate={canCreateQuote} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} onOpen={openQuote} onCreate={createQuote} onDeleteQuote={(quote) => void removeQuote(quote)} /> : section === "templates" ? <div className="page-stack templates-page"><section className="page-heading-row"><div><h1>Mẫu báo giá</h1><p className="muted">Khai báo và cập nhật mẫu mặc định của doanh nghiệp.</p></div></section><QuoteTemplatePanel canManage templateUsage={usage?.templates ?? null} usageLoading={usageLoading} usageError={Boolean(usageError)} onRefreshUsage={() => void loadUsage()} onUsageChanged={() => void loadUsage()} /></div> : section === "catalog" ? <PriceListPanel key={refreshKey} onToast={notify} /> : <AccountProfile user={user} onToast={notify} onSignOut={() => void signOut()} confirm={confirm} subscriptionExpiresAt={usage?.subscriptionExpiresAt ?? null} requestedPlanCode={requestedPlanCode} onInitialPlanHandled={() => setRequestedPlanCode(null)} onBillingPaid={handleBillingPaid} />}</main>
    </div>
    {creatingQuote && canCreateQuote && <NewQuoteDialog canManageTemplate onQuotaExceeded={() => void loadUsage()} onClose={() => setCreatingQuote(false)} onManageTemplate={() => { setCreatingQuote(false); setQuoteId(null); setSection("templates"); }} onCreated={(id) => { setCreatingQuote(false); setSection("quotes"); refresh(); notify("Bản nháp báo giá đã được tạo."); openQuote(id); }} />}
    {notification && <NotificationToast notification={notification} onDismiss={dismiss} />}
    {confirmationDialog}
  </div></NotificationProvider>;
}

function NavButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}><Icon name={icon} size={18} /><span>{label}</span></button>;
}

function Login({ onLogin, onNotify }: { onLogin: (user: User, requestedPlanCode?: string) => void; onNotify: Notify }) {
  const [mode, setMode] = useState<"login" | "register">(() => window.location.pathname === "/dang-ky" || new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login");
  const requestedPlanCode = new URLSearchParams(window.location.search).get("plan") ?? undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registration, setRegistration] = useState<RegistrationDraft>(emptyRegistration);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegistrationPasswords, setShowRegistrationPasswords] = useState(false);
  const setError = (message: string) => { if (message) onNotify(message, "error"); };
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const sessionUser = await confirmSession(result.user);
      if (sessionUser.role === "admin") {
        window.location.assign("/quan-tri");
        return;
      }
      onLogin(sessionUser, requestedPlanCode);
      onNotify("Đăng nhập thành công.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể đăng nhập. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  const submitRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const details = { ...registration, email: registration.businessEmail, name: registration.representativeName };
      const { user } = await api<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(details) });
      onLogin(await confirmSession(user), requestedPlanCode);
      onNotify("Tài khoản doanh nghiệp đã được tạo và đăng nhập.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo tài khoản doanh nghiệp.");
    } finally {
      setBusy(false);
    }
  };

  const registrationFields: Array<{ key: RegistrationField; label: string; type?: string; autoComplete?: string; maxLength: number; wide?: boolean }> = [
    { key: "companyName", label: "Tên doanh nghiệp", autoComplete: "organization", maxLength: 200 },
    { key: "taxId", label: "Mã số thuế", maxLength: 30 },
    { key: "address", label: "Địa chỉ doanh nghiệp", autoComplete: "street-address", maxLength: 500, wide: true },
    { key: "phone", label: "Điện thoại doanh nghiệp", type: "tel", autoComplete: "tel", maxLength: 30 },
    { key: "businessEmail", label: "Email đăng nhập", type: "email", autoComplete: "email", maxLength: 250 },
    { key: "representativeName", label: "Người đại diện và người dùng", autoComplete: "name", maxLength: 200 },
    { key: "password", label: "Mật khẩu", type: "password", autoComplete: "new-password", maxLength: 200 },
  ];

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    const nextPath = nextMode === "register" ? "/dang-ky" : "/dang-nhap";
    window.history.replaceState(null, "", requestedPlanCode ? `${nextPath}?plan=${encodeURIComponent(requestedPlanCode)}` : nextPath);
    setShowRegistrationPasswords(false);
    setError("");
  };

  return (
    <div className="login-screen">
      <div className={`login-card ${mode === "register" ? "register-mode" : ""}`}>
      <div className="login-art">
        <div className="art-content">
          <div className="art-brand-header">
            <img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Baogia — Trợ lý báo giá" />
          </div>

          <div className="art-hero">
            <h1>
              Báo giá nhanh.<br />
              <em>Rõ ràng.</em>
            </h1>
          </div>
          <img className="login-banner-image" src="/images/login-illustration.png" alt="Minh họa báo giá và quản lý doanh nghiệp" />
        </div>
      </div>

      <div className={`login-panel ${mode === "register" ? "register-mode" : ""}`}>
        <div className="login-form-card">
          <div className="mobile-brand">
            <img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Baogia — Trợ lý báo giá" />
          </div>

          <div className="login-header">
            <h2>{mode === "login" ? "Đăng nhập" : "Đăng ký doanh nghiệp"}</h2>
            <p className={`login-subtitle ${mode === "login" ? "login-subtitle-login" : ""}`}>
              {mode === "login" ? <>Đăng nhập vào không gian <span className="login-brand-highlight">báo giá</span> của doanh nghiệp.</> : "Tạo hồ sơ doanh nghiệp và tài khoản sử dụng."}
            </p>
          </div>

          {mode === "login" ? <form onSubmit={(event) => void submit(event)} className="login-form">
            <div className="input-group">
              <label htmlFor="login-email">Email công việc</label>
              <div className="input-wrapper">
                <span className="input-icon"><Icon name="mail" size={17} /></span>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="email@congty.vn"
                  required
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="login-password">Mật khẩu</label>
              <div className="input-wrapper">
                <span className="input-icon"><Icon name="lock" size={17} /></span>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Nhập mật khẩu"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  tabIndex={-1}
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
                </button>
              </div>
            </div>

            <button className="login-submit-btn" type="submit" disabled={busy}>
              {busy ? <span className="login-spinner" /> : null}
              <span>{busy ? "Đang xác thực…" : "Đăng nhập"}</span>
            </button>
          </form> : <form onSubmit={(event) => void submitRegistration(event)} className="login-form business-register-form">
            {registrationFields.map(({ key, label, type = "text", autoComplete = "off", maxLength, wide }) => {
              const isPassword = key === "password";
              return <div className={`input-group register-field ${wide ? "register-field-wide" : ""}`} key={key}>
                <label htmlFor={`register-${key}`}>{label}</label>
                <div className="input-wrapper">
                  <input id={`register-${key}`} type={isPassword && showRegistrationPasswords ? "text" : type} autoComplete={autoComplete} maxLength={maxLength} minLength={isPassword ? 7 : undefined} value={registration[key]} onChange={(event) => setRegistration((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === "taxId" ? "0123456789" : undefined} required />
                  {isPassword && <button type="button" className="password-toggle" onClick={() => setShowRegistrationPasswords((shown) => !shown)} title={showRegistrationPasswords ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-label={showRegistrationPasswords ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showRegistrationPasswords}><Icon name={showRegistrationPasswords ? "eyeOff" : "eye"} size={17} /></button>}
                </div>
              </div>;
            })}
            {error && <div className="login-error-alert register-field-wide" role="alert"><span className="error-icon"><Icon name="close" size={14} /></span><span>{error}</span></div>}
            <button className="login-submit-btn register-field-wide" type="submit" disabled={busy}>{busy ? <span className="login-spinner" /> : null}<span>{busy ? "Đang tạo tài khoản…" : "Tạo tài khoản"}</span></button>
          </form>}
          {mode === "login" && error && <div className="login-error-alert" role="alert"><span className="error-icon"><Icon name="close" size={14} /></span><span>{error}</span></div>}
          {mode === "login" && <div className="login-signup-cta">
            <span>Chưa có tài khoản?</span>
            <button className="login-signup-link" type="button" onClick={() => switchMode("register")}>
              <strong>Đăng ký tài khoản</strong>
              <Icon name="arrow" size={15} />
            </button>
          </div>}
          {mode === "register" && <button className="login-return-cta" type="button" onClick={() => switchMode("login")}>
            <span>Đã có tài khoản?</span> <strong>Đăng nhập ngay</strong>
          </button>}
          {mode === "login" && <a className="admin-login-link" href="/quan-tri">Đăng nhập dành cho quản trị viên</a>}
        </div>
      </div>
      </div>
    </div>
  );
}

function Dashboard({ onOpen, onCreate, onNavigate, canCreate, quoteUsageLabel, createBlockedMessage, onRefreshUsage, showUsageError, canReview, onDeleteQuote }: { onOpen: (id: string) => void; onCreate: () => void; onNavigate: (section: Section) => void; canCreate: boolean; quoteUsageLabel: string; createBlockedMessage: string; onRefreshUsage: () => void; showUsageError: boolean; canReview: boolean; onDeleteQuote: (quote: Quote) => void }) {
  const [data, setData] = useState<{ counts: { total: number; drafts: number; pending: number; approved: number }; recent: Quote[] } | null>(null);
  const notify = useAppNotification();
  useEffect(() => { api<typeof data>("/api/dashboard").then((value) => setData(value)).catch((cause) => notify(cause instanceof Error ? cause.message : "Không thể tải tổng quan báo giá.", "error")); }, [notify]);
  return <div className="page-stack dashboard-page">
    <section className="dashboard-banners" aria-label="Tạo và theo dõi báo giá">
      <article className="dashboard-banner dashboard-banner-primary">
        <img src="/images/quote-banner.png" alt="" />
        <div className="dashboard-banner-copy">
          <h1>Báo giá nhanh, rõ ràng</h1>
          <button className="button button-primary quote-create-button" disabled={!canCreate} onClick={onCreate}><Icon name="plus" size={17} />Tạo báo giá</button>
          {quoteUsageLabel && <p className="quota-usage-count">{quoteUsageLabel}</p>}
          {!canCreate && <div className="quota-blocked-notice" role="status">{createBlockedMessage}{showUsageError && <button type="button" className="text-button" onClick={onRefreshUsage}>Tải lại hạn mức</button>}</div>}
        </div>
      </article>
      <article className="dashboard-banner dashboard-banner-secondary">
        <img src="/images/approval-banner.png" alt="" />
      </article>
    </section>
    <section className="metric-grid">
      <Metric label="Tổng báo giá" value={data?.counts.total ?? "—"} icon="quote" tone="mint" />
      <Metric label="Bản nháp" value={data?.counts.drafts ?? "—"} icon="file" tone="sand" />
      <Metric label="Chờ duyệt" value={data?.counts.pending ?? "—"} icon="check" tone="lavender" action={canReview ? () => onNavigate("quotes") : undefined} />
      <Metric label="Đã duyệt" value={data?.counts.approved ?? "—"} icon="download" tone="blue" />
    </section>
    <section className="content-card recent-card">
      <div className="card-heading">
        <div><h2>Báo giá gần đây</h2></div>
        <button className="text-button" onClick={() => onNavigate("quotes")}>Xem tất cả <Icon name="arrow" size={15} /></button>
      </div>
      <QuoteCards quotes={data?.recent ?? []} onOpen={onOpen} onDelete={onDeleteQuote} emptyTitle="Chưa có báo giá nào" emptyText="" />
    </section>
  </div>;
}

function Metric({ label, value, icon, tone, action }: { label: string; value: number | string; icon: string; tone: string; action?: () => void }) {
  return <button className={`metric-card tone-${tone} ${action ? "metric-action" : ""}`} onClick={action} disabled={!action}><span className="metric-watermark" aria-hidden="true"><Icon name={icon} size={88} /></span><span className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon} size={18} /></span></span><strong className="metric-value">{value}</strong></button>;
}

function QuoteWorkspace({ onOpen, onCreate, canCreate, quoteUsageLabel, createBlockedMessage, onRefreshUsage, showUsageError, onDeleteQuote }: { onOpen: (id: string) => void; onCreate: () => void; canCreate: boolean; quoteUsageLabel: string; createBlockedMessage: string; onRefreshUsage: () => void; showUsageError: boolean; onDeleteQuote: (quote: Quote) => void }) {
  const [quotes, setQuotes] = useState<Quote[]>([]); const [loading, setLoading] = useState(true); const [loadFailed, setLoadFailed] = useState(false); const [reloadKey, setReloadKey] = useState(0); const [filter, setFilter] = useState("all");
  const notify = useAppNotification();
  useEffect(() => { setLoading(true); setLoadFailed(false); api<{ quotes: Quote[] }>("/api/quotes").then((result) => setQuotes(result.quotes)).catch((cause) => { setLoadFailed(true); notify(cause instanceof Error ? cause.message : "Không thể tải danh sách báo giá.", "error"); }).finally(() => setLoading(false)); }, [reloadKey, notify]);
  const filtered = filter === "all" ? quotes : quotes.filter((quote) => quote.status === filter);
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Báo giá</h1>{quoteUsageLabel && <p className="quota-usage-count">{quoteUsageLabel}</p>}{!canCreate && <div className="quota-blocked-notice" role="status">{createBlockedMessage}{showUsageError && <button type="button" className="text-button" onClick={onRefreshUsage}>Tải lại hạn mức</button>}</div>}</div><div className="page-heading-actions">{loadFailed && <button type="button" className="button button-soft" onClick={() => setReloadKey((key) => key + 1)}>Tải lại</button>}<button className="button button-primary quote-create-button" disabled={!canCreate} onClick={onCreate}><Icon name="plus" size={17} />Tạo báo giá mới</button></div></section><section className="content-card list-card"><div className="list-toolbar"><div className="filter-tabs">{[["all", "Tất cả"], ["draft", "Bản nháp"], ["pending_review", "Chờ duyệt"], ["approved", "Đã duyệt"], ["needs_info", "Cần bổ sung"], ["rejected", "Cần chỉnh sửa"]].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="row-count">{filtered.length} báo giá</span></div>{loading ? <Loading /> : <QuoteCards quotes={filtered} onOpen={onOpen} onDelete={onDeleteQuote} emptyTitle="Không có báo giá trong mục này" emptyText="" />}</section></div>;
}

interface QuoteOptions { templates: TemplateDetails[]; defaultTemplateId: string | null; productsAvailable: boolean }

function QuoteTemplateDropdown({ templates, value, defaultTemplateId, disabled, onChange }: { templates: TemplateDetails[]; value: string; defaultTemplateId: string | null; disabled: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = templates.find((entry) => entry.id === value);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    const selectedOption = root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    (selectedOption ?? root.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const label = (entry: TemplateDetails) => `${entry.name || entry.originalFilename}${entry.id === defaultTemplateId ? " (Mặc định)" : ""}`;
  return <div className={`quote-template-dropdown ${open ? "is-open" : ""}`} ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="quote-template-trigger" disabled={disabled || templates.length === 0} aria-haspopup="listbox" aria-expanded={open} aria-label={`Mẫu báo giá: ${selected ? label(selected) : "Chọn mẫu báo giá"}`} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <span>{selected ? label(selected) : "Chọn mẫu báo giá"}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="quote-template-menu" role="listbox" aria-label="Chọn mẫu báo giá">{templates.map((entry) => <button key={entry.id} type="button" role="option" aria-selected={entry.id === value} onClick={() => { onChange(entry.id); setOpen(false); trigger.current?.focus(); }}>{label(entry)}</button>)}</div>}
  </div>;
}

async function loadQuoteOptions(): Promise<QuoteOptions> {
  const loadTemplates = async () => {
    const templates: TemplateDetails[] = [];
    let cursor: string | null = null;
    let defaultTemplateId: string | null = null;
    do {
      const page: { templates: TemplateDetails[]; nextCursor: string | null; defaultTemplateId: string | null } = await api(`/api/quote-templates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      templates.push(...page.templates);
      defaultTemplateId = page.defaultTemplateId;
      cursor = page.nextCursor;
    } while (cursor);
    return { templates, defaultTemplateId };
  };
  const [templates, catalog] = await Promise.all([loadTemplates(), api<{ items: CatalogItem[] }>("/api/catalog")]);
  const today = new Date().toISOString().slice(0, 10);
  const productsAvailable = catalog.items.some((item) => item.active && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today));
  return { ...templates, productsAvailable };
}

function NewQuoteDialog({ onClose, onCreated, canManageTemplate, onManageTemplate, onQuotaExceeded }: { onClose: () => void; onCreated: (id: string) => void; canManageTemplate: boolean; onManageTemplate: () => void; onQuotaExceeded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<QuoteOptions>({ templates: [], defaultTemplateId: null, productsAvailable: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const notify = useAppNotification();
  const setError = useCallback((message: string) => { if (message) notify(message, "error"); }, [notify]);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadFailed(false);
    loadQuoteOptions().then((value) => { if (active) setOptions(value); }).catch((cause) => { if (active) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "Không tải được mẫu báo giá và danh mục sản phẩm."); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey, setError]);
  return <dialog ref={dialog} className="template-dialog quote-creation-dialog" aria-labelledby="new-quote-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="settings-card-heading"><h2 id="new-quote-title">Tạo báo giá mới</h2><button type="button" autoFocus className="icon-button" aria-label="Đóng popup tạo báo giá" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    <div className="quote-creation-body" aria-busy={busy || loading}>{loading ? <TaskProgress label="Đang tải mẫu và danh mục sản phẩm" detail="Chuẩn bị biểu mẫu tạo báo giá…" /> : loadFailed ? <div className="empty-state"><button className="button button-soft" onClick={() => setReloadKey((key) => key + 1)}>Tải lại</button></div> : <NewQuote options={options} canManageTemplate={canManageTemplate} onManageTemplate={onManageTemplate} onCreated={onCreated} onBusyChange={setBusy} onQuotaExceeded={onQuotaExceeded} />}</div>
  </dialog>;
}

function NewQuote({ options, onCreated, canManageTemplate, onManageTemplate, onBusyChange, onQuotaExceeded }: { onBusyChange: (busy: boolean) => void; onManageTemplate: () => void; onQuotaExceeded: () => void; canManageTemplate: boolean; options: QuoteOptions; onCreated: (id: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [templateId, setTemplateId] = useState(options.templates.find((entry) => entry.id === options.defaultTemplateId)?.id ?? options.templates[0]?.id ?? "");
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const uploadedFile = useRef<{ file: File; id: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [requestText, setRequestText] = useState("");
  const [requestIdempotencyKey, setRequestIdempotencyKey] = useState(() => crypto.randomUUID());
  const [quoteIdempotencyKey, setQuoteIdempotencyKey] = useState(() => crypto.randomUUID());
  const [requestId, setRequestId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<AnalysisItem[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const notify = useAppNotification();
  const setError = useCallback((message: string) => { if (message) notify(message, "error"); }, [notify]);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!templateId || (!requestText.trim() && !requestFile)) { setError("Hãy chọn mẫu và nhập yêu cầu hoặc tải file yêu cầu."); return; }
    if (requestFile && (!requestFile.size || requestFile.size > 10 * 1024 * 1024)) { setError("File yêu cầu phải có nội dung và không vượt quá 10 MB."); return; }
    setBusy(true);
    setError("");
    setAnalysis(null);
    setTaskProgress({ label: "Đang chuẩn bị phân tích", detail: "Chuẩn bị yêu cầu để đối chiếu với bảng giá…" });
    try {
      let id = requestId;
      if (!id) {
        if (requestFile && uploadedFile.current?.file !== requestFile) {
          setTaskProgress({ label: "Đang tải file yêu cầu lên", detail: "Tiến độ gửi file" });
          const { file } = await apiUploadWithProgress<{ file: { id: string } }>(
            "/api/request-files",
            requestFile,
            { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(requestFile.name) },
            (progress) => setTaskProgress({ label: "Đang tải file yêu cầu lên", progress, detail: "Tiến độ gửi file" }),
          );
          uploadedFile.current = { file: requestFile, id: file.id };
        }
        setTaskProgress({ label: "Đang lưu yêu cầu", detail: "Đang chuẩn bị nội dung và thông tin khách hàng…" });
        const { request } = await api<{ request: QuoteRequest }>("/api/quote-requests", {
          method: "POST",
          body: JSON.stringify({ requestText, customerName, customerEmail, customerPhone, templateId, requestFileId: requestFile ? uploadedFile.current?.id : undefined, idempotencyKey: requestIdempotencyKey }),
        });
        id = request._id;
        setRequestId(id);
      }
      setTaskProgress({ label: "AI đang đối chiếu bảng giá", detail: "Đang phân tích yêu cầu và ghép các sản phẩm phù hợp…" });
      const { analysis: result, candidates } = await api<{ analysis: Analysis; candidates: CatalogItem[] }>(`/api/quote-requests/${id}/analyze`, { method: "POST" });
      setCatalog(candidates);
      setCustomerName((current) => current.trim() ? current : result.customerName ?? "");
      setCustomerEmail((current) => current.trim() ? current : result.customerEmail ?? "");
      setAnalysis(result);
      setSelected(result.items);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded();
      setError(cause instanceof Error ? cause.message : "Không thể phân tích yêu cầu.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };

  const addCatalogItem = (item: CatalogItem) => {
    if (selected.some((line) => line.catalogItemId === item._id)) return;
    setSelected((lines) => [...lines, { catalogItemId: item._id, quantity: 1, unit: item.unit, attributes: {}, evidence: "Người dùng chọn từ danh mục" }]);
    setQuery("");
  };

  const createQuote = async () => {
    setBusy(true);
    setError("");
    setTaskProgress({ label: "Đang tạo bản nháp báo giá", detail: "Đang tính toán các dòng hàng và lưu báo giá…" });
    try {
      const { quote } = await api<{ quote: Quote }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          customerName,
          customerEmail,
          customerPhone,
          idempotencyKey: quoteIdempotencyKey,
          items: selected.map(({ catalogItemId, quantity, unit, attributes }) => ({ catalogItemId, quantity, unit, attributes })),
        }),
      });
      onCreated(quote._id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded();
      setError(cause instanceof Error ? cause.message : "Không thể tạo báo giá.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };

  const editRequest = () => {
    setRequestId(""); setAnalysis(null); setSelected([]); setCatalog([]); setError("");
    setRequestIdempotencyKey(crypto.randomUUID()); setQuoteIdempotencyKey(crypto.randomUUID());
  };
  const locked = busy || Boolean(requestId);

  const today = new Date().toISOString().slice(0, 10);
  const results = catalog
    .filter((item) => item.active && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today))
    .filter((item) => `${item.sku} ${item.name} ${item.description} ${Object.entries(item.attributes ?? {}).flat().join(" ")}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")))
    .slice(0, 8);
  const suggestedProductFields = new Set((analysis?.suggestedProducts ?? []).map((product) => product.informationField).filter((field): field is string => Boolean(field)));
  const otherMissingFields = analysis?.missingFields.filter((field) => !suggestedProductFields.has(field)) ?? [];

  return (
    <div className="page-stack">
      <div className="creation-layout">
        <section className="content-card form-card">
          <form onSubmit={(event) => void analyze(event)} className="request-form">
            {options.templates.length > 0 && <div className="template-setup">
              <div className="template-field"><span className="template-field-label">Mẫu báo giá</span><QuoteTemplateDropdown templates={options.templates} value={templateId} defaultTemplateId={options.defaultTemplateId} disabled={locked} onChange={setTemplateId} /></div>
              {templateId && <button type="button" className="text-button quote-template-preview" onClick={() => { const template = options.templates.find((entry) => entry.id === templateId); if (template) setPreviewFile({ name: template.originalFilename, url: `/api/quote-template/${template.id}/file?preview=1` }); }}>Xem trước mẫu</button>}
            </div>}
            {(!options.templates.length || !options.productsAvailable) && <div className="quote-setup-notice" role="status">
              <strong>Để tạo báo giá, hãy bổ sung:</strong>
              {!options.templates.length && <div className="quote-setup-item"><span>Mẫu báo giá</span>{canManageTemplate ? <button type="button" className="text-button" onClick={onManageTemplate}>Thêm mẫu →</button> : <span>Liên hệ quản trị viên</span>}</div>}
              {!options.productsAvailable && <div className="quote-setup-item"><span>Sản phẩm</span><span>Thêm tại mục Bảng giá</span></div>}
            </div>}
            {!analysis && <div className="field-row quote-customer-fields">
              <label>Tên khách hàng<input value={customerName} maxLength={250} disabled={locked} autoComplete="name" onChange={(event) => setCustomerName(event.target.value)} placeholder="Nhập tên khách hàng" /></label>
              <label>Email (không bắt buộc)<input type="email" value={customerEmail} maxLength={250} disabled={locked} autoComplete="email" onChange={(event) => setCustomerEmail(event.target.value)} placeholder="email@congty.vn" /></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={locked} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng" /></label>
            </div>}
            <label className="request-text-label">Yêu cầu của khách hàng<textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Mô tả sản phẩm, số lượng, quy cách khách hàng cần…" rows={4} maxLength={10000} required={!requestFile} disabled={locked} /></label>
            <label className="request-upload-label">Hoặc tải file yêu cầu<input className="request-file-input" ref={fileInput} type="file" accept=".pdf,.docx,.txt,.xlsx,.xls,.csv" disabled={locked} onChange={(event) => { setRequestFile(event.target.files?.[0] ?? null); uploadedFile.current = null; setError(""); }} /><span className="request-file-control"><span className="request-file-trigger">Chọn file</span><span className="request-file-name">{requestFile?.name ?? "Chưa chọn file"}</span></span><span className="field-hint">PDF, Word, TXT, Excel, CSV · Tối đa 10 MB</span></label>
            {requestFile && <div className="request-file-selection"><button type="button" className="text-button" onClick={() => setPreviewFile({ name: requestFile.name, file: requestFile })}>Xem trước file</button><button type="button" className="text-button" disabled={locked} onClick={() => { setRequestFile(null); uploadedFile.current = null; if (fileInput.current) fileInput.current.value = ""; }}>Bỏ file</button></div>}
            {!analysis && <button className="button button-primary analyze-button" type="submit" disabled={busy || !templateId || !options.productsAvailable || (!requestText.trim() && !requestFile)}>{busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{busy ? "Đang phân tích…" : "Phân tích yêu cầu"}<Icon name="arrow" size={16} /></button>}
            {requestId && <button type="button" className="text-button" disabled={busy} onClick={editRequest}>Chỉnh sửa yêu cầu</button>}
          </form>
          {!analysis && taskProgress && <TaskProgress {...taskProgress} />}
        </section>

        {analysis && <section className="content-card analysis-card">
          <div className="section-title"><span className="step-number step-number-ai"><Icon name="spark" size={17} /></span><div><h2>Gợi ý sản phẩm</h2></div></div>
          <div className="field-row quote-customer-review"><label>Tên khách hàng<input value={customerName} maxLength={250} disabled={busy} onChange={(event) => setCustomerName(event.target.value)} placeholder="Xác nhận tên khách hàng" required /></label><label>Email (không bắt buộc)<input type="email" value={customerEmail} maxLength={250} disabled={busy} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Email khách hàng" /></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={busy} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng" /></label></div>
          <div className={`analysis-banner ${analysis.status}`}>
            <span className="analysis-indicator" />
            <div><strong>{analysis.status === "matched" ? "Đã tìm thấy sản phẩm phù hợp" : analysis.status === "ambiguous" ? "Có nhiều sản phẩm cần xác nhận" : "Chưa ghép được sản phẩm"}</strong>{analysis.status !== "matched" && <span>{analysis.suggestedProducts?.length ? "Sản phẩm chưa ghép sẽ được thêm vào báo giá để bạn bổ sung đơn giá." : "Bạn có thể tìm và chọn mặt hàng trong danh mục bên dưới."}</span>}</div>
          </div>
          {otherMissingFields.length > 0 && <div className="missing-fields"><strong>Cần kiểm tra thêm</strong><div>{otherMissingFields.map((field) => <span key={field}>{field}</span>)}</div></div>}
          {Boolean(analysis.suggestedProducts?.length) && <div className="missing-fields"><strong>Sản phẩm chưa có giá sẽ được thêm vào báo giá</strong><div>{analysis.suggestedProducts!.map((product, index) => <span key={`${product.name}-${index}`}>{product.name} · {product.quantity} {product.unit || "cái"}</span>)}</div></div>}

          <div className="selected-list">
            {selected.map((line) => {
              const item = catalog.find((entry) => entry._id === line.catalogItemId);
              if (!item) return null;
              return <div className="selected-item" key={line.catalogItemId}>
                <div className="selected-copy"><strong>{item.name}</strong><span>{item.sku} · {item.unit} · {formatMoney(item.price, item.currency)}</span>{item.description && <small className="quote-product-description">{item.description}</small>}{Object.keys(item.attributes ?? {}).length > 0 && <small className="quote-product-details">{Object.entries(item.attributes ?? {}).map(([key, value]) => `${key}: ${value}`).join(" · ")}</small>}{Object.keys(line.attributes ?? {}).length > 0 && <small className="quote-request-details">Khách yêu cầu: {Object.entries(line.attributes ?? {}).map(([key, value]) => `${key}: ${value}`).join(" · ")}</small>}{line.evidence && <small>“{line.evidence}”</small>}</div>
                <label className="quantity-control"><span>Số lượng</span><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setSelected((rows) => rows.map((row) => row.catalogItemId === line.catalogItemId ? { ...row, quantity: Number(event.target.value) } : row))} /></label>
                <button className="icon-button remove-button" aria-label="Bỏ sản phẩm" onClick={() => setSelected((rows) => rows.filter((row) => row.catalogItemId !== line.catalogItemId))}><Icon name="close" size={16} /></button>
              </div>;
            })}
          </div>

          <div className="catalog-search-wrap">
            <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm thêm sản phẩm trong danh mục…" /></label>
            {query && <div className="search-results">{results.length ? results.map((item) => <button key={item._id} onClick={() => addCatalogItem(item)}><span><strong>{item.name}</strong><small>{item.sku} · {item.unit}</small>{Object.keys(item.attributes ?? {}).length > 0 && <small className="catalog-result-attributes">{Object.entries(item.attributes ?? {}).map(([key, value]) => `${key}: ${value}`).join(" · ")}</small>}</span><span className="result-price">{formatMoney(item.price, item.currency)}<Icon name="plus" size={15} /></span></button>) : <div className="search-empty">Không tìm thấy sản phẩm đang hoạt động.</div>}</div>}
          </div>
          <div className="analysis-footer"><span>{selected.length + (analysis.suggestedProducts?.length ?? 0)} mặt hàng trong báo giá</span><button className="button button-primary" disabled={busy || !customerName.trim() || (selected.length === 0 && !analysis.suggestedProducts?.length)} onClick={() => void createQuote()}>{busy ? "Đang tạo bản nháp…" : "Tạo bản nháp"}{!busy && <Icon name="arrow" size={16} />}</button></div>
          {busy && taskProgress && <TaskProgress {...taskProgress} />}
        </section>}
      </div>
      <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

function QuoteDetail({ id, user, onBack, onChanged, onToast, confirm, onDeleteQuote }: { id: string; user: User; onBack: () => void; onChanged: () => void; onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean>; onDeleteQuote: (quote: Quote) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [taxRateText, setTaxRateText] = useState("0");
  const [taxRateConfirmed, setTaxRateConfirmed] = useState(false);
  const [taxMode, setTaxMode] = useState<TaxMode>("unconfirmed");
  const [shippingFeeText, setShippingFeeText] = useState("");
  const [shippingMode, setShippingMode] = useState<ShippingMode>("unconfirmed");
  const [additionalInformation, setAdditionalInformation] = useState<Record<string, string>>({});
  const [supplementalProducts, setSupplementalProducts] = useState<SupplementalProductDraft[]>([]);
  const [validityDaysText, setValidityDaysText] = useState("");
  const [completionDateText, setCompletionDateText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const setError = (message: string) => { if (message) onToast(message, "error"); };
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(false);

  const canEdit = user.role === "user";
  const canApprove = user.role === "user";
  const editable = canEdit && Boolean(quote && ["draft", "needs_info", "pending_review", "rejected"].includes(quote.status));
  const shippingFeeIsConfirmed = shippingMode === "free"
    || (shippingMode === "paid" && shippingFeeText.trim() !== "" && Number.isFinite(Number(shippingFeeText)) && Number(shippingFeeText) > 0);

  const load = useCallback(async () => {
    try {
      const { quote: value } = await api<{ quote: Quote }>(`/api/quotes/${id}`);
      setQuote(value);
      setCustomerName(value.customerName);
      setCustomerEmail(value.customerEmail);
      setCustomerPhone(value.customerPhone ?? "");
      setQuantities(Object.fromEntries(value.lines.map((line) => [line.catalogItemId, line.quantity])));
      setTaxRateText(String(value.taxRate * 100));
      const loadedTaxConfirmed = value.taxRateConfirmed ?? !value.informationNeeded.some(isTaxMissingInformation);
      setTaxRateConfirmed(loadedTaxConfirmed);
      setTaxMode(loadedTaxConfirmed ? value.taxRate === 0 ? "zero" : "rate" : "unconfirmed");
      const loadedShippingConfirmed = value.shippingFeeConfirmed ?? (value.shippingFee != null || !value.informationNeeded.some(isShippingMissingInformation));
      const loadedShippingFee = loadedShippingConfirmed ? value.shippingFee ?? 0 : null;
      setShippingFeeText(loadedShippingFee === null ? "" : String(loadedShippingFee));
      setShippingMode(loadedShippingFee === null ? "unconfirmed" : loadedShippingFee === 0 ? "free" : "paid");
      setAdditionalInformation(value.additionalInformation ?? {});
      const savedSupplemental = value.lines.filter((line) => line.source === "supplemental");
      const supplementalDrafts: SupplementalProductDraft[] = savedSupplemental.map((line) => ({
        id: line.catalogItemId,
        ...(line.supplementalFor ? { informationField: line.supplementalFor } : {}),
        name: line.name,
        description: line.description ?? "",
        unit: normalizedSupplementalUnit(line.unit),
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      }));
      for (const suggestion of value.suggestedProducts ?? []) {
        if (!suggestion.informationField || supplementalDrafts.some((product) => product.informationField === suggestion.informationField)) continue;
        supplementalDrafts.push(createSupplementalProductDraft(suggestion.informationField, suggestion, false));
      }
      const draftedInformationFields = new Set(supplementalDrafts.map((product) => product.informationField).filter((field): field is string => Boolean(field)));
      value.informationNeeded.filter((field) => isSupplementalProductInformation(field) && !draftedInformationFields.has(field))
        .forEach((field) => supplementalDrafts.push(createSupplementalProductDraft(field, undefined, false)));
      setSupplementalProducts(supplementalDrafts);
      setValidityDaysText(value.validityDays == null ? "" : String(value.validityDays));
      setCompletionDateText(value.completionDate ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể mở báo giá.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const hasIncompleteSupplementalProduct = supplementalProducts.some((product) => {
    if (!hasSupplementalProductContent(product)) return false;
    const quantity = Number(product.quantity);
    const unitPrice = Number(product.unitPrice);
    return !product.name.trim() || product.name.length > 250 || !product.unit.trim() || product.unit.length > 50
      || !product.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
      || !product.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1e12
      || product.description.length > 2000;
  });

  const editPayload = () => ({
    items: quote?.lines.filter((line) => line.source !== "supplemental").map((line) => ({
      catalogItemId: line.catalogItemId,
      quantity: Number(quantities[line.catalogItemId]) || line.quantity,
    })) ?? [],
    supplementalProducts: supplementalProducts.filter(hasSupplementalProductContent).map((product) => ({
      ...(product.id.startsWith("supplemental:") ? { id: product.id } : {}),
      ...(product.informationField ? { informationField: product.informationField } : {}),
      name: product.name,
      description: product.description,
      unit: product.unit,
      quantity: Number(product.quantity),
      unitPrice: Number(product.unitPrice),
    })),
    taxRate: Number(taxRateText) / 100,
    taxRateConfirmed: taxMode !== "unconfirmed" && taxRateConfirmed && taxRateText.trim() !== "",
    shippingFee: shippingMode === "unconfirmed" ? null : shippingMode === "free" ? 0 : shippingFeeText.trim() === "" ? null : Number(shippingFeeText),
    shippingFeeConfirmed: shippingFeeIsConfirmed,
    validityDays: validityDaysText.trim() === "" ? null : Number(validityDaysText),
    completionDate: completionDateText || null,
    additionalInformation,
    customerName,
    customerEmail,
    customerPhone,
  });

  const hasUnsavedChanges = Boolean(
    quote && (
      quote.lines.some((line) => line.source !== "supplemental" && Number(quantities[line.catalogItemId]) !== line.quantity) ||
      JSON.stringify(supplementalProducts.filter(hasSupplementalProductContent).map(supplementalProductFields)) !== JSON.stringify(quote.lines.filter((line) => line.source === "supplemental").map((line) => ({
        informationField: line.supplementalFor ?? "",
        name: line.name.trim(),
        description: (line.description ?? "").trim(),
        unit: normalizedSupplementalUnit(line.unit),
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      }))) ||
      Number(taxRateText) / 100 !== quote.taxRate ||
      taxRateConfirmed !== (quote.taxRateConfirmed ?? !quote.informationNeeded.some((field) => /vat|thuế/i.test(field))) ||
      (shippingFeeText.trim() === "" ? null : Number(shippingFeeText)) !== (quote.shippingFeeConfirmed === false ? null : quote.shippingFee ?? 0) ||
      (validityDaysText.trim() === "" ? null : Number(validityDaysText)) !== (quote.validityDays ?? null) ||
      (completionDateText || null) !== (quote.completionDate ?? null) ||
      [...new Set([...Object.keys(quote.additionalInformation ?? {}), ...Object.keys(additionalInformation)])]
        .some((field) => (quote.additionalInformation?.[field] ?? "").trim() !== (additionalInformation[field] ?? "").trim()) ||
      customerName !== quote.customerName ||
      customerEmail !== quote.customerEmail ||
      customerPhone !== (quote.customerPhone ?? "")
    )
  );

  const liveSubtotal = useMemo(() => {
    if (!quote) return 0;
    const catalogSubtotal = quote.lines.filter((line) => line.source !== "supplemental").reduce((sum, line) => {
      const qty = Number(quantities[line.catalogItemId] ?? line.quantity) || 0;
      return sum + Math.round((qty * line.unitPrice + Number.EPSILON) * 100) / 100;
    }, 0);
    const supplementalSubtotal = supplementalProducts.reduce((sum, product) => {
      const quantity = Number(product.quantity);
      const unitPrice = Number(product.unitPrice);
      return sum + (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice) && unitPrice >= 0
        ? Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100
        : 0);
    }, 0);
    return Math.round((catalogSubtotal + supplementalSubtotal + Number.EPSILON) * 100) / 100;
  }, [quote, quantities, supplementalProducts]);

  const liveTaxAmount = useMemo(() => {
    if (!quote || !taxRateConfirmed || taxRateText.trim() === "") return 0;
    return Math.round((liveSubtotal * (Number(taxRateText) / 100) + Number.EPSILON) * 100) / 100;
  }, [quote, liveSubtotal, taxRateConfirmed, taxRateText]);

  const liveShippingFee = shippingFeeIsConfirmed && shippingMode === "paid" ? Number(shippingFeeText) : 0;

  const liveTotal = useMemo(() => {
    return liveSubtotal + liveTaxAmount + liveShippingFee;
  }, [liveSubtotal, liveTaxAmount, liveShippingFee]);

  const chooseShippingMode = (mode: ShippingMode) => {
    setShippingMode(mode);
    if (mode === "unconfirmed") setShippingFeeText("");
    else if (mode === "free") setShippingFeeText("0");
    else if (!(Number(shippingFeeText) > 0)) setShippingFeeText("");
  };

  const chooseTaxMode = (mode: TaxMode) => {
    setTaxMode(mode);
    if (mode === "unconfirmed") setTaxRateConfirmed(false);
    else if (mode === "zero") {
      setTaxRateText("0");
      setTaxRateConfirmed(true);
    } else if (Number(taxRateText) > 0) setTaxRateConfirmed(true);
    else {
      setTaxRateText("");
      setTaxRateConfirmed(false);
    }
  };

  const copyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    onToast(`Đã sao chép ${label}.`);
  };

  const perform = async (url: string, body?: unknown, method = "POST", success = "Đã cập nhật báo giá.") => {
    if (editable && hasIncompleteSupplementalProduct) {
      setError("Vui lòng nhập tên, đơn vị, số lượng hợp lệ và đơn giá cho mỗi dòng sản phẩm bổ sung.");
      return;
    }
    if (quote) {
      let confirmation: ConfirmOptions | undefined;
      if (url.endsWith("/approve")) confirmation = { title: "Duyệt báo giá này?", message: `${quote.quoteNumber} · ${quote.customerName}\nTổng tiền: ${formatMoney(liveTotal, quote.currency)}\nSau khi duyệt, có thể tải file chính thức và gửi cho khách hàng.`, confirmLabel: "Duyệt báo giá" };
      else if (url.endsWith("/reject")) confirmation = { title: "Trả báo giá để chỉnh sửa?", message: `${quote.quoteNumber} sẽ chuyển về trạng thái cần chỉnh sửa.\nLý do: ${typeof body === "object" && body && "reason" in body ? String(body.reason) : ""}`, confirmLabel: "Trả lại", tone: "danger" };
      else if (url.endsWith("/email")) confirmation = { title: "Gửi báo giá qua email?", message: `Báo giá đã duyệt sẽ được gửi tới ${quote.customerEmail || "khách hàng"}.`, confirmLabel: "Gửi email" };
      if (confirmation && !await confirm(confirmation)) return;
    }
    setBusy(true);
    setError("");
    const taskLabel = url.endsWith("/approve") ? "Đang duyệt báo giá" : url.endsWith("/email") ? "Đang gửi báo giá qua email" : "Đang lưu báo giá";
    setTaskProgress({ label: taskLabel, detail: "Đang cập nhật dữ liệu trên máy chủ…" });
    const saveBeforeApprove = url.endsWith("/approve") && editable && hasUnsavedChanges;
    try {
      if (saveBeforeApprove && quote) {
        await api(`/api/quotes/${quote._id}`, { method: "PATCH", body: JSON.stringify(editPayload()) });
      }
      await api(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await load();
      onChanged();
      onToast(saveBeforeApprove ? "Đã lưu thay đổi và duyệt báo giá." : success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật báo giá.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };

  if (loading) return <Loading />;
  if (!quote) return <div className="empty-state"><h2>Báo giá không khả dụng</h2><p>Vui lòng quay lại danh sách báo giá.</p><button className="button button-soft" onClick={onBack}>Quay lại</button></div>;

  const unresolvedInformation = quote.informationNeeded.filter((field) => {
    if (isTaxMissingInformation(field) || isShippingMissingInformation(field)) return false;
    if (isSupplementalProductInformation(field)) {
      return !supplementalProducts.some((product) => {
        if (product.informationField !== field || !product.name.trim() || !product.unit.trim()) return false;
        const quantity = Number(product.quantity);
        const unitPrice = Number(product.unitPrice);
        return Number.isFinite(quantity) && quantity > 0 && product.unitPrice.trim() !== "" && Number.isFinite(unitPrice) && unitPrice >= 0;
      });
    }
    return !canSupplementMissingInformation(field) || !quote.additionalInformation?.[field]?.trim();
  });
  const hasUnresolvedInformation = unresolvedInformation.length > 0 || !taxRateConfirmed || taxRateText.trim() === "" || !shippingFeeIsConfirmed;
  const supplementalInformation = quote.informationNeeded.filter((field) => !isTaxMissingInformation(field) && !isShippingMissingInformation(field) && !isSupplementalProductInformation(field));
  const unresolvedProductNeeds = unresolvedInformation.filter(isSupplementalProductInformation).map((field) => ({
    field,
    suggestion: quote.suggestedProducts?.find((product) => product.informationField === field),
    draft: supplementalProducts.find((product) => product.informationField === field),
  }));
  const unresolvedOtherInformation = unresolvedInformation.filter((field) => !isSupplementalProductInformation(field));
  const hasUnresolvedProductInformation = unresolvedProductNeeds.length > 0;
  const missingSetupInformation = [
    ...(!shippingFeeIsConfirmed ? ["Phí vận chuyển"] : []),
    ...(!taxRateConfirmed || taxRateText.trim() === "" ? ["VAT"] : []),
  ];
  const catalogLines = quote.lines.filter((line) => line.source !== "supplemental");
  const visibleLineCount = catalogLines.length + supplementalProducts.filter(hasSupplementalProductContent).length;
  const outputExtension = quote.template?.originalFilename.split(".").pop()?.toLowerCase() || "pdf";
  const canPreviewGeneratedFile = quote.status === "approved" || quote.status === "pending_review" || (editable && outputExtension === "xlsx");
  const canExportDraftXlsx = editable && quote.status === "draft" && outputExtension === "xlsx";
  const canDownloadQuote = quote.status === "approved" || canExportDraftXlsx;
  const save = () => perform(`/api/quotes/${quote._id}`, editPayload(), "PATCH", "Đã lưu thay đổi và tính lại giá.");

  const downloadQuote = async () => {
    setBusy(true); setError("");
    const fileLabel = canExportDraftXlsx ? "Đang xuất Excel nháp" : "Đang chuẩn bị file báo giá";
    setTaskProgress({ label: fileLabel, detail: "Đang tạo file từ mẫu báo giá…" });
    try {
      const draftQuery = canExportDraftXlsx ? "?draft=1" : "";
      const response = await fetch(`/api/quotes/${quote._id}/export${draftQuery}`, { credentials: "include" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Không tải được báo giá."); }
      const blob = await responseBlobWithProgress(response, (progress) => setTaskProgress({
        label: canExportDraftXlsx ? "Đang tải file Excel" : "Đang tải file báo giá",
        progress,
        detail: progress === null ? "Máy chủ đã tạo file. Đang tải xuống…" : "Tiến độ tải file",
      }));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${quote.quoteNumber}${canExportDraftXlsx ? "-nhap" : ""}.${quote.template?.originalFilename.split(".").pop()?.toLowerCase() || "pdf"}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast("Đã tải file báo giá.", "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được báo giá."); }
    finally { setBusy(false); setTaskProgress(null); }
  };

  const customerInitials = (customerName || quote.customerName).trim().slice(0, 2).toLocaleUpperCase("vi") || "KH";

  return (
    <div className="page-stack detail-stack">
      {/* Top Navigation */}
      <div className="quote-detail-nav">
        <button type="button" className="quote-back-btn" onClick={onBack}>
          <Icon name="back" size={16} /> Quay lại danh sách báo giá
        </button>
      </div>
      {taskProgress && <TaskProgress {...taskProgress} />}

      {/* Main Header Card */}
      <header className="quote-detail-header-card">
        <div className="quote-header-title-box">
          <div className="quote-number-row">
            <h1 className="quote-number-title">{quote.quoteNumber}</h1>
            <button
              type="button"
              className="quote-copy-badge"
              onClick={() => copyText(quote.quoteNumber, "mã báo giá")}
              title="Sao chép mã báo giá"
            >
              <Icon name="copy" size={12} /> Sao chép
            </button>
            <StatusPill status={quote.status} />
          </div>
          <div className="quote-header-meta">
            <span>Khách hàng: <strong>{customerName || quote.customerName}</strong></span>
            <span className="dot-separator">·</span>
            <span>Ngày tạo: <strong>{formatDate(quote.createdAt)}</strong></span>
            <span className="dot-separator">·</span>
            <span>Người lập: <strong>{user.name}</strong></span>
          </div>
        </div>

        <div className="quote-header-actions">
          {editable && (
            <button
              type="button"
              className={`button ${hasUnsavedChanges ? "button-primary" : "button-soft"}`}
              disabled={busy || !hasUnsavedChanges}
              onClick={() => void save()}
              title="Lưu các thay đổi về số lượng và thông tin khách hàng"
            >
              <Icon name="check" size={16} /> {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          )}

          <button
            type="button"
            className="button button-primary"
            disabled={busy || !canDownloadQuote || hasUnresolvedInformation || hasUnsavedChanges}
            title={hasUnresolvedInformation ? "Cần xử lý thông tin còn thiếu trước khi xuất file" : hasUnsavedChanges ? "Lưu thay đổi trước khi xuất file" : canExportDraftXlsx ? "Xuất Excel nháp trước khi duyệt" : quote.status === "approved" ? "Tải file báo giá chính thức" : "Chỉ có thể xuất Excel nháp hoặc tải file sau khi duyệt"}
            onClick={() => void downloadQuote()}
          >
            <Icon name="download" size={16} />
            {quote.status === "approved" ? "Tải file báo giá" : canExportDraftXlsx ? "Xuất Excel nháp" : "Xuất sau khi duyệt"}
          </button>

          {canApprove && (quote.status === "draft" || quote.status === "pending_review") && (
            <>
              {quote.status === "pending_review" && <button
                type="button"
                className="button button-soft"
                disabled={busy}
                onClick={() => setRejecting((prev) => !prev)}
              >Trả lại chỉnh sửa</button>}
              <button
                type="button"
                className="button button-primary"
                disabled={busy || hasUnresolvedInformation}
                onClick={() => void perform(`/api/quotes/${quote._id}/approve`, {}, "POST", "Báo giá đã được phê duyệt thành công.")}
              >
                <Icon name="check" size={16} /> Duyệt báo giá
              </button>
            </>
          )}

          {canEdit && quote.status === "approved" && (
            <button
              type="button"
              className="button button-soft"
              disabled={busy || !quote.customerEmail || hasUnresolvedInformation}
              title={hasUnresolvedInformation ? "Cần xử lý thông tin còn thiếu trước khi gửi email" : !quote.customerEmail ? "Chưa có email khách hàng" : "Gửi báo giá qua email"}
              onClick={() => void perform("/api/quotes/" + quote._id + "/email", undefined, "POST", "Đã gửi báo giá qua email thành công.")}
            >
              <Icon name="mail" size={16} /> Gửi email
            </button>
          )}

          {canEdit && <button type="button" className="button button-soft quote-delete-action" disabled={busy} onClick={() => onDeleteQuote(quote)}>
            <Icon name="trash" size={16} /> Xóa báo giá
          </button>}

        </div>
      </header>

      {/* Stepper Pipeline */}
      <section className="quote-stepper-card" aria-label="Quy trình xử lý báo giá">
        <div className="quote-stepper">
          <div className={`quote-step-item ${quote.status === "needs_info" ? "is-alert" : "is-done"}`}>
            <span className="quote-step-icon">
              {quote.status === "needs_info" ? "!" : <Icon name="check" size={15} />}
            </span>
            <div className="quote-step-copy">
              <strong>1. Soạn thảo nháp</strong>
              <span>{quote.status === "needs_info" ? "Cần bổ sung tin" : "Đã tạo bản nháp"}</span>
            </div>
          </div>

          <div className={`quote-step-line ${quote.status !== "needs_info" ? "is-done" : ""}`} />

          <div className={`quote-step-item ${quote.status === "rejected" ? "is-alert" : quote.status === "draft" || quote.status === "pending_review" ? "is-current" : quote.status === "approved" ? "is-done" : "is-upcoming"}`}>
            <span className="quote-step-icon">
              {quote.status === "rejected" ? "!" : quote.status === "pending_review" ? <Icon name="clock" size={15} /> : quote.status === "approved" ? <Icon name="check" size={15} /> : "2"}
            </span>
            <div className="quote-step-copy">
              <strong>2. Phê duyệt báo giá</strong>
              <span>{quote.status === "rejected" ? "Cần chỉnh sửa" : quote.status === "pending_review" ? "Đang chờ duyệt" : quote.status === "approved" ? "Đã duyệt" : quote.status === "draft" ? "Sẵn sàng duyệt" : "Cần bổ sung thông tin"}</span>
            </div>
          </div>

          <div className={`quote-step-line ${quote.status === "approved" ? "is-done" : ""}`} />

          <div className={`quote-step-item ${quote.status === "approved" ? "is-done" : "is-upcoming"}`}>
            <span className="quote-step-icon">
              {quote.status === "approved" ? <Icon name="check" size={15} /> : "3"}
            </span>
            <div className="quote-step-copy">
              <strong>3. Xuất & Gửi khách hàng</strong>
              <span>{quote.status === "approved" ? "Sẵn sàng xuất file" : canExportDraftXlsx ? "Có thể xuất Excel nháp" : "Chờ duyệt xong"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Errors & Alerts */}

      {/* Pending Review Action Banner */}
      {quote.status === "pending_review" && (
        <div className="quote-status-banner banner-pending">
          <div className="banner-info-wrap">
            <span className="banner-icon"><Icon name="clock" size={20} /></span>
            <div className="banner-text-box">
              <h3>Báo giá đang chờ phê duyệt</h3>
              <p>Vui lòng đối chiếu sản phẩm, đơn giá và mẫu tài liệu đính kèm trước khi xác nhận phê duyệt.</p>
            </div>
          </div>
          {canApprove && (
            <div className="banner-actions">
              <button type="button" className="button button-soft" onClick={() => setRejecting((prev) => !prev)}>
                Trả lại chỉnh sửa
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busy || hasUnresolvedInformation}
                onClick={() => void perform(`/api/quotes/${quote._id}/approve`, {}, "POST", "Báo giá đã được phê duyệt thành công.")}
              >
                <Icon name="check" size={16} /> Phê duyệt ngay
              </button>
            </div>
          )}
        </div>
      )}

      {/* Rejection Alert Banner */}
      {quote.status === "rejected" && quote.rejectionReason && (
        <div className="quote-status-banner banner-rejected">
          <div className="banner-info-wrap">
            <span className="banner-icon"><Icon name="close" size={20} /></span>
            <div className="banner-text-box">
              <h3>Yêu cầu chỉnh sửa từ người duyệt</h3>
              <p>"{quote.rejectionReason}"</p>
            </div>
          </div>
          <span className="price-list-status inactive">Cần chỉnh sửa lại</span>
        </div>
      )}

      {/* Needs Info Banner */}
      {hasUnresolvedInformation && (
        <div className="quote-status-banner banner-needs-info">
          <div className="banner-info-wrap">
            <span className="banner-icon"><Icon name="spark" size={20} /></span>
            <div className="banner-text-box">
              <h3>Còn thông tin cần bổ sung</h3>
              <p>{[
                ...unresolvedOtherInformation,
                ...missingSetupInformation.map((field) => `${field}: chưa xác nhận`),
              ].join(" · ") || "Cần hoàn tất các hạng mục bên dưới."}</p>
            </div>
          </div>
          <p className="field-hint">Cần chốt các mục này trước khi gửi duyệt.</p>
          {hasUnresolvedProductInformation && <div className="quote-missing-product-list" aria-label="Hạng mục chưa ghép được">
            {unresolvedProductNeeds.map(({ field, suggestion, draft }) => {
              const name = draft ? draft.name.trim() : suggestion?.name?.trim() ?? "";
              const label = name || suggestedNameFromMissingField(field) || field;
              const unit = draft ? draft.unit.trim() : suggestion?.unit.trim() ?? "";
              const quantity = draft ? Number(draft.quantity) : suggestion?.quantity ?? 0;
              const quantityLabel = Number.isFinite(quantity) && quantity > 0 && unit
                ? `${quantity} ${normalizedSupplementalUnit(unit)}`
                : "Chưa có số lượng / đơn vị";
              const unitPriceText = draft?.unitPrice ?? "";
              const unitPrice = Number(unitPriceText);
              const missingFields = [
                ...(!name ? ["tên hạng mục"] : []),
                ...(!unit ? ["đơn vị"] : []),
                ...(!Number.isFinite(quantity) || quantity <= 0 ? ["số lượng"] : []),
                ...(!unitPriceText.trim() || !Number.isFinite(unitPrice) || unitPrice < 0 ? ["đơn giá"] : []),
              ];
              return <div className="quote-missing-product" key={field}>
                <div><strong>{label}</strong><span>{quantityLabel} · Bảng giá chưa có mã phù hợp; cần bổ sung: {missingFields.join(", ") || "thông tin xác nhận"}.</span></div>
              </div>;
            })}
          </div>}
        </div>
      )}

      {(editable || supplementalInformation.length > 0 || supplementalProducts.length > 0) && (
        <section className="content-card quote-supplement-card">
          <div className="section-title quote-terms-heading">
            <div><h2>Thông tin bổ sung</h2></div>
          </div>
          {supplementalInformation.length > 0 && <div className="quote-supplement-fields">
            {supplementalInformation.map((field, index) => (
              <div className="quote-supplement-field" key={field}>
                <label className="quote-supplement-field-heading" htmlFor={`supplement-${quote._id}-${index}`}>
                  {field}
                  {isSupplementalProductInformation(field) ? <small>Nhập thành dòng sản phẩm bên dưới</small>
                    : Boolean((quote.additionalInformation?.[field] ?? "").trim()) && (quote.additionalInformation?.[field] ?? "").trim() === (additionalInformation[field] ?? "").trim() && <small>Đã lưu</small>}
                </label>
                {isSupplementalProductInformation(field) ? (
                  <small>Điền tên sản phẩm, quy cách, đơn vị, số lượng và đơn giá ở bảng sản phẩm bổ sung.</small>
                ) : (
                  <textarea id={`supplement-${quote._id}-${index}`} rows={2} maxLength={2000} value={additionalInformation[field] ?? ""} disabled={!editable || busy} placeholder="Nhập thông tin đã xác nhận…" onChange={(event) => setAdditionalInformation((current) => ({ ...current, [field]: event.target.value }))} />
                )}
                {!isSupplementalProductInformation(field) && <small>{(additionalInformation[field] ?? "").length}/2.000 ký tự</small>}
              </div>
            ))}
          </div>}

          <div className="quote-supplement-products">
            <div className="quote-supplement-products-heading">
              <div><strong>Sản phẩm / hạng mục bổ sung</strong><small>Tổng dòng hàng được tính từ số lượng × đơn giá.</small></div>
              {editable && <button type="button" className="button button-soft" disabled={busy} onClick={() => setSupplementalProducts((current) => [...current, createSupplementalProductDraft()])}><Icon name="plus" size={15} /> Thêm dòng</button>}
            </div>
            {supplementalProducts.length > 0 ? <div className="quote-supplement-product-wrap">
              <table className="quote-supplement-product-table">
                <thead><tr><th>Tên sản phẩm & quy cách</th><th>Đơn vị</th><th>Số lượng</th><th>Đơn giá ({quote.currency})</th><th>Thành tiền</th><th aria-label="Thao tác" /></tr></thead>
                <tbody>{supplementalProducts.map((product) => {
                  const quantity = Number(product.quantity);
                  const unitPrice = Number(product.unitPrice);
                  const hasUnitPrice = product.unitPrice.trim() !== "" && Number.isFinite(unitPrice) && unitPrice >= 0;
                  const missingProductFields = [
                    ...(!product.name.trim() ? ["tên hạng mục"] : []),
                    ...(!product.unit.trim() ? ["đơn vị"] : []),
                    ...(!product.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0 ? ["số lượng"] : []),
                    ...(!hasUnitPrice ? ["đơn giá"] : []),
                  ];
                  const lineTotal = Number.isFinite(quantity) && quantity > 0 && hasUnitPrice ? Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100 : 0;
                  const unitOptions = supplementalUnitOptions.includes(product.unit) ? supplementalUnitOptions : [product.unit, ...supplementalUnitOptions];
                  const updateProduct = (patch: Partial<SupplementalProductDraft>) => setSupplementalProducts((current) => current.map((row) => row.id === product.id ? { ...row, ...patch } : row));
                  return <tr key={product.id}>
                    <td><input value={product.name} maxLength={250} disabled={!editable || busy} placeholder="Tên sản phẩm / hạng mục" aria-label="Tên sản phẩm bổ sung" onChange={(event) => updateProduct({ name: event.target.value })} /><input value={product.description} maxLength={2000} disabled={!editable || busy} placeholder="Quy cách / mô tả" aria-label="Quy cách sản phẩm bổ sung" onChange={(event) => updateProduct({ description: event.target.value })} />{product.informationField && <small>Bổ sung cho: {product.informationField}</small>}{missingProductFields.length > 0 && <small className="quote-supplement-row-missing">Cần bổ sung: {missingProductFields.join(", ")}</small>}</td>
                    <td><select value={product.unit} disabled={!editable || busy} aria-label="Đơn vị tính" onChange={(event) => updateProduct({ unit: event.target.value })}>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></td>
                    <td><input type="number" min="0.01" step="any" value={product.quantity} disabled={!editable || busy} placeholder="0" aria-label="Số lượng" onChange={(event) => updateProduct({ quantity: event.target.value })} /></td>
                    <td><input type="number" min="0" step="any" value={product.unitPrice} disabled={!editable || busy} placeholder="0" aria-label="Đơn giá" onChange={(event) => updateProduct({ unitPrice: event.target.value })} /></td>
                    <td><strong>{hasUnitPrice ? formatMoney(lineTotal, quote.currency) : "—"}</strong></td>
                    <td>{editable && <button type="button" className="icon-button remove-button" disabled={busy} aria-label="Xóa dòng bổ sung" onClick={() => setSupplementalProducts((current) => current.filter((row) => row.id !== product.id))}><Icon name="close" size={15} /></button>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div> : <p className="quote-supplement-empty">Chưa có dòng bổ sung. Bấm “Thêm dòng” để nhập hạng mục mới.</p>}
          </div>
          {editable && hasUnsavedChanges && <div className="quote-supplement-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Đang lưu…" : "Lưu thông tin bổ sung"}
            </button>
          </div>}
        </section>
      )}

      {/* Inline Reject Form */}
      {rejecting && (
        <div className="content-card reject-form">
          <label>
            Lý do cần chỉnh sửa
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ghi rõ các nội dung hoặc sản phẩm cần điều chỉnh lại để nhân viên sửa đổi…"
            />
          </label>
          <div className="review-actions">
            <button type="button" className="button button-soft" onClick={() => setRejecting(false)}>Hủy</button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !reason.trim()}
              onClick={() => void perform(`/api/quotes/${quote._id}/reject`, { reason }, "POST", "Đã trả báo giá để chỉnh sửa.")}
            >
              Gửi nhận xét trả lại
            </button>
          </div>
        </div>
      )}

      {/* 2-Column Responsive Layout */}
      <div className="quote-detail-layout">
        {/* Main Content Column */}
        <main className="quote-main-column">
          {/* Customer Request Card */}
          <section className="quote-request-card">
            <div className="quote-card-header">
              <span className="quote-card-title">
                <Icon name="quote" size={16} /> Nội dung yêu cầu từ khách hàng
              </span>
              {quote.requestText && (
                <button
                  type="button"
                  className="quote-mini-icon-btn"
                  onClick={() => copyText(quote.requestText ?? "", "nội dung yêu cầu")}
                  title="Sao chép nội dung yêu cầu"
                >
                  <Icon name="copy" size={14} />
                </button>
              )}
            </div>
            <p className="quote-request-bubble">
              {quote.requestText?.trim() || (quote.requestFile ? `Yêu cầu được gửi đính kèm trong file: ${quote.requestFile.originalFilename}` : "Không có văn bản yêu cầu cụ thể.")}
            </p>
          </section>

          <section className="content-card quote-terms-panel">
            <div className="section-title quote-terms-heading"><div><h2>Chi phí & điều khoản</h2><p>Chưa chốt sẽ chưa vào tổng.</p></div></div>
            <div className="quote-terms-grid">
              <div className="quote-fee-control">
                <label className="quote-fee-label" htmlFor={`shipping-mode-${quote._id}`}>Vận chuyển</label>
                <div className="quote-fee-row">
                  <select id={`shipping-mode-${quote._id}`} value={shippingMode} disabled={!editable || busy} onChange={(event) => chooseShippingMode(event.target.value as ShippingMode)}>
                    <option value="unconfirmed">Chưa chốt</option><option value="free">Miễn phí</option><option value="paid">Tính phí</option>
                  </select>
                  {shippingMode === "paid" && <input type="number" min="0.01" step="1" value={shippingFeeText} disabled={!editable || busy} placeholder={quote.currency} aria-label={`Phí vận chuyển (${quote.currency})`} onChange={(event) => setShippingFeeText(event.target.value)} />}
                </div>
              </div>
              <div className="quote-fee-control">
                <label className="quote-fee-label" htmlFor={`tax-mode-${quote._id}`}>Thuế VAT</label>
                <div className="quote-fee-row">
                  <select id={`tax-mode-${quote._id}`} value={taxMode} disabled={!editable || busy} onChange={(event) => chooseTaxMode(event.target.value as TaxMode)}>
                    <option value="unconfirmed">Chưa chốt</option><option value="zero">0%</option><option value="rate">Tính VAT</option>
                  </select>
                  {taxMode === "rate" && <input type="number" min="0" max="100" step="any" value={taxRateText} disabled={!editable || busy} placeholder="%" aria-label="Thuế suất VAT (%)" onChange={(event) => { setTaxRateText(event.target.value); setTaxRateConfirmed(event.target.value.trim() !== "" && Number.isFinite(Number(event.target.value)) && Number(event.target.value) >= 0); }} />}
                </div>
              </div>
              <label>Hiệu lực (ngày)
                <input type="number" min="1" max="3650" step="1" value={validityDaysText} disabled={!editable || busy} placeholder="Ví dụ: 30" onChange={(event) => setValidityDaysText(event.target.value)} />
              </label>
              <label>Hạn hoàn thành
                <input type="date" value={completionDateText} disabled={!editable || busy} onChange={(event) => setCompletionDateText(event.target.value)} />
              </label>
            </div>
          </section>

          {/* Products & Pricing Table Card */}
          <section className="quote-products-card">
            <div className="quote-products-header">
              <div className="quote-products-title">
                <h2>Chi tiết sản phẩm & đơn giá</h2>
                <span className="quote-badge-count">{visibleLineCount} sản phẩm</span>
                {hasUnsavedChanges && (
                  <span className="quote-unsaved-badge">
                    ● Có thay đổi chưa lưu
                  </span>
                )}
              </div>
              {editable && hasUnsavedChanges && (
                <button
                  type="button"
                  className="button button-primary button-compact"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  Lưu thay đổi giá
                </button>
              )}
            </div>

            <div className="quote-table-wrapper">
              <table className="quote-modern-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Sản phẩm & Quy cách</th>
                    <th className="col-unit">Đơn vị</th>
                    <th className="col-qty">Số lượng</th>
                    <th className="col-amount">Đơn giá</th>
                    <th className="col-amount">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogLines.map((line, index) => {
                    const lineQty = Number(quantities[line.catalogItemId]) || line.quantity;
                    const lineTotal = lineQty * line.unitPrice;
                    return (
                      <tr key={line.catalogItemId}>
                        <td className="quote-item-index">{index + 1}</td>
                        <td>
                          <div className="quote-item-details">
                            <div className="quote-item-title-row">
                              <span className="quote-item-name">{line.name}</span>
                              <span className="quote-item-sku">{line.sku}</span>
                            </div>
                            {line.description && (
                              <span className="quote-item-desc">{line.description}</span>
                            )}
                            {Object.keys(line.catalogAttributes ?? {}).length > 0 && (
                              <div className="quote-item-attributes">
                                {Object.entries(line.catalogAttributes ?? {}).map(([key, value]) => (
                                  <span key={key} className="quote-item-attr-chip">
                                    <strong>{key}:</strong> {value}
                                  </span>
                                ))}
                              </div>
                            )}
                            {Object.keys(line.attributes ?? {}).length > 0 && (
                              <div className="quote-item-evidence">
                                <Icon name="spark" size={13} /> Khách yêu cầu: {Object.entries(line.attributes ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="col-unit">
                          <span className="quote-unit-label">{line.unit}</span>
                        </td>
                        <td className="col-qty">
                          <div className="quote-qty-input-box">
                            {editable ? (
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                className="quote-qty-input"
                                value={quantities[line.catalogItemId] ?? line.quantity}
                                onChange={(event) =>
                                  setQuantities((prev) => ({
                                    ...prev,
                                    [line.catalogItemId]: Number(event.target.value),
                                  }))
                                }
                                aria-label={`Số lượng cho ${line.name}`}
                              />
                            ) : (
                              <span className="quote-qty-static">{line.quantity}</span>
                            )}
                          </div>
                        </td>
                        <td className="col-amount">
                          <span className="quote-price-cell">{formatMoney(line.unitPrice, line.currency)}</span>
                        </td>
                        <td className="col-amount">
                          <strong className="quote-total-cell">{formatMoney(lineTotal, line.currency)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="quote-totals-container">
              <div className="quote-totals-card">
                <div className="quote-total-row">
                  <span>Tạm tính hàng hóa ({visibleLineCount} sản phẩm):</span>
                  <strong>{formatMoney(liveSubtotal, quote.currency)}</strong>
                </div>
                <div className="quote-total-row">
                  <span>{taxRateConfirmed ? `Thuế VAT (${(Number(taxRateText) || 0).toLocaleString("vi-VN")}%):` : "Thuế VAT (chưa xác nhận):"}</span>
                  <strong>{taxRateConfirmed && taxRateText.trim() !== "" ? formatMoney(liveTaxAmount, quote.currency) : "Chưa xác nhận"}</strong>
                </div>
                <div className="quote-total-row">
                  <span>Phí vận chuyển:</span>
                  <strong>{shippingFeeIsConfirmed ? formatMoney(liveShippingFee, quote.currency) : "Chưa xác nhận"}</strong>
                </div>
                <div className="quote-grand-total-row">
                  <span>Tổng tiền thanh toán:</span>
                  <strong>{formatMoney(liveTotal, quote.currency)}</strong>
                </div>
                {hasUnresolvedInformation && <small className="quote-total-pending-note">Tạm tính chưa bao gồm các khoản còn thiếu trong danh sách xác nhận.</small>}
              </div>
            </div>
          </section>
        </main>

        {/* Sidebar Information Column */}
        <aside className="quote-side-column">
          {/* Customer Profile Card */}
          <section className="quote-side-card">
            <div className="quote-side-title">
              <span>Thông tin khách hàng</span>
              {editable && !editingCustomer && (
                <button
                  type="button"
                  className="quote-mini-icon-btn"
                  onClick={() => setEditingCustomer(true)}
                  title="Chỉnh sửa thông tin khách"
                >
                  <Icon name="edit" size={14} />
                </button>
              )}
            </div>

            {editingCustomer ? (
              <form
                className="quote-customer-edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                  setEditingCustomer(false);
                }}
              >
                <label>
                  Tên khách hàng
                  <input
                    required
                    maxLength={250}
                    value={customerName}
                    disabled={busy}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    maxLength={250}
                    value={customerEmail}
                    disabled={busy}
                    placeholder="email@example.com"
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                </label>
                <label>
                  Số điện thoại
                  <input
                    type="tel"
                    maxLength={50}
                    value={customerPhone}
                    disabled={busy}
                    placeholder="0912 345 678"
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </label>
                <div className="quote-edit-actions">
                  <button
                    type="button"
                    className="button button-soft"
                    onClick={() => {
                      setCustomerName(quote.customerName);
                      setCustomerEmail(quote.customerEmail);
                      setCustomerPhone(quote.customerPhone ?? "");
                      setEditingCustomer(false);
                    }}
                  >
                    Hủy
                  </button>
                  <button type="submit" className="button button-primary" disabled={busy || !customerName.trim()}>
                    Lưu
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="quote-customer-profile">
                  <div className="quote-customer-avatar">{customerInitials}</div>
                  <div className="quote-customer-info">
                    <strong className="quote-customer-name">{customerName || quote.customerName}</strong>
                    <span className="table-subtext">Khách hàng báo giá</span>
                  </div>
                </div>

                <div className="quote-customer-contact-list">
                  <div className="quote-contact-item">
                    <div className="quote-contact-left">
                      <Icon name="mail" size={15} />
                      <span>{customerEmail || quote.customerEmail || "Chưa có email"}</span>
                    </div>
                    {customerEmail && (
                      <button
                        type="button"
                        className="quote-mini-icon-btn"
                        onClick={() => copyText(customerEmail, "email khách hàng")}
                        title="Sao chép email"
                      >
                        <Icon name="copy" size={12} />
                      </button>
                    )}
                  </div>

                  <div className="quote-contact-item">
                    <div className="quote-contact-left">
                      <Icon name="phone" size={15} />
                      <span>{customerPhone || quote.customerPhone || "Chưa có số điện thoại"}</span>
                    </div>
                    {customerPhone && (
                      <button
                        type="button"
                        className="quote-mini-icon-btn"
                        onClick={() => copyText(customerPhone, "số điện thoại")}
                        title="Sao chép số điện thoại"
                      >
                        <Icon name="copy" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>

          {/* Reference Documents Card */}
          <section className="quote-side-card">
            <div className="quote-side-title">
              <span>Tài liệu & Hồ sơ mẫu</span>
            </div>

            <div className="stored-files-list">
              {quote.template && (
                <div className="quote-doc-item">
                  <div className="quote-doc-left">
                    <span className="quote-doc-icon"><Icon name="file" size={16} /></span>
                    <div className="quote-doc-info">
                      <strong title={quote.template.name || quote.template.originalFilename}>
                        {quote.template.name || quote.template.originalFilename}
                      </strong>
                      <span>Mẫu báo giá chuẩn</span>
                    </div>
                  </div>
                  <div className="quote-doc-actions">
                    <button
                      type="button"
                      className="button button-soft"
                      onClick={() => setPreviewFile({ name: quote.template!.originalFilename, url: `/api/quote-template/${quote.template!.id}/file?preview=1` })}
                    >
                      Xem
                    </button>
                    <a className="button button-soft" href={`/api/quote-template/${quote.template.id}/file`} title="Tải file mẫu gốc">
                      Tải
                    </a>
                  </div>
                </div>
              )}

              {quote.priceList && (
                <div className="quote-doc-item">
                  <div className="quote-doc-left">
                    <span className="quote-doc-icon"><Icon name="box" size={16} /></span>
                    <div className="quote-doc-info">
                      <strong title={quote.priceList.originalFilename}>{quote.priceList.originalFilename}</strong>
                      <span>Bảng giá đã nạp</span>
                    </div>
                  </div>
                  <div className="quote-doc-actions">
                    <button
                      type="button"
                      className="button button-soft"
                      onClick={() => setPreviewFile({ name: quote.priceList!.originalFilename, url: `/api/price-list/${quote.priceList!.id}/file` })}
                    >
                      Xem
                    </button>
                  </div>
                </div>
              )}

              {quote.requestFile && (
                <div className="quote-doc-item">
                  <div className="quote-doc-left">
                    <span className="quote-doc-icon"><Icon name="spark" size={16} /></span>
                    <div className="quote-doc-info">
                      <strong title={quote.requestFile.originalFilename}>{quote.requestFile.originalFilename}</strong>
                      <span>Tệp yêu cầu gốc</span>
                    </div>
                  </div>
                  <div className="quote-doc-actions">
                    <button
                      type="button"
                      className="button button-soft"
                      onClick={() => setPreviewFile({ name: quote.requestFile!.originalFilename, url: `/api/quotes/${quote._id}/request-file/preview` })}
                    >
                      Xem
                    </button>
                  </div>
                </div>
              )}

              {canPreviewGeneratedFile && (
                <div className="quote-doc-item">
                  <div className="quote-doc-left">
                    <span className="quote-doc-icon"><Icon name="eye" size={16} /></span>
                    <div className="quote-doc-info">
                      <strong>{quote.status === "approved" ? "Bản báo giá điền hoàn chỉnh" : canExportDraftXlsx ? "File Excel nháp" : "Xem trước file báo giá"}</strong>
                      <span>{quote.status === "approved" ? "File chính thức đã duyệt" : quote.status === "pending_review" ? "Bản xem trước phê duyệt" : canExportDraftXlsx ? "Có thể tải trước khi duyệt" : "File Excel được tạo từ báo giá"}</span>
                    </div>
                  </div>
                  <div className="quote-doc-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || hasUnresolvedInformation || hasUnsavedChanges}
                      title={hasUnsavedChanges ? "Lưu thay đổi trước khi xem trước file" : undefined}
                      onClick={() => setPreviewFile({ name: `${quote.quoteNumber}.${outputExtension}`, url: `/api/quotes/${quote._id}/export?preview=1` })}
                    >
                      {outputExtension === "xlsx" ? "Xem trước Excel" : "Xem trước"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Audit & Guarantee Policy Card */}
          <section className="quote-side-card">
            <div className="quote-side-title">
              <span>Thông tin chứng từ</span>
            </div>

            <div className="quote-meta-rows">
              <div className="quote-meta-row">
                <span>Mã hệ thống:</span>
                <strong>{quote.quoteNumber}</strong>
              </div>
              <div className="quote-meta-row">
                <span>Trạng thái:</span>
                <StatusPill status={quote.status} />
              </div>
              <div className="quote-meta-row">
                <span>Thời gian lập:</span>
                <strong>{formatDate(quote.createdAt)}</strong>
              </div>
              <div className="quote-meta-row">
                <span>Tiền tệ:</span>
                <strong>{quote.currency || "VND"}</strong>
              </div>
            </div>

          </section>
        </aside>
      </div>

      <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

function AccountProfile({ user, onToast, onSignOut, confirm, subscriptionExpiresAt, requestedPlanCode, onInitialPlanHandled, onBillingPaid }: { user: User; onToast: Notify; onSignOut: () => void; confirm: (options: ConfirmOptions) => Promise<boolean>; subscriptionExpiresAt: string | null; requestedPlanCode: string | null; onInitialPlanHandled: () => void; onBillingPaid: () => void }) {
  const plan = user.plan;
  return <div className="page-stack profile-page">
    <section className="page-heading-row"><div><h1>Trang cá nhân</h1><p className="muted">Quản lý tài khoản, email gửi báo giá và tệp doanh nghiệp.</p></div><button type="button" className="profile-signout" onClick={() => void confirm({ title: "Đăng xuất khỏi tài khoản?", message: "Bạn sẽ cần đăng nhập lại để tiếp tục làm việc.", confirmLabel: "Đăng xuất", tone: "danger", dismissWithClose: true }).then((accepted) => { if (accepted) onSignOut(); })}><Icon name="logout" size={17} />Đăng xuất</button></section>
    <div className="profile-left-column">
      <section className="content-card profile-overview">
        <div className="profile-identity">
          <span className="profile-overview-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toLocaleUpperCase("vi") || "?"}</span>
          <div className="profile-overview-copy"><strong>{user.name}</strong><span className="profile-email">{user.email}</span><small className="profile-role">{roleLabels[user.role]}</small></div>
        </div>
      </section>
      <section className="content-card profile-plan-card">
        <div className="profile-plan-main"><span className="profile-plan-icon"><Icon name="check" size={19} /></span><div><span className="profile-plan-eyebrow">Gói đang sử dụng</span><h2>{plan?.name ?? "Dùng thử"}</h2><p>{plan?.description ?? "Gói miễn phí mặc định của iGen Baogia."}</p></div></div>
        <div className="profile-plan-details"><span><small>Giá gói</small><strong>{plan?.monthlyPrice === null ? "Theo nhu cầu" : plan?.monthlyPrice ? `${new Intl.NumberFormat("vi-VN").format(plan.monthlyPrice)}đ / tháng` : "Miễn phí"}</strong></span><span><small>Báo giá</small><strong>{plan?.quoteLimit == null ? "Theo nhu cầu" : `${new Intl.NumberFormat("vi-VN").format(plan.quoteLimit)} lượt / tháng`}</strong></span><span><small>Mẫu báo giá</small><strong>{plan?.templateLimit == null ? "Theo nhu cầu" : `${new Intl.NumberFormat("vi-VN").format(plan.templateLimit)} mẫu`}</strong></span></div>
      </section>
      <CompanyFiles onToast={onToast} confirm={confirm} />
    </div>
    <SubscriptionBillingPanel currentPlanCode={plan?.code ?? "free"} subscriptionExpiresAt={subscriptionExpiresAt} initialPlanCode={requestedPlanCode} onInitialPlanHandled={onInitialPlanHandled} onPaid={onBillingPaid} />
    <CompanySettings onToast={onToast} confirm={confirm} />
  </div>;
}

function SmtpSecurityDropdown({ secure, onChange }: { secure: boolean; onChange: (secure: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = [
    { value: false, label: "STARTTLS (thường dùng cổng 587)" },
    { value: true, label: "TLS (thường dùng cổng 465)" },
  ];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return <div className={`smtp-security-dropdown ${open ? "is-open" : ""}`} ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="smtp-security-trigger" aria-label="Kiểu bảo mật" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{options.find((option) => option.value === secure)?.label}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="smtp-security-menu" role="listbox" aria-label="Kiểu bảo mật">
      {options.map((option) => <button key={String(option.value)} type="button" role="option" aria-selected={secure === option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>{option.label}</button>)}
    </div>}
  </div>;
}

interface BillingPayment {
  id: string;
  code: string;
  amount: number;
  planCode: string;
  planName: string;
  status: "pending" | "paid" | "superseded";
  qrUrl?: string;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
  createdAt: string;
  paidAt?: string | null;
}

function SubscriptionBillingPanel({ currentPlanCode, subscriptionExpiresAt, initialPlanCode, onInitialPlanHandled, onPaid }: { currentPlanCode: string; subscriptionExpiresAt: string | null; initialPlanCode: string | null; onInitialPlanHandled: () => void; onPaid: () => void }) {
  const [plans, setPlans] = useState<SubscriptionPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [payment, setPayment] = useState<BillingPayment | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const notify = useAppNotification();
  const autoCheckoutStarted = useRef(false);

  useEffect(() => {
    let active = true;
    api<{ plans: SubscriptionPlanSummary[] }>("/api/plans").then(({ plans: available }) => {
      if (active) setPlans(available.filter((plan) => plan.monthlyPrice !== null && plan.monthlyPrice > 0));
    }).catch((cause) => {
      if (active) notify(cause instanceof Error ? cause.message : "Không tải được các gói dịch vụ.", "error");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notify]);

  const beginCheckout = useCallback(async (planCode: string) => {
    setBusyPlan(planCode);
    setTaskProgress({ label: "Đang tạo mã thanh toán", detail: "Đang chuẩn bị QR SePay cho gói đã chọn…" });
    try {
      const { payment: nextPayment } = await api<{ payment: BillingPayment }>("/api/billing/payments", {
        method: "POST",
        body: JSON.stringify({ planCode }),
      });
      setPayment(nextPayment);
      notify("Đã tạo mã thanh toán. Quét QR để hoàn tất đăng ký gói.", "info");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không thể tạo yêu cầu thanh toán.", "error");
    } finally {
      setBusyPlan(null);
      setTaskProgress(null);
    }
  }, [notify]);

  useEffect(() => {
    if (!initialPlanCode || loading || autoCheckoutStarted.current) return;
    autoCheckoutStarted.current = true;
    onInitialPlanHandled();
    if (!plans.some((plan) => plan.code === initialPlanCode)) {
      notify("Gói được chọn không còn khả dụng. Vui lòng chọn gói khác.", "error");
      return;
    }
    void beginCheckout(initialPlanCode);
  }, [beginCheckout, initialPlanCode, loading, notify, onInitialPlanHandled, plans]);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const { payment: current } = await api<{ payment: BillingPayment }>(`/api/billing/payments/${encodeURIComponent(payment.id)}`);
        if (!active) return;
        setPayment((existing) => existing?.id === current.id ? { ...existing, ...current, qrUrl: existing.qrUrl, bankCode: existing.bankCode, accountNumber: existing.accountNumber, accountName: existing.accountName } : existing);
        if (current.status === "paid") {
          notify(`Đã xác nhận thanh toán gói ${current.planName}. Gói được kích hoạt tự động.`, "success");
          onPaid();
          return;
        }
      } catch { /* Keep polling; the user can still use the manual refresh button. */ }
      if (active) timer = window.setTimeout(() => void poll(), 4000);
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [payment?.id, payment?.status, notify, onPaid]);

  const refreshPayment = async () => {
    if (!payment) return;
    setCheckingPayment(true);
    try {
      const { payment: current } = await api<{ payment: BillingPayment }>(`/api/billing/payments/${encodeURIComponent(payment.id)}`);
      setPayment((existing) => existing?.id === current.id ? { ...existing, ...current, qrUrl: existing.qrUrl, bankCode: existing.bankCode, accountNumber: existing.accountNumber, accountName: existing.accountName } : existing);
      if (current.status === "paid") {
        notify(`Đã xác nhận thanh toán gói ${current.planName}. Gói được kích hoạt tự động.`, "success");
        onPaid();
      } else notify("Chưa nhận được thanh toán. Hệ thống sẽ tự kiểm tra lại.", "info");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không kiểm tra được trạng thái thanh toán.", "error");
    } finally { setCheckingPayment(false); }
  };

  return <section className="content-card subscription-billing-card">
    <div className="settings-card-heading"><div><span className="eyebrow">THANH TOÁN QUA SEPAY</span><h2>Chọn gói dịch vụ</h2><p className="muted">Gói được kích hoạt sau khi SePay xác nhận chuyển khoản.</p></div></div>
    {taskProgress && <TaskProgress {...taskProgress} />}
    {subscriptionExpiresAt && <p className="subscription-expiry">Gói hiện tại có hiệu lực đến {formatDate(subscriptionExpiresAt)}.</p>}
    {loading ? <TaskProgress label="Đang tải các gói dịch vụ" /> : plans.length ? <div className="subscription-plan-grid">{plans.map((plan) => {
      const current = plan.code === currentPlanCode;
      const hasExpiry = Boolean(subscriptionExpiresAt);
      return <article className={`subscription-plan-option ${current ? "is-current" : ""}`} key={plan.code}>
        <div><strong>{plan.name}</strong><span>{plan.description}</span></div>
        <b>{new Intl.NumberFormat("vi-VN").format(plan.monthlyPrice ?? 0)}đ <small>/ tháng</small></b>
        <p>{plan.quoteLimit == null ? "Không giới hạn báo giá" : `${new Intl.NumberFormat("vi-VN").format(plan.quoteLimit)} báo giá/tháng`} · {plan.templateLimit == null ? "Không giới hạn mẫu" : `${plan.templateLimit} mẫu`}</p>
        <button type="button" className={`button ${current && !hasExpiry ? "button-soft" : "button-primary"}`} disabled={Boolean(busyPlan) || (current && !hasExpiry)} onClick={() => void beginCheckout(plan.code)}>
          {busyPlan === plan.code ? "Đang tạo mã…" : current && !hasExpiry ? "Đang sử dụng" : current ? "Gia hạn gói" : currentPlanCode === "free" ? "Nâng cấp gói" : "Chọn gói"}
        </button>
      </article>;
    })}</div> : <div className="empty-state"><p>Chưa có gói trả phí khả dụng.</p></div>}
    {payment && <div className="billing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPayment(null); }}>
      <section className="billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
        <button type="button" className="icon-button billing-modal-close" aria-label="Đóng" onClick={() => setPayment(null)}>×</button>
        <span className="eyebrow">SEPAY · {payment.status === "paid" ? "ĐÃ THANH TOÁN" : payment.status === "superseded" ? "MÃ ĐÃ ĐƯỢC THAY THẾ" : "CHỜ THANH TOÁN"}</span>
        <h2 id="billing-modal-title">Thanh toán gói {payment.planName}</h2>
        {payment.status === "paid" ? <div className="billing-success"><span aria-hidden="true">✓</span><strong>Thanh toán thành công</strong><p>Gói dịch vụ đã được cập nhật tự động.</p></div> : payment.status === "superseded" ? <p>Mã thanh toán này đã được thay bằng yêu cầu mới. Hãy chọn gói để tạo mã khác.</p> : <>
          {payment.qrUrl && <img className="billing-qr" src={payment.qrUrl} alt={`QR thanh toán ${payment.amount.toLocaleString("vi-VN")} đồng`} />}
          <strong className="billing-amount">{new Intl.NumberFormat("vi-VN").format(payment.amount)}đ</strong>
          <p className="billing-instruction">Quét QR bằng ứng dụng ngân hàng và giữ nguyên nội dung chuyển khoản.</p>
          <dl className="billing-transfer-details"><div><dt>Ngân hàng</dt><dd>{payment.bankCode}</dd></div><div><dt>Tài khoản</dt><dd>{payment.accountNumber}</dd></div>{payment.accountName && <div><dt>Chủ tài khoản</dt><dd>{payment.accountName}</dd></div>}<div><dt>Nội dung</dt><dd>{payment.code}</dd></div></dl>
          <p className="billing-pending-note">Đang tự kiểm tra thanh toán…</p>
        </>}
        <div className="billing-modal-actions"><button type="button" className="button button-soft" onClick={() => setPayment(null)}>Đóng</button>{payment.status === "pending" && <button type="button" className="button button-primary" disabled={checkingPayment} onClick={() => void refreshPayment()}>{checkingPayment ? "Đang kiểm tra…" : "Kiểm tra ngay"}</button>}</div>
      </section>
    </div>}
  </section>;
}

function CompanySettings({ onToast, confirm }: { onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [settings, setSettings] = useState<CompanyEmailSettings | null>(null);
  const [form, setForm] = useState<CompanyEmailForm>({ host: "", port: "587", secure: false, user: "", password: "", from: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const setError = useCallback((message: string) => { if (message) onToast(message, "error"); }, [onToast]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings: saved } = await api<{ settings: CompanyEmailSettings }>("/api/settings/email");
      setSettings(saved);
      setForm({ host: saved.host, port: String(saved.port), secure: saved.secure, user: saved.user, password: "", from: saved.from });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được cài đặt email.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const update = <K extends keyof CompanyEmailForm>(key: K, value: CompanyEmailForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setTaskProgress({ label: "Đang lưu cấu hình email", detail: "Đang cập nhật cài đặt máy chủ…" });
    setError("");
    try {
      const { settings: saved } = await api<{ settings: CompanyEmailSettings }>("/api/settings/email", {
        method: "PUT",
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      setSettings(saved);
      setForm((current) => ({ ...current, password: "" }));
      onToast("Cài đặt email đã được lưu cho doanh nghiệp.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được cài đặt email.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };
  const testConnection = async () => {
    setTesting(true);
    setTaskProgress({ label: "Đang kiểm tra kết nối SMTP", detail: "Đang kết nối với máy chủ email…" });
    setError("");
    try {
      await api("/api/settings/email/test", { method: "POST" });
      onToast("Kết nối SMTP thành công.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không kết nối được SMTP.");
    } finally {
      setTesting(false);
      setTaskProgress(null);
    }
  };
  const removeSettings = async () => {
    if (!await confirm({ title: "Xóa cấu hình email?", message: "Doanh nghiệp sẽ không thể gửi báo giá qua SMTP cho đến khi cấu hình lại.", confirmLabel: "Xóa cấu hình", tone: "danger" })) return;
    setBusy(true);
    setTaskProgress({ label: "Đang xóa cấu hình email", detail: "Đang cập nhật cài đặt doanh nghiệp…" });
    setError("");
    try {
      await api("/api/settings/email", { method: "DELETE" });
      onToast("Đã xóa cấu hình email của doanh nghiệp.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được cài đặt email.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };
  if (loading) return <div className="profile-settings-loading"><Loading /></div>;
  return <div className="page-stack settings-page">
    <section className="content-card email-settings-card profile-email-settings-card">
      <div className="settings-card-heading"><div><h2>Email gửi báo giá</h2><p className="settings-hint">Cấu hình máy chủ SMTP để gửi báo giá.</p></div><span className={`settings-status ${settings?.configured ? "connected" : "not-connected"}`}>{settings?.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span></div>
    {taskProgress && <TaskProgress {...taskProgress} />}
      <form className="email-settings-form" onSubmit={(event) => void save(event)}>
        <label>Máy chủ SMTP<input type="text" value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="smtp.congty.vn" autoComplete="off" required /></label>
        <div className="email-settings-row">
          <label>Cổng<input type="number" min="1" max="65535" value={form.port} onChange={(event) => update("port", event.target.value)} required /></label>
          <div className="smtp-security-field"><span>Kiểu bảo mật</span><SmtpSecurityDropdown secure={form.secure} onChange={(secure) => update("secure", secure)} /></div>
        </div>
        <label>Tên đăng nhập SMTP<input type="text" value={form.user} onChange={(event) => update("user", event.target.value)} placeholder="Có thể để trống nếu máy chủ không yêu cầu" autoComplete="username" /></label>
        <label>Mật khẩu SMTP<input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={settings?.passwordSet ? "Để trống để giữ mật khẩu đã lưu" : "Nhập mật khẩu hoặc mật khẩu ứng dụng"} autoComplete="new-password" /></label>
        <label>Tên/email người gửi<input type="text" value={form.from} onChange={(event) => update("from", event.target.value)} placeholder="Báo giá ABC <baogia@congty.vn>" required /></label>
        <p className="settings-hint">Mật khẩu được mã hóa và không hiển thị lại. Dùng mật khẩu ứng dụng nếu nhà cung cấp yêu cầu.</p>
        <div className="settings-actions"><div>{settings?.configured && <><button className="button button-soft" type="button" disabled={busy || testing} onClick={() => void testConnection()}>{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</button><button className="text-button settings-delete" type="button" disabled={busy || testing} onClick={() => void removeSettings()}>Xóa cấu hình</button></>}</div><button className="button button-primary" type="submit" disabled={busy || testing}>{busy ? "Đang lưu…" : "Lưu cấu hình"}</button></div>
      </form>
    </section>
  </div>;
}

function CompanyFiles({ onToast, confirm }: { onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [files, setFiles] = useState<CompanyStoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const setError = useCallback((message: string) => { if (message) onToast(message, "error"); }, [onToast]);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { files: storedFiles } = await api<{ files: CompanyStoredFile[] }>("/api/files");
      setFiles(storedFiles);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được danh sách tệp.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    if (file.size > 10 * 1024 * 1024) {
      setError("Tệp không được vượt quá 10 MB.");
      return;
    }
    if (!await confirm({ title: "Tải tệp lên?", message: `${file.name}\nDung lượng: ${(file.size / 1024 / 1024).toFixed(2)} MB`, confirmLabel: "Tải lên" })) return;
    setUploading(true);
    setError("");
    setTaskProgress({ label: "Đang tải tệp lên", detail: file.name });
    try {
      await apiUploadWithProgress<{ file: CompanyStoredFile }>("/api/files", file, {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type || "application/octet-stream",
      }, (progress) => setTaskProgress(progress >= 100
        ? { label: "Đang lưu tệp", detail: "Đang xử lý file trên máy chủ…" }
        : { label: "Đang tải tệp lên", progress, detail: file.name }));
      setTaskProgress({ label: "Đang cập nhật danh sách tệp", detail: "Đang hoàn tất…" });
      await load();
      onToast("Tệp đã được lưu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được tệp lên.");
    } finally {
      setUploading(false);
      setTaskProgress(null);
    }
  };
  if (loading) return <section className="content-card email-settings-card company-files-card"><Loading /></section>;
  return <section className="content-card email-settings-card company-files-card">
    <div className="settings-card-heading"><div><h2>Tệp doanh nghiệp</h2><p className="settings-hint">Ảnh, PDF, CSV và Excel · tối đa 10 MB mỗi tệp</p></div><button className="button button-soft" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? "Đang tải lên…" : "Tải tệp lên"}</button><input ref={fileInput} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.xlsx,.xls" onChange={(event) => void upload(event)} /></div>
    {taskProgress && <TaskProgress {...taskProgress} />}
    <div className="stored-files-section">
      {files.length ? <div className="stored-files-list">{files.map((file) => <div className="stored-file-row" key={file._id ?? `${file.originalFilename}-${file.createdAt}`}><span className="stored-file-icon"><Icon name="file" size={16} /></span><span><strong>{file.originalFilename}</strong><small>{formatDate(file.createdAt)} · {(file.bytes / 1024).toFixed(0)} KB</small></span><button type="button" className="text-button" disabled={!file._id} onClick={() => setPreviewFile({ name: file.originalFilename, url: `/api/files/${file._id}/preview` })}>Xem trước</button></div>)}</div> : <p className="settings-hint stored-files-empty">Chưa có tệp nào được tải lên.</p>}
    </div>
    <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
  </section>;
}
function QuoteCards({ quotes, onOpen, onDelete, emptyTitle, emptyText }: { quotes: Quote[]; onOpen: (id: string) => void; onDelete?: (quote: Quote) => void; emptyTitle: string; emptyText: string }) {
  if (!quotes.length) return <EmptyState title={emptyTitle} text={emptyText} />;
  return <div className="quote-cards">{quotes.map((quote) => <div className="quote-card-entry" key={quote._id}><button type="button" className="quote-summary-card" onClick={() => onOpen(quote._id)}><span className="quote-summary-top"><strong className="quote-number">{quote.quoteNumber}</strong><StatusPill status={quote.status} /></span><span className="quote-summary-customer"><strong>{quote.customerName}</strong><span>{quote.customerEmail || "Chưa có email"}</span>{quote.customerPhone && <span>{quote.customerPhone}</span>}</span><span className="quote-summary-meta">Tạo {formatDate(quote.createdAt)} · {quote.lines.length} mặt hàng</span><span className="quote-summary-bottom"><span><small>Tổng tiền</small><strong>{formatMoney(quote.total, quote.currency)}</strong></span><Icon name="arrow" size={18} /></span></button>{onDelete && <button type="button" className="quote-card-delete" onClick={() => onDelete(quote)}><Icon name="trash" size={14} /> Xóa báo giá</button>}</div>)}</div>;
}

function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state quote-empty-state"><span className="empty-icon"><img src="/images/quote-empty-3d.svg" alt="" /></span><h3>{title}</h3>{text && <p>{text}</p>}</div>; }
function Loading() { return <TaskProgress label="Đang tải dữ liệu" detail="Vui lòng chờ trong giây lát…" />; }

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/quan-tri") return <AdminApp />;
  if (path === "/dang-nhap" || path === "/dang-ky" || path === "/ung-dung") return <UserApp />;
  if (path === "/") return <LandingPage />;
  return <main className="route-not-found"><div><span>404</span><h1>Không tìm thấy trang</h1><p>Đường dẫn này không tồn tại hoặc đã được thay đổi.</p><a href="/">Về trang chủ</a></div></main>;
}

export default App;
