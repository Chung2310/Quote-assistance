import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { api, formatDate, formatMoney } from "./api";
import type { Analysis, AnalysisItem, CatalogItem, Quote, QuoteRequest, QuoteStatus, User } from "./types";
import AdminApp from "./AdminApp";
import { NotificationToast, useConfirmation, useNotification, type ConfirmOptions, type Notify } from "./Feedback";
import "./settings.css";

type Section = "home" | "quotes" | "approvals" | "catalog" | "profile";
interface CompanyEmailSettings { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string; passwordSet: boolean }
interface CompanyEmailForm { host: string; port: string; secure: boolean; user: string; password: string; from: string }
interface CompanyStoredFile { _id?: string; originalFilename: string; mimeType: string; bytes: number; createdAt: string }

const statusLabels: Record<QuoteStatus, string> = { draft: "Bản nháp", needs_info: "Thiếu thông tin", pending_review: "Chờ duyệt", approved: "Đã duyệt", rejected: "Cần chỉnh sửa" };
const statusStyles: Record<QuoteStatus, string> = { draft: "neutral", needs_info: "amber", pending_review: "blue", approved: "green", rejected: "rose" };
const roleLabels = { sales: "Nhân viên báo giá", admin: "Quản trị doanh nghiệp" };

type RegistrationField = "companyName" | "taxId" | "address" | "phone" | "businessEmail" | "representativeName" | "name" | "email" | "password" | "confirmPassword";
type RegistrationDraft = Record<RegistrationField, string>;
const emptyRegistration: RegistrationDraft = {
  companyName: "", taxId: "", address: "", phone: "", businessEmail: "", representativeName: "",
  name: "", email: "", password: "", confirmPassword: "",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    quote: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
    check: <><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19v2h16v-2"/></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>,
    file: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    back: <><path d="m15 18-6-6 6-6"/><path d="M9 12h12"/></>,
    mail: <><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}

function StatusPill({ status }: { status: QuoteStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}><span className="status-dot" />{statusLabels[status]}</span>;
}

function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [section, setSection] = useState<Section>("home");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const { notification, notify, dismiss } = useNotification();
  const { confirm, dialog: confirmationDialog } = useConfirmation();
  const [refreshKey, setRefreshKey] = useState(0);
  const isAdminWorkspace = window.location.pathname.replace(/\/+$/, "") === "/workspace";

  useEffect(() => {
    api<{ user: User }>("/api/auth/me").then(({ user: signedIn }) => {
      if (signedIn.platformAdmin && !isAdminWorkspace) {
        window.location.replace("/admin");
        return;
      }
      setUser(signedIn);
    }).catch(() => setUser(null)).finally(() => setCheckingSession(false));
  }, [isAdminWorkspace]);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); setSection("home"); };
  if (checkingSession) return <div className="splash"><div className="brand-mark">G</div><span>Đang mở không gian làm việc…</span></div>;
  if (!user) return <Login onLogin={setUser} onNotify={notify} />;
  const openQuote = (id: string) => setQuoteId(id);
  const showTopbarAction = Boolean(quoteId);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark">G</div><div><strong>giáo</strong><span>TRỢ LÝ BÁO GIÁ</span></div></div>
      <div className="nav-caption">KHÔNG GIAN LÀM VIỆC</div>
      <nav className="side-nav">
        {user.platformAdmin && <a className="nav-button admin-portal-link" href="/admin" title="Quản lý doanh nghiệp"><Icon name="shield" size={18} /><span>Quản lý doanh nghiệp</span></a>}
        <NavButton icon="home" label="Tổng quan" active={!quoteId && section === "home"} onClick={() => { setQuoteId(null); setSection("home"); }} />
        <NavButton icon="quote" label="Báo giá" active={!quoteId && section === "quotes"} onClick={() => { setQuoteId(null); setSection("quotes"); }} />
        {user.role === "admin" && <NavButton icon="check" label="Duyệt báo giá" active={!quoteId && section === "approvals"} onClick={() => { setQuoteId(null); setSection("approvals"); }} />}
        {user.role === "admin" && <NavButton icon="box" label="Danh mục" active={!quoteId && section === "catalog"} onClick={() => { setQuoteId(null); setSection("catalog"); }} />}
      </nav>
      <div className="sidebar-bottom">
        <button className={`profile-button ${!quoteId && section === "profile" ? "active" : ""}`} onClick={() => { setQuoteId(null); setSection("profile"); }} title="Trang cá nhân"><span className="avatar"><Icon name="user" size={17}/></span><span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span><Icon name="arrow" size={17} /></button>
      </div>
    </aside>
    <div className="main-column">
      {showTopbarAction && <header className="topbar">
        <div className="topbar-actions"><button className="button button-primary button-compact" onClick={() => { setQuoteId(null); setSection("quotes"); }}><Icon name="plus" size={16} />Tạo báo giá</button></div>
      </header>}
      <main className="main-content">{quoteId ? <QuoteDetail key={quoteId} id={quoteId} user={user} onBack={() => setQuoteId(null)} onChanged={refresh} onToast={notify} confirm={confirm} /> : section === "home" ? <Dashboard key={refreshKey} canCreate canReview={user.role === "admin"} onOpen={openQuote} onCreate={() => setSection("quotes")} onNavigate={setSection} /> : section === "quotes" ? <QuoteWorkspace key={refreshKey} canCreate onOpen={openQuote} onCreated={(id) => { refresh(); notify("Bản nháp báo giá đã được tạo."); openQuote(id); }} /> : section === "approvals" ? <Approvals key={refreshKey} onOpen={openQuote} /> : section === "catalog" ? <CatalogWorkspace key={refreshKey} onToast={notify} confirm={confirm} /> : <AccountProfile user={user} onToast={notify} onSignOut={() => void signOut()} confirm={confirm} />}</main>
    </div>
    {notification && <NotificationToast notification={notification} onDismiss={dismiss}/>}
    {confirmationDialog}
  </div>;
}

function NavButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}><Icon name={icon} size={18} /><span>{label}</span>{label === "Duyệt báo giá" && active && <span className="nav-active-dot" />}</button>;
}

function Login({ onLogin, onNotify }: { onLogin: (user: User) => void; onNotify: Notify }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registration, setRegistration] = useState<RegistrationDraft>(emptyRegistration);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
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
      if (result.user.platformAdmin) {
        window.location.assign("/admin");
        return;
      }
      onLogin(result.user);
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
      if (registration.password !== registration.confirmPassword) throw new Error("Mật khẩu xác nhận chưa khớp.");
      const { confirmPassword: _confirmPassword, ...details } = registration;
      const { user } = await api<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(details) });
      onLogin(user);
      onNotify("Tài khoản doanh nghiệp đã được tạo và đăng nhập.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo tài khoản doanh nghiệp.");
    } finally {
      setBusy(false);
    }
  };

  const registrationFields: Array<{ key: RegistrationField; label: string; type?: string; autoComplete?: string; wide?: boolean }> = [
    { key: "companyName", label: "Tên doanh nghiệp", autoComplete: "organization" },
    { key: "taxId", label: "Mã số thuế" },
    { key: "address", label: "Địa chỉ doanh nghiệp", autoComplete: "street-address", wide: true },
    { key: "phone", label: "Điện thoại doanh nghiệp", type: "tel", autoComplete: "tel" },
    { key: "businessEmail", label: "Email doanh nghiệp", type: "email", autoComplete: "email" },
    { key: "representativeName", label: "Người đại diện", autoComplete: "name" },
    { key: "name", label: "Họ tên người quản trị", autoComplete: "name" },
    { key: "email", label: "Email đăng nhập", type: "email", autoComplete: "username" },
    { key: "password", label: "Mật khẩu", type: "password", autoComplete: "new-password" },
    { key: "confirmPassword", label: "Xác nhận mật khẩu", type: "password", autoComplete: "new-password" },
  ];

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setError("");
  };

  return (
    <div className="login-screen">
      <div className="login-art">
        <div className="art-content">
          <div className="art-brand-header">
            <div className="brand-mark brand-mark-cyan">G</div>
            <div className="art-brand-text">
              <strong>giáo</strong>
              <span>TRỢ LÝ BÁO GIÁ</span>
            </div>
          </div>

          <div className="art-hero">
            <h1>
              Báo giá nhanh.<br />
              <em>Rõ ràng.</em>
            </h1>
          </div>
          <img className="login-banner-image" src="/images/quote-banner.png" alt="" />
        </div>
      </div>

      <div className={`login-panel ${mode === "register" ? "register-mode" : ""}`}>
        <div className="login-form-card">
          <div className="mobile-brand">
            <span className="brand-mark brand-mark-cyan">G</span>
            <div>
              <strong>giáo</strong>
              <span>TRỢ LÝ BÁO GIÁ</span>
            </div>
          </div>

          <div className="login-header">
            <h2>{mode === "login" ? "Đăng nhập" : "Đăng ký doanh nghiệp"}</h2>
            <p className="login-subtitle">{mode === "login" ? "Đăng nhập vào không gian báo giá của doanh nghiệp." : "Tạo hồ sơ doanh nghiệp và tài khoản quản trị riêng."}</p>
          </div>

          <div className="login-mode-switch" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => switchMode("login")}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => switchMode("register")}>Đăng ký doanh nghiệp</button>
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
              {!busy && <Icon name="arrow" size={17} />}
            </button>
          </form> : <form onSubmit={(event) => void submitRegistration(event)} className="login-form business-register-form">
            {registrationFields.map(({ key, label, type = "text", autoComplete = "off", wide }) => <div className={`input-group register-field ${wide ? "register-field-wide" : ""}`} key={key}>
              <label htmlFor={`register-${key}`}>{label}</label>
              <div className="input-wrapper"><input id={`register-${key}`} type={type} autoComplete={autoComplete} maxLength={key === "address" ? 500 : key === "password" || key === "confirmPassword" ? 200 : 250} minLength={key === "password" || key === "confirmPassword" ? 12 : undefined} value={registration[key]} onChange={(event) => setRegistration((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === "taxId" ? "Mã số thuế doanh nghiệp" : undefined} required/></div>
            </div>)}
            {error && <div className="login-error-alert register-field-wide" role="alert"><span className="error-icon"><Icon name="close" size={14}/></span><span>{error}</span></div>}
            <button className="login-submit-btn register-field-wide" type="submit" disabled={busy}>{busy ? <span className="login-spinner"/> : null}<span>{busy ? "Đang tạo tài khoản…" : "Tạo tài khoản doanh nghiệp"}</span>{!busy && <Icon name="arrow" size={17}/>}</button>
          </form>}
          {mode === "login" && error && <div className="login-error-alert" role="alert"><span className="error-icon"><Icon name="close" size={14}/></span><span>{error}</span></div>}
          <a className="admin-login-link" href="/admin">Đăng nhập dành cho quản trị viên</a>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ onOpen, onCreate, onNavigate, canCreate, canReview }: { onOpen: (id: string) => void; onCreate: () => void; onNavigate: (section: Section) => void; canCreate: boolean; canReview: boolean }) {
  const [data, setData] = useState<{ counts: { total: number; drafts: number; pending: number; approved: number }; recent: Quote[] } | null>(null); const [error, setError] = useState("");
  useEffect(() => { api<typeof data>("/api/dashboard").then((value) => setData(value)).catch((cause) => setError(cause.message)); }, []);
  return <div className="page-stack dashboard-page">
    <section className="dashboard-banners" aria-label="Tạo và theo dõi báo giá">
      <article className="dashboard-banner dashboard-banner-primary">
        <img src="/images/quote-banner.png" alt="" />
        <div className="dashboard-banner-copy">
          <h1>Báo giá nhanh, rõ ràng</h1>
          {canCreate && <button className="button button-primary" onClick={onCreate}><Icon name="plus" size={17} />Tạo báo giá</button>}
        </div>
      </article>
      <article className="dashboard-banner dashboard-banner-secondary">
        <img src="/images/approval-banner.png" alt="" />
      </article>
    </section>
    {error && <div className="inline-error">{error}</div>}
    <section className="metric-grid">
      <Metric label="Tổng báo giá" value={data?.counts.total ?? "—"} icon="quote" tone="mint" />
      <Metric label="Bản nháp" value={data?.counts.drafts ?? "—"} icon="file" tone="sand" />
      <Metric label="Chờ duyệt" value={data?.counts.pending ?? "—"} icon="check" tone="lavender" action={canReview ? () => onNavigate("approvals") : undefined} />
      <Metric label="Đã duyệt" value={data?.counts.approved ?? "—"} icon="download" tone="blue" />
    </section>
    <section className="content-card recent-card">
      <div className="card-heading">
        <div><h2>Báo giá gần đây</h2></div>
        <button className="text-button" onClick={() => onNavigate("quotes")}>Xem tất cả <Icon name="arrow" size={15} /></button>
      </div>
      <QuoteTable quotes={data?.recent ?? []} onOpen={onOpen} emptyTitle="Chưa có báo giá nào" emptyText="" />
    </section>
  </div>;
}

function Metric({ label, value, icon, tone, action }: { label: string; value: number | string; icon: string; tone: string; action?: () => void }) {
  return <button className={`metric-card tone-${tone} ${action ? "metric-action" : ""}`} onClick={action} disabled={!action}><span className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon} size={18}/></span></span><strong className="metric-value">{value}</strong></button>;
}

function QuoteWorkspace({ onOpen, onCreated, canCreate }: { onOpen: (id: string) => void; onCreated: (id: string) => void; canCreate: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]); const [catalog, setCatalog] = useState<CatalogItem[]>([]); const [creating, setCreating] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [reloadKey, setReloadKey] = useState(0); const [filter, setFilter] = useState("all");
  useEffect(() => { setLoading(true); setError(""); Promise.all([api<{ quotes: Quote[] }>("/api/quotes"), api<{ items: CatalogItem[] }>("/api/catalog")]).then(([quoteResult, catalogResult]) => { setQuotes(quoteResult.quotes); setCatalog(catalogResult.items); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải danh sách báo giá.")).finally(() => setLoading(false)); }, [reloadKey]);
  const filtered = filter === "all" ? quotes : quotes.filter((quote) => quote.status === filter);
  if (creating) return <NewQuote catalog={catalog} onCancel={() => setCreating(false)} onCreated={onCreated}/>;
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Báo giá</h1></div>{canCreate && <button className="button button-primary" onClick={() => setCreating(true)}><Icon name="plus" size={17}/>Tạo báo giá mới</button>}</section>{error && <div className="inline-error" role="alert">{error} <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>Thử lại</button></div>}<section className="content-card list-card"><div className="list-toolbar"><div className="filter-tabs">{[["all", "Tất cả"], ["draft", "Bản nháp"], ["pending_review", "Chờ duyệt"], ["approved", "Đã duyệt"], ["needs_info", "Cần bổ sung"], ["rejected", "Cần chỉnh sửa"]].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="row-count">{filtered.length} báo giá</span></div>{loading ? <Loading/> : error ? null : <QuoteTable quotes={filtered} onOpen={onOpen} emptyTitle="Không có báo giá trong mục này" emptyText=""/>}</section></div>;
}

function NewQuote({ catalog, onCancel, onCreated }: { catalog: CatalogItem[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [requestText, setRequestText] = useState("");
  const [requestIdempotencyKey] = useState(() => crypto.randomUUID());
  const [quoteIdempotencyKey] = useState(() => crypto.randomUUID());
  const [requestId, setRequestId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<AnalysisItem[]>([]);
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAnalysis(null);
    try {
      const { request } = await api<{ request: QuoteRequest }>("/api/quote-requests", {
        method: "POST",
        body: JSON.stringify({ customerName, customerEmail, requestText, idempotencyKey: requestIdempotencyKey }),
      });
      setRequestId(request._id);
      const { analysis: result } = await api<{ analysis: Analysis }>(`/api/quote-requests/${request._id}/analyze`, { method: "POST" });
      setAnalysis(result);
      setSelected(result.items);
      if (result.missingFields.length === 0) setConfirmed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể phân tích yêu cầu.");
    } finally {
      setBusy(false);
    }
  };

  const addCatalogItem = (item: CatalogItem) => {
    if (selected.some((line) => line.catalogItemId === item._id)) return;
    setSelected((lines) => [...lines, { catalogItemId: item._id, quantity: 1, unit: item.unit, attributes: {}, evidence: "Nhân viên chọn từ danh mục" }]);
    setQuery("");
  };

  const createQuote = async () => {
    setBusy(true);
    setError("");
    try {
      const { quote } = await api<{ quote: Quote }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          idempotencyKey: quoteIdempotencyKey,
          items: selected.map(({ catalogItemId, quantity, unit, attributes }) => ({ catalogItemId, quantity, unit, attributes })),
          informationConfirmed: confirmed,
        }),
      });
      onCreated(quote._id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo báo giá.");
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const results = catalog
    .filter((item) => item.active && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today))
    .filter((item) => `${item.sku} ${item.name}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")))
    .slice(0, 8);

  return (
    <div className="page-stack">
      <div className="page-heading-row compact-heading">
        <div>
          <button className="back-link" onClick={onCancel}><Icon name="back" size={17} />Quay lại báo giá</button>
          <h1>Tạo báo giá mới</h1>
        </div>
      </div>

      <div className="creation-layout">
        <section className="content-card form-card">
          <div className="section-title"><span className="step-number">01</span><div><h2>Thông tin yêu cầu</h2></div></div>
          <form onSubmit={(event) => void analyze(event)} className="request-form">
            <div className="field-row">
              <label>Tên khách hàng<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ví dụ: Công ty Minh An" required disabled={Boolean(analysis)} /></label>
              <label>Email (không bắt buộc)<input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="lienhe@congty.vn" disabled={Boolean(analysis)} /></label>
            </div>
            <label>Nội dung khách yêu cầu<textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Dán nội dung trao đổi hoặc mô tả nhu cầu của khách hàng…" rows={6} maxLength={10000} required disabled={Boolean(analysis)} /><span className="field-hint">Chỉ gửi nội dung cần thiết để tìm sản phẩm. Không nhập thông tin nhạy cảm.</span></label>
            {!analysis && <button className="button button-primary analyze-button" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{busy ? "Đang phân tích…" : "Phân tích yêu cầu"}<Icon name="arrow" size={16} /></button>}
          </form>
          {error && <div className="inline-error">{error}</div>}
        </section>

        {analysis && <section className="content-card analysis-card">
          <div className="section-title"><span className="step-number step-number-ai"><Icon name="spark" size={17} /></span><div><h2>Gợi ý sản phẩm</h2></div></div>
          <div className={`analysis-banner ${analysis.status}`}>
            <span className="analysis-indicator" />
            <div><strong>{analysis.status === "matched" ? "Đã tìm thấy sản phẩm phù hợp" : analysis.status === "ambiguous" ? "Có nhiều sản phẩm cần xác nhận" : "Chưa ghép được sản phẩm"}</strong>{analysis.status !== "matched" && <span>Bạn có thể tìm và chọn mặt hàng trong danh mục bên dưới.</span>}</div>
          </div>
          {analysis.missingFields.length > 0 && <div className="missing-fields"><strong>Cần kiểm tra thêm</strong><div>{analysis.missingFields.map((field) => <span key={field}>{field}</span>)}</div></div>}

          <div className="selected-list">
            {selected.map((line) => {
              const item = catalog.find((entry) => entry._id === line.catalogItemId);
              if (!item) return null;
              return <div className="selected-item" key={line.catalogItemId}>
                <div className="selected-copy"><strong>{item.name}</strong><span>{item.sku} · {item.unit} · {formatMoney(item.price, item.currency)}</span>{line.evidence && <small>“{line.evidence}”</small>}</div>
                <label className="quantity-control"><span>Số lượng</span><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setSelected((rows) => rows.map((row) => row.catalogItemId === line.catalogItemId ? { ...row, quantity: Number(event.target.value) } : row))} /></label>
                <button className="icon-button remove-button" aria-label="Bỏ sản phẩm" onClick={() => setSelected((rows) => rows.filter((row) => row.catalogItemId !== line.catalogItemId))}><Icon name="close" size={16} /></button>
              </div>;
            })}
          </div>

          <div className="catalog-search-wrap">
            <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm thêm sản phẩm trong danh mục…" /></label>
            {query && <div className="search-results">{results.length ? results.map((item) => <button key={item._id} onClick={() => addCatalogItem(item)}><span><strong>{item.name}</strong><small>{item.sku} · {item.unit}</small></span><span className="result-price">{formatMoney(item.price, item.currency)}<Icon name="plus" size={15} /></span></button>) : <div className="search-empty">Không tìm thấy sản phẩm đang hoạt động.</div>}</div>}
          </div>
          {analysis.missingFields.length > 0 && <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>Tôi đã xác nhận thông tin cần thiết</strong><small>Đã bổ sung hoặc xác nhận với khách.</small></span></label>}
          <div className="analysis-footer"><span>{selected.length} mặt hàng đã chọn</span><button className="button button-primary" disabled={busy || selected.length === 0 || (analysis.missingFields.length > 0 && !confirmed)} onClick={() => void createQuote()}>{busy ? "Đang lưu…" : "Tạo bản nháp"}<Icon name="arrow" size={16} /></button></div>
        </section>}
      </div>
    </div>
  );
}

function QuoteDetail({ id, user, onBack, onChanged, onToast, confirm }: { id: string; user: User; onBack: () => void; onChanged: () => void; onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [quantities, setQuantities] = useState<Record<string, number>>({}); const [confirmed, setConfirmed] = useState(false); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState("");
  const canEdit = user.role === "sales" || user.role === "admin"; const canApprove = user.role === "admin"; const editable = canEdit && Boolean(quote && ["draft", "needs_info", "rejected"].includes(quote.status));
  const load = useCallback(async () => { try { const { quote: value } = await api<{ quote: Quote }>(`/api/quotes/${id}`); setQuote(value); setQuantities(Object.fromEntries(value.lines.map((line) => [line.catalogItemId, line.quantity]))); setConfirmed(value.informationConfirmed); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể mở báo giá."); } finally { setLoading(false); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const perform = async (url: string, body?: unknown, method = "POST", success = "Đã cập nhật báo giá.") => {
    if (quote) {
      let confirmation: ConfirmOptions | undefined;
      if (url.endsWith("/submit-review")) confirmation = { title: "Gửi báo giá duyệt?", message: `Báo giá ${quote.quoteNumber} sẽ chuyển vào danh sách chờ quản trị viên doanh nghiệp duyệt.`, confirmLabel: "Gửi duyệt" };
      else if (url.endsWith("/approve")) confirmation = { title: "Duyệt báo giá này?", message: `${quote.quoteNumber} · ${quote.customerName}\nTổng tiền: ${formatMoney(quote.total, quote.currency)}\nSau khi duyệt, có thể xuất PDF và gửi cho khách hàng.`, confirmLabel: "Duyệt báo giá" };
      else if (url.endsWith("/reject")) confirmation = { title: "Trả báo giá để chỉnh sửa?", message: `${quote.quoteNumber} sẽ chuyển về trạng thái cần chỉnh sửa.\nLý do: ${typeof body === "object" && body && "reason" in body ? String(body.reason) : ""}`, confirmLabel: "Trả lại", tone: "danger" };
      else if (url.endsWith("/email")) confirmation = { title: "Gửi báo giá qua email?", message: `Email PDF đã duyệt sẽ được gửi tới ${quote.customerEmail || "khách hàng"}.`, confirmLabel: "Gửi email" };
      if (confirmation && !await confirm(confirmation)) return;
    }
    if (url.endsWith("/submit-review") && quote && (quote.lines.some((line) => Number(quantities[line.catalogItemId]) !== line.quantity) || confirmed !== quote.informationConfirmed)) {
      setError("Lưu thay đổi và kiểm tra lại tổng tiền trước khi gửi duyệt.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await load();
      onChanged();
      onToast(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật báo giá.");
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading/>;
  if (!quote) return <div className="empty-state"><h2>Báo giá không khả dụng</h2><p>{error || "Không tìm thấy dữ liệu."}</p><button className="button button-soft" onClick={onBack}>Quay lại</button></div>;
  const save = (informationConfirmed = confirmed) => perform(`/api/quotes/${quote._id}`, { items: quote.lines.map((line) => ({ catalogItemId: line.catalogItemId, quantity: quantities[line.catalogItemId] })), informationConfirmed }, "PATCH", "Đã lưu thay đổi và tính lại giá.");
  const downloadPdf = () => { window.location.href = `/api/quotes/${quote._id}/pdf`; };
  return <div className="page-stack detail-stack"><div className="page-heading-row detail-heading"><div><button className="back-link" onClick={onBack}><Icon name="back" size={17}/>Tất cả báo giá</button><div className="quote-title-row"><h1>{quote.quoteNumber}</h1><StatusPill status={quote.status}/></div><p className="muted">Tạo {formatDate(quote.createdAt)} · {quote.customerName}</p></div><div className="detail-heading-actions">{editable && <button className="button button-soft" disabled={busy} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>}{canEdit && quote.status === "approved" && <button className="button button-soft" disabled={busy || !quote.customerEmail} title={!quote.customerEmail ? "Chưa có email khách hàng" : "Gửi PDF báo giá đã duyệt"} onClick={() => void perform("/api/quotes/" + quote._id + "/email", undefined, "POST", "Đã gửi báo giá qua email.")}><Icon name="mail" size={16}/>Gửi email</button>}<button className="button button-primary" disabled={quote.status !== "approved"} title={quote.status === "approved" ? "Tải bản PDF đã duyệt" : "Báo giá cần được duyệt trước khi xuất PDF"} onClick={downloadPdf}><Icon name="download" size={16}/>{quote.status === "approved" ? "Tải PDF" : "PDF sau khi duyệt"}</button></div></div>{error && <div className="inline-error">{error}</div>}{quote.status === "rejected" && quote.rejectionReason && <div className="rejection-note"><strong>Lý do doanh nghiệp trả lại</strong><span>{quote.rejectionReason}</span></div>}{quote.informationNeeded.length > 0 && <div className="needs-info-note"><div><strong>Cần kiểm tra thông tin</strong><span>{quote.informationNeeded.join(" · ")}</span></div>{editable && <label className="confirm-check compact-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span><strong>Đã xác nhận đủ</strong></span></label>}</div>}
    <div className="detail-grid"><div className="detail-main-column"><section className="content-card detail-card"><div className="card-heading"><div><span className="eyebrow">SẢN PHẨM & GIÁ</span><h2>Các dòng báo giá</h2></div><span className="subtle-count">{quote.lines.length} dòng</span></div><div className="quote-lines"><div className="quote-line-head"><span>Sản phẩm</span><span>Số lượng</span><span>Đơn giá</span><span>Thành tiền</span></div>{quote.lines.map((line) => <div className="quote-line" key={line.catalogItemId}><div className="line-product"><strong>{line.name}</strong><span>{line.sku} · {line.unit}</span></div><div className="line-quantity">{editable ? <input type="number" min="0.01" step="0.01" value={quantities[line.catalogItemId]} onChange={(event) => setQuantities((value) => ({ ...value, [line.catalogItemId]: Number(event.target.value) }))}/> : <span>{line.quantity} {line.unit}</span>}</div><span className="line-price">{formatMoney(line.unitPrice, line.currency)}</span><strong className="line-total">{formatMoney(line.lineTotal, line.currency)}</strong></div>)}</div><div className="totals-box"><div><span>Tạm tính</span><strong>{formatMoney(quote.subtotal, quote.currency)}</strong></div><div><span>Thuế ({(quote.taxRate * 100).toLocaleString("vi-VN")}%)</span><strong>{formatMoney(quote.taxAmount, quote.currency)}</strong></div><div className="grand-total"><span>Tổng cộng</span><strong>{formatMoney(quote.total, quote.currency)}</strong></div></div></section>{editable && quote.status === "needs_info" && <button className="button button-primary full-button" disabled={busy || (quote.informationNeeded.length > 0 && !confirmed)} onClick={() => void save(true)}>Xác nhận thông tin và lưu nháp<Icon name="arrow" size={16}/></button>}{editable && quote.status === "draft" && <button className="button button-primary full-button" disabled={busy || (quote.informationNeeded.length > 0 && !quote.informationConfirmed)} onClick={() => void perform(`/api/quotes/${quote._id}/submit-review`, {}, "POST", "Đã gửi báo giá vào hàng chờ duyệt.")}>Gửi duyệt báo giá<Icon name="arrow" size={16}/></button>}{canApprove && quote.status === "pending_review" && <div className="review-actions"><button className="button button-soft" onClick={() => setRejecting((value) => !value)}>Trả lại chỉnh sửa</button><button className="button button-primary" disabled={busy} onClick={() => void perform(`/api/quotes/${quote._id}/approve`, {}, "POST", "Báo giá đã được duyệt.")}><Icon name="check" size={16}/>Duyệt báo giá</button></div>}{rejecting && <div className="content-card reject-form"><label>Lý do cần chỉnh sửa<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ghi rõ phần cần bổ sung hoặc điều chỉnh…"/></label><button className="button button-primary" disabled={busy || !reason.trim()} onClick={() => void perform(`/api/quotes/${quote._id}/reject`, { reason }, "POST", "Đã trả báo giá để chỉnh sửa.")}>Gửi nhận xét</button></div>}</div><aside className="detail-side-column"><section className="content-card customer-card"><span className="eyebrow">KHÁCH HÀNG</span><div className="customer-avatar">{quote.customerName.slice(0, 1).toLocaleUpperCase("vi")}</div><h2>{quote.customerName}</h2><p>{quote.customerEmail || "Chưa có email"}</p><div className="side-divider"/><span className="eyebrow">NGƯỜI TẠO</span><p className="created-by">{quote.createdBy}</p><span className="eyebrow side-spaced">TRẠNG THÁI</span><StatusPill status={quote.status}/></section><section className="info-card"><span className="info-card-icon"><Icon name="spark" size={17}/></span><div><strong>Đơn giá giữ nguyên theo thời điểm tạo, kể cả khi bảng giá thay đổi.</strong></div></section></aside></div></div>;
}

function AccountProfile({ user, onToast, onSignOut, confirm }: { user: User; onToast: Notify; onSignOut: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  return <div className="page-stack profile-page">
    <section className="page-heading-row"><div><h1>Trang cá nhân</h1></div></section>
    <section className="content-card profile-overview">
      <div className="profile-identity">
        <span className="profile-overview-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toLocaleUpperCase("vi") || "?"}</span>
        <div className="profile-overview-copy"><strong>{user.name}</strong><span className="profile-email">{user.email}</span><small className="profile-role">{roleLabels[user.role]}</small></div>
      </div>
      <button className="button profile-signout" onClick={() => void confirm({ title: "Đăng xuất khỏi tài khoản?", message: "Bạn sẽ cần đăng nhập lại để tiếp tục làm việc.", confirmLabel: "Đăng xuất" }).then((accepted) => { if (accepted) onSignOut(); })}><Icon name="logout" size={17}/>Đăng xuất</button>
    </section>
    {user.role === "admin" ? <CompanySettings onToast={onToast} confirm={confirm}/> : <section className="content-card profile-admin-note"><h2>Email gửi báo giá do quản trị viên cấu hình</h2></section>}
  </div>;
}

function CompanySettings({ onToast, confirm }: { onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [settings, setSettings] = useState<CompanyEmailSettings | null>(null);
  const [form, setForm] = useState<CompanyEmailForm>({ host: "", port: "587", secure: false, user: "", password: "", from: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
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
    }
  };
  const testConnection = async () => {
    setTesting(true);
    setError("");
    try {
      await api("/api/settings/email/test", { method: "POST" });
      onToast("Kết nối SMTP thành công.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không kết nối được SMTP.");
    } finally {
      setTesting(false);
    }
  };
  const removeSettings = async () => {
    if (!await confirm({ title: "Xóa cấu hình email?", message: "Doanh nghiệp sẽ không thể gửi báo giá qua SMTP cho đến khi cấu hình lại.", confirmLabel: "Xóa cấu hình", tone: "danger" })) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/settings/email", { method: "DELETE" });
      onToast("Đã xóa cấu hình email của doanh nghiệp.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được cài đặt email.");
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading/>;
  return <div className="page-stack settings-page">
    <section className="page-heading-row"><div><h1>Email gửi báo giá</h1></div></section>
    {error && <div className="inline-error">{error}</div>}
    <section className="content-card email-settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">MÁY CHỦ SMTP</span><h2>Thông tin kết nối</h2></div><span className={`settings-status ${settings?.configured ? "connected" : "not-connected"}`}>{settings?.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span></div>
      <form className="email-settings-form" onSubmit={(event) => void save(event)}>
        <label>Máy chủ SMTP<input type="text" value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="smtp.congty.vn" autoComplete="off" required /></label>
        <div className="email-settings-row">
          <label>Cổng<input type="number" min="1" max="65535" value={form.port} onChange={(event) => update("port", event.target.value)} required /></label>
          <label>Kiểu bảo mật<select value={form.secure ? "tls" : "starttls"} onChange={(event) => update("secure", event.target.value === "tls")}><option value="starttls">STARTTLS (thường dùng cổng 587)</option><option value="tls">TLS (thường dùng cổng 465)</option></select></label>
        </div>
        <label>Tên đăng nhập SMTP<input type="text" value={form.user} onChange={(event) => update("user", event.target.value)} placeholder="Có thể để trống nếu máy chủ không yêu cầu" autoComplete="username" /></label>
        <label>Mật khẩu SMTP<input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={settings?.passwordSet ? "Để trống để giữ mật khẩu đã lưu" : "Nhập mật khẩu hoặc mật khẩu ứng dụng"} autoComplete="new-password" /></label>
        <label>Tên/email người gửi<input type="text" value={form.from} onChange={(event) => update("from", event.target.value)} placeholder="Báo giá ABC <baogia@congty.vn>" required /></label>
        <p className="settings-hint">Mật khẩu được mã hóa và không hiển thị lại. Dùng mật khẩu ứng dụng nếu nhà cung cấp yêu cầu.</p>
        <div className="settings-actions"><div>{settings?.configured && <><button className="button button-soft" type="button" disabled={busy || testing} onClick={() => void testConnection()}>{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</button><button className="text-button settings-delete" type="button" disabled={busy || testing} onClick={() => void removeSettings()}>Xóa cấu hình</button></>}</div><button className="button button-primary" type="submit" disabled={busy || testing}>{busy ? "Đang lưu…" : "Lưu cấu hình"}</button></div>
      </form>
    </section>
    <CompanyFiles onToast={onToast} confirm={confirm}/>
  </div>;
}

function CompanyFiles({ onToast, confirm }: { onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [files, setFiles] = useState<CompanyStoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
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
    try {
      await api<{ file: CompanyStoredFile }>("/api/files", {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Type": file.type || "application/octet-stream",
        },
      });
      await load();
      onToast("Tệp đã được lưu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được tệp lên.");
    } finally {
      setUploading(false);
    }
  };
  if (loading) return <section className="content-card email-settings-card"><Loading/></section>;
  return <section className="content-card email-settings-card company-files-card">
    <div className="settings-card-heading"><div><span className="eyebrow">TỆP VÀ ẢNH</span><h2>Tệp doanh nghiệp</h2></div></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="stored-files-section"><div className="stored-files-heading"><div><p className="settings-hint">Ảnh, PDF, CSV và Excel · tối đa 10 MB mỗi tệp</p></div><button className="button button-soft" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? "Đang tải lên…" : "Tải tệp hoặc ảnh"}</button><input ref={fileInput} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.xlsx,.xls" onChange={(event) => void upload(event)}/></div>
      {files.length ? <div className="stored-files-list">{files.map((file) => <div className="stored-file-row" key={file._id ?? `${file.originalFilename}-${file.createdAt}`}><span className="stored-file-icon"><Icon name="file" size={16}/></span><span><strong>{file.originalFilename}</strong><small>{formatDate(file.createdAt)} · {(file.bytes / 1024).toFixed(0)} KB</small></span></div>)}</div> : <p className="settings-hint stored-files-empty">Chưa có tệp nào được tải lên.</p>}
    </div>
  </section>;
}
function Approvals({ onOpen }: { onOpen: (id: string) => void }) {
  const [quotes, setQuotes] = useState<Quote[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { setLoading(true); setError(""); api<{ quotes: Quote[] }>("/api/quotes?status=pending_review").then(({ quotes: rows }) => setQuotes(rows)).catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải hàng chờ duyệt.")).finally(() => setLoading(false)); }, [reloadKey]);
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Doanh nghiệp duyệt báo giá</h1></div><span className="pending-count">{quotes.length} đang chờ</span></section>{error && <div className="inline-error" role="alert">{error} <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>Thử lại</button></div>}<section className="content-card list-card">{loading ? <Loading/> : error ? null : <QuoteTable quotes={quotes} onOpen={onOpen} emptyTitle="Không có báo giá đang chờ duyệt" emptyText=""/>}</section></div>;
}

function CatalogWorkspace({ onToast, confirm }: { onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [items, setItems] = useState<CatalogItem[]>([]); const [search, setSearch] = useState(""); const [fileRows, setFileRows] = useState<Record<string, unknown>[] | null>(null); const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; errors: string[]; validCount: number } | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<{ items: CatalogItem[] }>("/api/catalog").then(({ items: rows }) => setItems(rows)).catch((cause) => setError(cause.message)), []);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => items.filter((item) => `${item.sku} ${item.name}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))), [items, search]);
  const parseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return; setError(""); setPreview(null); setFileRows(null);
    if (file.size > 5 * 1024 * 1024) { setError("Tệp không được vượt quá 5 MB."); return; }
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, sheetRows: 2002 }); const firstSheet = workbook.Sheets[workbook.SheetNames[0]]; if (!firstSheet) throw new Error("Tệp không có trang dữ liệu.");
      const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "", raw: true, blankrows: false }); if (source.length > 2000) throw new Error("Tệp chỉ được có tối đa 2.000 dòng dữ liệu.");
      const rows = source.map((row) => { const values = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])); const take = (...names: string[]) => names.map(normalizeHeader).map((name) => values.get(name)).find((value) => value !== undefined) ?? ""; return { sku: take("sku", "ma hang", "ma san pham", "product code"), name: take("name", "ten hang", "ten san pham", "product name"), description: take("description", "mo ta", "chi tiet"), unit: take("unit", "don vi", "don vi tinh"), price: parsePrice(take("price", "don gia", "gia ban", "unit price")), currency: take("currency", "tien te") || "VND", effectiveFrom: parseDateValue(take("effective from", "hieu luc tu")), effectiveTo: parseDateValue(take("effective to", "hieu luc den")) }; });
      const result = await api<{ rows: Record<string, unknown>[]; errors: string[]; validCount: number }>("/api/catalog/import/preview", { method: "POST", body: JSON.stringify({ rows }) }); if (result.validCount > 0 && result.errors.length === 0) await api("/api/files", { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-File-Type": file.type || "application/octet-stream" } }); setFileRows(rows); setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đọc tệp."); }
  };
  const confirmImport = async () => { if (!preview || !fileRows) return; if (!await confirm({ title: "Nhập các mặt hàng vào danh mục?", message: `${preview.validCount} mặt hàng sẽ được thêm. Mã hàng trùng sẽ cập nhật dữ liệu hiện có.`, confirmLabel: "Xác nhận nhập" })) return; setBusy(true); setError(""); try { const result = await api<{ imported: number }>("/api/catalog/import/confirm", { method: "POST", body: JSON.stringify({ confirmed: true, rows: fileRows }) }); setPreview(null); setFileRows(null); if (inputRef.current) inputRef.current.value = ""; await load(); onToast(`Đã nhập ${result.imported} mặt hàng vào danh mục.`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể nhập bảng giá."); } finally { setBusy(false); } };
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Danh mục sản phẩm</h1></div><button className="button button-primary" onClick={() => inputRef.current?.click()}><Icon name="plus" size={17}/>Nhập bảng giá</button><input ref={inputRef} type="file" hidden accept=".csv,.xlsx,.xls" onChange={(event) => void parseFile(event)}/></section>{error && <div className="inline-error">{error}</div>}{preview && <section className="content-card import-preview"><div className="card-heading"><div><h2>{preview.validCount} dòng hợp lệ · {preview.errors.length} lỗi</h2></div><button className="icon-button" onClick={() => { setPreview(null); setFileRows(null); }} aria-label="Đóng xem trước"><Icon name="close"/></button></div><p className="muted">Mã hàng trùng với danh mục hiện tại sẽ được cập nhật bằng dữ liệu mới.</p>{preview.errors.length > 0 && <div className="import-errors">{preview.errors.slice(0, 20).map((message) => <span key={message}>{message}</span>)}{preview.errors.length > 20 && <span>…và {preview.errors.length - 20} lỗi khác.</span>}</div>}<div className="preview-actions"><button className="button button-soft" onClick={() => { setPreview(null); setFileRows(null); }}>Hủy</button><button className="button button-primary" disabled={busy || preview.validCount === 0 || preview.errors.length > 0} onClick={() => void confirmImport()}>{busy ? "Đang nhập…" : "Xác nhận nhập"}<Icon name="arrow" size={16}/></button></div></section>}<section className="content-card list-card"><div className="catalog-toolbar"><div><h2>{items.length} mặt hàng</h2></div><label className="search-field catalog-search"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên sản phẩm"/></label></div><div className="table-scroll"><table className="data-table"><thead><tr><th>MÃ HÀNG</th><th>TÊN SẢN PHẨM</th><th>ĐƠN VỊ</th><th>ĐƠN GIÁ</th><th>HIỆU LỰC</th><th>TRẠNG THÁI</th></tr></thead><tbody>{visible.slice(0, 100).map((item) => <tr key={item._id}><td><span className="sku-tag">{item.sku}</span></td><td><strong>{item.name}</strong>{item.description && <small className="table-subtext">{item.description}</small>}</td><td>{item.unit}</td><td className="amount-cell">{formatMoney(item.price, item.currency)}</td><td>{item.effectiveFrom || item.effectiveTo ? `${item.effectiveFrom || "…"} — ${item.effectiveTo || "…"}` : "Không giới hạn"}</td><td><span className={`catalog-status ${item.active ? "on" : "off"}`}><i/>{item.active ? "Đang bán" : "Ngừng bán"}</span></td></tr>)}</tbody></table>{visible.length === 0 && <EmptyState title="Chưa có sản phẩm" text="Nhập tệp CSV hoặc XLSX để thêm bảng giá."/>}</div></section><p className="catalog-note"><Icon name="file" size={15}/> CSV/XLSX · Tối đa 2.000 dòng · Mã hàng trùng sẽ được cập nhật</p></div>;
}

function QuoteTable({ quotes, onOpen, emptyTitle, emptyText }: { quotes: Quote[]; onOpen: (id: string) => void; emptyTitle: string; emptyText: string }) {
  if (!quotes.length) return <EmptyState title={emptyTitle} text={emptyText}/>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>SỐ BÁO GIÁ</th><th>KHÁCH HÀNG</th><th>NGÀY TẠO</th><th>TỔNG TIỀN</th><th>TRẠNG THÁI</th><th/></tr></thead><tbody>{quotes.map((quote) => <tr className="clickable-row" key={quote._id} onClick={() => onOpen(quote._id)}><td><strong className="quote-number">{quote.quoteNumber}</strong></td><td><strong>{quote.customerName}</strong>{quote.customerEmail && <small className="table-subtext">{quote.customerEmail}</small>}</td><td>{formatDate(quote.createdAt)}</td><td className="amount-cell">{formatMoney(quote.total, quote.currency)}</td><td><StatusPill status={quote.status}/></td><td className="row-arrow"><Icon name="arrow" size={16}/></td></tr>)}</tbody></table></div>;
}

function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span className="empty-icon"><Icon name="file" size={21}/></span><h3>{title}</h3>{text && <p>{text}</p>}</div>; }
function Loading() { return <div className="loading-state"><span className="spinner spinner-dark"/>Đang tải dữ liệu…</div>; }
function normalizeHeader(value: string) { return value.trim().toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim(); }
function parsePrice(value: unknown) { if (typeof value === "number") return value; let text = String(value ?? "").trim().replace(/\s|₫|vnd/gi, ""); if (!text) return ""; const comma = text.lastIndexOf(","); const dot = text.lastIndexOf("."); if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, ""); else if (comma >= 0) text = /,\d{1,2}$/.test(text) ? text.replace(",", ".") : text.replace(/,/g, ""); else if (/\.\d{3}$/.test(text)) text = text.replace(/\./g, ""); const parsed = Number(text); return Number.isFinite(parsed) ? parsed : text; }
function parseDateValue(value: unknown) { if (typeof value === "number") { const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000); return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10); } if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); const text = String(value ?? "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const localized = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); return localized ? `${localized[3]}-${String(localized[2]).padStart(2, "0")}-${String(localized[1]).padStart(2, "0")}` : text; }

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/admin" ? <AdminApp /> : <UserApp />;
}

export default App;
