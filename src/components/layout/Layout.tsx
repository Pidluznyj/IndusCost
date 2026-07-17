import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { SidebarLayoutProvider, useSidebarLayout } from "@/src/contexts/SidebarLayoutContext";
import { evaluatePathViewAccess, navigationAccessContextFromAuth } from "@/src/lib/resourceNavigationAccess";
import { AccessDenied } from "@/src/components/AccessDenied";
import { AppHeaderBar } from "@/src/components/layout/AppHeaderBar";
import { fetchJsonOk } from "@/src/lib/http";
import {
  resolveNextNomusRunAt,
  type HeaderSyncStatus,
} from "@/src/lib/appHeaderStatus";
import { Loader2 } from "lucide-react";

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
  const { authUser, permissionsChangedNotice, clearPermissionsChangedNotice } = auth;
  const location = useLocation();
  const [lastSyncAt, setLastSyncAt] = React.useState<string>("—");
  const [lastSyncStatus, setLastSyncStatus] = React.useState<HeaderSyncStatus>("—");

  const pathView = evaluatePathViewAccess(
    location.pathname,
    navigationAccessContextFromAuth(auth)
  );
  const currentModuleId = pathView.moduleId;
  const moduleAccessAllowed = pathView.allowed;
  const pathLoading = pathView.reason === "loading";

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
          {permissionsChangedNotice ? (
            <div
              className="mx-auto mb-4 flex max-w-7xl items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              role="status"
              data-testid="permissions-changed-notice"
            >
              <p>{permissionsChangedNotice}</p>
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                onClick={clearPermissionsChangedNotice}
              >
                Entendi
              </button>
            </div>
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="max-w-7xl mx-auto w-full"
            >
              {pathLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Verificando acesso…</p>
                </div>
              ) : moduleAccessAllowed ? (
                <Outlet />
              ) : (
                <AccessDenied
                  moduleId={currentModuleId ?? undefined}
                  intendedPath={pathView.intendedPath ?? location.pathname}
                  reason={pathView.reason}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
