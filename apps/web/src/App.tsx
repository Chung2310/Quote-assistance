import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { api, formatDate, formatMoney } from "./api";
import type { Analysis, AnalysisItem, CatalogItem, Quote, QuoteRequest, QuoteStatus, User } from "./types";
import AdminApp from "./AdminApp";
import PriceListPanel from "./PriceListPanel";
import FilePreview, { type PreviewFile } from "./FilePreview";
import { QuoteTemplatePanel, type TemplateDetails } from "./QuoteTemplate";
import { NotificationToast, useConfirmation, useNotification, type ConfirmOptions, type Notify } from "./Feedback";
import "./settings.css";

type Section = "home" | "quotes" | "approvals" | "catalog" | "templates" | "profile";
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
  const [creatingQuote, setCreatingQuote] = useState(false);
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
    }).catch(() => {
      setUser(null);
      if (window.location.pathname !== "/") window.location.replace("/");
    }).finally(() => setCheckingSession(false));
  }, [isAdminWorkspace]);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setUser(null); setSection("home"); window.location.replace("/"); };
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
        {user.role === "admin" && <NavButton icon="file" label="Mẫu báo giá" active={!quoteId && section === "templates"} onClick={() => { setQuoteId(null); setSection("templates"); }} />}
        {user.role === "admin" && <NavButton icon="check" label="Duyệt báo giá" active={!quoteId && section === "approvals"} onClick={() => { setQuoteId(null); setSection("approvals"); }} />}
        {user.role === "admin" && <NavButton icon="box" label="Bảng giá" active={!quoteId && section === "catalog"} onClick={() => { setQuoteId(null); setSection("catalog"); }} />}
      </nav>
      <div className="sidebar-bottom">
        <button className={`profile-button ${!quoteId && section === "profile" ? "active" : ""}`} onClick={() => { setQuoteId(null); setSection("profile"); }} title="Trang cá nhân"><span className="avatar"><Icon name="user" size={17}/></span><span className="profile-copy"><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></span><Icon name="arrow" size={17} /></button>
      </div>
    </aside>
    <div className="main-column">
      {showTopbarAction && <header className="topbar">
        <div className="topbar-actions"><button className="button button-primary button-compact" onClick={() => setCreatingQuote(true)}><Icon name="plus" size={16} />Tạo báo giá</button></div>
      </header>}
      <main className="main-content">{quoteId ? <QuoteDetail key={quoteId} id={quoteId} user={user} onBack={() => setQuoteId(null)} onChanged={refresh} onToast={notify} confirm={confirm} /> : section === "home" ? <Dashboard key={refreshKey} canCreate canReview={user.role === "admin"} onOpen={openQuote} onCreate={() => setCreatingQuote(true)} onNavigate={setSection} /> : section === "quotes" ? <QuoteWorkspace key={refreshKey} canCreate onOpen={openQuote} onCreate={() => setCreatingQuote(true)} /> : section === "templates" && user.role === "admin" ? <div className="page-stack templates-page"><section className="page-heading-row"><div><h1>Mẫu báo giá</h1><p className="muted">Khai báo và cập nhật mẫu mặc định của doanh nghiệp.</p></div></section><QuoteTemplatePanel canManage/></div> : section === "approvals" ? <Approvals key={refreshKey} onOpen={openQuote} /> : section === "catalog" ? <PriceListPanel key={refreshKey} onToast={notify} /> : <AccountProfile user={user} onToast={notify} onSignOut={() => void signOut()} confirm={confirm} />}</main>
    </div>
    {creatingQuote && <NewQuoteDialog canManageTemplate={user.role === "admin"} onClose={() => setCreatingQuote(false)} onManageTemplate={() => { setCreatingQuote(false); setQuoteId(null); setSection("templates"); }} onCreated={(id) => { setCreatingQuote(false); setSection("quotes"); refresh(); notify("Bản nháp báo giá đã được tạo."); openQuote(id); }}/ >}
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
              <div className="input-wrapper"><input id={`register-${key}`} type={type} autoComplete={autoComplete} maxLength={key === "address" ? 500 : key === "password" || key === "confirmPassword" ? 200 : 250} minLength={key === "password" || key === "confirmPassword" ? 7 : undefined} value={registration[key]} onChange={(event) => setRegistration((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === "taxId" ? "Mã số thuế doanh nghiệp" : undefined} required/></div>
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
      <QuoteCards quotes={data?.recent ?? []} onOpen={onOpen} emptyTitle="Chưa có báo giá nào" emptyText="" />
    </section>
  </div>;
}

function Metric({ label, value, icon, tone, action }: { label: string; value: number | string; icon: string; tone: string; action?: () => void }) {
  return <button className={`metric-card tone-${tone} ${action ? "metric-action" : ""}`} onClick={action} disabled={!action}><span className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon} size={18}/></span></span><strong className="metric-value">{value}</strong></button>;
}

function QuoteWorkspace({ onOpen, onCreate, canCreate }: { onOpen: (id: string) => void; onCreate: () => void; canCreate: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [reloadKey, setReloadKey] = useState(0); const [filter, setFilter] = useState("all");
  useEffect(() => { setLoading(true); setError(""); api<{ quotes: Quote[] }>("/api/quotes").then((result) => setQuotes(result.quotes)).catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải danh sách báo giá.")).finally(() => setLoading(false)); }, [reloadKey]);
  const filtered = filter === "all" ? quotes : quotes.filter((quote) => quote.status === filter);
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Báo giá</h1></div>{canCreate && <button className="button button-primary" onClick={onCreate}><Icon name="plus" size={17}/>Tạo báo giá mới</button>}</section>{error && <div className="inline-error" role="alert">{error} <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>Thử lại</button></div>}<section className="content-card list-card"><div className="list-toolbar"><div className="filter-tabs">{[["all", "Tất cả"], ["draft", "Bản nháp"], ["pending_review", "Chờ duyệt"], ["approved", "Đã duyệt"], ["needs_info", "Cần bổ sung"], ["rejected", "Cần chỉnh sửa"]].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="row-count">{filtered.length} báo giá</span></div>{loading ? <Loading/> : error ? null : <QuoteCards quotes={filtered} onOpen={onOpen} emptyTitle="Không có báo giá trong mục này" emptyText=""/>}</section></div>;
}

interface QuotePriceList { _id: string; originalFilename: string }
interface QuoteOptions { templates: TemplateDetails[]; priceLists: QuotePriceList[]; defaultTemplateId: string | null }

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
  const [templates, priceLists] = await Promise.all([loadTemplates(), api<{ files: QuotePriceList[] }>("/api/price-list")]);
  return { ...templates, priceLists: priceLists.files };
}

function NewQuoteDialog({ onClose, onCreated, canManageTemplate, onManageTemplate }: { onClose: () => void; onCreated: (id: string) => void; canManageTemplate: boolean; onManageTemplate: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<QuoteOptions>({ templates: [], priceLists: [], defaultTemplateId: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setLoading(true); setError("");
    loadQuoteOptions().then((value) => { if (active) setOptions(value); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Không tải được mẫu và bảng giá."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);
  return <dialog ref={dialog} className="template-dialog quote-creation-dialog" aria-labelledby="new-quote-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="settings-card-heading"><h2 id="new-quote-title">Tạo báo giá mới</h2><button type="button" autoFocus className="icon-button" aria-label="Đóng popup tạo báo giá" disabled={busy} onClick={onClose}><Icon name="close"/></button></div>
    <div className="quote-creation-body" aria-busy={busy || loading}>{loading ? <Loading/> : error ? <div className="inline-error" role="alert">{error} <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>Thử lại</button></div> : <NewQuote options={options} canManageTemplate={canManageTemplate} onManageTemplate={onManageTemplate} onCreated={onCreated} onBusyChange={setBusy}/>}</div>
  </dialog>;
}

function NewQuote({ options, onCreated, canManageTemplate, onManageTemplate, onBusyChange }: { onBusyChange: (busy: boolean) => void; onManageTemplate: () => void; canManageTemplate: boolean; options: QuoteOptions; onCreated: (id: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [templateId, setTemplateId] = useState(options.templates.find((entry) => entry.id === options.defaultTemplateId)?.id ?? options.templates[0]?.id ?? "");
  const [priceListId, setPriceListId] = useState(options.priceLists.length === 1 ? options.priceLists[0]._id : "");
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
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!templateId || !priceListId || (!requestText.trim() && !requestFile)) { setError("Hãy chọn mẫu, bảng giá và nhập yêu cầu hoặc tải file yêu cầu."); return; }
    if (requestFile && (!requestFile.size || requestFile.size > 10 * 1024 * 1024)) { setError("File yêu cầu phải có nội dung và không vượt quá 10 MB."); return; }
    setBusy(true);
    setError("");
    setAnalysis(null);
    try {
      let id = requestId;
      if (!id) {
        if (requestFile && uploadedFile.current?.file !== requestFile) {
          const { file } = await api<{ file: { id: string } }>("/api/request-files", { method: "POST", body: requestFile, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(requestFile.name) } });
          uploadedFile.current = { file: requestFile, id: file.id };
        }
        const { request } = await api<{ request: QuoteRequest }>("/api/quote-requests", {
          method: "POST",
          body: JSON.stringify({ requestText, customerName, customerEmail, customerPhone, templateId, priceListId, requestFileId: requestFile ? uploadedFile.current?.id : undefined, idempotencyKey: requestIdempotencyKey }),
        });
        id = request._id;
        setRequestId(id);
      }
      const { analysis: result, candidates } = await api<{ analysis: Analysis; candidates: CatalogItem[] }>(`/api/quote-requests/${id}/analyze`, { method: "POST" });
      setCatalog(candidates);
      setCustomerName((current) => current.trim() ? current : result.customerName ?? "");
      setCustomerEmail((current) => current.trim() ? current : result.customerEmail ?? "");
      setAnalysis(result);
      setSelected(result.items);
      setConfirmed(result.missingFields.length === 0);
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
          customerName,
          customerEmail,
          customerPhone,
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

  const editRequest = () => {
    setRequestId(""); setAnalysis(null); setSelected([]); setCatalog([]); setConfirmed(false); setError("");
    setRequestIdempotencyKey(crypto.randomUUID()); setQuoteIdempotencyKey(crypto.randomUUID());
  };
  const locked = busy || Boolean(requestId);

  const today = new Date().toISOString().slice(0, 10);
  const results = catalog
    .filter((item) => item.active && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today))
    .filter((item) => `${item.sku} ${item.name}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")))
    .slice(0, 8);

  return (
    <div className="page-stack">
      <div className="creation-layout">
        <section className="content-card form-card">
          <form onSubmit={(event) => void analyze(event)} className="request-form">
            <div className="field-row">
              <label>Mẫu báo giá<select required value={templateId} disabled={locked} onChange={(event) => setTemplateId(event.target.value)}><option value="">Chọn mẫu báo giá</option>{options.templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || entry.originalFilename}{entry.id === options.defaultTemplateId ? " (Mặc định)" : ""}</option>)}</select></label>
              <label>Bảng giá<select required value={priceListId} disabled={locked} onChange={(event) => setPriceListId(event.target.value)}><option value="">Chọn bảng giá</option>{options.priceLists.map((entry) => <option key={entry._id} value={entry._id}>{entry.originalFilename}</option>)}</select></label>
            </div>
            {(templateId || priceListId) && <div className="request-file-selection">{templateId && <button type="button" className="text-button" onClick={() => { const template = options.templates.find((entry) => entry.id === templateId); if (template) setPreviewFile({ name: template.originalFilename, url: `/api/quote-template/${template.id}/file?preview=1` }); }}>Xem trước mẫu đã chọn</button>}{priceListId && <button type="button" className="text-button" onClick={() => { const priceList = options.priceLists.find((entry) => entry._id === priceListId); if (priceList) setPreviewFile({ name: priceList.originalFilename, url: `/api/price-list/${priceList._id}/file` }); }}>Xem trước bảng giá đã chọn</button>}</div>}
            {!options.templates.length && <p className="muted">Chưa có mẫu báo giá. {canManageTemplate ? <button type="button" className="text-button" onClick={onManageTemplate}>Thêm mẫu báo giá</button> : "Vui lòng liên hệ quản trị viên."}</p>}
            {!options.priceLists.length && <p className="muted">Chưa có bảng giá. Vui lòng thêm bảng giá tại mục Bảng giá trước khi tạo báo giá.</p>}
            {!analysis && <div className="field-row">
              <label>Tên khách hàng<input value={customerName} maxLength={250} disabled={locked} autoComplete="name" onChange={(event) => setCustomerName(event.target.value)} placeholder="Nhập tên khách hàng"/></label>
              <label>Email (không bắt buộc)<input type="email" value={customerEmail} maxLength={250} disabled={locked} autoComplete="email" onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Không bắt buộc"/></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={locked} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng"/></label>
            </div>}
            <label>Yêu cầu của khách hàng<textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Nhập yêu cầu của khách hàng hoặc tải file yêu cầu bên dưới…" rows={6} maxLength={10000} required={!requestFile} disabled={locked}/></label>
            <label>Hoặc tải file yêu cầu<input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.xlsx,.xls,.csv" disabled={locked} onChange={(event) => { setRequestFile(event.target.files?.[0] ?? null); uploadedFile.current = null; setError(""); }}/><span className="field-hint">PDF, Word, TXT, Excel, CSV · Tối đa 10 MB</span></label>
            {requestFile && <div className="request-file-selection"><span>{requestFile.name}</span><button type="button" className="text-button" onClick={() => setPreviewFile({ name: requestFile.name, file: requestFile })}>Xem trước</button><button type="button" className="text-button" disabled={locked} onClick={() => { setRequestFile(null); uploadedFile.current = null; if (fileInput.current) fileInput.current.value = ""; }}>Bỏ file</button></div>}
            {!analysis && <button className="button button-primary analyze-button" type="submit" disabled={busy || !templateId || !priceListId || (!requestText.trim() && !requestFile)}>{busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{busy ? "Đang phân tích…" : "Phân tích yêu cầu"}<Icon name="arrow" size={16} /></button>}
            {requestId && <button type="button" className="text-button" disabled={busy} onClick={editRequest}>Chỉnh sửa yêu cầu</button>}
          </form>
          {error && <div className="inline-error">{error}</div>}
        </section>

        {analysis && <section className="content-card analysis-card">
          <div className="section-title"><span className="step-number step-number-ai"><Icon name="spark" size={17} /></span><div><h2>Gợi ý sản phẩm</h2></div></div>
          <div className="field-row quote-customer-review"><label>Tên khách hàng<input value={customerName} maxLength={250} disabled={busy} onChange={(event) => setCustomerName(event.target.value)} placeholder="Xác nhận tên khách hàng" required/></label><label>Email (không bắt buộc)<input type="email" value={customerEmail} maxLength={250} disabled={busy} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Email khách hàng"/></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={busy} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng"/></label></div>
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
          <div className="analysis-footer"><span>{selected.length} mặt hàng đã chọn</span><button className="button button-primary" disabled={busy || !customerName.trim() || selected.length === 0 || (analysis.missingFields.length > 0 && !confirmed)} onClick={() => void createQuote()}>{busy ? "AI đang điền mẫu…" : "Tạo bản nháp"}<Icon name="arrow" size={16} /></button></div>
        </section>}
      </div>
      <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

function QuoteDetail({ id, user, onBack, onChanged, onToast, confirm }: { id: string; user: User; onBack: () => void; onChanged: () => void; onToast: Notify; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [quantities, setQuantities] = useState<Record<string, number>>({}); const [confirmed, setConfirmed] = useState(false); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState("");
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [customerName, setCustomerName] = useState(""); const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const canEdit = user.role === "sales" || user.role === "admin"; const canApprove = user.role === "admin"; const editable = canEdit && Boolean(quote && ["draft", "needs_info", "rejected"].includes(quote.status));
  const load = useCallback(async () => { try { const { quote: value } = await api<{ quote: Quote }>(`/api/quotes/${id}`); setQuote(value); setCustomerName(value.customerName); setCustomerEmail(value.customerEmail); setCustomerPhone(value.customerPhone ?? ""); setQuantities(Object.fromEntries(value.lines.map((line) => [line.catalogItemId, line.quantity]))); setConfirmed(value.informationConfirmed); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể mở báo giá."); } finally { setLoading(false); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const perform = async (url: string, body?: unknown, method = "POST", success = "Đã cập nhật báo giá.") => {
    if (quote) {
      let confirmation: ConfirmOptions | undefined;
      if (url.endsWith("/submit-review")) confirmation = { title: "Gửi báo giá duyệt?", message: `Báo giá ${quote.quoteNumber} sẽ chuyển vào danh sách chờ quản trị viên doanh nghiệp duyệt.`, confirmLabel: "Gửi duyệt" };
      else if (url.endsWith("/approve")) confirmation = { title: "Duyệt báo giá này?", message: `${quote.quoteNumber} · ${quote.customerName}\nTổng tiền: ${formatMoney(quote.total, quote.currency)}\nSau khi duyệt, có thể xuất file theo mẫu và gửi cho khách hàng.`, confirmLabel: "Duyệt báo giá" };
      else if (url.endsWith("/reject")) confirmation = { title: "Trả báo giá để chỉnh sửa?", message: `${quote.quoteNumber} sẽ chuyển về trạng thái cần chỉnh sửa.\nLý do: ${typeof body === "object" && body && "reason" in body ? String(body.reason) : ""}`, confirmLabel: "Trả lại", tone: "danger" };
      else if (url.endsWith("/email")) confirmation = { title: "Gửi báo giá qua email?", message: `Báo giá đã duyệt sẽ được gửi tới ${quote.customerEmail || "khách hàng"}.`, confirmLabel: "Gửi email" };
      if (confirmation && !await confirm(confirmation)) return;
    }
    if (url.endsWith("/submit-review") && quote && (quote.lines.some((line) => Number(quantities[line.catalogItemId]) !== line.quantity) || confirmed !== quote.informationConfirmed || customerName !== quote.customerName || customerEmail !== quote.customerEmail || customerPhone !== (quote.customerPhone ?? ""))) {
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
  const save = (informationConfirmed = confirmed) => perform(`/api/quotes/${quote._id}`, { items: quote.lines.map((line) => ({ catalogItemId: line.catalogItemId, quantity: quantities[line.catalogItemId] })), informationConfirmed, customerName, customerEmail, customerPhone }, "PATCH", "Đã lưu thay đổi và tính lại giá.");
  const downloadQuote = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/quotes/${quote._id}/export`, { credentials: "include" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Không tải được báo giá."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `${quote.quoteNumber}.${quote.template?.originalFilename.split(".").pop()?.toLowerCase() || "pdf"}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được báo giá."); }
    finally { setBusy(false); }
  };
  return <div className="page-stack detail-stack"><div className="page-heading-row detail-heading"><div><button className="back-link" onClick={onBack}><Icon name="back" size={17}/>Tất cả báo giá</button><div className="quote-title-row"><h1>{quote.quoteNumber}</h1><StatusPill status={quote.status}/></div><p className="muted">Tạo {formatDate(quote.createdAt)} · {quote.customerName}</p></div><div className="detail-heading-actions">{editable && <button className="button button-soft" disabled={busy} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>}{canEdit && quote.status === "approved" && <button className="button button-soft" disabled={busy || !quote.customerEmail} title={!quote.customerEmail ? "Chưa có email khách hàng" : "Gửi báo giá đúng định dạng mẫu"} onClick={() => void perform("/api/quotes/" + quote._id + "/email", undefined, "POST", "Đã gửi báo giá qua email.")}><Icon name="mail" size={16}/>Gửi email</button>}<button className="button button-primary" disabled={busy || quote.status !== "approved"} title={quote.status === "approved" ? "Tải báo giá theo mẫu đã duyệt" : "Báo giá cần được duyệt trước khi xuất file theo mẫu"} onClick={() => void downloadQuote()}><Icon name="download" size={16}/>{quote.status === "approved" ? "Tải báo giá" : "Xuất sau khi duyệt"}</button></div></div>{error && <div className="inline-error">{error}</div>}{quote.status === "rejected" && quote.rejectionReason && <div className="rejection-note"><strong>Lý do doanh nghiệp trả lại</strong><span>{quote.rejectionReason}</span></div>}{quote.informationNeeded.length > 0 && <div className="needs-info-note"><div><strong>Cần kiểm tra thông tin</strong><span>{quote.informationNeeded.join(" · ")}</span></div>{editable && <label className="confirm-check compact-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span><strong>Đã xác nhận đủ</strong></span></label>}</div>}
    <section className="content-card form-card quote-file-references">{quote.template && <div className="quote-file-reference"><strong>Mẫu báo giá: {quote.template.name || quote.template.originalFilename}</strong><button className="text-button" onClick={() => setPreviewFile({ name: quote.template!.originalFilename, url: `/api/quote-template/${quote.template!.id}/file?preview=1` })}>Xem trước</button><a className="text-button" href={`/api/quote-template/${quote.template.id}/file`}>Tải file gốc</a></div>}{quote.priceList && <div className="quote-file-reference"><strong>Bảng giá: {quote.priceList.originalFilename}</strong><button className="text-button" onClick={() => setPreviewFile({ name: quote.priceList!.originalFilename, url: `/api/price-list/${quote.priceList!.id}/file` })}>Xem trước</button></div>}{quote.requestFile && <div className="quote-file-reference"><strong>File yêu cầu: {quote.requestFile.originalFilename}</strong><button className="text-button" onClick={() => setPreviewFile({ name: quote.requestFile!.originalFilename, url: `/api/quotes/${quote._id}/request-file/preview` })}>Xem trước</button></div>}{quote.status === "approved" && <div className="quote-file-reference"><strong>Báo giá đã tạo</strong><button className="text-button" onClick={() => setPreviewFile({ name: `${quote.quoteNumber}.${quote.template?.originalFilename.split(".").pop()?.toLowerCase() || "pdf"}`, url: `/api/quotes/${quote._id}/export?preview=1` })}>Xem trước</button></div>}<FilePreview file={previewFile} onClose={() => setPreviewFile(null)} /></section>
    <div className="detail-grid"><div className="detail-main-column"><section className="content-card detail-card"><div className="card-heading"><div><span className="eyebrow">SẢN PHẨM & GIÁ</span><h2>Các dòng báo giá</h2></div><span className="subtle-count">{quote.lines.length} dòng</span></div><div className="quote-lines"><div className="quote-line-head"><span>Sản phẩm</span><span>Số lượng</span><span>Đơn giá</span><span>Thành tiền</span></div>{quote.lines.map((line) => <div className="quote-line" key={line.catalogItemId}><div className="line-product"><strong>{line.name}</strong><span>{line.sku} · {line.unit}</span></div><div className="line-quantity">{editable ? <input type="number" min="0.01" step="0.01" value={quantities[line.catalogItemId]} onChange={(event) => setQuantities((value) => ({ ...value, [line.catalogItemId]: Number(event.target.value) }))}/> : <span>{line.quantity} {line.unit}</span>}</div><span className="line-price">{formatMoney(line.unitPrice, line.currency)}</span><strong className="line-total">{formatMoney(line.lineTotal, line.currency)}</strong></div>)}</div><div className="totals-box"><div><span>Tạm tính</span><strong>{formatMoney(quote.subtotal, quote.currency)}</strong></div><div><span>Thuế ({(quote.taxRate * 100).toLocaleString("vi-VN")}%)</span><strong>{formatMoney(quote.taxAmount, quote.currency)}</strong></div><div className="grand-total"><span>Tổng cộng</span><strong>{formatMoney(quote.total, quote.currency)}</strong></div></div></section>{editable && quote.status === "needs_info" && <button className="button button-primary full-button" disabled={busy || (quote.informationNeeded.length > 0 && !confirmed)} onClick={() => void save(true)}>Xác nhận thông tin và lưu nháp<Icon name="arrow" size={16}/></button>}{editable && quote.status === "draft" && <button className="button button-primary full-button" disabled={busy || (quote.informationNeeded.length > 0 && !quote.informationConfirmed)} onClick={() => void perform(`/api/quotes/${quote._id}/submit-review`, {}, "POST", "Đã gửi báo giá vào hàng chờ duyệt.")}>Gửi duyệt báo giá<Icon name="arrow" size={16}/></button>}{canApprove && quote.status === "pending_review" && <div className="review-actions"><button className="button button-soft" onClick={() => setRejecting((value) => !value)}>Trả lại chỉnh sửa</button><button className="button button-primary" disabled={busy} onClick={() => void perform(`/api/quotes/${quote._id}/approve`, {}, "POST", "Báo giá đã được duyệt.")}><Icon name="check" size={16}/>Duyệt báo giá</button></div>}{rejecting && <div className="content-card reject-form"><label>Lý do cần chỉnh sửa<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ghi rõ phần cần bổ sung hoặc điều chỉnh…"/></label><button className="button button-primary" disabled={busy || !reason.trim()} onClick={() => void perform(`/api/quotes/${quote._id}/reject`, { reason }, "POST", "Đã trả báo giá để chỉnh sửa.")}>Gửi nhận xét</button></div>}</div><aside className="detail-side-column"><section className="content-card customer-card"><span className="eyebrow">KHÁCH HÀNG</span><div className="customer-avatar">{quote.customerName.slice(0, 1).toLocaleUpperCase("vi")}</div><h2>{quote.customerName}</h2>{editable ? <div className="quote-customer-fields"><label>Tên khách hàng<input required maxLength={250} value={customerName} disabled={busy} onChange={(event) => setCustomerName(event.target.value)}/></label><label>Email (không bắt buộc)<input type="email" maxLength={250} value={customerEmail} disabled={busy} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="Không bắt buộc"/></label><label>Số điện thoại (không bắt buộc)<input type="tel" autoComplete="tel" maxLength={50} value={customerPhone} disabled={busy} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Số điện thoại khách hàng"/></label><button className="button button-soft" disabled={busy || !customerName.trim()} onClick={() => void save()}>Lưu thông tin khách hàng</button></div> : <><p>{quote.customerEmail || "Chưa có email"}</p>{quote.customerPhone && <p>{quote.customerPhone}</p>}</>}<div className="side-divider"/><span className="eyebrow">NGƯỜI TẠO</span><p className="created-by">{quote.createdBy}</p><span className="eyebrow side-spaced">TRẠNG THÁI</span><StatusPill status={quote.status}/></section><section className="info-card"><span className="info-card-icon"><Icon name="spark" size={17}/></span><div><strong>Đơn giá giữ nguyên theo thời điểm tạo, kể cả khi bảng giá thay đổi.</strong></div></section></aside></div></div>;
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
      {files.length ? <div className="stored-files-list">{files.map((file) => <div className="stored-file-row" key={file._id ?? `${file.originalFilename}-${file.createdAt}`}><span className="stored-file-icon"><Icon name="file" size={16}/></span><span><strong>{file.originalFilename}</strong><small>{formatDate(file.createdAt)} · {(file.bytes / 1024).toFixed(0)} KB</small></span><button type="button" className="text-button" disabled={!file._id} onClick={() => setPreviewFile({ name: file.originalFilename, url: `/api/files/${file._id}/preview` })}>Xem trước</button></div>)}</div> : <p className="settings-hint stored-files-empty">Chưa có tệp nào được tải lên.</p>}
    </div>
    <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
  </section>;
}
function Approvals({ onOpen }: { onOpen: (id: string) => void }) {
  const [quotes, setQuotes] = useState<Quote[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { setLoading(true); setError(""); api<{ quotes: Quote[] }>("/api/quotes?status=pending_review").then(({ quotes: rows }) => setQuotes(rows)).catch((cause) => setError(cause instanceof Error ? cause.message : "Không thể tải hàng chờ duyệt.")).finally(() => setLoading(false)); }, [reloadKey]);
  return <div className="page-stack"><section className="page-heading-row"><div><h1>Doanh nghiệp duyệt báo giá</h1></div><span className="pending-count">{quotes.length} đang chờ</span></section>{error && <div className="inline-error" role="alert">{error} <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>Thử lại</button></div>}<section className="content-card list-card">{loading ? <Loading/> : error ? null : <QuoteCards quotes={quotes} onOpen={onOpen} emptyTitle="Không có báo giá đang chờ duyệt" emptyText=""/>}</section></div>;
}

function QuoteCards({ quotes, onOpen, emptyTitle, emptyText }: { quotes: Quote[]; onOpen: (id: string) => void; emptyTitle: string; emptyText: string }) {
  if (!quotes.length) return <EmptyState title={emptyTitle} text={emptyText}/>;
  return <div className="quote-cards">{quotes.map((quote) => <button type="button" className="quote-summary-card" key={quote._id} onClick={() => onOpen(quote._id)}><span className="quote-summary-top"><strong className="quote-number">{quote.quoteNumber}</strong><StatusPill status={quote.status}/></span><span className="quote-summary-customer"><strong>{quote.customerName}</strong><span>{quote.customerEmail || "Chưa có email"}</span>{quote.customerPhone && <span>{quote.customerPhone}</span>}</span><span className="quote-summary-meta">Tạo {formatDate(quote.createdAt)} · {quote.lines.length} mặt hàng</span><span className="quote-summary-bottom"><span><small>Tổng tiền</small><strong>{formatMoney(quote.total, quote.currency)}</strong></span><Icon name="arrow" size={18}/></span></button>)}</div>;
}

function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span className="empty-icon"><Icon name="file" size={21}/></span><h3>{title}</h3>{text && <p>{text}</p>}</div>; }
function Loading() { return <div className="loading-state"><span className="spinner spinner-dark"/>Đang tải dữ liệu…</div>; }

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/admin" ? <AdminApp /> : <UserApp />;
}

export default App;
