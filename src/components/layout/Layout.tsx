import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PanelLeft } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/src/contexts/AuthContext";
import { SidebarLayoutProvider, useSidebarLayout } from "@/src/contexts/SidebarLayoutContext";
import { formatRoleLabel } from "@/src/lib/appAuthClient";
import { canAccessModule, resolveModuleIdFromPath } from "@/src/lib/modulePermissions";
import { AccessDenied } from "@/src/components/AccessDenied";
import { MarketHeaderTicker } from "@/src/components/layout/MarketHeaderTicker";
import { fetchJsonOk } from "@/src/lib/http";

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

  const currentModuleId = resolveModuleIdFromPath(location.pathname);
  const moduleAccessAllowed =
    currentModuleId === null || canAccessModule(currentModuleId, auth);
  const [lastSyncStatus, setLastSyncStatus] = React.useState<"SUCCESS" | "FAILED" | "UNKNOWN" | "SKIPPED" | "—">("—");

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

  const nextNomusRun = React.useMemo(() => {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    if (now.getMinutes() < 17) {
      next.setMinutes(17);
    } else {
      next.setHours(now.getHours() + 1, 17, 0, 0);
    }
    return next.toLocaleString("pt-BR");
  }, []);

  const statusLabel =
    lastSyncStatus === "SUCCESS"
      ? "Sucesso"
      : lastSyncStatus === "FAILED"
      ? "Falha"
      : lastSyncStatus === "SKIPPED"
      ? "Ignorado"
      : lastSyncStatus === "UNKNOWN"
      ? "Indisponível"
      : "—";

  const statusClass =
    lastSyncStatus === "SUCCESS"
      ? "text-green-600"
      : lastSyncStatus === "FAILED"
      ? "text-red-600"
      : lastSyncStatus === "SKIPPED"
      ? "text-slate-600"
      : "text-amber-600";

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans antialiased text-foreground">
      <SidebarMobileBackdrop />
      <Sidebar />

      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        <header className="h-16 border-b border-border flex items-center justify-between px-4 sm:px-8 bg-card/50 backdrop-blur-sm z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {isMobile ? (
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Abrir menu lateral"
                title="Abrir menu"
                onClick={openMobileSidebar}
              >
                <PanelLeft className="h-5 w-5" />
              </button>
            ) : null}
            <h1 className="text-xl font-semibold tracking-tight truncate">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2 lg:gap-4 min-w-0">
            {authUser ? <MarketHeaderTicker /> : null}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/50 border border-border shrink-0">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Sistema Online</span>
            </div>
            <div className="text-[11px] leading-tight text-muted-foreground text-right hidden md:block">
              <p>
                Última sincronia com o Nomus: <span className="font-medium text-foreground">{lastSyncAt}</span>{" "}
                <span className={`font-semibold ${statusClass}`}>({statusLabel})</span>
              </p>
              <p>
                Próxima prevista: <span className="font-medium text-foreground">{nextNomusRun}</span>
              </p>
            </div>
            {authUser ? (
              <div className="hidden lg:block text-right max-w-[180px]">
                <p className="text-xs font-semibold text-foreground truncate">{authUser.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {formatRoleLabel(authUser.role)}
                </p>
              </div>
            ) : null}
            <div
              className="h-8 min-w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center px-2"
              title={authUser ? `${authUser.name} · ${formatRoleLabel(authUser.role)}` : undefined}
            >
              <span className="text-[10px] font-bold text-primary">
                {authUser
                  ? authUser.name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase() ?? "")
                      .join("") || "?"
                  : "—"}
              </span>
            </div>
          </div>
        </header>

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
