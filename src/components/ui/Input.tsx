import type { InputHTMLAttributes, ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  errorText?: string;
  leading?: ReactNode;
}

/** Labelled input with hint/error text; error never conveyed by color alone (a11y §5). */
export function Input({
  label,
  hint,
  errorText,
  leading,
  id,
  className = "",
  ...rest
}: InputProps) {
  const inputId = id ?? `input-${label?.toLowerCase().replace(/\s+/g, "-") ?? "field"}`;
  const describedBy = hint || errorText ? `${inputId}-desc` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--color-onetextsecondary)]"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leading && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-onetextmuted)]"
          >
            {leading}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy}
          className={`h-10 w-full rounded-md border bg-[var(--color-onesurface)] px-3 text-sm text-[var(--color-onetext)] placeholder:text-[var(--color-onetextmuted)] ${
            leading ? "pl-9" : ""
          } ${errorText ? "border-[var(--color-onerror)]" : "border-[var(--color-oneborder)]"} ${className}`}
          {...rest}
        />
      </div>
      {(hint || errorText) && (
        <p
          id={describedBy}
          className={`text-xs ${errorText ? "text-[var(--color-onerror)]" : "text-[var(--color-onetextmuted)]"}`}
        >
          {errorText ?? hint}
        </p>
      )}
    </div>
  );
}
