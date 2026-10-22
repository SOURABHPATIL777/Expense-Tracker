import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type CommonProps = { variant?: Variant; size?: Size; loading?: boolean; children: ReactNode; className?: string };

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

const classesFor = ({ variant = "primary", size = "md", className }: Pick<CommonProps, "variant" | "size" | "className">) =>
  cx(styles.button, styles[variant], styles[size], className);

export function Button({ variant, size, loading, children, className, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={classesFor({ variant, size, className })} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden />}
      {children}
    </button>
  );
}

/** Link styled as a button (navigation, not actions). */
export function ButtonLink({ href, variant, size, className, children }: CommonProps & { href: string }) {
  return (
    <Link href={href} className={classesFor({ variant, size, className })}>
      {children}
    </Link>
  );
}
