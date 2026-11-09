import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { aiProgress } from "./ai-progress";
import "./ai-progress.css";

export default function AiProgressPopup() {
  const tasks = useSyncExternalStore(aiProgress.subscribe, aiProgress.getSnapshot, aiProgress.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const visible = tasks.length > 0;
  const running = tasks.some((task) => task.status === "running");

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (visible && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      element.focus();
    } else if (!visible && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    }
  }, [visible]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(aiProgress.tick, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => () => { if (dialog.current?.open) dialog.current.close?.(); }, []);
  const dismiss = () => tasks.forEach((task) => aiProgress.dismiss(task.id));

  return createPortal(<dialog ref={dialog} className="ai-progress-dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
    onCancel={(event) => { event.preventDefault(); if (!running) dismiss(); }}>
    <div className="ai-progress-popup-heading">
      <span className={`ai-progress-popup-icon${running ? " is-running" : ""}`} aria-hidden="true">{running ? "" : tasks.some((task) => task.status === "failed") ? "!" : "✓"}</span>
      <div><h2 id={titleId}>{running ? "Đang xử lý yêu cầu" : tasks.some((task) => task.status === "failed") ? "Chưa hoàn tất yêu cầu" : "Đã hoàn tất"}</h2>
        <p>{running ? "Bạn có thể theo dõi tiến độ bên dưới." : tasks.some((task) => task.status === "failed") ? "Đóng thông báo để kiểm tra và thử lại." : "Kết quả đã sẵn sàng."}</p></div>
    </div>
    <div className="ai-progress-popup-tasks" aria-busy={running}>
      {tasks.map((task) => <section key={task.id} className={`ai-progress-popup-task is-${task.status}`}>
        <div className="ai-progress-popup-label"><strong>{task.label}</strong><span>{task.progress}%</span></div>
        <div className="ai-progress-popup-track" role="progressbar" aria-label={task.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}
          aria-valuetext={`${task.progress}%${task.estimated ? " — tiến độ ước tính" : ""}`}><span style={{ width: `${task.progress}%` }} /></div>
        <p role={task.status === "failed" ? "alert" : "status"}>{task.detail}</p>
      </section>)}
    </div>
    {running && <small className="ai-progress-popup-hint">Tiến độ ước tính trong lúc xử lý; 100% khi có kết quả thành công.</small>}
    {!running && tasks.some((task) => task.status === "failed") && <button type="button" className="button button-primary ai-progress-popup-close" onClick={dismiss}>Đóng</button>}
  </dialog>, document.body);
}
