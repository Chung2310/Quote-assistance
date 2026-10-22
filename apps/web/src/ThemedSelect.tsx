import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./themed-select.css";

type Option = { value: string; label: string };

interface Props {
  id?: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function ThemedSelect({ id, label, value, options, onChange, disabled = false, className = "" }: Props) {
  const generatedId = useId();
  const listId = `${generatedId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 300 });
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const maxHeight = Math.min(300, Math.floor(window.innerHeight * 0.5));
      const menuHeight = Math.min(options.length * 42 + 12, maxHeight);
      const width = Math.min(Math.max(bounds.width, 220), window.innerWidth - 16);
      const above = window.innerHeight - bounds.bottom < menuHeight + 8 && bounds.top > menuHeight + 8;
      setPosition({
        top: above ? bounds.top - menuHeight - 6 : bounds.bottom + 6,
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        width,
        maxHeight,
      });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    requestAnimationFrame(() => {
      (menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const moveFocus = (key: string) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = key === "Home" ? 0 : key === "End" ? items.length - 1 :
      (current + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <div className={`theme-select ${open ? "is-open" : ""} ${className}`} ref={rootRef}>
    <button
      ref={triggerRef}
      id={id}
      type="button"
      className="theme-select-trigger"
      aria-label={`${label}: ${selected?.label ?? ""}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled || options.length === 0}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (open) moveFocus(event.key);
          else setOpen(true);
        }
      }}
    ><span>{selected?.label ?? ""}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
    {open && createPortal(<div
      id={listId}
      ref={menuRef}
      role="listbox"
      aria-label={label}
      className="theme-select-menu"
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); moveFocus(event.key); }
        if (event.key === "Tab") setOpen(false);
      }}
    >{options.map((option) => <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={option.value === value}
      onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
    ><span>{option.label}</span>{option.value === value && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}</button>)}</div>, document.body)}
  </div>;
}
