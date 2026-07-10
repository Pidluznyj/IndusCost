import React from "react";
import { PanelLeft } from "lucide-react";
import { AppHeaderBreadcrumb } from "@/src/components/layout/AppHeaderBreadcrumb";
import { MarketHeaderTicker } from "@/src/components/layout/MarketHeaderTicker";
import { AppHeaderStatusMenu } from "@/src/components/layout/AppHeaderStatusMenu";
import { formatRoleLabel } from "@/src/lib/appAuthClient";
import {
  formatHeaderNextNomusRunCompact,
  formatHeaderNomusSyncCompact,
  formatHeaderSyncStatusLabel,
  resolveHeaderSyncStatusClass,
  type HeaderSyncStatus,
} from "@/src/lib/appHeaderStatus";
import { cn } from "@/src/lib/utils";

export type AppHeaderBarUser = {
  name: string;
  role: string;
} | null;

export type AppHeaderBarProps = {
  pathname: string;
  isMobile: boolean;
  onOpenMobileSidebar: () => void;
  authUser: AppHeaderBarUser;
  lastSyncAt: string;
  lastSyncStatus: HeaderSyncStatus;
  nextNomusRun: string;
};

function OnlineBadge({ compact }: { compact?: boolean }) {
  return (
    <div
      data-header-online-badge={compact ? "compact" : "full"}
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-border bg-accent/50 shrink-0",
        compact ? "px-2 py-1" : "px-3 py-1.5"
      )}
    >
      <div className="h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        {compact ? "Online" : "Sistema Online"}
      </span>
    </div>
  );
}

function UserAvatar({ authUser }: { authUser: AppHeaderBarUser }) {
  const initials = authUser
    ? authUser.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "?"
    : "—";

  return (
    <div
      data-header-user-avatar="true"
      className="h-9 min-h-9 min-w-9 shrink-0 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center px-2"
      title={authUser ? `${authUser.name} · ${formatRoleLabel(authUser.role)}` : undefined}
      aria-label={authUser ? `Usuário ${authUser.name}` : "Usuário"}
    >
      <span className="text-[10px] font-bold text-primary">{initials}</span>
    </div>
  );
}

/**
 * Header global responsivo por prioridade de informação.
 * Desktop: linha única com tickers/status.
 * Notebook: versões compactas.
 * Tablet/mobile: menu Status com indicadores acessíveis por toque.
 */
export function AppHeaderBar({
  pathname,
  isMobile,
  onOpenMobileSidebar,
  authUser,
  lastSyncAt,
  lastSyncStatus,
  nextNomusRun,
}: AppHeaderBarProps) {
  const statusLabel = formatHeaderSyncStatusLabel(lastSyncStatus);
  const statusClass = resolveHeaderSyncStatusClass(lastSyncStatus);
  const roleLabel = authUser ? formatRoleLabel(authUser.role) : null;
  const compactSync = formatHeaderNomusSyncCompact({ lastSyncAt, statusLabel });
  const compactNext = formatHeaderNextNomusRunCompact(nextNomusRun);

  return (
    <header
      data-app-header-bar="true"
      className={cn(
        "border-b border-border bg-card/50 backdrop-blur-sm z-10 shrink-0",
        "flex flex-col gap-0"
      )}
    >
      <div className="flex min-h-16 items-center gap-2 sm:gap-3 px-3 sm:px-6 lg:px-8 min-w-0">
        {/* Prioridade 1 — menu + contexto */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
          {isMobile ? (
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Abrir menu lateral"
              aria-expanded={false}
              title="Abrir menu"
              onClick={onOpenMobileSidebar}
            >
              <PanelLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1 overflow-hidden">
            <AppHeaderBreadcrumb pathname={pathname} />
          </div>
        </div>

        {/* Prioridade 2/3 — indicadores inline (desktop / notebook) */}
        <div className="hidden lg:flex items-center gap-2 xl:gap-3 min-w-0 shrink">
          {authUser ? (
            <div className="hidden xl:block min-w-0 shrink">
              <MarketHeaderTicker />
            </div>
          ) : null}
          {authUser ? (
            <div className="xl:hidden min-w-0 shrink">
              <MarketHeaderTicker layout="compact" />
            </div>
          ) : null}

          <div className="hidden xl:block">
            <OnlineBadge />
          </div>
          <div className="xl:hidden">
            <OnlineBadge compact />
          </div>

          {/* Nomus — texto completo só em telas bem largas */}
          <div
            data-header-nomus-sync="full"
            className="hidden 2xl:block text-[11px] leading-tight text-muted-foreground text-right max-w-[220px] min-w-0"
          >
            <p className="truncate">
              Última sincronia com o Nomus:{" "}
              <span className="font-medium text-foreground">{lastSyncAt}</span>{" "}
              <span className={cn("font-semibold", statusClass)}>({statusLabel})</span>
            </p>
            <p className="truncate">
              Próxima prevista: <span className="font-medium text-foreground">{nextNomusRun}</span>
            </p>
          </div>

          {/* Nomus compacto em lg–2xl */}
          <div
            data-header-nomus-sync="compact"
            className="hidden lg:block 2xl:hidden text-[11px] leading-tight text-muted-foreground text-right max-w-[148px] min-w-0"
            title={`Última sincronia com o Nomus: ${lastSyncAt} (${statusLabel}). ${compactNext}`}
          >
            <p className="truncate">
              <span className="font-medium text-foreground">{compactSync}</span>
            </p>
            <p className="truncate text-muted-foreground/80">{compactNext}</p>
          </div>
        </div>

        {/* Prioridade 4 — menu Status em &lt; lg (iPad/celular) */}
        <div className="lg:hidden shrink-0">
          <AppHeaderStatusMenu
            lastSyncAt={lastSyncAt}
            statusLabel={statusLabel}
            statusClass={statusClass}
            nextNomusRun={nextNomusRun}
            syncStatus={lastSyncStatus}
            userName={authUser?.name}
            userRoleLabel={roleLabel}
            showMarketTicker={Boolean(authUser)}
          />
        </div>

        {/* Prioridade 1 — usuário */}
        {authUser ? (
          <div className="hidden xl:block text-right max-w-[140px] min-w-0 shrink">
            <p className="text-xs font-semibold text-foreground truncate">{authUser.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{roleLabel}</p>
          </div>
        ) : null}
        <UserAvatar authUser={authUser} />
      </div>
    </header>
  );
}
