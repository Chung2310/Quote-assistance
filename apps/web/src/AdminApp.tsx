import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, formatDate, formatMoney } from "./api";
import MoneyInput from "./MoneyInput";
import { NotificationProvider, NotificationToast, TaskProgress, useAppNotification, useConfirmation, useNotification, type ConfirmOptions, type Notify, type TaskProgressState } from "./Feedback";
import type { User } from "./types";
import "./admin.css";
import "./admin-portal.css";

type ServicePlan = { code: string; name: string; description: string; monthlyPrice: number | null; quoteLimit: number | null; aiLimit: number | null; templateLimit: number | null; active: boolean; featured: boolean; displayOrder: number; assignedBusinesses?: number };
type ManagedUser = User & { active: boolean; createdAt: string; updatedAt: string; companyName: string; taxId: string; address: string; phone: string; businessEmail: string; representativeName: string; planCode: string; planName: string };
type ContactStatus = "new" | "contacted" | "closed";
type PlanContactRequest = { id: string; name: string; companyName: string; email: string; phone: string; message: string; status: ContactStatus; adminNote?: string; createdAt: string; updatedAt: string };
type SessionState = "checking" | "anonymous" | "allowed" | "forbidden";
type AdminSection = "businesses" | "plans" | "contacts" | "payments";
type AccountDraft = { name: string; email: string; active: boolean; companyName: string; taxId: string; address: string; phone: string; businessEmail: string; representativeName: string; planCode: string };
type AdminSepaySettings = { configured: boolean; bankCode: string; accountNumber: string; accountName: string; paymentPrefix: string; webhookApiKeySet: boolean; webhookApiKeySource: "admin" | "environment" | "none" };
type AdminSepayForm = { bankCode: string; accountNumber: string; accountName: string; paymentPrefix: string; webhookApiKey: string };

const emptyDraft: AccountDraft = { name: "", email: "", active: true, companyName: "", taxId: "", address: "", phone: "", businessEmail: "", representativeName: "", planCode: "free" };

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
    messages: <><path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.6L3 21l1.9-5.6a8.5 8.5 0 1 1 16.1-3.9Z" /><path d="M8 11h8M8 15h5" /></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    plans: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    bank: <><path d="M3 10h18M5 10v9m5-9v9m4-9v9m5-9v9M3 21h18M12 3 2 8v2h20V8L12 3Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.users}</svg>;
}

type AdminSelectOption = { value: string; label: string };
type AdminSelectProps = {
  value: string;
  options: AdminSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  variant?: "field" | "filter";
};

function AdminSelect({ value, options, onChange, ariaLabel, variant = "field" }: AdminSelectProps) {
  const selectId = `admin-select-${useId()}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const activeOption = options[activeIndex];

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxHeight = Math.min(280, window.innerHeight - 24);
    const estimatedHeight = Math.min(maxHeight, options.length * 42 + 10);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const opensUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const availableHeight = opensUp ? spaceAbove : spaceBelow;
    const visibleHeight = Math.max(80, Math.min(estimatedHeight, availableHeight));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
    setMenuPosition({
      top: opensUp ? Math.max(8, rect.top - visibleHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - visibleHeight - 8),
      left,
      width: rect.width,
      maxHeight: visibleHeight,
    });
  };

  const openMenu = (nextIndex = selectedIndex) => {
    if (!options.length) return;
    setActiveIndex(Math.max(0, Math.min(nextIndex, options.length - 1)));
    updateMenuPosition();
    setIsOpen(true);
  };

  const chooseOption = (option: AdminSelectOption) => {
    onChange(option.value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false);
    };
    const reposition = () => updateMenuPosition();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen, options.length]);

  useEffect(() => {
    if (isOpen && activeOption) document.getElementById(`${selectId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex, activeOption, selectId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? selectedIndex + 1 : event.key === "ArrowUp" ? selectedIndex - 1 : selectedIndex);
      return;
    }
    if (!isOpen) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeOption) chooseOption(activeOption);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setIsOpen(false);
    }
  };

  return <div className={`admin-select admin-select-${variant}`} ref={rootRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
  }}>
    <button
      ref={triggerRef}
      id={`${selectId}-trigger`}
      type="button"
      className={`admin-select-trigger ${isOpen ? "is-open" : ""}`}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-controls={`${selectId}-listbox`}
      aria-activedescendant={isOpen && activeOption ? `${selectId}-option-${activeIndex}` : undefined}
      aria-label={ariaLabel}
      onClick={() => isOpen ? setIsOpen(false) : openMenu()}
      onKeyDown={handleKeyDown}
    >
      <span className="admin-select-value">{selectedOption?.label ?? ""}</span>
      <svg className="admin-select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {isOpen && createPortal(<div
      ref={menuRef}
      id={`${selectId}-listbox`}
      className="admin-select-menu"
      role="listbox"
      aria-label={ariaLabel}
      style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isActive = index === activeIndex;
        return <div
          key={option.value}
          id={`${selectId}-option-${index}`}
          className={`admin-select-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
          role="option"
          aria-selected={isSelected}
          aria-posinset={index + 1}
          aria-setsize={options.length}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseOption(option)}
        >
          <span>{option.label}</span>
          <span className="admin-select-check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
        </div>;
      })}
    </div>, document.body)}
  </div>;
}

export default function AdminApp() {
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [contactRequests, setContactRequests] = useState<PlanContactRequest[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [activeSection, setActiveSection] = useState<AdminSection>("businesses");
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogUser, setDialogUser] = useState<ManagedUser | null | undefined>(undefined);
  const [dialogPlan, setDialogPlan] = useState<ServicePlan | null | undefined>(undefined);
  const [dialogContact, setDialogContact] = useState<PlanContactRequest | null>(null);
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const { notification, notify, dismiss } = useNotification();
  const { confirm, dialog: confirmationDialog } = useConfirmation();

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then(({ user }) => {
        setCurrentUser(user);
        setSessionState(user.role === "admin" ? "allowed" : "forbidden");
      })
      .catch(() => setSessionState("anonymous"));
  }, []);

  useEffect(() => {
    if (sessionState !== "allowed") return;
    let cancelled = false;
    setLoadingUsers(true);
    setLoadError("");
    Promise.all([
      api<{ businesses: ManagedUser[] }>("/api/admin/businesses"),
      api<{ plans: ServicePlan[] }>("/api/admin/plans"),
      api<{ requests: PlanContactRequest[] }>("/api/admin/plan-contact-requests"),
    ])
      .then(([{ businesses }, { plans: loadedPlans }, { requests }]) => {
        if (!cancelled) { setUsers(businesses); setPlans(loadedPlans); setContactRequests(requests); }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError("failed");
          notify(error instanceof Error ? error.message : "Không thể tải dữ liệu quản trị.", "error");
        }
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, [sessionState, reloadKey, notify]);

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
    return <div className="admin-splash"><img className="brand-logo-image brand-logo-image-splash brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" /><span>Đang kiểm tra phiên quản trị…</span></div>;
  }
  if (sessionState !== "allowed") return null;

  const activeCount = users.filter((user) => user.active).length;
  const inactiveCount = users.filter((user) => !user.active).length;

  return <NotificationProvider notify={notify}><div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/quan-tri" aria-label="Trang quản trị iGen Trợ lí báo giá">
        <img className="brand-logo-image brand-logo-baogia" src="/images/logo-baogia.png" alt="iGen Trợ lí báo giá" />
      </a>
      <div className="admin-nav-label">Quản lý</div>
      <nav className="admin-nav">
        <button type="button" className={`admin-nav-item ${activeSection === "businesses" ? "is-active" : ""}`} onClick={() => setActiveSection("businesses")}><AdminIcon name="users" /><span>Doanh nghiệp</span></button>
        <button type="button" className={`admin-nav-item ${activeSection === "plans" ? "is-active" : ""}`} onClick={() => setActiveSection("plans")}><AdminIcon name="plans" /><span>Gói dịch vụ</span></button>
        <button type="button" className={`admin-nav-item ${activeSection === "contacts" ? "is-active" : ""}`} onClick={() => setActiveSection("contacts")}><AdminIcon name="messages" /><span>Yêu cầu liên hệ</span></button>
        <button type="button" className={`admin-nav-item ${activeSection === "payments" ? "is-active" : ""}`} onClick={() => setActiveSection("payments")}><AdminIcon name="bank" /><span>Thanh toán</span></button>
      </nav>
      <div className="admin-profile">
        <span className="admin-avatar">{currentUser?.name.trim().charAt(0).toLocaleUpperCase("vi") || "A"}</span>
        <span className="admin-profile-copy"><strong>{currentUser?.name}</strong><small>Admin hệ thống</small></span>
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
                <AdminSelect
                  variant="filter"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
                  ariaLabel="Lọc theo trạng thái"
                  options={[{ value: "all", label: "Tất cả trạng thái" }, { value: "active", label: "Đang hoạt động" }, { value: "inactive", label: "Đã khóa" }]}
                />
              </div>
            </div>
            {loadError && <div className="admin-inline-error" role="alert">{loadError}<button onClick={() => setReloadKey((key) => key + 1)}>Tải lại</button></div>}
            {loadingUsers ? <div className="admin-loading"><span className="admin-spinner" />Đang tải doanh nghiệp…</div> : users.length === 0 ? <div className="admin-empty"><span><AdminIcon name="users" size={23} /></span><strong>Chưa có doanh nghiệp</strong><p>Doanh nghiệp có thể tự đăng ký tài khoản trên trang đăng nhập.</p><button className="admin-button admin-button-primary" onClick={() => setDialogUser(null)}><AdminIcon name="plus" size={16} /> Thêm doanh nghiệp</button></div> : visibleUsers.length === 0 ? <div className="admin-empty admin-empty-compact"><strong>Không tìm thấy doanh nghiệp phù hợp</strong><p>Thử từ khóa hoặc trạng thái khác.</p></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Doanh nghiệp</th><th>Tài khoản người dùng</th><th>Gói hiện tại</th><th>Trạng thái</th><th>Ngày tạo</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {visibleUsers.map((managedUser) => <tr key={managedUser.id}>
                <td><div className="admin-user-cell"><span className="admin-user-avatar">{managedUser.companyName.trim().charAt(0).toLocaleUpperCase("vi") || "?"}</span><span><strong>{managedUser.companyName}</strong><small>Mã số thuế: {managedUser.taxId} · {managedUser.representativeName}</small></span></div></td>
                <td><div className="admin-business-contact"><strong>{managedUser.name}</strong><small>{managedUser.email}</small><small>{managedUser.phone} · {managedUser.businessEmail}</small></div></td>
                <td><span className={`admin-plan-pill ${managedUser.planCode === "pro" ? "is-featured" : ""}`}>{managedUser.planName || "Dùng thử"}</span></td>
                <td><span className={`admin-status ${managedUser.active ? "is-active" : "is-inactive"}`}><i />{managedUser.active ? "Đang hoạt động" : "Đã khóa"}</span></td>
                <td className="admin-date-cell">{managedUser.createdAt ? formatDate(managedUser.createdAt) : "—"}</td>
                <td><div className="admin-row-actions"><button className="admin-icon-button" onClick={() => setDialogUser(managedUser)} title="Chỉnh sửa doanh nghiệp" aria-label={`Chỉnh sửa ${managedUser.companyName}`}><AdminIcon name="edit" size={16} /></button><button className="admin-icon-button" onClick={() => setPasswordUser(managedUser)} title="Đặt lại mật khẩu" aria-label={`Đặt lại mật khẩu cho ${managedUser.name}`}><AdminIcon name="key" size={16} /></button></div></td>
              </tr>)}
            </tbody></table></div>}
            {!loadingUsers && users.length > 0 && <div className="admin-card-footer">Hiển thị {visibleUsers.length} / {users.length} doanh nghiệp</div>}
          </section>
        </div>
        {activeSection === "plans" && <section className="admin-plan-management">
          <div className="admin-page-heading"><div><span className="admin-eyebrow">THUÊ BAO</span><h1>Gói dịch vụ</h1><p>Quản lý giá, hạn mức và gói đang áp dụng cho doanh nghiệp.</p></div><button className="admin-button admin-button-primary" onClick={() => setDialogPlan(null)}><AdminIcon name="plus" size={16} /> Thêm gói</button></div>
          {loadError && <button className="admin-button admin-button-secondary" onClick={() => setReloadKey((key) => key + 1)}>Tải lại dữ liệu</button>}
          {loadingUsers ? <div className="admin-loading"><span className="admin-spinner" />Đang tải gói dịch vụ…</div> : <div className="admin-plan-grid">{plans.map((plan) => <article className={`admin-plan-card ${plan.featured ? "is-featured" : ""}`} key={plan.code}>
            <div className="admin-plan-card-top"><span className={`admin-status ${plan.active ? "is-active" : "is-inactive"}`}><i />{plan.active ? "Đang mở" : "Đã ẩn"}</span><button className="admin-icon-button" onClick={() => setDialogPlan(plan)} title={`Chỉnh sửa gói ${plan.name}`} aria-label={`Chỉnh sửa gói ${plan.name}`}><AdminIcon name="edit" size={16} /></button></div>
            <h2>{plan.name}</h2><p>{plan.description || "Chưa có mô tả."}</p>
            <strong className="admin-plan-price">{plan.monthlyPrice === null ? "Theo nhu cầu" : plan.monthlyPrice === 0 ? "Miễn phí" : formatMoney(plan.monthlyPrice, "VND")}<small>{plan.monthlyPrice !== null && plan.monthlyPrice > 0 ? "/ tháng" : ""}</small></strong>
            <div className="admin-plan-limits"><span>{plan.quoteLimit === null ? "Hạn mức báo giá riêng" : `${new Intl.NumberFormat("vi-VN").format(plan.quoteLimit)} lượt báo giá / tháng`}</span><span>{plan.aiLimit === null ? "AI không giới hạn" : `${new Intl.NumberFormat("vi-VN").format(plan.aiLimit)} lượt AI / tháng`}</span><span>{plan.templateLimit === null ? "Mẫu theo nhu cầu" : `${new Intl.NumberFormat("vi-VN").format(plan.templateLimit)} mẫu báo giá`}</span></div>
            <footer><span>{plan.assignedBusinesses ?? 0} doanh nghiệp đang dùng</span><button className="admin-button admin-button-secondary" onClick={() => setDialogPlan(plan)}>Chỉnh sửa</button></footer>
          </article>)}</div>}
          <p className="admin-plan-note">Gói miễn phí luôn được giữ hoạt động và dùng làm mặc định cho doanh nghiệp mới.</p>
        </section>}
        {activeSection === "payments" && <AdminSepay onToast={notify} />}
        {activeSection === "contacts" && <PlanContactRequestsPage requests={contactRequests} loading={loadingUsers} error={Boolean(loadError)} onRetry={() => setReloadKey((key) => key + 1)} onOpen={setDialogContact} />}
      </main>
    </div>

    {dialogUser !== undefined && <AccountDialog
      user={dialogUser}
      plans={plans}
      confirm={confirm}
      onClose={() => setDialogUser(undefined)}
      onSaved={() => { setDialogUser(undefined); setReloadKey((key) => key + 1); notify(dialogUser ? "Đã cập nhật doanh nghiệp." : "Đã tạo doanh nghiệp và tài khoản người dùng."); }}
    />}
    {dialogPlan !== undefined && <PlanDialog plan={dialogPlan} confirm={confirm} onClose={() => setDialogPlan(undefined)} onSaved={() => { const creating = dialogPlan === null; setDialogPlan(undefined); setReloadKey((key) => key + 1); notify(creating ? "Đã tạo gói dịch vụ." : "Đã cập nhật gói dịch vụ."); }} />}
    {dialogContact && <PlanContactRequestDialog request={dialogContact} onClose={() => setDialogContact(null)} onSaved={(updated) => { setContactRequests((items) => items.map((item) => item.id === updated.id ? updated : item)); setDialogContact(null); notify("Đã cập nhật yêu cầu liên hệ."); }} />}
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
  </div></NotificationProvider>;
}

function PlanContactRequestsPage({ requests, loading, error, onRetry, onOpen }: { requests: PlanContactRequest[]; loading: boolean; error: boolean; onRetry: () => void; onOpen: (request: PlanContactRequest) => void }) {
  const newCount = requests.filter((request) => request.status === "new").length;
  const contactedCount = requests.filter((request) => request.status === "contacted").length;
  const closedCount = requests.filter((request) => request.status === "closed").length;
  const statusLabels: Record<ContactStatus, string> = { new: "Mới", contacted: "Đã liên hệ", closed: "Đã đóng" };
  return <section className="admin-contact-management">
    <div className="admin-page-heading"><div><span className="admin-eyebrow">GÓI TƯ VẤN</span><h1>Yêu cầu liên hệ</h1><p>Xem thông tin khách hàng và theo dõi tiến độ tư vấn gói.</p></div></div>
    <section className="admin-contact-stats" aria-label="Tổng quan yêu cầu liên hệ">
      <article><span>Tổng yêu cầu</span><strong>{requests.length}</strong></article>
      <article><span>Mới</span><strong>{newCount}</strong></article>
      <article><span>Đã liên hệ</span><strong>{contactedCount}</strong></article>
      <article><span>Đã đóng</span><strong>{closedCount}</strong></article>
    </section>
    <section className="admin-users-card admin-contact-table-card">
      <div className="admin-users-toolbar"><div><h2>Danh sách yêu cầu</h2><span>{requests.length} yêu cầu</span></div></div>
      {error && <button className="admin-button admin-button-secondary" onClick={onRetry}>Tải lại dữ liệu</button>}
      {loading ? <div className="admin-loading"><span className="admin-spinner" />Đang tải yêu cầu…</div> : requests.length === 0 ? <div className="admin-empty"><span><AdminIcon name="mail" size={23} /></span><strong>Chưa có yêu cầu liên hệ</strong><p>Yêu cầu từ gói Liên hệ sẽ xuất hiện tại đây.</p></div> : <div className="admin-table-scroll"><table className="admin-table admin-contact-table"><thead><tr><th>NGÀY GỬI</th><th>NGƯỜI LIÊN HỆ</th><th>THÔNG TIN LIÊN HỆ</th><th>NHU CẦU</th><th>TRẠNG THÁI</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
        <td className="admin-date-cell">{formatDate(request.createdAt)}</td>
        <td><div className="admin-business-contact"><strong>{request.name}</strong><small>{request.companyName}</small></div></td>
        <td><div className="admin-business-contact"><a href={`mailto:${request.email}`}>{request.email}</a><small>{request.phone || "Chưa cung cấp số điện thoại"}</small></div></td>
        <td><span className="admin-contact-message-preview" title={request.message}>{request.message}</span></td>
        <td><span className={`admin-contact-status is-${request.status}`}>{statusLabels[request.status]}</span></td>
        <td><button className="admin-button admin-button-secondary" onClick={() => onOpen(request)}>Xem / xử lý</button></td>
      </tr>)}</tbody></table></div>}
      {!loading && requests.length > 0 && <div className="admin-card-footer">Đang hiển thị {requests.length} yêu cầu</div>}
    </section>
  </section>;
}

function PlanContactRequestDialog({ request, onClose, onSaved }: { request: PlanContactRequest; onClose: () => void; onSaved: (request: PlanContactRequest) => void }) {
  const [status, setStatus] = useState<ContactStatus>(request.status);
  const [adminNote, setAdminNote] = useState(request.adminNote ?? "");
  const notify = useAppNotification();
  const setError = (message: string) => { if (message) notify(message, "error"); };
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { request: updated } = await api<{ request: PlanContactRequest }>(`/api/admin/plan-contact-requests/${encodeURIComponent(request.id)}`, { method: "PATCH", body: JSON.stringify({ status, adminNote }) });
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được thay đổi.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-modal admin-contact-modal" role="dialog" aria-modal="true" aria-labelledby="admin-contact-title">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">YÊU CẦU TƯ VẤN · {formatDate(request.createdAt)}</span><h2 id="admin-contact-title">{request.companyName}</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      <div className="admin-contact-details"><div><small>Người liên hệ</small><strong>{request.name}</strong></div><div><small>Email</small><a href={`mailto:${request.email}`}>{request.email}</a></div><div><small>Số điện thoại</small>{request.phone ? <a href={`tel:${request.phone}`}>{request.phone}</a> : <span>Chưa cung cấp</span>}</div></div>
      <section className="admin-contact-message-full"><span>Nhu cầu của khách hàng</span><p>{request.message}</p></section>
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Trạng thái xử lý<AdminSelect value={status} onChange={(value) => setStatus(value as ContactStatus)} options={[{ value: "new", label: "Mới" }, { value: "contacted", label: "Đã liên hệ" }, { value: "closed", label: "Đã đóng" }]} /></label>
        <label>Ghi chú nội bộ<textarea rows={4} maxLength={2000} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Ghi lại nội dung trao đổi hoặc việc cần làm tiếp theo…" /></label>
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Đóng</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : "Lưu xử lý"}</button></div>
      </form>
    </section>
  </div>;
}

function AdminSepay({ onToast }: { onToast: Notify }) {
  const [settings, setSettings] = useState<AdminSepaySettings | null>(null);
  const [form, setForm] = useState<AdminSepayForm>({ bankCode: "", accountNumber: "", accountName: "", paymentPrefix: "BG", webhookApiKey: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    setTaskProgress({ label: "Đang tải cài đặt thanh toán", detail: "Đang đọc tài khoản ngân hàng…" });
    try {
      const { settings: saved } = await api<{ settings: AdminSepaySettings }>("/api/admin/settings/sepay");
      setSettings(saved);
      setForm({ bankCode: saved.bankCode, accountNumber: saved.accountNumber, accountName: saved.accountName, paymentPrefix: saved.paymentPrefix, webhookApiKey: "" });
    } catch (cause) {
      setLoadFailed(true);
      onToast(cause instanceof Error ? cause.message : "Không tải được cài đặt thanh toán.", "error");
    } finally {
      setLoading(false);
      setTaskProgress(null);
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setTaskProgress({ label: "Đang lưu tài khoản thanh toán", detail: "Đang cập nhật cấu hình SePay…" });
    try {
      const { settings: saved } = await api<{ settings: AdminSepaySettings }>("/api/admin/settings/sepay", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setSettings(saved);
      setForm((current) => ({ ...current, webhookApiKey: "" }));
      onToast("Đã lưu tài khoản ngân hàng và cài đặt SePay.");
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : "Không lưu được cài đặt thanh toán.", "error");
    } finally {
      setSaving(false);
      setTaskProgress(null);
    }
  };

  const webhookUrl = new URL("/api/billing/sepay/webhook", window.location.origin).toString();
  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      onToast("Đã sao chép địa chỉ webhook.");
    } catch {
      onToast("Không sao chép được địa chỉ webhook trên trình duyệt này.", "error");
    }
  };

  if (loading) return <TaskProgress label="Đang tải cài đặt thanh toán" detail="Đang đọc tài khoản ngân hàng…" />;
  return <>
    <div className="admin-page-heading">
      <div><span className="admin-eyebrow">THANH TOÁN</span><h1>Tài khoản ngân hàng</h1><p>Cấu hình tài khoản nhận tiền và webhook SePay cho đăng ký, nâng cấp gói.</p></div>
    </div>
    {taskProgress && <TaskProgress {...taskProgress} />}
    {loadFailed && <button className="admin-button admin-button-secondary" onClick={() => void load()}>Tải lại cài đặt thanh toán</button>}
    <div className="admin-settings-grid admin-sepay-grid">
      <section className="admin-users-card admin-settings-card">
        <div className="admin-users-toolbar"><div><h2>Ngân hàng nhận tiền</h2><span className={`admin-status ${settings?.configured ? "is-active" : "is-inactive"}`}><i />{settings?.configured ? "Đã sẵn sàng" : "Chưa cấu hình đủ"}</span></div></div>
        <form className="admin-account-form admin-settings-form" onSubmit={(event) => void save(event)}>
          <div className="admin-sepay-fields">
            <label>Mã ngân hàng<input value={form.bankCode} onChange={(event) => setForm((current) => ({ ...current, bankCode: event.target.value }))} placeholder="MB, VCB…" maxLength={30} autoComplete="off" required /></label>
            <label>Số tài khoản<input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value }))} maxLength={19} autoComplete="off" required /></label>
            <label className="admin-sepay-wide">Tên chủ tài khoản<input value={form.accountName} onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))} maxLength={100} autoComplete="off" /></label>
            <label>Mã nội dung chuyển khoản<input value={form.paymentPrefix} onChange={(event) => setForm((current) => ({ ...current, paymentPrefix: event.target.value.toUpperCase() }))} minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" required /></label>
            <label className="admin-sepay-wide">API Key webhook SePay<input type="password" value={form.webhookApiKey} onChange={(event) => setForm((current) => ({ ...current, webhookApiKey: event.target.value }))} placeholder={settings?.webhookApiKeySet ? "Để trống để giữ khóa hiện tại" : "Nhập API Key đã cấu hình trên SePay"} maxLength={1024} autoComplete="new-password" /></label>
          </div>
          <p className="admin-settings-hint">Khóa webhook được mã hóa khi lưu. {settings?.webhookApiKeySource === "environment" ? "Đang dùng khóa từ biến môi trường; nhập khóa mới để thay thế." : "Khóa lấy từ cấu hình SePay mục API Key."}</p>
          <div className="admin-settings-actions"><button className="admin-button admin-button-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu cài đặt"}</button></div>
        </form>
      </section>

      <section className="admin-users-card admin-settings-card admin-sepay-info-card">
        <div className="admin-users-toolbar"><div><h2>Kết nối webhook</h2><span>SePay gọi địa chỉ này khi có tiền vào</span></div></div>
        <div className="admin-sepay-info">
          <div className="admin-sepay-endpoint"><code>{webhookUrl}</code><button type="button" className="admin-button admin-button-secondary" onClick={() => void copyWebhookUrl()}>Sao chép</button></div>
          <p>Trong SePay, chọn webhook tiền vào, xác thực API Key và nhập cùng khóa ở đây.</p>
          <p>Mã chuyển khoản bắt đầu bằng <strong>{form.paymentPrefix || "BG"}</strong>. Dùng tiền tố này trong cấu hình nhận diện giao dịch của SePay.</p>
          <p>Ngân hàng, số tài khoản và API Key phải cùng thuộc cấu hình webhook đang sử dụng.</p>
        </div>
      </section>
    </div>
  </>;
}

function AccountDialog({ user, plans, onClose, onSaved, confirm }: { user: ManagedUser | null; plans: ServicePlan[]; onClose: () => void; onSaved: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
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
    planCode: user.planCode ?? "free",
  } : emptyDraft);
  const [password, setPassword] = useState("");
  const notify = useAppNotification();
  const setError = (message: string) => { if (message) notify(message, "error"); };
  const [busy, setBusy] = useState(false);
  const selectedPlan = plans.find((plan) => plan.code === draft.planCode);
  const quoteLimitSummary = selectedPlan?.quoteLimit == null ? "Theo nhu cầu" : `${new Intl.NumberFormat("vi-VN").format(selectedPlan.quoteLimit)} lượt/tháng`;
  const templateLimitSummary = selectedPlan?.templateLimit == null ? "Theo nhu cầu" : `${new Intl.NumberFormat("vi-VN").format(selectedPlan.templateLimit)} mẫu`;
  const updateSharedEmail = (email: string) => setDraft((current) => ({ ...current, businessEmail: email, email }));
  const updateSharedName = (name: string) => setDraft((current) => ({ ...current, representativeName: name, name }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user && password.length < 7) {
      setError("Mật khẩu ban đầu cần có ít nhất 7 ký tự.");
      return;
    }
    if (user && user.active && !draft.active && !await confirm({ title: "Khóa tài khoản doanh nghiệp?", message: `${user.companyName} sẽ không thể đăng nhập cho đến khi tài khoản được mở lại.`, confirmLabel: "Khóa tài khoản", tone: "danger" })) return;
    if (!user && !await confirm({ title: "Tạo doanh nghiệp và tài khoản người dùng?", message: `Doanh nghiệp: ${draft.companyName}\nTài khoản đăng nhập: ${draft.businessEmail}\nGói được cấp: ${selectedPlan?.name ?? "Dùng thử"}`, confirmLabel: "Tạo doanh nghiệp" })) return;
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
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">Hồ sơ doanh nghiệp</span><h2 id="account-dialog-title">{user ? "Chỉnh sửa doanh nghiệp" : "Tạo doanh nghiệp"}</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Tên doanh nghiệp<input autoComplete="organization" maxLength={200} value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} placeholder="Công ty ABC" required /></label>
        <label>Mã số thuế<input maxLength={30} value={draft.taxId} onChange={(event) => setDraft({ ...draft, taxId: event.target.value })} placeholder="0123456789" required /></label>
        <label>Địa chỉ doanh nghiệp<input autoComplete="street-address" maxLength={500} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="Số nhà, đường, quận/huyện, tỉnh/thành" required /></label>
        <label>Điện thoại doanh nghiệp<input type="tel" autoComplete="tel" maxLength={30} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="028 1234 5678" required /></label>
        {user ? <label>Email doanh nghiệp<input type="email" autoComplete="email" maxLength={250} value={draft.businessEmail} onChange={(event) => setDraft({ ...draft, businessEmail: event.target.value })} placeholder="info@congty.vn" required /></label> : <label>Email doanh nghiệp và đăng nhập<input type="email" autoComplete="email" maxLength={250} value={draft.businessEmail} onChange={(event) => updateSharedEmail(event.target.value)} placeholder="info@congty.vn" required /></label>}
        {user ? <label>Người đại diện<input autoComplete="name" maxLength={200} value={draft.representativeName} onChange={(event) => setDraft({ ...draft, representativeName: event.target.value })} placeholder="Nguyễn Văn An" required /></label> : <label>Người đại diện và người dùng<input autoComplete="name" maxLength={200} value={draft.representativeName} onChange={(event) => updateSharedName(event.target.value)} placeholder="Nguyễn Văn An" required /></label>}
        {user && <>
          <label>Họ và tên người dùng<input autoComplete="name" maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nguyễn Văn An" required /></label>
          <label>Email đăng nhập<input type="email" autoComplete="username" maxLength={250} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="admin@congty.vn" required /></label>
        </>}
        <label>{user ? "Gói dịch vụ" : "Gói cấp cho tài khoản"}<AdminSelect value={draft.planCode} onChange={(value) => setDraft({ ...draft, planCode: value })} options={plans.filter((plan) => plan.active || plan.code === draft.planCode).map((plan) => ({ value: plan.code, label: `${plan.name}${plan.monthlyPrice === null ? " · Theo nhu cầu" : ` · ${formatMoney(plan.monthlyPrice, "VND")}/tháng`}` }))} /><small>{user ? "Thay đổi gói áp dụng ngay cho doanh nghiệp này." : "Gói được cấp ngay khi tạo tài khoản test; mặc định là Dùng thử miễn phí."}</small>{selectedPlan && <small className="admin-account-plan-summary">Hạn mức: {quoteLimitSummary} · Mẫu báo giá: {templateLimitSummary}</small>}</label>
        {user ? <label>Trạng thái<AdminSelect value={draft.active ? "active" : "inactive"} onChange={(value) => setDraft({ ...draft, active: value === "active" })} options={[{ value: "active", label: "Đang hoạt động" }, { value: "inactive", label: "Đã khóa" }]} /><small>Khóa sẽ chặn tài khoản đăng nhập vào doanh nghiệp.</small></label> : <label>Mật khẩu ban đầu<input type="password" autoComplete="new-password" minLength={7} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ít nhất 7 ký tự" required /><small>Mật khẩu cần có từ 7 đến 200 ký tự.</small></label>}
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Hủy</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : user ? "Lưu doanh nghiệp" : "Tạo doanh nghiệp và tài khoản"}</button></div>
      </form>
    </section>
  </div>;
}

type PlanFormDraft = { name: string; description: string; monthlyPrice: string; quoteLimit: string; aiLimit: string; templateLimit: string; active: boolean; featured: boolean; displayOrder: string };

function PlanDialog({ plan, onClose, onSaved, confirm }: { plan: ServicePlan | null; onClose: () => void; onSaved: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [draft, setDraft] = useState<PlanFormDraft>(plan ? {
    name: plan.name,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice === null ? "" : String(plan.monthlyPrice),
    quoteLimit: plan.quoteLimit === null ? "" : String(plan.quoteLimit),
    aiLimit: plan.aiLimit === null ? "" : String(plan.aiLimit),
    templateLimit: plan.templateLimit === null ? "" : String(plan.templateLimit),
    active: plan.active,
    featured: plan.featured,
    displayOrder: String(plan.displayOrder),
  } : { name: "", description: "", monthlyPrice: "", quoteLimit: "", aiLimit: "", templateLimit: "", active: true, featured: false, displayOrder: "10" });
  const notify = useAppNotification();
  const setError = (message: string) => { if (message) notify(message, "error"); };
  const [busy, setBusy] = useState(false);
  const isFreePlan = plan?.code === "free";
  const isContactPlan = plan?.code === "contact";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (plan?.active && !draft.active && !await confirm({ title: "Ẩn gói dịch vụ?", message: "Gói này sẽ không còn xuất hiện trên landing page và không thể gán cho doanh nghiệp mới. Doanh nghiệp đang dùng gói vẫn giữ nguyên gói đó.", confirmLabel: "Ẩn gói" })) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...draft,
        monthlyPrice: isFreePlan ? 0 : draft.monthlyPrice.trim() === "" ? null : Number(draft.monthlyPrice),
        quoteLimit: draft.quoteLimit.trim() === "" ? null : Number(draft.quoteLimit),
        aiLimit: draft.aiLimit.trim() === "" ? null : Number(draft.aiLimit),
        templateLimit: draft.templateLimit.trim() === "" ? null : Number(draft.templateLimit),
        displayOrder: draft.displayOrder.trim() === "" ? 0 : Number(draft.displayOrder),
      };
      if (plan) {
        await api(`/api/admin/plans/${encodeURIComponent(plan.code)}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/admin/plans", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được gói dịch vụ.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-modal admin-plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">QUẢN LÝ GÓI</span><h2 id="plan-dialog-title">{plan ? `Chỉnh sửa gói ${plan.name}` : "Tạo gói dịch vụ"}</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Tên gói<input maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ví dụ: Pro" required /></label>
        <label>Mô tả<input maxLength={300} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Gói phù hợp với doanh nghiệp…" /></label>
        <div className="admin-plan-input-grid">
          <label>Giá tháng (đ)<MoneyInput value={isFreePlan ? "0" : draft.monthlyPrice} onChange={(monthlyPrice) => setDraft({ ...draft, monthlyPrice })} placeholder="Để trống = báo giá riêng" disabled={isFreePlan || isContactPlan} /><small>Để trống nếu giá theo thỏa thuận.</small></label>
          <label>Lượt báo giá / tháng<input type="number" min="1" step="1" value={draft.quoteLimit} onChange={(event) => setDraft({ ...draft, quoteLimit: event.target.value })} placeholder="Để trống = theo nhu cầu" /><small>Để trống nếu không đặt hạn mức cố định.</small></label>
          <label>Lượt dùng AI / tháng<input type="number" min="1" step="1" value={draft.aiLimit} onChange={(event) => setDraft({ ...draft, aiLimit: event.target.value })} placeholder="Để trống = không giới hạn" /><small>Mỗi lần phân tích, đề xuất hoặc tính lại trừ 1 lượt.</small></label>
          <label>Số mẫu báo giá<input type="number" min="1" step="1" value={draft.templateLimit} onChange={(event) => setDraft({ ...draft, templateLimit: event.target.value })} placeholder="Để trống = theo nhu cầu" /><small>Số mẫu đang sử dụng của doanh nghiệp.</small></label>
          <label>Thứ tự hiển thị<input type="number" min="0" step="1" value={draft.displayOrder} onChange={(event) => setDraft({ ...draft, displayOrder: event.target.value })} /></label>
        </div>
        <div className="admin-plan-options"><label className="admin-plan-checkbox"><input type="checkbox" checked={draft.active} disabled={isFreePlan || isContactPlan} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span>Hiển thị và cho phép gán gói</span></label><label className="admin-plan-checkbox"><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft({ ...draft, featured: event.target.checked })} /><span>Đánh dấu gói nổi bật trên landing page</span></label></div>
        {isFreePlan && <p className="admin-account-note"><AdminIcon name="shield" size={16} /> Gói Dùng thử luôn được miễn phí và không thể ẩn.</p>}
        {isContactPlan && <p className="admin-account-note"><AdminIcon name="shield" size={16} /> Gói Liên hệ luôn hiển thị trên landing page và giữ giá theo thỏa thuận.</p>}
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Hủy</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : plan ? "Lưu gói" : "Tạo gói"}</button></div>
      </form>
    </section>
  </div>;
}

function PasswordDialog({ user, onClose, onSaved, confirm }: { user: ManagedUser; onClose: () => void; onSaved: () => void; confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const [password, setPassword] = useState("");
  const notify = useAppNotification();
  const setError = (message: string) => { if (message) notify(message, "error"); };
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
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">Bảo mật tài khoản</span><h2 id="password-dialog-title">Đặt lại mật khẩu</h2></div><button className="admin-icon-button" onClick={onClose} aria-label="Đóng"><AdminIcon name="close" /></button></div>
      <p className="admin-password-user">{user.name}<small>{user.email}</small></p>
      <form className="admin-account-form" onSubmit={(event) => void submit(event)}>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={7} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ít nhất 7 ký tự" required /><small>Mật khẩu phải có từ 7 đến 200 ký tự.</small></label>
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={onClose}>Hủy</button><button className="admin-button admin-button-primary" disabled={busy}>{busy && <span className="admin-spinner admin-spinner-light" />}{busy ? "Đang lưu…" : "Cập nhật mật khẩu"}</button></div>
      </form>
    </section>
  </div>;
}
