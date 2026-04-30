import React from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "motion/react";

type HeaderSyncLog = {
  status?: "SUCCESS" | "FAILED" | "UNKNOWN" | "SKIPPED";
  finishedAt?: string | null;
  modifiedAt?: string;
};

export const Layout = () => {
  const [lastSyncAt, setLastSyncAt] = React.useState<string>("—");
  const [lastSyncStatus, setLastSyncStatus] = React.useState<"SUCCESS" | "FAILED" | "UNKNOWN" | "SKIPPED" | "—">("—");

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/settings/nomus-sync/logs?limit=1&target=sales-orders&mode=all&kind=all");
        if (!res.ok) {
          if (!cancelled) {
            setLastSyncAt("—");
            setLastSyncStatus("UNKNOWN");
          }
          return;
        }
        const rows = (await res.json()) as HeaderSyncLog[];
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
      <Sidebar />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-card/50 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/50 border border-border">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Sistema Online</span>
            </div>
            <div className="text-[11px] leading-tight text-muted-foreground text-right hidden md:block">
              <p>
                Última atualização: <span className="font-medium text-foreground">{lastSyncAt}</span>{" "}
                <span className={`font-semibold ${statusClass}`}>({statusLabel})</span>
              </p>
              <p>
                Próxima prevista: <span className="font-medium text-foreground">{nextNomusRun}</span>
              </p>
            </div>
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">PA</span>
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
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};
