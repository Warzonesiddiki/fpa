import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Surface card (DESIGN-SYSTEM surfaces). */
export function Card({ title, actions, children, className = "", ...rest }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-[var(--color-oneborder)] bg-[var(--color-onesurface)] p-4 shadow-sm ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-[var(--color-onetext)]">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
