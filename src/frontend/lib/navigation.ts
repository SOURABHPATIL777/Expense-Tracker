import type { IconName } from "@/frontend/components/Icon/Icon";
import { PAGE_ROUTES } from "@/shared/constants/routes";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavSection = { title: string; items: NavItem[] };

const DASHBOARD: NavItem = { href: PAGE_ROUTES.dashboard, label: "Home", icon: "home" };
const TRANSACTIONS: NavItem = { href: PAGE_ROUTES.transactions, label: "Transactions", icon: "list" };
const IMPORTS: NavItem = { href: PAGE_ROUTES.imports, label: "Import", icon: "upload" };
const SPLITS: NavItem = { href: PAGE_ROUTES.splits, label: "Splits", icon: "users" };
const REVIEW: NavItem = { href: PAGE_ROUTES.review, label: "Needs review", icon: "check" };
const REFUNDS: NavItem = { href: PAGE_ROUTES.refunds, label: "Refunds expected", icon: "refund" };
const CATEGORIES: NavItem = { href: PAGE_ROUTES.categories, label: "Categories", icon: "tag" };
const RULES: NavItem = { href: PAGE_ROUTES.rules, label: "Rules", icon: "sliders" };
const ACCOUNTS: NavItem = { href: PAGE_ROUTES.settingsAccounts, label: "Accounts & UPI IDs", icon: "wallet" };

/** Sidebar (desktop). */
export const NAV_SECTIONS: NavSection[] = [
  { title: "Overview", items: [DASHBOARD, TRANSACTIONS, REVIEW] },
  { title: "Money owed", items: [SPLITS, REFUNDS] },
  { title: "Data", items: [{ ...IMPORTS, label: "Imports" }, CATEGORIES, RULES] },
  { title: "Settings", items: [ACCOUNTS] },
];

/** Bottom tab bar (mobile): four tabs around a raised Import button, then "More". */
export const TAB_ITEMS: { left: NavItem[]; primary: NavItem; right: NavItem[] } = {
  left: [DASHBOARD, TRANSACTIONS],
  primary: IMPORTS,
  right: [SPLITS],
};

/** Everything not on the tab bar, shown in the mobile "More" sheet. */
export const MORE_ITEMS: NavItem[] = [REVIEW, REFUNDS, CATEGORIES, RULES, ACCOUNTS];
