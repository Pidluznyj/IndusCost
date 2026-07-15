import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { SidebarLayoutProvider, useSidebarLayout } from "@/src/contexts/SidebarLayoutContext";
import { evaluatePathViewAccess } from "@/src/lib/resourceNavigationAccess";
import { AccessDenied } from "@/src/components/AccessDenied";
import { AppHeaderBar } from "@/src/components/layout/AppHeaderBar";
import { fetchJsonOk } from "@/src/lib/http";
import {
  resolveNextNomusRunAt,
  type HeaderSyncStatus,
} from "@/src/lib/appHeaderStatus";

type HeaderSyncLog = {
  status?: "SUCCESS" | "FAILED" | "UNKNOWN" | "SKIPPED";
  finishedAt?: string | null;
  modifiedAt?: string;
};

export const Layout = () => (
  <SidebarLayoutProvider>
    <LayoutShell />
  </SidebarLayoutProvider>
);

function SidebarMobileBackdrop() {
  const { isMobile, mobileOpen, closeMobileSidebar } = useSidebarLayout();
  if (!isMobile || !mobileOpen) return null;
  return (
    <button
      type="button"
      aria-label="Fechar menu lateral"
      className="fixed inset-0 z-20 bg-black/40 lg:hidden"
      onClick={closeMobileSidebar}
    />
  );
}

function LayoutShell() {
  const { openMobileSidebar, isMobile } = useSidebarLayout();
  const auth = useAuth();
  const { authUser } = auth;
  const location = useLocation();
  const [lastSyncAt, setLastSyncAt] = React.useState<string>("—");
  const [lastSyncStatus, setLastSyncStatus] = React.useState<HeaderSyncStatus>("—");

  const pathView = evaluatePathViewAccess(location.pathname, {
    user: authUser,
    checker: auth,
  });
  const currentModuleId = pathView.moduleId;
  const moduleAccessAllowed = pathView.allowed;

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchJsonOk<HeaderSyncLog[]>(
          "/api/settings/nomus-sync/logs?limit=1&target=sales-orders&mode=all&kind=all"
        );
        const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        const stamp = first?.finishedAt || first?.modifiedAt || null;
        const date = stamp ? new Date(stamp) : null;
        if (!cancelled) {
          setLastSyncAt(date && !Number.isNaN(date.getTime()) ? date.toLocaleString("pt-BR") : "—");
          setLastSyncStatus(first?.status ?? "UNKNOWN");
        }
      } catch {
        if (!cancelled) {
          setLastSyncAt("—");
          setLastSyncStatus("UNKNOWN");
        }
      }
    };

    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const nextNomusRun = React.useMemo(
    () => resolveNextNomusRunAt().toLocaleString("pt-BR"),
    []
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans antialiased text-foreground">
      <SidebarMobileBackdrop />
      <Sidebar />

      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <AppHeaderBar
          pathname={location.pathname}
          isMobile={isMobile}
          onOpenMobileSidebar={openMobileSidebar}
          authUser={
            authUser
              ? { name: authUser.name, role: authUser.role }
              : null
          }
          lastSyncAt={lastSyncAt}
          lastSyncStatus={lastSyncStatus}
          nextNomusRun={nextNomusRun}
        />

        <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="max-w-7xl mx-auto w-full"
            >
              {moduleAccessAllowed ? (
                <Outlet />
              ) : (
                <AccessDenied moduleId={currentModuleId ?? undefined} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
