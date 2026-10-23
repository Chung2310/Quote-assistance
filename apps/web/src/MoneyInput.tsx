import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import "./money-input.css";

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  currency?: string;
};

function formatValue(value: string) {
  if (!value) return "";
  const [integer, decimal] = value.split(".");
  const grouped = (integer || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal === undefined ? grouped : `${grouped},${decimal}`;
}

function parseValue(value: string) {
  const clean = value.replace(/[^\d.,]/g, "");
  const comma = clean.indexOf(",");
  const integer = (comma < 0 ? clean : clean.slice(0, comma)).replace(/\./g, "");
  const decimal = comma < 0 ? "" : clean.slice(comma + 1).replace(/\D/g, "");
  return comma < 0 ? integer : `${integer || "0"}.${decimal}`;
}

export default function MoneyInput({ value, onChange, currency = "VND", className, ...props }: MoneyInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<{ digits: number; fraction: boolean } | null>(null);
  const displayed = formatValue(value);

  useLayoutEffect(() => {
    if (!pendingCaret.current || !input.current || document.activeElement !== input.current) return;
    const { digits, fraction } = pendingCaret.current;
    pendingCaret.current = null;
    let position = 0;
    let seen = 0;
    while (position < displayed.length && seen < digits) {
      if (/\d/.test(displayed[position])) seen++;
      position++;
    }
    if (fraction && displayed.includes(",")) position = Math.max(position, displayed.indexOf(",") + 1);
    input.current.setSelectionRange(position, position);
  }, [displayed]);

  return <span className="money-input">
    <input
      {...props}
      ref={input}
      className={className}
      type="text"
      inputMode="decimal"
      value={displayed}
      onChange={(event) => {
        const beforeCaret = event.target.value.slice(0, event.target.selectionStart ?? 0);
        pendingCaret.current = { digits: (beforeCaret.match(/\d/g) ?? []).length, fraction: beforeCaret.includes(",") };
        onChange(parseValue(event.target.value));
      }}
    />
    <span className="money-input-currency" aria-hidden="true">{currency.toUpperCase() === "VND" ? "₫" : currency.toUpperCase()}</span>
  </span>;
}
