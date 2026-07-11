import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  PortfolioIntelligenceCardDto,
  PortfolioIntelligenceGroupDto,
  PortfolioIntelligenceOrderRow,
} from "@/src/lib/financePortfolioReconciliationClient";
import {
  INTELLIGENCE_ACCORDION_KEYS,
  type IntelligenceAccordionKey,
  rowsForIntelligenceAccordion,
  statsForIntelligenceAccordion,
  sumPrincipalGroupValues,
} from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import { cn } from "@/src/lib/utils";
import { PortfolioIntelligenceOrdersGrid } from "./PortfolioIntelligenceOrdersGrid";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";
import type { PortfolioIntelligenceExplanation } from "./PortfolioIntelligenceHelpPopover";

export {
  cardKeyToAccordionKey,
  INTELLIGENCE_ACCORDION_KEYS,
  type IntelligenceAccordionKey,
} from "@/src/lib/finance/portfolioIntelligenceDrilldown";

const TITLE_BY_KEY: Record<IntelligenceAccordionKey, string> = {
  RECEBIDO: "Recebido",
  CR_ABERTO: "CR aberto",
  FATURADO_SEM_CR: "Faturado sem CR",
  CARTEIRA_FUTURA_PROVAVEL: "Carteira futura provável",
  CARTEIRA_PRESENTE_ATENCAO: "Presente / atenção",
  CARTEIRA_VENCIDA_BLOQUEADA: "Carteira vencida bloqueada",
  DIVERGENCIA_TECNICA: "Divergência técnica",
  SEM_EVIDENCIA: "Sem evidência suficiente",
};

const TONE_CLASS: Record<IntelligenceAccordionKey, string> = {
  RECEBIDO: "border-emerald-200/90 bg-emerald-50/50",
  CR_ABERTO: "border-emerald-200/90 bg-emerald-50/40",
  FATURADO_SEM_CR: "border-amber-200/90 bg-amber-50/50",
  CARTEIRA_FUTURA_PROVAVEL: "border-sky-200/90 bg-sky-50/50",
  CARTEIRA_PRESENTE_ATENCAO: "border-amber-200/80 bg-amber-50/40",
  CARTEIRA_VENCIDA_BLOQUEADA: "border-rose-200/80 bg-rose-50/40",
  DIVERGENCIA_TECNICA: "border-orange-200/90 bg-orange-50/50",
  SEM_EVIDENCIA: "border-zinc-200/90 bg-zinc-50/60",
};

function explanationForAccordion(
  key: IntelligenceAccordionKey,
  cards: readonly PortfolioIntelligenceCardDto[]
): PortfolioIntelligenceExplanation | null {
  const card = cards.find((c) => c.key === key);
  return card?.explanation ?? null;
}

type Props = {
  groups: PortfolioIntelligenceGroupDto[];
  cards: PortfolioIntelligenceCardDto[];
  rows: PortfolioIntelligenceOrderRow[];
  carteiraTotal: number;
  expandedKey: IntelligenceAccordionKey | null;
  onExpandedChange: (key: IntelligenceAccordionKey | null) => void;
  onOpenOrder?: (salesOrderId: string) => void;
};

/**
 * Sanfonas de drilldown por status — dados da API; sem recalcular carteira.
 */
export function PortfolioIntelligenceAccordions({
  groups,
  cards,
  rows,
  carteiraTotal,
  expandedKey,
  onExpandedChange,
  onOpenOrder,
}: Props) {
  const [searchByKey, setSearchByKey] = useState<Record<string, string>>({});

  const principalSum = useMemo(() => sumPrincipalGroupValues(groups), [groups]);

  const duplicationWarning =
    carteiraTotal > 0 && Math.abs(principalSum - carteiraTotal) > 0.05
      ? `Soma dos status principais (${principalSum.toLocaleString("pt-BR")}) difere da carteira total (${carteiraTotal.toLocaleString("pt-BR")}).`
      : null;

  return (
    <div className="space-y-2" data-testid="portfolio-intelligence-accordions">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Pedidos por maturidade</h3>
          <p className="text-[11px] text-muted-foreground">
            Cada pedido entra em um único status principal. Divergência técnica é alerta e pode
            coexistir.
          </p>
        </div>
      </div>

      {duplicationWarning ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-950"
          data-testid="portfolio-intelligence-duplication-warning"
        >
          {duplicationWarning}
        </p>
      ) : null}

      {INTELLIGENCE_ACCORDION_KEYS.map((key) => {
        const stats = statsForIntelligenceAccordion(
          key,
          groups,
          cards,
          rows,
          carteiraTotal
        );
        const expanded = expandedKey === key;
        const groupRows = rowsForIntelligenceAccordion(key, rows);
        return (
          <section
            key={key}
            className={cn("overflow-hidden rounded-xl border shadow-sm", TONE_CLASS[key])}
            data-testid={`portfolio-intelligence-accordion-${key}`}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/40"
              aria-expanded={expanded}
              onClick={() => onExpandedChange(expanded ? null : key)}
              data-testid={`portfolio-intelligence-accordion-toggle-${key}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <span>{TITLE_BY_KEY[key]}</span>
                  {stats.isAlert ? (
                    <span className="text-[10px] font-medium text-orange-800">(alerta)</span>
                  ) : null}
                  <span
                    className="inline-flex"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <MetricHelpTooltip
                      title={TITLE_BY_KEY[key]}
                      explanation={explanationForAccordion(key, cards)}
                      missingExplanation={!explanationForAccordion(key, cards)}
                    />
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {formatFinanceCurrencyCompact(stats.value)} ·{" "}
                  {formatFinanceInteger(stats.count)} ped.
                  {stats.percentage != null
                    ? ` · ${formatFinancePercent(stats.percentage)}`
                    : ""}
                  {" · "}
                  conf. média{" "}
                  {stats.averageConfidence.toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              {expanded ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>

            {expanded ? (
              <div className="border-t border-border/50 bg-background/70 px-3 py-3">
                <PortfolioIntelligenceOrdersGrid
                  rows={groupRows}
                  searchQuery={searchByKey[key] ?? ""}
                  onSearchChange={(q) =>
                    setSearchByKey((prev) => ({ ...prev, [key]: q }))
                  }
                  onOpenOrder={onOpenOrder}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
