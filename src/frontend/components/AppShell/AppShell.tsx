"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import { api } from "@/frontend/lib/apiClient";
import { NAV_SECTIONS } from "@/frontend/lib/navigation";
import { useApi } from "@/frontend/hooks/useApi";
import { Button } from "@/frontend/components/Button/Button";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import type { MeDto } from "@/shared/schemas/auth";
import styles from "./AppShell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: me } = useApi<MeDto>(API_ROUTES.auth.me);

  async function logout() {
    await api.post(API_ROUTES.auth.logout).catch(() => undefined);
    router.replace(PAGE_ROUTES.login);
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href={PAGE_ROUTES.dashboard} className={styles.brand}>
          UPI Spend
        </Link>
        <button type="button" className={styles.menuButton} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          Menu
        </button>
      </header>

      <aside className={cx(styles.sidebar, menuOpen && styles.sidebarOpen)}>
        <Link href={PAGE_ROUTES.dashboard} className={cx(styles.brand, styles.sidebarBrand)}>
          UPI Spend
        </Link>
        <nav className={styles.nav} aria-label="Main">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className={styles.section}>
              <span className={styles.sectionTitle}>{section.title}</span>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(styles.link, isActive(item.href) && styles.active)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.account}>
          <span className={styles.email} title={me?.email ?? undefined}>
            {me?.displayName ?? me?.email ?? " "}
          </span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
