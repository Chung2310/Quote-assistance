import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, formatDate } from "./api";
import { NotificationToast, useConfirmation, useNotification, type ConfirmOptions } from "./Feedback";
import type { User } from "./types";
import "./admin.css";
import "./admin-portal.css";

type ManagedUser = User & { active: boolean; createdAt: string; updatedAt: string; companyName: string; taxId: string; address: string; phone: string; businessEmail: string; representativeName: string };
type SessionState = "checking" | "anonymous" | "allowed" | "forbidden";
type AdminSection = "businesses" | "email";
type AccountDraft = { name: string; email: string; active: boolean; companyName: string; taxId: string; address: string; phone: string; businessEmail: string; representativeName: string };
type AdminEmailSettings = { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string; passwordSet: boolean };
type AdminEmailForm = { host: string; port: string; secure: boolean; user: string; password: string; from: string };

const emptyDraft: AccountDraft = { name: "", email: "", active: true, companyName: "", taxId: "", address: "", phone: "", businessEmail: "", representativeName: "" };

function AdminIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    key: <><circle cx="8" cy="15" r="5" /><path d="m11.5 11.5 8-8L22 6l-3 3 2 2-3 3-2-2-3 3" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    quote: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.users}</svg>;
}

export default function AdminApp() {
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [activeSection, setActiveSection] = useState<AdminSection>("businesses");
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogUser, setDialogUser] = useState<ManagedUser | null | undefined>(undefined);
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const { notification, notify, dismiss } = useNotification();
  const { confirm, dialog: confirmationDialog } = useConfirmation();

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then(({ user }) => {
        setCurrentUser(user);
        setSessionState(user.platformAdmin ? "allowed" : "forbidden");
      })
      .catch(() => setSessionState("anonymous"));
  }, []);

  useEffect(() => {
    if (sessionState !== "allowed") return;
    let cancelled = false;
    setLoadingUsers(true);
    setLoadError("");
    api<{ businesses: ManagedUser[] }>("/api/admin/businesses")
      .then(({ businesses }) => { if (!cancelled) setUsers(businesses); })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không thể tải danh sách tài khoản.");
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, [sessionState, reloadKey]);

  useEffect(() => {
    if (sessionState === "anonymous" || sessionState === "forbidden") {
      window.location.replace("/");
    }
  }, [sessionState]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return users.filter((user) => {
      const matchesQuery = !normalized || `${user.companyName} ${user.name} ${user.email} ${user.taxId}`.toLocaleLowerCase("vi").includes(normalized);
      return matchesQuery && (statusFilter === "all" || (statusFilter === "active" ? user.active : !user.active));
    });
  }, [query, statusFilter, users]);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setCurrentUser(null);
    setUsers([]);
    setSessionState("anonymous");
  };

  if (sessionState === "checking") {
    return <div className="admin-splash"><span className="admin-mark">G</span><span>Đang kiểm tra phiên quản trị…</span></div>;
  }
  if (sessionState !== "allowed") return null;

  const activeCount = users.filter((user) => user.active).length;
  const inactiveCount = users.filter((user) => !user.active).length;

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/admin" aria-label="Trang quản trị">
        <span className="admin-mark">G</span><span className="admin-brand-copy"><strong>giáo</strong><small>QUẢN TRỊ DOANH NGHIỆP</small></span>
      </a>
      <div className="admin-nav-label">QUẢN LÝ</div>
      <nav className="admin-nav">
        <button type="button" className={`admin-nav-item ${activeSection === "businesses" ? "is-active" : ""}`} onClick={() => setActiveSection("businesses")}><AdminIcon name="users" /><span>Doanh nghiệp</span></button>
        <button type="button" className={`admin-nav-item ${activeSection === "email" ? "is-active" : ""}`} onClick={() => setActiveSection("email")}><AdminIcon name="mail" /><span>Email toàn hệ thống</span></button>
      </nav>
      <div className="admin-profile">
        <span className="admin-avatar">{currentUser?.name.trim().charAt(0).toLocaleUpperCase("vi") || "A"}</span>
        <span className="admin-profile-copy"><strong>{currentUser?.name}</strong><small>Quản trị viên</small></span>
        <button className="admin-icon-button" onClick={() => void signOut()} title="Đăng xuất" aria-label="Đăng xuất"><AdminIcon name="logout" size={17} /></button>
      </div>
    </aside>

    <div className="admin-main-column">
      <main className="admin-content">
        <div hidden={activeSection !== "businesses"}>
          <div className="admin-page-heading">
            <h1>Doanh nghiệp</h1>
            <button className="admin-button admin-button-primary" onClick={() => setDialogUser(null)}><AdminIcon name="plus" size={17} /> Thêm doanh nghiệp</button>
          </div>

          <section className="admin-stat-grid" aria-label="Tổng quan doanh nghiệp">
            <article className="admin-stat-card"><span>Tổng doanh nghiệp</span><strong>{users.length}</strong><small>Mỗi doanh nghiệp một tài khoản</small></article>
            <article className="admin-stat-card"><span>Đang hoạt động</span><strong>{activeCount}</strong><small>Có thể đăng nhập</small></article>
            <article className="admin-stat-card"><span>Đã khóa</span><strong>{inactiveCount}</strong><small>Tạm ngưng đăng nhập</small></article>
            <article className="admin-stat-card"><span>Thông tin đầy đủ</span><strong>{users.filter((item) => item.taxId && item.address && item.phone && item.businessEmail && item.representativeName).length}</strong><small>Hồ sơ doanh nghiệp</small></article>
          </section>

          <section className="admin-users-card">
            <div className="admin-users-toolbar">
              <div><h2>Danh sách doanh nghiệp</h2><span>{users.length} doanh nghiệp</span></div>
              <div className="admin-filters">
                <label className="admin-search"><AdminIcon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, mã số thuế hoặc email" aria-label="Tìm doanh nghiệp" /></label>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")} aria-label="Lọc theo trạng thái">
                  <option value="all">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="inactive">Đã khóa</option>
                </select>
              </div>
            </div>
            {loadError && <div className="admin-inline-error" role="alert">{loadError}<button onClick={() => setReloadKey((key) => key + 1)}>Tải lại</button></div>}
            {loadingUsers ? <div className="admin-loading"><span className="admin-spinner" />Đang tải doanh nghiệp…</div> : users.length === 0 ? <div className="admin-empty"><span><AdminIcon name="users" size={23} /></span><strong>Chưa có doanh nghiệp</strong><p>Tạo doanh nghiệp đầu tiên cùng tài khoản quản trị.</p><button className="admin-button admin-button-primary" onClick={() => setDialogUser(null)}><AdminIcon name="plus" size={16} /> Thêm doanh nghiệp</button></div> : visibleUsers.length === 0 ? <div className="admin-empty admin-empty-compact"><strong>Không tìm thấy doanh nghiệp phù hợp</strong><p>Thử từ khóa hoặc trạng thái khác.</p></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>DOANH NGHIỆP</th><th>TÀI KHOẢN QUẢN TRỊ</th><th>TRẠNG THÁI</th><th>NGÀY TẠO</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {visibleUsers.map((managedUser) => <tr key={managedUser.id}>
                <td><div className="admin-user-cell"><span className="admin-user-avatar role-admin">{managedUser.companyName.trim().charAt(0).toLocaleUpperCase("vi") || "?"}</span><span><strong>{managedUser.companyName}</strong><small>MST: {managedUser.taxId} · {managedUser.representativeName}</small></span></div></td>
                <td><div className="admin-business-contact"><strong>{managedUser.name}</strong><small>{managedUser.email}</small><small>{managedUser.phone} · {managedUser.businessEmail}</small></div></td>
                <td><span className={`admin-status ${managedUser.active ? "is-active" : "is-inactive"}`}><i />{managedUser.active ? "Đang hoạt động" : "Đã khóa"}</span></td>
                <td className="admin-date-cell">{managedUser.createdAt ? formatDate(managedUser.createdAt) : "—"}</td>
                <td><div className="admin-row-actions"><button className="admin-icon-button" onClick={() => setDialogUser(managedUser)} title="Chỉnh sửa doanh nghiệp" aria-label={`Chỉnh sửa ${managedUser.companyName}`}><AdminIcon name="edit" size={16} /></button><button className="admin-icon-button" onClick={() => setPasswordUser(managedUser)} title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu cho ${managedUser.name}`}><AdminIcon name="key" size={16} /></button></div></td>
              </tr>)}
            </tbody></table></div>}
            {!loadingUsers && users.length > 0 && <div className="admin-card-footer">Hiển thị {visibleUsers.length} / {users.length} doanh nghiệp</div>}
          </section>
        </div>
        {activeSection === "email" && <AdminEmail onToast={notify} confirm={confirm} />}
      </main>
    </div>

    {dialogUser !== undefined && <AccountDialog
      user={dialogUser}
      confirm={confirm}
      onClose={() => setDialogUser(undefined)}
      onSaved={() => { setDialogUser(undefined); setReloadKey((key) => key + 1); notify(dialogUser ? "Đã cập nhật doanh nghiệp." : "Đã tạo doanh nghiệp và tài khoản quản trị."); }}
    />}
    {passwordUser && <PasswordDialog
      user={passwordUser}
      confirm={confirm}
      onClose={() => setPasswordUser(null)}
      onSaved={() => {
        const resetOwnPassword = passwordUser.id === currentUser?.id;
        setPasswordUser(null);
        if (resetOwnPassword) {
          setCurrentUser(null);
          setSessionState("anonymous");
        } else {
          notify("Đã đổi mật khẩu tài khoản.");
        }
      }}
    />}
    {notification && <NotificationToast notification={notification} onDismiss={dismiss} />}
    {confirmationDialog}
  </div>;
}

function AdminEmail({ onToast, confirm }: { onToast: (message: string) => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [settings, setSettings] = useState<AdminEmailSettings | null>(null);
  const [form, setForm] = useState<AdminEmailForm>({ host: "", port: "587", secure: false, user: "", password: "", from: "" });
  const [recipientCount, setRecipientCount] = useState(0);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [{ settings: saved }, { recipientCount: count }] = await Promise.all([
        api<{ settings: AdminEmailSettings }>("/api/admin/settings/email"),
        api<{ recipientCount: number }>("/api/admin/email/recipients"),
      ]);
      setSettings(saved);
      setForm({ host: saved.host, port: String(saved.port), secure: saved.secure, user: saved.user, password: "", from: saved.from });
      setRecipientCount(count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được cài đặt email.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { settings: saved } = await api<{ settings: AdminEmailSettings }>("/api/admin/settings/email", {
        method: "PUT",
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      setSettings(saved);
      setForm((current) => ({ ...current, password: "" }));
      onToast("Đã lưu SMTP gửi email toàn hệ thống.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được cấu hình SMTP.");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError("");
    try {
      await api("/api/admin/settings/email/test", { method: "POST" });
      onToast("Kết nối SMTP thành công.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không kiểm tra được SMTP.");
    } finally {
      setTesting(false);
    }
  };

  const sendBroadcast = async (event: FormEvent) => {
    event.preventDefault();
    if (!await confirm({
      title: "Gửi email cho toàn bộ người dùng?",
      message: `Email “${subject.trim()}” sẽ được gửi đến ${recipientCount} tài khoản. Người nhận sẽ không thấy địa chỉ email của nhau.`,
      confirmLabel: "Gửi email",
      tone: "danger",
    })) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ sentCount: number }>("/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({ subject, message }),
      });
      onToast(`Đã gửi email đến ${result.sentCount} tài khoản.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được email thông báo.");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="admin-loading"><span className="admin-spinner" />Đang tải cài đặt email…</div>;
  return <>
    <div className="admin-page-heading">
      <div><span className="admin-eyebrow">THÔNG BÁO</span><h1>Email toàn hệ thống</h1><p>Cấu hình máy chủ gửi thư và gửi thông báo đến các tài khoản người dùng.</p></div>
    </div>
    {error && <div className="admin-form-error admin-mail-error" role="alert">{error}</div>}
    <div className="admin-mail-grid">
      <section className="admin-users-card admin-mail-card">
        <div className="admin-users-toolbar"><div><h2>Cấu hình SMTP quản trị</h2><span className={`admin-status ${settings?.configured ? "is-active" : "is-inactive"}`}>{settings?.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span></div></div>
        <form className="admin-account-form admin-mail-form" onSubmit={(event) => void save(event)}>
          <label>Máy chủ SMTP<input value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} placeholder="smtp.congty.vn" required /></label>
          <div className="admin-mail-row">
            <label>Cổng<input type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))} required /></label>
            <label>Bảo mật<select value={form.secure ? "tls" : "starttls"} onChange={(event) => setForm((current) => ({ ...current, secure: event.target.value === "tls" }))}><option value="starttls">STARTTLS · cổng 587</option><option value="tls">TLS · cổng 465</option></select></label>
          </div>
          <label>Tên đăng nhập SMTP<input value={form.user} onChange={(event) => setForm((current) => ({ ...current, user: event.target.value }))} autoComplete="username" /></label>
          <label>Mật khẩu SMTP<input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={settings?.passwordSet ? "Để trống để giữ mật khẩu đã lưu" : "Nhập mật khẩu SMTP"} autoComplete="new-password" /></label>
          <label>Email người gửi<input value={form.from} onChange={(event) => setForm((current) => ({ ...current, from: event.target.value }))} placeholder="Quản trị hệ thống <admin@congty.vn>" required /></label>
          <p className="admin-mail-hint">Mật khẩu được mã hóa khi lưu. Cấu hình này dùng riêng cho email thông báo toàn hệ thống.</p>
          <div className="admin-mail-actions">
            {settings?.configured && <button type="button" className="admin-button admin-button-secondary" disabled={saving || testing} onClick={() => void testConnection()}>{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</button>}
            <button className="admin-button admin-button-primary" disabled={saving || testing}>{saving ? "Đang lưu…" : "Lưu SMTP"}</button>
          </div>
        </form>
      </section>

      <section className="admin-users-card admin-mail-card">
        <div className="admin-users-toolbar"><div><h2>Gửi email thông báo</h2><span>{recipientCount} tài khoản nhận · BCC ẩn địa chỉ</span></div></div>
        <form className="admin-account-form admin-mail-form" onSubmit={(event) => void sendBroadcast(event)}>
          <label>Tiêu đề email<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required /></label>
          <label>Nội dung<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={10000} rows={8} required /></label>
          <p className="admin-mail-hint">Email dạng văn bản sẽ được gửi đến tất cả tài khoản doanh nghiệp có email hợp lệ.</p>
          <div className="admin-mail-actions"><button className="admin-button admin-button-primary" disabled={!settings?.configured || recipientCount === 0 || sending}>{sending ? "Đang gửi…" : `Gửi đến ${recipientCount} người dùng`}</button></div>
        </form>
      </section>
    </div>
  </>;
}

function AccountDialog({ user, onClose, onSaved, confirm }: { user: ManagedUser | null; onClose: () => void; onSaved: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [draft, setDraft] = useState<AccountDraft>(user ? {
    name: user.name,
    email: user.email,
    active: user.active,
    companyName: user.companyName,
    taxId: user.taxId,
    address: user.address,
    phone: user.phone,
    businessEmail: user.businessEmail,
    representativeName: user.representativeName,
  } : emptyDraft);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const updateSharedEmail = (email: string) => setDraft((current) => ({ ...current, businessEmail: email, email }));
  const updateSharedName = (name: string) => setDraft((current) => ({ ...current, representativeName: name, name }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user && password.length < 7) {
      setError("Mật khẩu ban đầu cần có ít nhất 7 ký tự.");
      return;
    }
    if (user && user.active && !draft.active && !await confirm({ title: "Khóa tài khoản doanh nghiệp?", message: `${user.companyName} sẽ không thể đăng nhập cho đến khi tài khoản được mở lại.`, confirmLabel: "Khóa tài khoản", tone: "danger" })) return;
    if (!user && !await confirm({ title: "Tạo doanh nghiệp và tài khoản quản trị?", message: `Doanh nghiệp: ${draft.companyName}\nTài khoản đăng nhập: ${draft.businessEmail}\nSau khi tạo, tài khoản sẽ có quyền quản trị doanh nghiệp.`, confirmLabel: "Tạo doanh nghiệp" })) return;
    setBusy(true);
    setError("");
    try {
      if (user) {
        await api(`/api/admin/businesses/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify(draft) });
      } else {
        if (password.length < 7) throw new Error("Mật khẩu ban đầu cần có ít nhất 7 ký tự.");
        await api("/api/admin/businesses", { method: "POST", body: JSON.stringify({ ...draft, email: draft.businessEmail, name: draft.representativeName, password }) });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu tài khoản.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">HỒ SƠ DOANH NGHIỆP</span><h2 id="account-dialog-title">{user ? "Chỉnh sửa doanh nghiệp" : "Tạo doanh nghiệp"}</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      {error && <div className="admin-form-error" role="alert">{error}</div>}
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Tên doanh nghiệp<input autoComplete="organization" maxLength={200} value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} placeholder="Công ty ABC" required /></label>
        <label>Mã số thuế<input maxLength={30} value={draft.taxId} onChange={(event) => setDraft({ ...draft, taxId: event.target.value })} placeholder="0123456789" required /></label>
        <label>Địa chỉ doanh nghiệp<input autoComplete="street-address" maxLength={500} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="Số nhà, đường, quận/huyện, tỉnh/thành" required /></label>
        <label>Điện thoại doanh nghiệp<input type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="028 1234 5678" required /></label>
        {user ? <label>Email doanh nghiệp<input type="email" autoComplete="email" maxLength={250} value={draft.businessEmail} onChange={(event) => setDraft({ ...draft, businessEmail: event.target.value })} placeholder="info@congty.vn" required /></label> : <label>Email doanh nghiệp và đăng nhập<input type="email" autoComplete="email" maxLength={250} value={draft.businessEmail} onChange={(event) => updateSharedEmail(event.target.value)} placeholder="info@congty.vn" required /></label>}
        {user ? <label>Người đại diện<input autoComplete="name" maxLength={200} value={draft.representativeName} onChange={(event) => setDraft({ ...draft, representativeName: event.target.value })} placeholder="Nguyễn Văn An" required /></label> : <label>Người đại diện và họ tên quản trị viên<input autoComplete="name" maxLength={200} value={draft.representativeName} onChange={(event) => updateSharedName(event.target.value)} placeholder="Nguyễn Văn An" required /></label>}
        {user && <>
          <label>Họ và tên người quản trị<input autoComplete="name" maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nguyễn Văn An" required /></label>
          <label>Email đăng nhập<input type="email" autoComplete="username" maxLength={250} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="admin@congty.vn" required /></label>
        </>}
        {user ? <label>Trạng thái<select value={draft.active ? "active" : "inactive"} onChange={(event) => setDraft({ ...draft, active: event.target.value === "active" })}><option value="active">Đang hoạt động</option><option value="inactive">Đã khóa</option></select><small>Khóa sẽ chặn tài khoản đăng nhập vào doanh nghiệp.</small></label> : <label>Mật khẩu ban đầu<input type="password" autoComplete="new-password" minLength={7} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ít nhất 7 ký tự" required /><small>Mật khẩu cần có từ 7 đến 200 ký tự.</small></label>}
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Hủy</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : user ? "Lưu doanh nghiệp" : "Tạo doanh nghiệp và tài khoản"}</button></div>
      </form>
    </section>
  </div>;
}

function PasswordDialog({ user, onClose, onSaved, confirm }: { user: ManagedUser; onClose: () => void; onSaved: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!await confirm({ title: "Đặt lại mật khẩu?", message: `Mật khẩu tài khoản ${user.email} sẽ được thay đổi ngay. Các phiên đăng nhập hiện tại của tài khoản sẽ hết hiệu lực.`, confirmLabel: "Đặt lại mật khẩu", tone: "danger" })) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/businesses/${encodeURIComponent(user.id)}/password`, { method: "PUT", body: JSON.stringify({ password }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật mật khẩu.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-modal admin-password-modal" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">BẢO MẬT TÀI KHOẢN</span><h2 id="password-dialog-title">Đặt lại mật khẩu</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      <p className="admin-password-user">{user.name}<small>{user.email}</small></p>
      {error && <div className="admin-form-error" role="alert">{error}</div>}
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={7} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ít nhất 7 ký tự" required /><small>Mật khẩu phải có từ 7 đến 200 ký tự.</small></label>
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Hủy</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : "Cập nhật mật khẩu"}</button></div>
      </form>
    </section>
  </div>;
}
