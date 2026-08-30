import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--color-oneprimary)] text-white hover:bg-[var(--color-oneprimaryhover)]",
  secondary:
    "bg-onesurface border border-[var(--color-oneborder)] hover:border-[var(--color-oneprimary)]",
  danger: "bg-[var(--color-onerror)] text-white",
  ghost: "hover:bg-[var(--color-onesurfacealt)] text-[var(--color-onetextsecondary)]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

/** Primary/ghost/danger Button. Focus ring comes from the global :focus-visible rule (a11y). */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const height = size === "sm" ? "h-8" : size === "lg" ? "h-12" : "h-10";
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${height} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
