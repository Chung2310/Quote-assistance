import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationType = "success" | "error" | "info";
export type Notify = (message: string, type?: NotificationType) => void;
export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
};

type Notification = { id: number; message: string; type: NotificationType };

export function useNotification() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const nextId = useRef(0);
  const notify = useCallback<Notify>((message, type = "success") => {
    nextId.current += 1;
    setNotification({ id: nextId.current, message, type });
  }, []);
  const dismiss = useCallback(() => setNotification(null), []);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), notification.type === "error" ? 6000 : 3800);
    return () => window.clearTimeout(timer);
  }, [notification]);

  return { notification, notify, dismiss };
}

export function NotificationToast({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const icon = notification.type === "success" ? "✓" : notification.type === "error" ? "!" : "i";
  return <div className={`app-notification is-${notification.type}`} role={notification.type === "error" ? "alert" : "status"} aria-live={notification.type === "error" ? "assertive" : "polite"}>
    <span className="app-notification-icon" aria-hidden="true">{icon}</span>
    <span className="app-notification-message">{notification.message}</span>
    <button type="button" className="app-notification-close" aria-label="Đóng thông báo" onClick={onDismiss}>×</button>
  </div>;
}

export function useConfirmation() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
    setOptions(next);
  }), []);
  const settle = useCallback((accepted: boolean) => {
    resolveRef.current?.(accepted);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options, settle]);

  const dialog = options ? <div className="app-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}>
    <section className="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title" aria-describedby="app-confirm-message">
      <span className={`app-confirm-mark ${options.tone === "danger" ? "is-danger" : ""}`} aria-hidden="true">{options.tone === "danger" ? "!" : "?"}</span>
      <h2 id="app-confirm-title">{options.title}</h2>
      <p id="app-confirm-message">{options.message}</p>
      <div className="app-confirm-actions">
        <button type="button" autoFocus className="button button-soft" onClick={() => settle(false)}>Hủy</button>
        <button type="button" className={`button ${options.tone === "danger" ? "button-danger" : "button-primary"}`} onClick={() => settle(true)}>{options.confirmLabel ?? "Xác nhận"}</button>
      </div>
    </section>
  </div> : null;

  return { confirm, dialog };
}
