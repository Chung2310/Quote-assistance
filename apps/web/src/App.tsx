import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, apiUploadWithProgress, formatDate, formatMoney, responseBlobWithProgress } from "./api";
import type { Analysis, AnalysisItem, CatalogItem, Quote, QuoteRequest, QuoteStatus, SuggestedProduct, SubscriptionPlanSummary, User } from "./types";
import AdminApp from "./AdminApp";
import LandingPage from "./LandingPage";
import PriceListPanel from "./PriceListPanel";
import CustomerQuotes from "./CustomerQuotes";
import CustomerQuoteDetail from "./CustomerProductListDetail";
import BudgetPlanner from "./BudgetPlanner";
import FilePreview, { type PreviewFile } from "./FilePreview";
import { QuoteTemplatePanel, type TemplateDetails } from "./QuoteTemplate";
import { NotificationProvider, NotificationToast, TaskProgress, useAppNotification, useConfirmation, useNotification, type ConfirmOptions, type Notify, type TaskProgressState } from "./Feedback";
import "./settings.css";
import "./quote-supplement.css";

type Section = "home" | "quotes" | "budgetPlanner" | "customerQuotes" | "catalog" | "templates" | "profile";
const sectionPaths: Record<Section, string> = {
  home: "/tong-quan",
  quotes: "/bao-gia",
  budgetPlanner: "/tu-van-ngan-sach",
  customerQuotes: "/bao-gia-khach",
  templates: "/mau-bao-gia",
  catalog: "/bang-gia",
  profile: "/tai-khoan",
};

function normalizedPath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

function userRouteForPath(pathname: string): { section: Section; quoteId: string | null } | null {
  const path = normalizedPath(pathname);
  const section = (Object.entries(sectionPaths) as Array<[Section, string]>).find(([, value]) => value === path)?.[0];
  if (section) return { section, quoteId: null };
  const quoteMatch = path.match(/^\/(bao-gia|bao-gia-khach)\/([a-f0-9]{24})$/i);
  return quoteMatch ? { section: quoteMatch[1] === "bao-gia-khach" ? "customerQuotes" : "quotes", quoteId: quoteMatch[2] } : null;
}
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
    template: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    settings: <><path d="M12 3.5 14 5l2.4-.3.8 2.3 2.2 1.1-.7 2.3 1.2 2-1.2 2 .7 2.3-2.2 1.1-.8 2.3L14 19l-2 1.5L10 19l-2.4.3-.8-2.3-2.2-1.1.7-2.3-1.2-2 1.2-2-.7-2.3 2.2-1.1.8-2.3L10 5Z" /><circle cx="12" cy="12" r="3" /></>,
    bars: <><path d="M4 20V13M10 20V9M16 20V5M22 20V2" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></>,
    mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
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
  const initialRoute = useRef(userRouteForPath(window.location.pathname));
  const [section, setSection] = useState<Section>(initialRoute.current?.section ?? "home");
  const [quoteId, setQuoteId] = useState<string | null>(initialRoute.current?.quoteId ?? null);
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
      if (requestedPaidPlan) {
        setRequestedPlanCode(requestedPaidPlan);
        setSection("profile");
        setQuoteId(null);
        window.history.replaceState(null, "", sectionPaths.profile);
      } else if (!userRouteForPath(window.location.pathname)) {
        setSection("home");
        setQuoteId(null);
        window.history.replaceState(null, "", sectionPaths.home);
      }
      setUser(signedIn);
    }).catch(() => {
      setUser(null);
    }).finally(() => setCheckingSession(false));
  }, []);
  useEffect(() => {
    const syncRoute = () => {
      const route = userRouteForPath(window.location.pathname);
      if (route) { setSection(route.section); setQuoteId(route.quoteId); }
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);
  const handleLogin = (signedIn: User, planCode?: string) => {
    const requestedPaidPlan = planCode && planCode !== "free" && /^[a-z][a-z0-9-]{0,60}$/i.test(planCode) ? planCode : null;
    const route = requestedPaidPlan ? { section: "profile" as Section, quoteId: null } : initialRoute.current ?? { section: "home" as Section, quoteId: null };
    window.history.replaceState(null, "", route.quoteId ? `${sectionPaths[route.section]}/${route.quoteId}` : sectionPaths[route.section]);
    setSection(route.section);
    setQuoteId(route.quoteId);
    setRequestedPlanCode(requestedPaidPlan);
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
    if (!signedInUserId || !quoteId || (section !== "quotes" && section !== "customerQuotes")) return;
    let live = true;
    void api<{ quote: Quote }>(`/api/quotes/${quoteId}`).then(({ quote }) => {
      if (!live) return;
      const correctSection = quote.kind === "customer" ? "customerQuotes" : "quotes";
      if (correctSection === section) return;
      window.history.replaceState(null, "", `${sectionPaths[correctSection]}/${quoteId}`);
      setSection(correctSection);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [signedInUserId, quoteId, section]);
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
  const navigateSection = (nextSection: Section) => {
    const target = sectionPaths[nextSection];
    if (normalizedPath(window.location.pathname) !== target) window.history.pushState(null, "", target);
    setQuoteId(null);
    setSection(nextSection);
  };
  const closeQuote = () => {
    window.history.replaceState(null, "", sectionPaths[section === "customerQuotes" ? "customerQuotes" : "quotes"]);
    setQuoteId(null);
    setSection(section === "customerQuotes" ? "customerQuotes" : "quotes");
  };
  if (checkingSession) return <div className="splash"><img className="brand-logo-image brand-logo-image-splash brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" /><span>Đang mở không gian làm việc…</span></div>;
  if (!user) return <NotificationProvider notify={notify}><><Login onLogin={handleLogin} onNotify={notify} />{notification && <NotificationToast notification={notification} onDismiss={dismiss} />}{confirmationDialog}</></NotificationProvider>;
  const openQuote = (id: string, kind: "estimate" | "customer" = "estimate") => {
    const nextSection = kind === "customer" ? "customerQuotes" : "quotes";
    const target = `${sectionPaths[nextSection]}/${id}`;
    if (normalizedPath(window.location.pathname) !== target) window.history.pushState(null, "", target);
    setSection(nextSection);
    setQuoteId(id);
  };
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
      if (quoteId === quote._id) closeQuote();
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
      <div className="brand-lockup"><img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" /></div>
      <nav className="side-nav">
        <NavButton icon="home" label="Tổng quan" href={sectionPaths.home} active={!quoteId && section === "home"} onClick={() => navigateSection("home")} />
        <NavButton icon="quote" label="Dự toán" href={sectionPaths.quotes} active={!quoteId && section === "quotes"} onClick={() => navigateSection("quotes")} />
        <NavButton icon="spark" label="Tư vấn ngân sách" href={sectionPaths.budgetPlanner} active={!quoteId && section === "budgetPlanner"} onClick={() => navigateSection("budgetPlanner")} />
        <NavButton icon="file" label="Báo giá khách" href={sectionPaths.customerQuotes} active={!quoteId && section === "customerQuotes"} onClick={() => navigateSection("customerQuotes")} />
        <NavButton icon="template" label="Mẫu báo giá" href={sectionPaths.templates} active={!quoteId && section === "templates"} onClick={() => navigateSection("templates")} />
        <NavButton icon="box" label="Bảng giá" href={sectionPaths.catalog} active={!quoteId && section === "catalog"} onClick={() => navigateSection("catalog")} />
      </nav>
      <div className="sidebar-bottom">
        <a className={`profile-button ${!quoteId && section === "profile" ? "active" : ""}`} href={sectionPaths.profile} onClick={(event) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigateSection("profile"); }} title="Trang cá nhân"><span className="avatar"><Icon name="user" size={17} /></span><span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span><Icon name="arrow" size={17} /></a>
      </div>
    </aside>
    <div className="main-column">
      <main className="main-content">{quoteId && section === "customerQuotes" ?
        <CustomerQuoteDetail key={quoteId} id={quoteId} onBack={closeQuote} onChanged={refresh} onToast={notify} confirm={confirm} onDeleteQuote={removeQuote} />
        : quoteId ?
          <QuoteDetail key={quoteId} id={quoteId} user={user} onBack={closeQuote} onChanged={refresh} onToast={notify} confirm={confirm} onDeleteQuote={removeQuote} />
          : section === "home" ?
            <Dashboard key={refreshKey} canCreate={canCreateQuote} usage={usage} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} canReview onOpen={openQuote} onCreate={createQuote} onNavigate={navigateSection} onDeleteQuote={(quote) => void removeQuote(quote)} />
            : section === "quotes" ?
              <QuoteWorkspace key={refreshKey} canCreate={canCreateQuote} usage={usage} quoteUsageLabel={quoteUsageLabel} createBlockedMessage={quoteBlockedMessage} onRefreshUsage={() => void loadUsage()} showUsageError={Boolean(usageError)} userName={user.name} onOpen={openQuote} onCreate={createQuote} onDeleteQuote={(quote) => void removeQuote(quote)} onNavigate={navigateSection} />
              : section === "budgetPlanner" ?
                <BudgetPlanner />
                : section === "customerQuotes" ?
                  <CustomerQuotes onOpen={(id) => openQuote(id, "customer")} onCreated={refresh} onQuotaExceeded={() => void loadUsage()} />
                  : section === "templates" ?
                    <QuoteTemplatePanel canManage confirm={confirm} templateUsage={usage?.templates ?? null} usageLoading={usageLoading} usageError={Boolean(usageError)} onRefreshUsage={() => void loadUsage()} onUsageChanged={() => void loadUsage()} />
                    : section === "catalog" ?
                      <PriceListPanel key={refreshKey} onToast={notify} />
                      : <AccountProfile user={user} onToast={notify} onSignOut={() => void signOut()} confirm={confirm} usage={usage} subscriptionExpiresAt={usage?.subscriptionExpiresAt ?? null} requestedPlanCode={requestedPlanCode} onInitialPlanHandled={() => setRequestedPlanCode(null)} onBillingPaid={handleBillingPaid} />}</main>
    </div>
    {creatingQuote && canCreateQuote && <NewQuoteDialog canManageTemplate onQuotaExceeded={() => void loadUsage()} onClose={() => setCreatingQuote(false)} onManageTemplate={() => { setCreatingQuote(false); navigateSection("templates"); }} onCreated={(id) => { setCreatingQuote(false); refresh(); notify("Bản nháp báo giá đã được tạo."); openQuote(id); }} />}
    {notification && <NotificationToast notification={notification} onDismiss={dismiss} />}
    {confirmationDialog}
  </div></NotificationProvider>;
}

function NavButton({ icon, label, href, active, onClick }: { icon: string; label: string; href: string; active: boolean; onClick: () => void }) {
  return <a className={`nav-button ${active ? "active" : ""}`} href={href} onClick={(event) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onClick(); }}><Icon name={icon} size={18} /><span>{label}</span></a>;
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
              <img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" />
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
              <img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" />
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
              <button className="login-submit-btn register-field-wide" type="submit" disabled={busy}>{busy ? <span className="login-spinner" /> : null}<span>{busy ? "Đang tạo tài khoản…" : "Tạo tài khoản"}</span></button>
            </form>}
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
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteUsageWidget({
  usage,
  quoteUsageLabel,
  canCreate,
  createBlockedMessage,
  onRefreshUsage,
  showUsageError,
  onNavigate,
  variant = "workspace",
}: {
  usage?: SubscriptionUsage | null;
  quoteUsageLabel?: string;
  canCreate: boolean;
  createBlockedMessage: string;
  onRefreshUsage: () => void;
  showUsageError: boolean;
  onNavigate?: (section: Section) => void;
  variant?: "workspace" | "banner";
}) {
  if (!usage) {
    if (!quoteUsageLabel && !createBlockedMessage) return null;
    return (
      <div className={`quote-quota-card variant-${variant}`}>
        {quoteUsageLabel && <span className="quote-quota-count-text">{quoteUsageLabel}</span>}
        {!canCreate && (
          <div className="quote-quota-blocked-alert">
            <Icon name="close" size={13} />
            <span>{createBlockedMessage}</span>
          </div>
        )}
        {showUsageError && (
          <button type="button" className="quote-quota-retry-link" onClick={onRefreshUsage}>
            Tải lại hạn mức
          </button>
        )}
      </div>
    );
  }

  const { plan, quotes } = usage;
  const isUnlimited = quotes.limit === null;
  const used = quotes.used ?? 0;
  const limit = quotes.limit ?? 0;
  const remaining = quotes.remaining ?? 0;
  const percent = isUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  const isBlocked = !canCreate || (!isUnlimited && remaining <= 0);
  const isWarning = !isBlocked && !isUnlimited && percent >= 80;
  const tone = isBlocked ? "danger" : isWarning ? "warning" : isUnlimited ? "unlimited" : "normal";

  if (variant === "workspace") {
    return (
      <div className={`quote-quota-card variant-workspace tone-${tone}`} role="region" aria-label="Hạn mức tạo báo giá">
        <div className="quote-quota-ring" style={{ "--quota-percent": `${percent}%` } as React.CSSProperties} aria-label={`Đã sử dụng ${percent}% hạn mức`}>
          <span>{isUnlimited ? "∞" : `${percent}%`}</span>
        </div>
        <div className="quote-quota-workspace-copy">
          <div className="quote-quota-workspace-main">
            <strong>{isUnlimited ? `Đã tạo ${used.toLocaleString("vi-VN")} báo giá` : `Đã dùng ${used.toLocaleString("vi-VN")} / ${limit.toLocaleString("vi-VN")} lượt`}</strong>
            {onNavigate && !isUnlimited && <button type="button" className="quote-quota-upgrade-btn" onClick={() => onNavigate("profile")}>Nâng cấp <Icon name="arrow" size={17} /></button>}
          </div>
          <p>{isBlocked ? createBlockedMessage : isUnlimited ? "Không giới hạn lượt tạo trong chu kỳ này" : `Còn lại ${remaining.toLocaleString("vi-VN")} lượt tạo trong chu kỳ này`}</p>
          {showUsageError && <button type="button" className="quote-quota-retry-link" onClick={onRefreshUsage}>Tải lại hạn mức</button>}
        </div>
      </div>
    );
  }

  return (
    <div className={`quote-quota-card variant-${variant} tone-${tone}`} role="region" aria-label="Hạn mức tạo báo giá">
      <div className="quote-quota-inner">
        {/* Top: Plan badge & count & upgrade action */}
        <div className="quote-quota-meta">
          <div className="quote-quota-plan-tag">
            <span className="quote-plan-dot" />
            <span className="quote-plan-name">{plan.name}</span>
          </div>

          <div className="quote-quota-numbers">
            {isUnlimited ? (
              <span className="quote-quota-count-text">
                Đã tạo <strong>{used.toLocaleString("vi-VN")}</strong> báo giá tháng này · <em>Không giới hạn</em>
              </span>
            ) : (
              <span className="quote-quota-count-text">
                Đã dùng <strong>{used.toLocaleString("vi-VN")}</strong> / {limit.toLocaleString("vi-VN")} lượt
                <span className="quote-quota-pct-badge">{percent}%</span>
              </span>
            )}
          </div>

          {onNavigate && !isUnlimited && (
            <button
              type="button"
              className="quote-quota-upgrade-btn"
              onClick={() => onNavigate("profile")}
              title="Nâng cấp gói để có thêm lượt tạo báo giá"
            >
              <span>Nâng cấp</span>
              <Icon name="arrow" size={12} />
            </button>
          )}
        </div>

        {/* Progress Bar (Only when limited) */}
        {!isUnlimited && (
          <div className="quote-quota-bar-track" title={`Đã sử dụng ${percent}% hạn mức tháng`}>
            <div
              className={`quote-quota-bar-fill tone-${tone}`}
              style={{ width: `${Math.max(used > 0 ? 4 : 0, percent)}%` }}
            />
          </div>
        )}

        {/* Bottom details: Remaining or Blocked message */}
        <div className="quote-quota-subline">
          {isBlocked ? (
            <div className="quote-quota-blocked-alert">
              <Icon name="close" size={13} />
              <span>{createBlockedMessage || "Bạn đã dùng hết lượt tạo báo giá trong tháng này."}</span>
              {showUsageError && (
                <button type="button" className="quote-quota-retry-link" onClick={onRefreshUsage}>
                  Tải lại hạn mức
                </button>
              )}
            </div>
          ) : (
            <div className="quote-quota-status-line">
              {!isUnlimited ? (
                <span>
                  Còn lại <strong>{remaining.toLocaleString("vi-VN")}</strong> lượt tạo trong chu kỳ này
                </span>
              ) : (
                <span>Tài khoản doanh nghiệp không giới hạn số lượng tạo</span>
              )}
              {showUsageError && (
                <button type="button" className="quote-quota-retry-link" onClick={onRefreshUsage}>
                  Tải lại hạn mức
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dashboard({ onOpen, onCreate, onNavigate, canCreate, usage, quoteUsageLabel, createBlockedMessage, onRefreshUsage, showUsageError, canReview, onDeleteQuote }: { onOpen: (id: string) => void; onCreate: () => void; onNavigate: (section: Section) => void; canCreate: boolean; usage?: SubscriptionUsage | null; quoteUsageLabel: string; createBlockedMessage: string; onRefreshUsage: () => void; showUsageError: boolean; canReview: boolean; onDeleteQuote: (quote: Quote) => void }) {
  const [data, setData] = useState<{ counts: { total: number; drafts: number; pending: number; approved: number }; recent: Quote[] } | null>(null);
  const notify = useAppNotification();
  useEffect(() => { api<typeof data>("/api/dashboard").then((value) => setData(value)).catch((cause) => notify(cause instanceof Error ? cause.message : "Không thể tải tổng quan báo giá.", "error")); }, [notify]);
  return <div className="page-stack dashboard-page">
    <section className="dashboard-banners" aria-label="Tạo và theo dõi báo giá">
      <article className="dashboard-banner dashboard-banner-primary">
        <img src="/images/dashboard-hero-v4.png" alt="" />
        <div className="dashboard-banner-copy">
          <h1>Dự toán nhanh,<br /><span>rõ ràng, chính xác</span></h1>
          <p>Tạo dự toán, báo giá chuyên nghiệp chỉ trong vài phút<br />Tiết kiệm thời gian, nâng cao hiệu quả kinh doanh</p>
          <button className="button button-primary quote-create-button" disabled={!canCreate} onClick={onCreate}><Icon name="plus" size={17} />Tạo dự toán</button>
          <QuoteUsageWidget usage={usage} quoteUsageLabel={quoteUsageLabel} canCreate={canCreate} createBlockedMessage={createBlockedMessage} onRefreshUsage={onRefreshUsage} showUsageError={showUsageError} onNavigate={onNavigate} variant="banner" />
        </div>
      </article>
    </section>
    <section className="metric-grid">
      <Metric label="Tổng báo giá" value={data?.counts.total ?? "—"} icon="quote" watermarkIcon="bars" tone="mint" note="Tất cả dự toán" />
      <Metric label="Bản nháp" value={data?.counts.drafts ?? "—"} icon="file" tone="sand" note="Đang soạn thảo" />
      <Metric label="Chờ duyệt" value={data?.counts.pending ?? "—"} icon="clock" tone="lavender" note="Đang chờ phê duyệt" action={canReview ? () => onNavigate("quotes") : undefined} />
      <Metric label="Đã duyệt" value={data?.counts.approved ?? "—"} icon="check" tone="blue" note="Sẵn sàng sử dụng" />
    </section>
    <section className="content-card recent-card">
      <div className="card-heading">
        <div><h2>Dự toán gần đây</h2></div>
        <button className="text-button" onClick={() => onNavigate("quotes")}>Xem tất cả <Icon name="arrow" size={15} /></button>
      </div>
      {data?.recent.length ? <QuoteCards quotes={data.recent} onOpen={onOpen} onDelete={onDeleteQuote} emptyTitle="Chưa có dự toán nào" emptyText="" /> : <div className="dashboard-empty-state"><img src="/images/quote-empty-3d.svg" alt="" /><h3>Chưa có dự toán nào</h3><p>Tạo dự toán đầu tiên để bắt đầu</p><button className="button button-primary" disabled={!canCreate} onClick={onCreate}><Icon name="plus" size={17} />Tạo dự toán</button></div>}
    </section>
  </div>;
}

function Metric({ label, value, icon, watermarkIcon, tone, note, action }: { label: string; value: number | string; icon: string; watermarkIcon?: string; tone: string; note: string; action?: () => void }) {
  return <button className={`metric-card tone-${tone} ${action ? "metric-action" : ""}`} onClick={action} disabled={!action}><span className="metric-watermark" aria-hidden="true"><Icon name={watermarkIcon ?? icon} size={82} /></span><span className="metric-top"><span className="metric-icon"><Icon name={icon} size={25} /></span><span>{label}</span></span><strong className="metric-value">{value}</strong><span className="metric-note"><span className="metric-trend" aria-hidden="true">↗ {value === 0 ? "0%" : ""}</span><span>{value === 0 ? "so với tháng trước" : note}</span></span></button>;
}

type QuoteSortKey = "newest" | "oldest" | "total_desc" | "total_asc" | "customer";
interface QuoteListStats { total: number; drafts: number; pending: number; approved: number; needsInfo: number; rejected: number; approvedRevenue: number }
interface QuoteListResponse { quotes: Quote[]; page: number; pageSize: number; total: number; totalPages: number; stats: QuoteListStats }

function QuoteWorkspace({
  onOpen,
  onCreate,
  canCreate,
  usage,
  quoteUsageLabel,
  createBlockedMessage,
  onRefreshUsage,
  showUsageError,
  onDeleteQuote,
  onNavigate,
  userName,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
  canCreate: boolean;
  usage?: SubscriptionUsage | null;
  quoteUsageLabel: string;
  createBlockedMessage: string;
  onRefreshUsage: () => void;
  showUsageError: boolean;
  onDeleteQuote: (quote: Quote) => void;
  onNavigate: (section: Section) => void;
  userName: string;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<QuoteSortKey>("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState<QuoteListStats>({ total: 0, drafts: 0, pending: 0, approved: 0, needsInfo: 0, rejected: 0, approvedRevenue: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notify = useAppNotification();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams({ page: String(page), sort: sortBy });
    if (filter !== "all") params.set("status", filter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    api<QuoteListResponse>(`/api/quotes?${params}`)
      .then((result) => {
        if (cancelled) return;
        setQuotes(result.quotes);
        setPage(result.page);
        setPageSize(result.pageSize);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setStats(result.stats);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoadFailed(true);
        notify(cause instanceof Error ? cause.message : "Không thể tải danh sách báo giá.", "error");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, sortBy, filter, debouncedSearch, reloadKey, notify]);

  // Phím tắt / để focus vào ô tìm kiếm
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA")) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filterTabs: Array<{ key: string; label: string; count: number }> = [
    { key: "all", label: "Tất cả", count: stats.total },
    { key: "draft", label: "Bản nháp", count: stats.drafts },
    { key: "pending_review", label: "Chờ duyệt", count: stats.pending },
    { key: "approved", label: "Đã duyệt", count: stats.approved },
    { key: "needs_info", label: "Cần bổ sung", count: stats.needsInfo },
    { key: "rejected", label: "Cần chỉnh sửa", count: stats.rejected },
  ];
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const visiblePages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => firstVisiblePage + index);

  return (
    <div className="page-stack quote-workspace-page">
      <div className="quote-workspace-topbar">
        <button type="button" className="quote-top-icon" aria-label="Cài đặt tài khoản" onClick={() => onNavigate("profile")}><Icon name="settings" size={20} /></button>
        <button type="button" className="quote-top-avatar" aria-label="Trang cá nhân" onClick={() => onNavigate("profile")}>{userName.trim().charAt(0).toLocaleUpperCase("vi") || "U"}</button>
      </div>
      {/* HEADER ROW */}
      <section className="page-heading-row quote-workspace-header">
        <div className="quote-workspace-heading-left">
          <span className="quote-heading-icon"><Icon name="quote" size={26} /></span>
          <div><h1>Dự toán</h1><p>Quản lý và tạo dự toán nhanh chóng, chính xác</p></div>
        </div>
        <div className="page-heading-actions">
          {loadFailed && (
            <button type="button" className="button button-soft" onClick={() => setReloadKey((key) => key + 1)}>
              Tải lại
            </button>
          )}
          <button
            className="button button-primary quote-create-button"
            disabled={!canCreate}
            onClick={onCreate}
          >
            <Icon name="plus" size={17} />
            <span>Tạo dự toán mới</span>
          </button>
        </div>
      </section>
      <QuoteUsageWidget usage={usage} quoteUsageLabel={quoteUsageLabel} canCreate={canCreate} createBlockedMessage={createBlockedMessage} onRefreshUsage={onRefreshUsage} showUsageError={showUsageError} onNavigate={onNavigate} variant="workspace" />

      {/* QUICK KPI MINI STRIP */}
      {stats.total > 0 && (
        <section className="quote-kpi-strip" aria-label="Thống kê nhanh báo giá">
          <div className="quote-kpi-card tone-total">
            <span className="quote-kpi-icon"><Icon name="quote" size={18} /></span>
            <div className="quote-kpi-data">
              <span className="quote-kpi-label">Tổng số báo giá</span>
              <strong className="quote-kpi-value">{stats.total}</strong>
            </div>
          </div>

          <div className="quote-kpi-card tone-pending">
            <span className="quote-kpi-icon"><Icon name="clock" size={18} /></span>
            <div className="quote-kpi-data">
              <span className="quote-kpi-label">Đang chờ duyệt</span>
              <strong className="quote-kpi-value">{stats.pending}</strong>
            </div>
          </div>

          <div className="quote-kpi-card tone-approved">
            <span className="quote-kpi-icon"><Icon name="check" size={18} /></span>
            <div className="quote-kpi-data">
              <span className="quote-kpi-label">Đã phê duyệt</span>
              <strong className="quote-kpi-value">{stats.approved}</strong>
            </div>
          </div>

          <div className="quote-kpi-card tone-revenue">
            <span className="quote-kpi-icon"><Icon name="spark" size={18} /></span>
            <div className="quote-kpi-data">
              <span className="quote-kpi-label">Doanh số đã duyệt</span>
              <strong className="quote-kpi-value">{new Intl.NumberFormat("vi-VN").format(stats.approvedRevenue)}đ</strong>
            </div>
          </div>
        </section>
      )}

      {/* MAIN LIST CARD */}
      <section className="content-card quote-list-card">
        {/* TOOLBAR: SEARCH & SORT & STATUS TABS */}
        <div className="quote-workspace-toolbar">
          {/* Row 1: Search & Sort */}
          <div className="quote-toolbar-top">
            <div className="quote-search-wrapper">
              <Icon name="search" size={16} />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Tìm theo mã báo giá, tên khách hàng, email, SĐT…"
                className="quote-search-input"
              />
              {search ? (
                <button
                  type="button"
                  className="quote-search-clear-btn"
                  onClick={() => { setSearch(""); setPage(1); }}
                  title="Xóa tìm kiếm (Esc)"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : (
                <span className="quote-search-shortcut" title="Phím tắt">/</span>
              )}
            </div>

            <div className="quote-sort-wrapper">
              <label htmlFor="quote-sort-select">Sắp xếp:</label>
              <select
                id="quote-sort-select"
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value as QuoteSortKey); setPage(1); }}
                className="quote-sort-select"
              >
                <option value="newest">Mới nhất trước</option>
                <option value="oldest">Cũ nhất trước</option>
                <option value="total_desc">Giá trị: Cao đến thấp</option>
                <option value="total_asc">Giá trị: Thấp đến cao</option>
                <option value="customer">Tên khách hàng: A-Z</option>
              </select>
            </div>
          </div>

          {/* Row 2: Status Tabs & Result Count */}
          <div className="quote-toolbar-bottom">
            <div className="quote-status-filter-tabs">
              {filterTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`quote-filter-tab ${filter === tab.key ? "is-active" : ""}`}
                  onClick={() => { setFilter(tab.key); setPage(1); }}
                >
                  <span>{tab.label}</span>
                  <span className="tab-badge">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="quote-toolbar-count">
              {stats.total > 0 && (
                <span>
                  Hiển thị <strong>{total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}</strong> / {total} báo giá
                </span>
              )}
            </div>
          </div>
        </div>

        {/* QUOTE CARDS GRID */}
        {loading ? (
          <Loading />
        ) : quotes.length === 0 ? (
          <div className="quote-empty-container">
            {search || filter !== "all" ? (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="search" size={24} /></span>
                <h3>Không tìm thấy báo giá phù hợp</h3>
                <p>Thử tìm kiếm với từ khóa khác hoặc thay đổi bộ lọc trạng thái.</p>
                <button
                  type="button"
                  className="button button-soft"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                    setPage(1);
                  }}
                >
                  Đặt lại bộ lọc
                </button>
              </div>
            ) : (
              <div className="quote-empty-action"><EmptyState title="Chưa có bản báo giá nào" text="Bắt đầu tạo bản báo giá đầu tiên từ yêu cầu của khách hàng." /><button type="button" className="button button-primary quote-create-button" disabled={!canCreate} onClick={onCreate}><Icon name="plus" size={20} />Tạo dự toán mới</button></div>
            )}
          </div>
        ) : (
          <QuoteCards
            quotes={quotes}
            onOpen={onOpen}
            onDelete={onDeleteQuote}
            emptyTitle="Không có báo giá trong mục này"
            emptyText=""
          />
        )}
        {!loading && !loadFailed && totalPages > 1 && (
          <nav className="quote-pagination" aria-label="Phân trang báo giá">
            <button type="button" className="quote-page-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Trước</button>
            <div className="quote-page-numbers">
              {visiblePages.map((number) => <button key={number} type="button" className={`quote-page-button ${number === page ? "is-active" : ""}`} aria-label={`Trang ${number}`} aria-current={number === page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>)}
            </div>
            <button type="button" className="quote-page-button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Sau</button>
          </nav>
        )}
      </section>
    </div>
  );
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
  const filePickerOpen = useRef(false);
  const ignoreDialogCancelUntil = useRef(0);
  const [options, setOptions] = useState<QuoteOptions>({ templates: [], defaultTemplateId: null, productsAvailable: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const notify = useAppNotification();
  const setError = useCallback((message: string) => { if (message) notify(message, "error"); }, [notify]);
  const [reloadKey, setReloadKey] = useState(0);
  const markFilePickerOpen = useCallback(() => {
    filePickerOpen.current = true;
    ignoreDialogCancelUntil.current = 0;
  }, []);
  const markFilePickerDismissed = useCallback(() => {
    if (!filePickerOpen.current) return;
    filePickerOpen.current = false;
    ignoreDialogCancelUntil.current = Date.now() + 1200;
  }, []);
  const markFileSelected = useCallback(() => {
    filePickerOpen.current = false;
    ignoreDialogCancelUntil.current = 0;
  }, []);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    window.addEventListener("focus", markFilePickerDismissed);
    return () => window.removeEventListener("focus", markFilePickerDismissed);
  }, [markFilePickerDismissed]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadFailed(false);
    loadQuoteOptions().then((value) => { if (active) setOptions(value); }).catch((cause) => { if (active) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "Không tải được mẫu báo giá và danh mục sản phẩm."); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey, setError]);
  return <dialog ref={dialog} className="template-dialog quote-creation-dialog" aria-labelledby="new-quote-title" onCancel={(event) => {
    event.preventDefault();
    if (filePickerOpen.current || Date.now() < ignoreDialogCancelUntil.current) {
      markFilePickerDismissed();
      return;
    }
    if (!busy) onClose();
  }}>
    <div className="settings-card-heading"><h2 id="new-quote-title">Tạo dự toán mới</h2><button type="button" autoFocus className="icon-button" aria-label="Đóng popup tạo dự toán" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    <div className="quote-creation-body" aria-busy={busy || loading}>{loading ? <TaskProgress label="Đang tải mẫu và danh mục sản phẩm" detail="Chuẩn bị biểu mẫu tạo báo giá…" /> : loadFailed ? <div className="empty-state"><button className="button button-soft" onClick={() => setReloadKey((key) => key + 1)}>Tải lại</button></div> : <NewQuote options={options} canManageTemplate={canManageTemplate} onManageTemplate={onManageTemplate} onCreated={onCreated} onBusyChange={setBusy} onQuotaExceeded={onQuotaExceeded} onFilePickerOpen={markFilePickerOpen} onFilePickerDismissed={markFilePickerDismissed} onFileSelected={markFileSelected} />}</div>
  </dialog>;
}

function NewQuote({ options, onCreated, canManageTemplate, onManageTemplate, onBusyChange, onQuotaExceeded, onFilePickerOpen, onFilePickerDismissed, onFileSelected }: { onBusyChange: (busy: boolean) => void; onManageTemplate: () => void; onQuotaExceeded: () => void; onFilePickerOpen: () => void; onFilePickerDismissed: () => void; onFileSelected: () => void; canManageTemplate: boolean; options: QuoteOptions; onCreated: (id: string) => void }) {
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
  useEffect(() => {
    const input = fileInput.current;
    if (!input) return;
    const handlePickerCancel = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      onFilePickerDismissed();
    };
    input.addEventListener("cancel", handlePickerCancel);
    return () => input.removeEventListener("cancel", handlePickerCancel);
  }, [onFilePickerDismissed]);

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!templateId || (!requestText.trim() && !requestFile)) { setError("Hãy chọn mẫu và nhập yêu cầu hoặc tải file yêu cầu."); return; }
    if (requestFile && (!requestFile.size || requestFile.size > 10 * 1024 * 1024)) { setError("File yêu cầu phải có nội dung và không vượt quá 10 MB."); return; }
    setBusy(true);
    setError("");
    setAnalysis(null);
    setTaskProgress({ label: "Đang chuẩn bị phân tích", detail: "Chuẩn bị yêu cầu để đối chiếu với bảng giá…" });
    let analysisCompleted = false;
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
      analysisCompleted = true;
      setTaskProgress({ label: "Đang tạo bản nháp báo giá", detail: "Đang tính toán các dòng hàng và lưu báo giá…" });
      const { quote } = await api<{ quote: Quote }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          requestId: id,
          customerName: customerName.trim() || result.customerName?.trim() || "Khách hàng chưa xác định",
          customerEmail: customerEmail.trim() || result.customerEmail?.trim() || "",
          customerPhone,
          idempotencyKey: quoteIdempotencyKey,
          items: result.items.map(({ catalogItemId, quantity, unit, attributes }) => ({ catalogItemId, quantity, unit, attributes })),
        }),
      });
      onCreated(quote._id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded();
      setError(cause instanceof Error ? cause.message : analysisCompleted ? "Không thể tạo bản nháp." : "Không thể phân tích yêu cầu.");
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
          customerName: customerName.trim() || "Khách hàng chưa xác định",
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
              <strong>Thiết lập báo giá</strong>
              {!options.templates.length && <div className="quote-setup-item"><span>Mẫu báo giá</span>{canManageTemplate ? <button type="button" className="text-button" onClick={onManageTemplate}>Thêm mẫu →</button> : <span>Liên hệ quản trị viên</span>}</div>}
              {!options.productsAvailable && <div className="quote-setup-item"><span>Sản phẩm</span><span>Có thể bổ sung sau khi tạo bản nháp</span></div>}
            </div>}
            {!analysis && <div className="field-row quote-customer-fields">
              <label>Tên khách hàng<input value={customerName} maxLength={250} disabled={locked} autoComplete="name" onChange={(event) => setCustomerName(event.target.value)} placeholder="Nhập tên khách hàng" /></label>
              <label>Email (không bắt buộc)<input type="email" value={customerEmail} maxLength={250} disabled={locked} autoComplete="email" onChange={(event) => setCustomerEmail(event.target.value)} placeholder="email@congty.vn" /></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={locked} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng" /></label>
            </div>}
            <label className="request-text-label">Yêu cầu của khách hàng<textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Mô tả sản phẩm, số lượng, quy cách khách hàng cần…" rows={4} maxLength={10000} required={!requestFile} disabled={locked} /></label>
            <label className="request-upload-label">Hoặc tải file yêu cầu<input className="request-file-input" ref={fileInput} type="file" accept=".pdf,.docx,.txt,.xlsx,.xls,.csv" disabled={locked} onClick={onFilePickerOpen} onChange={(event) => { onFileSelected(); setRequestFile(event.target.files?.[0] ?? null); uploadedFile.current = null; setError(""); }} /><span className="request-file-control"><span className="request-file-trigger">Chọn file</span><span className="request-file-name">{requestFile?.name ?? "Chưa chọn file"}</span></span><span className="field-hint">PDF, Word, TXT, Excel, CSV · Tối đa 10 MB</span></label>
            {requestFile && <div className="request-file-selection"><button type="button" className="text-button" onClick={() => setPreviewFile({ name: requestFile.name, file: requestFile })}>Xem trước file</button><button type="button" className="text-button" disabled={locked} onClick={() => { setRequestFile(null); uploadedFile.current = null; if (fileInput.current) fileInput.current.value = ""; }}>Bỏ file</button></div>}
            {!analysis && <button className="button button-primary analyze-button" type="submit" disabled={busy || !templateId || (!requestText.trim() && !requestFile)}>{busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{busy ? "Đang phân tích…" : "Phân tích & tạo bản nháp"}<Icon name="arrow" size={16} /></button>}
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
          <div className="analysis-footer"><span>{selected.length + (analysis.suggestedProducts?.length ?? 0)} mặt hàng trong báo giá</span><button className="button button-primary" disabled={busy} onClick={() => void createQuote()}>{busy ? "Đang tạo bản nháp…" : "Thử tạo bản nháp"}{!busy && <Icon name="arrow" size={16} />}</button></div>
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
    if (editable && hasIncompleteSupplementalProduct && !url.endsWith("/approve")) {
      setError("Vui lòng nhập tên, đơn vị, số lượng hợp lệ và đơn giá cho mỗi dòng sản phẩm bổ sung.");
      return;
    }
    if (quote) {
      let confirmation: ConfirmOptions | undefined;
      if (url.endsWith("/approve")) confirmation = { title: "Duyệt báo giá này?", message: `${quote.quoteNumber} · ${quote.customerName}\nTổng tiền: ${formatMoney(liveTotal, quote.currency)}\nSau khi duyệt, có thể tải file chính thức và gửi cho khách hàng.${hasUnsavedChanges && hasIncompleteSupplementalProduct ? "\nCác dòng bổ sung chưa đủ thông tin sẽ không được lưu." : ""}`, confirmLabel: "Duyệt báo giá" };
      else if (url.endsWith("/reject")) confirmation = { title: "Trả báo giá để chỉnh sửa?", message: `${quote.quoteNumber} sẽ chuyển về trạng thái cần chỉnh sửa.\nLý do: ${typeof body === "object" && body && "reason" in body ? String(body.reason) : ""}`, confirmLabel: "Trả lại", tone: "danger" };
      if (confirmation && !await confirm(confirmation)) return;
    }
    setBusy(true);
    setError("");
    const taskLabel = url.endsWith("/approve") ? "Đang duyệt báo giá" : "Đang lưu báo giá";
    setTaskProgress({ label: taskLabel, detail: "Đang cập nhật dữ liệu trên máy chủ…" });
    const saveBeforeApprove = url.endsWith("/approve") && editable && hasUnsavedChanges && !hasIncompleteSupplementalProduct;
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
  const canPreviewGeneratedFile = quote.status === "approved" || editable;
  const canExportDraftXlsx = editable && quote.status !== "approved";
  const canDownloadQuote = quote.status === "approved" || canExportDraftXlsx;
  const save = () => perform(`/api/quotes/${quote._id}`, editPayload(), "PATCH", "Đã lưu thay đổi và tính lại giá.");

  const downloadQuote = async (excelOnly = false) => {
    setBusy(true); setError("");
    const fileLabel = canExportDraftXlsx || excelOnly ? "Đang xuất Excel" : "Đang chuẩn bị file báo giá";
    setTaskProgress({ label: fileLabel, detail: "Đang tạo file từ mẫu báo giá…" });
    try {
      if (editable && hasUnsavedChanges && !hasIncompleteSupplementalProduct) {
        await api(`/api/quotes/${quote._id}`, { method: "PATCH", body: JSON.stringify(editPayload()) });
        await load();
        onChanged();
      }
      const exportQuery = canExportDraftXlsx ? "?draft=1" : excelOnly ? "?excel=1" : "";
      const response = await fetch(`/api/quotes/${quote._id}/export${exportQuery}`, { credentials: "include" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Không tải được báo giá."); }
      const blob = await responseBlobWithProgress(response, (progress) => setTaskProgress({
        label: canExportDraftXlsx || excelOnly ? "Đang tải file Excel" : "Đang tải file báo giá",
        progress,
        detail: progress === null ? "Máy chủ đã tạo file. Đang tải xuống…" : "Tiến độ tải file",
      }));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${quote.quoteNumber}${canExportDraftXlsx ? "-nhap" : ""}.${canExportDraftXlsx || excelOnly ? "xlsx" : outputExtension}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast("Đã tải file báo giá.", "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được báo giá."); }
    finally { setBusy(false); setTaskProgress(null); }
  };

  return (
    <div className="page-stack detail-stack">
      {/* Top Navigation Bar with Breadcrumb */}
      <div className="quote-detail-nav">
        <button type="button" className="quote-back-btn" onClick={onBack}>
          <Icon name="back" size={15} />
          <span>Quay lại danh sách</span>
        </button>
        <div className="quote-detail-breadcrumb">
          <span>Báo giá</span>
          <span className="breadcrumb-separator">/</span>
          <strong>{quote.quoteNumber}</strong>
        </div>
      </div>
      {taskProgress && <TaskProgress {...taskProgress} />}

      {/* Main Header Card */}
      <header className="quote-detail-header-card">
        <div className="quote-header-title-box">
          <div className="quote-number-row">
            <span className="quote-detail-tag" aria-hidden="true">
              <Icon name="quote" size={16} />
            </span>
            <h1 className="quote-number-title">{quote.quoteNumber}</h1>
            <button
              type="button"
              className="quote-copy-badge"
              onClick={() => copyText(quote.quoteNumber, "mã báo giá")}
              title="Sao chép mã báo giá"
            >
              <Icon name="copy" size={12} />
              <span>Sao chép</span>
            </button>
            <StatusPill status={quote.status} />
          </div>

          <div className="quote-header-meta">
            <span className="quote-meta-item">
              <Icon name="user" size={13} />
              <span>Khách hàng: <strong>{customerName || quote.customerName}</strong></span>
            </span>
            <span className="dot-separator">·</span>
            <span className="quote-meta-item">
              <Icon name="clock" size={13} />
              <span>Ngày tạo: <strong>{formatDate(quote.createdAt)}</strong></span>
            </span>
            <span className="dot-separator">·</span>
            <span className="quote-meta-item">
              <span>Người lập: <strong>{user.name}</strong></span>
            </span>
          </div>
        </div>

        <div className="quote-header-actions">
          {editable && (
            <button
              type="button"
              className={`button ${hasUnsavedChanges ? "button-primary quote-save-pulse-btn" : "button-soft"}`}
              disabled={busy || !hasUnsavedChanges}
              onClick={() => void save()}
              title="Lưu các thay đổi về số lượng và thông tin khách hàng"
            >
              <Icon name="check" size={16} />
              <span>{busy ? "Đang lưu…" : hasUnsavedChanges ? "Lưu thay đổi *" : "Đã lưu"}</span>
            </button>
          )}

          <button
            type="button"
            className="button button-primary"
            disabled={busy || !canDownloadQuote}
            title={canExportDraftXlsx ? "Xuất Excel nháp trước khi duyệt" : "Tải file báo giá chính thức"}
            onClick={() => void downloadQuote()}
          >
            <Icon name="download" size={16} />
            <span>{quote.status === "approved" ? "Tải file báo giá" : canExportDraftXlsx ? "Xuất Excel nháp" : "Xuất sau khi duyệt"}</span>
          </button>
          {quote.status === "approved" && (
            <button type="button" className="button button-soft" disabled={busy} onClick={() => void downloadQuote(true)}>
              <Icon name="download" size={16} /><span>Xuất Excel</span>
            </button>
          )}

          {canApprove && (["draft", "needs_info", "pending_review"].includes(quote.status)) && (
            <>
              {quote.status === "pending_review" && (
                <button
                  type="button"
                  className="button button-soft quote-reject-btn"
                  disabled={busy}
                  onClick={() => setRejecting((prev) => !prev)}
                >
                  <Icon name="close" size={14} />
                  <span>Trả lại chỉnh sửa</span>
                </button>
              )}
              <button
                type="button"
                className="button button-primary quote-approve-btn"
                disabled={busy}
                onClick={() => void perform(`/api/quotes/${quote._id}/approve`, {}, "POST", "Báo giá đã được phê duyệt thành công.")}
              >
                <Icon name="check" size={16} />
                <span>Duyệt báo giá</span>
              </button>
            </>
          )}

          {canEdit && (
            <button
              type="button"
              className="button button-soft quote-delete-action"
              disabled={busy}
              onClick={() => onDeleteQuote(quote)}
              title="Xóa vĩnh viễn báo giá này"
            >
              <Icon name="trash" size={15} />
              <span>Xóa</span>
            </button>
          )}
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
                disabled={busy}
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
                  <div
                    className="quote-customer-avatar"
                    style={{ background: getCustomerAvatarBg(customerName || quote.customerName) }}
                  >
                    {getCustomerInitials(customerName || quote.customerName)}
                  </div>
                  <div className="quote-customer-info">
                    <strong className="quote-customer-name">{customerName || quote.customerName}</strong>
                    <span className="table-subtext">Khách hàng nhận báo giá</span>
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
                      <strong>{quote.status === "approved" ? "Bản báo giá điền hoàn chỉnh" : "File Excel nháp"}</strong>
                      <span>{quote.status === "approved" ? "File chính thức đã duyệt" : quote.status === "pending_review" ? "Bản xem trước phê duyệt" : canExportDraftXlsx ? "Có thể tải trước khi duyệt" : "File Excel được tạo từ báo giá"}</span>
                    </div>
                  </div>
                  <div className="quote-doc-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || hasUnsavedChanges}
                      title={hasUnsavedChanges ? "Lưu thay đổi trước khi xem trước file" : undefined}
                      onClick={() => setPreviewFile({ name: `${quote.quoteNumber}${canExportDraftXlsx ? "-nhap.xlsx" : `.${outputExtension}`}`, url: `/api/quotes/${quote._id}/export?${canExportDraftXlsx ? "draft=1" : "preview=1"}` })}
                    >
                      {canExportDraftXlsx || outputExtension === "xlsx" ? "Xem trước Excel" : "Xem trước"}
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

function CopyTextButton({ text, label, onToast, title = "Sao chép" }: { text: string; label: string; onToast: Notify; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    onToast(`Đã sao chép ${label}.`, "info");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" className={`profile-copy-btn ${copied ? "is-copied" : ""}`} onClick={copy} title={title}>
      <Icon name={copied ? "check" : "copy"} size={13} />
      <span>{copied ? "Đã chép" : "Sao chép"}</span>
    </button>
  );
}

function AccountProfile({
  user,
  onToast,
  onSignOut,
  confirm,
  usage,
  subscriptionExpiresAt,
  requestedPlanCode,
  onInitialPlanHandled,
  onBillingPaid,
}: {
  user: User;
  onToast: Notify;
  onSignOut: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  usage?: SubscriptionUsage | null;
  subscriptionExpiresAt: string | null;
  requestedPlanCode: string | null;
  onInitialPlanHandled: () => void;
  onBillingPaid: () => void;
}) {
  const plan = user.plan;
  const quotesLimit = usage?.quotes.limit ?? plan?.quoteLimit ?? null;
  const quotesUsed = usage?.quotes.used ?? 0;
  const quotesPercent = quotesLimit ? Math.min(100, Math.round((quotesUsed / quotesLimit) * 100)) : null;

  const templatesLimit = usage?.templates.limit ?? plan?.templateLimit ?? null;
  const templatesUsed = usage?.templates.used ?? 0;
  const templatesPercent = templatesLimit ? Math.min(100, Math.round((templatesUsed / templatesLimit) * 100)) : null;

  return (
    <div className="page-stack profile-page">
      <section className="page-heading-row profile-heading-row">
        <div>
          <h1>Trang cá nhân &amp; Cài đặt</h1>
        </div>
        <button
          type="button"
          className="profile-signout-btn"
          onClick={() =>
            void confirm({
              title: "Đăng xuất khỏi tài khoản?",
              message: "Bạn sẽ cần đăng nhập lại để tiếp tục làm việc.",
              confirmLabel: "Đăng xuất",
              tone: "danger",
              dismissWithClose: true,
            }).then((accepted) => {
              if (accepted) onSignOut();
            })
          }
        >
          <Icon name="logout" size={16} />
          <span>Đăng xuất</span>
        </button>
      </section>

      <div className="profile-dashboard-layout">
        {/* CỘT TRÁI: THÔNG TIN HỒ SƠ & HẠN MỨC GÓI */}
        <aside className="profile-sidebar-col">
          {/* Card 1: Hồ sơ người dùng */}
          <section className="content-card profile-user-card">
            <div className="profile-user-cover" />
            <div className="profile-user-body">
              <div className="profile-avatar-wrapper">
                <span className="profile-avatar-large">
                  {user.name.trim().slice(0, 1).toLocaleUpperCase("vi") || "?"}
                </span>
                <span className="profile-status-online" title="Tài khoản đang hoạt động" />
              </div>
              <div className="profile-user-info">
                <h2>{user.name}</h2>
                <div className="profile-email-row">
                  <Icon name="mail" size={14} />
                  <span className="profile-email-text">{user.email}</span>
                  <CopyTextButton text={user.email} label="email" onToast={onToast} title="Sao chép email" />
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Hạn mức & Tình trạng gói */}
          <section className="content-card profile-quota-card">
            <div className="profile-quota-header">
              <div>
                <span className="profile-card-eyebrow">GÓI ĐANG SỬ DỤNG</span>
                <h3>{plan?.name ?? "Dùng thử"}</h3>
              </div>
              <span className="profile-plan-pill-active">ĐANG KÍCH HOẠT</span>
            </div>

            <p className="profile-quota-desc">{plan?.description ?? "Gói miễn phí mặc định của iGen Trợ lí báo giá."}</p>

            {subscriptionExpiresAt ? (
              <div className="profile-expiry-banner">
                <Icon name="clock" size={15} />
                <span>Hiệu lực đến <strong>{formatDate(subscriptionExpiresAt)}</strong></span>
              </div>
            ) : (
              <div className="profile-expiry-banner is-free">
                <Icon name="check" size={15} />
                <span>Gói dùng thử không giới hạn thời gian</span>
              </div>
            )}

            <div className="profile-quota-metrics">
              {/* Lượt tạo báo giá */}
              <div className="profile-quota-row">
                <div className="profile-quota-meta">
                  <span className="quota-label">Lượt tạo báo giá tháng này</span>
                  <strong className="quota-value">
                    {quotesLimit === null
                      ? `${quotesUsed.toLocaleString("vi-VN")} lượt (Không giới hạn)`
                      : `${quotesUsed.toLocaleString("vi-VN")} / ${quotesLimit.toLocaleString("vi-VN")}`}
                  </strong>
                </div>
                {quotesPercent !== null && (
                  <div className="profile-progress-track">
                    <div
                      className={`profile-progress-bar ${quotesPercent >= 90 ? "is-critical" : quotesPercent >= 75 ? "is-warning" : ""}`}
                      style={{ width: `${quotesPercent}%` }}
                    />
                  </div>
                )}
                {quotesLimit !== null && (
                  <div className="profile-quota-subtext">
                    <span>Còn lại: {Math.max(0, quotesLimit - quotesUsed).toLocaleString("vi-VN")} lượt</span>
                    {quotesPercent !== null && <span>{quotesPercent}% đã dùng</span>}
                  </div>
                )}
              </div>

              {/* Mẫu báo giá */}
              <div className="profile-quota-row">
                <div className="profile-quota-meta">
                  <span className="quota-label">Số mẫu báo giá đã lưu</span>
                  <strong className="quota-value">
                    {templatesLimit === null
                      ? `${templatesUsed} mẫu (Không giới hạn)`
                      : `${templatesUsed} / ${templatesLimit} mẫu`}
                  </strong>
                </div>
                {templatesPercent !== null && (
                  <div className="profile-progress-track">
                    <div
                      className={`profile-progress-bar ${templatesPercent >= 90 ? "is-critical" : templatesPercent >= 75 ? "is-warning" : ""}`}
                      style={{ width: `${templatesPercent}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>

        {/* CỘT PHẢI: NÂNG CẤP GÓI */}
        <div className="profile-main-col">
          <SubscriptionBillingPanel
            currentPlanCode={plan?.code ?? "free"}
            subscriptionExpiresAt={subscriptionExpiresAt}
            initialPlanCode={requestedPlanCode}
            onInitialPlanHandled={onInitialPlanHandled}
            onPaid={onBillingPaid}
            onToast={onToast}
          />
        </div>
      </div>
    </div>
  );
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

function SubscriptionBillingPanel({
  currentPlanCode,
  subscriptionExpiresAt,
  initialPlanCode,
  onInitialPlanHandled,
  onPaid,
  onToast,
}: {
  currentPlanCode: string;
  subscriptionExpiresAt: string | null;
  initialPlanCode: string | null;
  onInitialPlanHandled: () => void;
  onPaid: () => void;
  onToast?: Notify;
}) {
  const [plans, setPlans] = useState<SubscriptionPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [payment, setPayment] = useState<BillingPayment | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const notify = useAppNotification();
  const showToast = onToast ?? notify;
  const autoCheckoutStarted = useRef(false);

  useEffect(() => {
    let active = true;
    api<{ plans: SubscriptionPlanSummary[] }>("/api/plans")
      .then(({ plans: available }) => {
        if (active) setPlans(available.filter((plan) => plan.monthlyPrice !== null && plan.monthlyPrice > 0));
      })
      .catch((cause) => {
        if (active) showToast(cause instanceof Error ? cause.message : "Không tải được các gói dịch vụ.", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showToast]);

  const beginCheckout = useCallback(
    async (planCode: string) => {
      setBusyPlan(planCode);
      setTaskProgress({ label: "Đang tạo mã thanh toán", detail: "Đang chuẩn bị QR SePay cho gói đã chọn…" });
      try {
        const { payment: nextPayment } = await api<{ payment: BillingPayment }>("/api/billing/payments", {
          method: "POST",
          body: JSON.stringify({ planCode }),
        });
        setPayment(nextPayment);
        showToast("Đã tạo mã thanh toán. Quét QR để hoàn tất đăng ký gói.", "info");
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : "Không thể tạo yêu cầu thanh toán.", "error");
      } finally {
        setBusyPlan(null);
        setTaskProgress(null);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!initialPlanCode || loading || autoCheckoutStarted.current) return;
    autoCheckoutStarted.current = true;
    onInitialPlanHandled();
    if (!plans.some((plan) => plan.code === initialPlanCode)) {
      showToast("Gói được chọn không còn khả dụng. Vui lòng chọn gói khác.", "error");
      return;
    }
    void beginCheckout(initialPlanCode);
  }, [beginCheckout, initialPlanCode, loading, showToast, onInitialPlanHandled, plans]);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const { payment: current } = await api<{ payment: BillingPayment }>(
          `/api/billing/payments/${encodeURIComponent(payment.id)}`
        );
        if (!active) return;
        setPayment((existing) =>
          existing?.id === current.id
            ? {
              ...existing,
              ...current,
              qrUrl: existing.qrUrl,
              bankCode: existing.bankCode,
              accountNumber: existing.accountNumber,
              accountName: existing.accountName,
            }
            : existing
        );
        if (current.status === "paid") {
          showToast(`Đã xác nhận thanh toán gói ${current.planName}. Gói được kích hoạt tự động.`, "success");
          onPaid();
          return;
        }
      } catch {
        /* Keep polling; the user can still use the manual refresh button. */
      }
      if (active) timer = window.setTimeout(() => void poll(), 4000);
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [payment?.id, payment?.status, showToast, onPaid]);

  const refreshPayment = async () => {
    if (!payment) return;
    setCheckingPayment(true);
    try {
      const { payment: current } = await api<{ payment: BillingPayment }>(
        `/api/billing/payments/${encodeURIComponent(payment.id)}`
      );
      setPayment((existing) =>
        existing?.id === current.id
          ? {
            ...existing,
            ...current,
            qrUrl: existing.qrUrl,
            bankCode: existing.bankCode,
            accountNumber: existing.accountNumber,
            accountName: existing.accountName,
          }
          : existing
      );
      if (current.status === "paid") {
        showToast(`Đã xác nhận thanh toán gói ${current.planName}. Gói được kích hoạt tự động.`, "success");
        onPaid();
      } else {
        showToast("Chưa nhận được thanh toán. Hệ thống sẽ tự kiểm tra lại.", "info");
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Không kiểm tra được trạng thái thanh toán.", "error");
    } finally {
      setCheckingPayment(false);
    }
  };

  return (
    <section className="content-card profile-billing-card">
      <div className="profile-section-header">
        <div>
          <h2>Nâng cấp hoặc gia hạn gói dịch vụ</h2>
        </div>
      </div>

      {taskProgress && <TaskProgress {...taskProgress} />}

      {loading ? (
        <TaskProgress label="Đang tải các gói dịch vụ" />
      ) : plans.length ? (
        <div className="profile-pricing-grid">
          {plans.map((plan) => {
            const current = plan.code === currentPlanCode;
            const hasExpiry = Boolean(subscriptionExpiresAt);
            const isFeatured = plan.featured || plan.code === "pro";

            return (
              <article
                className={`profile-plan-tile ${current ? "is-current-plan" : ""} ${isFeatured ? "is-featured-plan" : ""}`}
                key={plan.code}
              >
                {isFeatured && <span className="profile-plan-featured-tag">ĐƯỢC CHỌN NHIỀU</span>}
                {current && <span className="profile-plan-current-tag">GÓI ĐANG DÙNG</span>}

                <div className="profile-plan-tile-header">
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                </div>

                <div className="profile-plan-tile-price">
                  <strong>{new Intl.NumberFormat("vi-VN").format(plan.monthlyPrice ?? 0)}đ</strong>
                  <span>/ tháng</span>
                </div>

                <ul className="profile-plan-features">
                  <li>
                    <Icon name="check" size={14} />
                    <span>{plan.quoteLimit == null ? "Không giới hạn lượt báo giá" : `${new Intl.NumberFormat("vi-VN").format(plan.quoteLimit)} lượt tạo báo giá / tháng`}</span>
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    <span>{plan.templateLimit == null ? "Không giới hạn mẫu báo giá" : `${plan.templateLimit} mẫu báo giá doanh nghiệp`}</span>
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    <span>AI đối chiếu chính xác theo bảng giá riêng</span>
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    <span>Xuất file Excel &amp; PDF chuẩn mẫu</span>
                  </li>
                </ul>

                <button
                  type="button"
                  className={`button ${current && !hasExpiry ? "button-soft is-disabled-btn" : isFeatured ? "button-primary profile-btn-featured" : "button-primary"}`}
                  disabled={Boolean(busyPlan) || (current && !hasExpiry)}
                  onClick={() => void beginCheckout(plan.code)}
                >
                  {busyPlan === plan.code ? (
                    "Đang tạo mã…"
                  ) : current && !hasExpiry ? (
                    "Đang sử dụng"
                  ) : current ? (
                    "Gia hạn gói này"
                  ) : currentPlanCode === "free" ? (
                    "Nâng cấp ngay"
                  ) : (
                    "Đổi sang gói này"
                  )}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <p>Chưa có gói trả phí khả dụng.</p>
        </div>
      )}

      {/* MODAL THANH TOÁN SEPAY VỚI NÚT COPY TIỆN LỢI */}
      {payment && (
        <div
          className="billing-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPayment(null);
          }}
        >
          <section className="billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
            <button
              type="button"
              className="icon-button billing-modal-close"
              aria-label="Đóng"
              onClick={() => setPayment(null)}
            >
              ×
            </button>
            <span className="profile-card-eyebrow">
              SEPAY · {payment.status === "paid" ? "ĐÃ THANH TOÁN" : payment.status === "superseded" ? "MÃ ĐÃ THAY THẾ" : "CHỜ THANH TOÁN"}
            </span>
            <h2 id="billing-modal-title">Thanh toán gói {payment.planName}</h2>

            {payment.status === "paid" ? (
              <div className="billing-success">
                <span aria-hidden="true">✓</span>
                <strong>Thanh toán thành công</strong>
                <p>Gói dịch vụ đã được kích hoạt tự động trên tài khoản của bạn.</p>
              </div>
            ) : payment.status === "superseded" ? (
              <p>Mã thanh toán này đã được thay bằng yêu cầu mới. Hãy chọn gói để tạo mã khác.</p>
            ) : (
              <>
                {payment.qrUrl && (
                  <div className="billing-qr-box">
                    <img
                      className="billing-qr"
                      src={payment.qrUrl}
                      alt={`QR thanh toán ${payment.amount.toLocaleString("vi-VN")} đồng`}
                    />
                  </div>
                )}
                <div className="billing-amount-banner">
                  <small>Số tiền cần chuyển:</small>
                  <strong className="billing-amount">{new Intl.NumberFormat("vi-VN").format(payment.amount)}đ</strong>
                </div>

                <p className="billing-instruction">Quét mã QR bằng app ngân hàng hoặc chuyển khoản theo thông tin bên dưới:</p>

                <div className="billing-copy-grid">
                  {payment.bankCode && (
                    <div className="billing-copy-item">
                      <div className="billing-copy-meta">
                        <small>Ngân hàng:</small>
                        <strong>{payment.bankCode}</strong>
                      </div>
                      <CopyTextButton text={payment.bankCode} label="ngân hàng" onToast={showToast} />
                    </div>
                  )}

                  {payment.accountNumber && (
                    <div className="billing-copy-item">
                      <div className="billing-copy-meta">
                        <small>Số tài khoản:</small>
                        <strong className="billing-mono-value">{payment.accountNumber}</strong>
                      </div>
                      <CopyTextButton text={payment.accountNumber} label="số tài khoản" onToast={showToast} />
                    </div>
                  )}

                  {payment.accountName && (
                    <div className="billing-copy-item">
                      <div className="billing-copy-meta">
                        <small>Chủ tài khoản:</small>
                        <strong>{payment.accountName}</strong>
                      </div>
                      <CopyTextButton text={payment.accountName} label="tên chủ tài khoản" onToast={showToast} />
                    </div>
                  )}

                  <div className="billing-copy-item billing-copy-highlight">
                    <div className="billing-copy-meta">
                      <small>Nội dung chuyển khoản (bắt buộc):</small>
                      <strong className="billing-code-value">{payment.code}</strong>
                    </div>
                    <CopyTextButton text={payment.code} label="nội dung chuyển khoản" onToast={showToast} />
                  </div>
                </div>

                <div className="billing-pulse-row">
                  <span className="billing-pulse-dot" />
                  <span>Hệ thống đang tự động kiểm tra giao dịch…</span>
                </div>
              </>
            )}

            <div className="billing-modal-actions">
              <button type="button" className="button button-soft" onClick={() => setPayment(null)}>
                Đóng
              </button>
              {payment.status === "pending" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={checkingPayment}
                  onClick={() => void refreshPayment()}
                >
                  {checkingPayment ? "Đang kiểm tra…" : "Kiểm tra ngay"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function getCustomerInitials(name: string): string {
  if (!name || !name.trim()) return "KH";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
  "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
  "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
  "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  "linear-gradient(135deg, #10b981 0%, #059669 100%)",
];

function getCustomerAvatarBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function QuoteCards({
  quotes,
  onOpen,
  onDelete,
  emptyTitle,
  emptyText,
}: {
  quotes: Quote[];
  onOpen: (id: string) => void;
  onDelete?: (quote: Quote) => void;
  emptyTitle: string;
  emptyText: string;
}) {
  if (!quotes.length) return <EmptyState title={emptyTitle} text={emptyText} />;

  return (
    <div className="quote-cards-grid">
      {quotes.map((quote) => {
        const initials = getCustomerInitials(quote.customerName);
        const avatarBg = getCustomerAvatarBg(quote.customerName);

        return (
          <div
            key={quote._id}
            className={`quote-card-item status-${quote.status}`}
            onClick={() => onOpen(quote._id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(quote._id);
              }
            }}
          >
            {/* Top colored accent indicator */}
            <div className={`quote-card-accent-bar status-bg-${quote.status}`} />

            {/* Header: Quote Number & Status */}
            <div className="quote-card-header">
              <span className="quote-number-pill" title={`Mã báo giá: ${quote.quoteNumber}`}>
                <Icon name="quote" size={13} />
                <span className="quote-number-text">{quote.quoteNumber}</span>
              </span>
              <StatusPill status={quote.status} />
            </div>

            {/* Customer Information */}
            <div className="quote-card-customer">
              <div className="quote-avatar-circle" style={{ background: avatarBg }}>
                <span>{initials}</span>
              </div>
              <div className="quote-customer-meta">
                <h4 className="quote-customer-name" title={quote.customerName}>
                  {quote.customerName}
                </h4>
                <div className="quote-contact-chips">
                  {quote.customerPhone ? (
                    <span className="quote-contact-chip" title={`Điện thoại: ${quote.customerPhone}`}>
                      <Icon name="phone" size={11} />
                      <span>{quote.customerPhone}</span>
                    </span>
                  ) : null}
                  {quote.customerEmail ? (
                    <span className="quote-contact-chip" title={`Email: ${quote.customerEmail}`}>
                      <Icon name="mail" size={11} />
                      <span>{quote.customerEmail}</span>
                    </span>
                  ) : (
                    !quote.customerPhone && (
                      <span className="quote-contact-chip is-empty">Chưa có liên hệ</span>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Details Meta Chips */}
            <div className="quote-card-stats">
              <span className="quote-stat-pill" title="Thời gian tạo">
                <Icon name="clock" size={12} />
                <span>{formatDate(quote.createdAt)}</span>
              </span>
              <span className="quote-stat-pill" title="Số lượng hạng mục sản phẩm">
                <Icon name="box" size={12} />
                <span>{quote.lines.length} hạng mục</span>
              </span>
            </div>

            {/* Card Footer: Total Amount & Actions */}
            <div className="quote-card-footer">
              <div className="quote-card-total">
                <span className="quote-total-label">Tổng giá trị</span>
                <strong className="quote-total-amount">
                  {formatMoney(quote.total, quote.currency)}
                </strong>
              </div>

              <div className="quote-card-actions">
                {onDelete && (
                  <button
                    type="button"
                    className="quote-card-action-btn quote-card-btn-delete"
                    title="Xóa bản báo giá"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(quote);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
                <span className="quote-card-open-badge" title="Mở chi tiết báo giá">
                  <span>Xem</span>
                  <Icon name="arrow" size={13} />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state quote-empty-state"><span className="empty-icon"><img src="/images/quote-empty-3d.svg" alt="" /></span><h3>{title}</h3>{text && <p>{text}</p>}</div>; }
function Loading() { return <TaskProgress label="Đang tải dữ liệu" detail="Vui lòng chờ trong giây lát…" />; }

function App() {
  const [path, setPath] = useState(() => normalizedPath(window.location.pathname));
  useEffect(() => {
    const syncPath = () => setPath(normalizedPath(window.location.pathname));
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);
  if (path === "/quan-tri") return <AdminApp />;
  if (path === "/dang-nhap" || path === "/dang-ky" || userRouteForPath(path)) return <UserApp />;
  if (path === "/") return <LandingPage />;
  return <main className="route-not-found"><div><span>404</span><h1>Không tìm thấy trang</h1><p>Đường dẫn này không tồn tại hoặc đã được thay đổi.</p><a href="/">Về trang chủ</a></div></main>;
}

export default App;
