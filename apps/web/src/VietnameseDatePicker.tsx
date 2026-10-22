import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./vietnamese-date-picker.css";

interface Props {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const weekdays = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"];
const shortWeekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string) {
  const date = parseDate(value);
  return date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}` : "Chọn ngày";
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>;
}

function Chevron({ direction, double = false }: { direction: "left" | "right"; double?: boolean }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />{double && <path d={direction === "left" ? "m19 6-6 6 6 6" : "m5 6 6 6-6 6"} />}</svg>;
}

export default function VietnameseDatePicker({ id, label, value, onChange, disabled = false, className = "" }: Props) {
  const generatedId = useId();
  const popupId = `${generatedId}-calendar`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const date = parseDate(value) ?? new Date(); return { year: date.getFullYear(), month: date.getMonth() }; });
  const [position, setPosition] = useState({ top: 0, left: 0, width: 312 });
  const today = dateKey(new Date());
  const start = new Date(view.year, view.month, 1);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(312, window.innerWidth - 16);
      const menuHeight = 390;
      const above = window.innerHeight - bounds.bottom < menuHeight + 8 && bounds.top > menuHeight + 8;
      setPosition({
        top: Math.max(8, Math.min(above ? bounds.top - menuHeight - 6 : bounds.bottom + 6, window.innerHeight - menuHeight - 8)),
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        width,
      });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    reposition();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, view.year, view.month]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const target = popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${value || today}"]`)
        ?? popupRef.current?.querySelector<HTMLButtonElement>('.vi-date-days button:not(.is-outside)');
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const key = pendingFocus.current;
    pendingFocus.current = null;
    popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus();
  }, [open, view.year, view.month]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const toggle = () => {
    if (!open) {
      const selected = parseDate(value) ?? new Date();
      setView({ year: selected.getFullYear(), month: selected.getMonth() });
    }
    setOpen((current) => !current);
  };
  const shiftMonth = (amount: number) => {
    const next = new Date(view.year, view.month + amount, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  };
  const choose = (date: Date) => { onChange(dateKey(date)); setOpen(false); triggerRef.current?.focus(); };
  const moveDay = (date: Date, offset: number) => {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    pendingFocus.current = dateKey(next);
    setView({ year: next.getFullYear(), month: next.getMonth() });
    requestAnimationFrame(() => { popupRef.current?.querySelector<HTMLButtonElement>(`[data-date="${dateKey(next)}"]`)?.focus(); });
  };
  const portalTarget = rootRef.current?.closest("dialog") ?? document.body;

  return <div className={`vi-date-picker ${open ? "is-open" : ""} ${className}`} ref={rootRef}>
    <button
      ref={triggerRef}
      id={id}
      type="button"
      className="vi-date-trigger"
      aria-label={`${label}: ${value ? displayDate(value) : "Chưa chọn"}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popupId : undefined}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); toggle(); } }}
    ><span className={value ? "" : "is-placeholder"}>{displayDate(value)}</span><CalendarIcon /></button>
    {open && createPortal(<div
      id={popupId}
      ref={popupRef}
      className="vi-date-popup"
      role="dialog"
      aria-label={`Chọn ngày: ${label}`}
      style={{ top: position.top, left: position.left, width: position.width }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
        if (event.key === "Tab") setOpen(false);
      }}
    >
      <div className="vi-date-header">
        <button type="button" aria-label="Năm trước" onClick={() => shiftMonth(-12)}><Chevron direction="left" double /></button>
        <button type="button" aria-label="Tháng trước" onClick={() => shiftMonth(-1)}><Chevron direction="left" /></button>
        <strong>Tháng {view.month + 1} năm {view.year}</strong>
        <button type="button" aria-label="Tháng sau" onClick={() => shiftMonth(1)}><Chevron direction="right" /></button>
        <button type="button" aria-label="Năm sau" onClick={() => shiftMonth(12)}><Chevron direction="right" double /></button>
      </div>
      <div className="vi-date-weekdays">{shortWeekdays.map((day, index) => <span key={day} title={weekdays[index]}>{day}</span>)}</div>
      <div className="vi-date-days">{days.map((date) => {
        const key = dateKey(date);
        return <button
          key={key}
          type="button"
          data-date={key}
          className={`${date.getMonth() !== view.month ? "is-outside" : ""} ${key === today ? "is-today" : ""} ${key === value ? "is-selected" : ""}`}
          aria-label={`${weekdays[(date.getDay() + 6) % 7]}, ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`}
          aria-pressed={key === value}
          onClick={() => choose(date)}
          onKeyDown={(event) => {
            const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (event.key in offsets) { event.preventDefault(); moveDay(date, offsets[event.key]); }
          }}
        >{date.getDate()}</button>;
      })}</div>
      <div className="vi-date-footer">
        <button type="button" onClick={() => { onChange(""); setOpen(false); triggerRef.current?.focus(); }}>Xóa ngày</button>
        <button type="button" onClick={() => choose(new Date())}>Hôm nay</button>
      </div>
    </div>, portalTarget)}
  </div>;
}
