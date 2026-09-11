import React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  CalendarClock,
  CheckCircle2,
  MinusCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { formatCrmReportsInteger } from "@/src/lib/commercial/crmReportsFormat";
import {
  CRM_REPORTS_CARDS,
  type CrmReportsCardKey,
  type CrmReportsCardTone,
} from "@/src/lib/commercial/crmReportsUiState";
import type {
  CrmReportsIndicators,
  CrmReportsSelectionInfo,
  CrmReportsUniverse,
} from "@/src/lib/commercial/crmReportsTypes";

const TONE: Record<CrmReportsCardTone, { icon: LucideIcon; accent: string; iconBox: string }> = {
  positive: { icon: CheckCircle2, accent: "before:bg-emerald-500", iconBox: "bg-emerald-50 text-emerald-700" },
  info: { icon: CalendarClock, accent: "before:bg-sky-500", iconBox: "bg-sky-50 text-sky-700" },
  warning: { icon: AlertTriangle, accent: "before:bg-amber-500", iconBox: "bg-amber-50 text-amber-700" },
  danger: { icon: AlertOctagon, accent: "before:bg-red-500", iconBox: "bg-red-50 text-red-700" },
  muted: { icon: MinusCircle, accent: "before:bg-slate-400", iconBox: "bg-slate-100 text-slate-600" },
};

export type CrmReportsSummaryCardsProps = {
  /** Números do backend (`indicators`) — a UI não conta linhas. */
  indicators: CrmReportsIndicators;
  refreshing: boolean;
  active: ReadonlySet<CrmReportsCardKey>;
  onSelect: (key: CrmReportsCardKey) => void;
};

/** Cinco cards clicáveis: cada um só seleciona a visão da lista correspondente. */
export function CrmReportsSummaryCards({ indicators, refreshing, active, onSelect }: CrmReportsSummaryCardsProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
      role="list"
      aria-label="Indicadores de recompra"
      data-testid="crm-reports-cards"
    >
      {CRM_REPORTS_CARDS.map((card) => {
        const tone = TONE[card.tone];
        const Icon = tone.icon;
        const isActive = active.has(card.key);
        return (
          <button
            key={card.key}
            type="button"
            role="listitem"
            onClick={() => onSelect(card.key)}
            aria-pressed={isActive}
            data-card={card.key}
            className={cn(
              // flex-col: conteúdo começa no topo (botão centraliza por padrão quando esticado pelo grid).
              "group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-4 pl-5 text-left shadow-sm transition-all",
              "before:absolute before:inset-y-0 before:left-0 before:w-1",
              tone.accent,
              isActive
                ? "border-primary ring-2 ring-primary/20"
                : "border-border hover:border-primary/40 hover:shadow-md"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-snug text-foreground">{card.label}</p>
              <span className={cn("shrink-0 rounded-lg p-1.5", tone.iconBox)}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            </div>
            <p className={cn("mt-2 text-3xl font-bold tabular-nums text-foreground", refreshing && "opacity-60")}>
              {formatCrmReportsInteger(indicators[card.indicator])}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
            <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-semibold text-primary">
              Ver na lista
              <ArrowDownRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Resumo do universo — contagens do backend, nunca o tamanho de uma página. */
export function CrmReportsUniverseSummary({
  universe,
  selection,
}: {
  universe: CrmReportsUniverse;
  selection: CrmReportsSelectionInfo;
}) {
  const item = (label: string, value: number, strong = false, testId?: string) => (
    <div className="flex items-baseline gap-1.5" data-testid={testId}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong ? "text-base font-bold text-foreground" : "text-sm font-semibold text-foreground")}>
        {formatCrmReportsInteger(value)}
      </span>
    </div>
  );
  const narrowedByFilters = universe.matchedBeforeExclusions !== universe.authorizedCustomers;
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border bg-muted/20 px-4 py-3"
      aria-label="Resumo do universo"
      data-testid="crm-reports-universe"
    >
      {item("Clientes no universo permitido", universe.authorizedCustomers, false, "universe-authorized")}
      {narrowedByFilters ? item("Após filtros", universe.matchedBeforeExclusions, false, "universe-matched") : null}
      {item("Ocultados", universe.manuallyExcluded, false, "universe-excluded")}
      {item("Clientes analisados", universe.analyzedCustomers, true, "universe-analyzed")}
      {selection.idsOutsideUniverse > 0 ? (
        <span className="text-xs text-amber-800">
          {formatCrmReportsInteger(selection.idsOutsideUniverse)} cliente(s) da seleção estão fora do universo filtrado e
          foram ignorados.
        </span>
      ) : null}
    </div>
  );
}
