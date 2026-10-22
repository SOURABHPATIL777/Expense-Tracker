import { PAGE_ROUTES } from "@/shared/constants/routes";

export type NavItem = { href: string; label: string };
export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: PAGE_ROUTES.dashboard, label: "Dashboard" },
      { href: PAGE_ROUTES.transactions, label: "Transactions" },
      { href: PAGE_ROUTES.review, label: "Needs review" },
    ],
  },
  {
    title: "Money owed",
    items: [
      { href: PAGE_ROUTES.splits, label: "Splits" },
      { href: PAGE_ROUTES.refunds, label: "Refunds expected" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: PAGE_ROUTES.imports, label: "Imports" },
      { href: PAGE_ROUTES.categories, label: "Categories" },
      { href: PAGE_ROUTES.rules, label: "Rules" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: PAGE_ROUTES.settingsAccounts, label: "Accounts & UPI IDs" },
    ],
  },
];
