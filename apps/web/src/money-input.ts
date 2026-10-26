import type { ChangeEvent } from "react";

export function formatVndInputValue(value: number) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function parseVndInputValue(value: string) {
  return Number(value.replace(/\D/g, "")) || 0;
}

export function updateVndInput(event: ChangeEvent<HTMLInputElement>, setValue: (value: string) => void) {
  const input = event.currentTarget;
  const raw = input.value;
  const digitsBeforeCursor = raw.slice(0, input.selectionStart ?? raw.length).replace(/\D/g, "").length;
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return;
  const formatted = digits ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(digits)) : "";
  setValue(formatted);
  requestAnimationFrame(() => {
    if (!input || document.activeElement !== input) return;
    let cursor = 0;
    let count = 0;
    while (cursor < formatted.length && count < digitsBeforeCursor) {
      if (/\d/.test(formatted[cursor])) count += 1;
      cursor += 1;
    }
    input.setSelectionRange(cursor, cursor);
  });
}
