import { AppShell } from "@/frontend/components/AppShell/AppShell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
