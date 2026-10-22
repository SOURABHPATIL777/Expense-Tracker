"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import { api } from "@/frontend/lib/apiClient";
import { NAV_SECTIONS } from "@/frontend/lib/navigation";
import { useApi } from "@/frontend/hooks/useApi";
import { Button } from "@/frontend/components/Button/Button";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import type { MeDto } from "@/shared/schemas/auth";
import styles from "./AppShell.module.css";

/** Pure nav markup; `activePath` is null in the static fallback rendered before the URL is known. */
function NavList({ activePath, onNavigate }: { activePath: string | null; onNavigate?: () => void }) {
  const isActive = (href: string) => activePath !== null && (activePath === href || activePath.startsWith(`${href}/`));
  return (
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
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Reads the URL, so it must render inside a Suspense boundary under Cache Components. */
function CurrentNav({ onNavigate }: { onNavigate: () => void }) {
  return <NavList activePath={usePathname()} onNavigate={onNavigate} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: me } = useApi<MeDto>(API_ROUTES.auth.me);

  async function logout() {
    await api.post(API_ROUTES.auth.logout).catch(() => undefined);
    router.replace(PAGE_ROUTES.login);
  }

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
        <Suspense fallback={<NavList activePath={null} />}>
          <CurrentNav onNavigate={() => setMenuOpen(false)} />
        </Suspense>
        <div className={styles.account}>
          <span className={styles.email} title={me?.email ?? undefined}>
            {me?.displayName ?? me?.email ?? " "}
          </span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className={styles.main}>
        {/* Pages read params/search params; the shell above stays static and renders instantly. */}
        <Suspense fallback={<Skeleton lines={6} />}>{children}</Suspense>
      </main>
    </div>
  );
}

