import React from "react";
import { Activity, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { MarketHeaderTicker } from "@/src/components/layout/MarketHeaderTicker";
import {
  formatHeaderNextNomusRunFull,
  type HeaderSyncStatus,
} from "@/src/lib/appHeaderStatus";

export type AppHeaderStatusMenuProps = {
  lastSyncAt: string;
  statusLabel: string;
  statusClass: string;
  nextNomusRun: string;
  syncStatus: HeaderSyncStatus;
  userName?: string | null;
  userRoleLabel?: string | null;
  showMarketTicker?: boolean;
};

/**
 * Agrupa indicadores/status do header para telas menores (toque/clique, sem hover).
 */
export function AppHeaderStatusMenu({
  lastSyncAt,
  statusLabel,
  statusClass,
  nextNomusRun,
  userName,
  userRoleLabel,
  showMarketTicker = true,
}: AppHeaderStatusMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0" data-header-status-menu="true">
      <button
        type="button"
        aria-label="Abrir indicadores e status do sistema"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="app-header-status-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-foreground shadow-sm",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          open && "bg-accent"
        )}
      >
        <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden xs:inline text-xs font-medium sm:inline">Status</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Indicadores e status do sistema"
          data-testid="app-header-status-menu-panel"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-card p-3 shadow-xl",
            "flex flex-col gap-3"
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
            <p className="text-sm font-semibold text-foreground">Indicadores</p>
            <button
              type="button"
              aria-label="Fechar indicadores"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {showMarketTicker ? (
            <div className="flex flex-wrap gap-2" data-header-status-tickers="true">
              <MarketHeaderTicker layout="stack" />
            </div>
          ) : null}

          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-accent/40 px-3 py-2">
            <div className="h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
            <span className="text-xs font-medium text-foreground">Sistema Online</span>
          </div>

          <div className="space-y-1.5 text-[12px] leading-snug text-muted-foreground">
            <p>
              Última sincronia com o Nomus:{" "}
              <span className="font-medium text-foreground">{lastSyncAt}</span>{" "}
              <span className={cn("font-semibold", statusClass)}>({statusLabel})</span>
            </p>
            <p>{formatHeaderNextNomusRunFull(nextNomusRun)}</p>
          </div>

          {userName ? (
            <div className="border-t border-border/70 pt-2">
              <p className="truncate text-xs font-semibold text-foreground">{userName}</p>
              {userRoleLabel ? (
                <p className="truncate text-[10px] text-muted-foreground">{userRoleLabel}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
