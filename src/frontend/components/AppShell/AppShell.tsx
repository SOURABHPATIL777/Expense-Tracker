"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { cx } from "@/frontend/lib/cx";
import { api } from "@/frontend/lib/apiClient";
import { MORE_ITEMS, NAV_SECTIONS, TAB_ITEMS, type NavItem } from "@/frontend/lib/navigation";
import { useApi } from "@/frontend/hooks/useApi";
import { Icon } from "@/frontend/components/Icon/Icon";
import { Modal } from "@/frontend/components/Modal/Modal";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { ProcessingPill } from "@/frontend/components/ProcessingPill/ProcessingPill";
import { useActiveImports } from "@/frontend/hooks/useActiveImports";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import type { MeDto } from "@/shared/schemas/auth";
import styles from "./AppShell.module.css";

const isActive = (path: string | null, href: string) => path !== null && (path === href || path.startsWith(`${href}/`));

function PathReader({ render }: { render: (path: string | null) => ReactNode }) {
  return render(usePathname());
}

/**
 * Renders `render(currentPath)`. Reading the URL must happen inside a Suspense boundary under
 * Cache Components, so the static fallback renders with no active item until the path is known.
 */
function WithPath({ render }: { render: (path: string | null) => ReactNode }) {
  return (
    <Suspense fallback={render(null)}>
      <PathReader render={render} />
    </Suspense>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link href={PAGE_ROUTES.dashboard} className={cx(styles.brand, className)}>
      <span className={styles.logo} aria-hidden>
        ₹
      </span>
      UPI Spend
    </Link>
  );
}

function SideNav({ path }: { path: string | null }) {
  return (
    <nav className={styles.nav} aria-label="Main">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className={styles.section}>
          <span className={styles.sectionTitle}>{section.title}</span>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(styles.link, isActive(path, item.href) && styles.active)}
              aria-current={isActive(path, item.href) ? "page" : undefined}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Tab({ item, path }: { item: NavItem; path: string | null }) {
  const active = isActive(path, item.href);
  return (
    <Link href={item.href} className={cx(styles.tab, active && styles.tabActive)} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} size={22} />
      <span>{item.label}</span>
    </Link>
  );
}

function TabBar({ path, onMore }: { path: string | null; onMore: () => void }) {
  const moreActive = MORE_ITEMS.some((i) => isActive(path, i.href));
  return (
    <nav className={styles.tabbar} aria-label="Main">
      {TAB_ITEMS.left.map((item) => (
        <Tab key={item.href} item={item} path={path} />
      ))}
      <Link href={TAB_ITEMS.primary.href} className={styles.fab} aria-label="Import statements">
        <Icon name="plus" size={26} />
      </Link>
      {TAB_ITEMS.right.map((item) => (
        <Tab key={item.href} item={item} path={path} />
      ))}
      <button type="button" className={cx(styles.tab, moreActive && styles.tabActive)} onClick={onMore} aria-haspopup="dialog">
        <Icon name="grid" size={22} />
        <span>More</span>
      </button>
    </nav>
  );
}

function initials(me: MeDto | undefined) {
  const source = me?.displayName ?? me?.email ?? "";
  return source.trim().charAt(0).toUpperCase() || "•";
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: me } = useApi<MeDto>(API_ROUTES.auth.me);
  const activeImports = useActiveImports();

  async function logout() {
    await api.post(API_ROUTES.auth.logout).catch(() => undefined);
    router.replace(PAGE_ROUTES.login);
  }

  const account = (
    <div className={styles.account}>
      <span className={styles.avatar} aria-hidden>
        {initials(me)}
      </span>
      <span className={styles.who}>
        <strong>{me?.displayName ?? "Your account"}</strong>
        <span title={me?.email ?? undefined}>{me?.email ?? " "}</span>
      </span>
      <button type="button" className={styles.iconButton} onClick={logout} aria-label="Sign out" title="Sign out">
        <Icon name="logout" size={18} />
      </button>
    </div>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Brand className={styles.sidebarBrand} />
        <ProcessingPill imports={activeImports} />
        <WithPath render={(path) => <SideNav path={path} />} />
        {account}
      </aside>

      <header className={styles.topbar}>
        <Brand />
        <ProcessingPill imports={activeImports} className={styles.topPill} />
        <button type="button" className={styles.avatarButton} onClick={() => setMoreOpen(true)} aria-label="Account and more">
          {initials(me)}
        </button>
      </header>

      <main className={styles.main}>
        {/* Pages read params/search params; the shell above stays static and renders instantly. */}
        <Suspense fallback={<Skeleton lines={6} />}>{children}</Suspense>
      </main>

      <WithPath render={(path) => <TabBar path={path} onMore={() => setMoreOpen(true)} />} />

      <Modal open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <div className={styles.sheet}>
          <WithPath
            render={(path) => (
              <ul className={styles.moreList}>
                {MORE_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={cx(styles.moreLink, isActive(path, item.href) && styles.active)} onClick={() => setMoreOpen(false)}>
                      <span className={styles.moreIcon}>
                        <Icon name={item.icon} size={20} />
                      </span>
                      {item.label}
                      <Icon name="chevronRight" size={18} className={styles.chevron} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          />
          {account}
        </div>
      </Modal>
    </div>
  );
}
