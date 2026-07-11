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
  INTELLIGENCE_ACCORDION_GROUPS,
  INTELLIGENCE_ACCORDION_KEYS,
  type IntelligenceAccordionKey,
  rowsForIntelligenceAccordion,
  statsForIntelligenceAccordion,
  sumPrincipalGroupValues,
} from "@/src/lib/finance/portfolioIntelligenceDrilldown";
import {
  INTELLIGENCE_ACCORDION_HINT,
  intelligenceAccordionTitle,
  intelligenceCardTitle,
} from "@/src/lib/finance/portfolioIntelligenceUiCopy";
import { cn } from "@/src/lib/utils";
import { PortfolioIntelligenceOrdersGrid } from "./PortfolioIntelligenceOrdersGrid";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";
import type { PortfolioIntelligenceExplanation } from "./PortfolioIntelligenceHelpPopover";

export {
  cardKeyToAccordionKey,
  INTELLIGENCE_ACCORDION_KEYS,
  type IntelligenceAccordionKey,
} from "@/src/lib/finance/portfolioIntelligenceDrilldown";

const TONE_CLASS: Record<IntelligenceAccordionKey, string> = {
  RECEBIDO: "border-emerald-200/80 bg-gradient-to-r from-emerald-50/70 to-white",
  CR_ABERTO: "border-sky-200/70 bg-gradient-to-r from-sky-50/50 to-white",
  FATURADO_SEM_CR: "border-sky-200/70 bg-gradient-to-r from-sky-50/40 to-white",
  CARTEIRA_FUTURA_PROVAVEL: "border-sky-200/80 bg-gradient-to-r from-sky-50/60 to-white",
  CARTEIRA_PRESENTE_ATENCAO: "border-amber-200/70 bg-gradient-to-r from-amber-50/50 to-white",
  CARTEIRA_VENCIDA_BLOQUEADA: "border-rose-200/70 bg-gradient-to-r from-rose-50/50 to-white",
  SEM_EVIDENCIA: "border-zinc-200/80 bg-gradient-to-r from-zinc-50/70 to-white",
  DIVERGENCIA_TECNICA:
    "border-dashed border-orange-300/80 bg-gradient-to-r from-orange-50/40 to-white",
  NF_CABECALHO_MAIOR_PEDIDO:
    "border-dashed border-orange-300/80 bg-gradient-to-r from-orange-50/30 to-white",
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
      ? `A soma dos status principais difere da carteira total. Revise o filtro ou a conciliação.`
      : null;

  return (
    <div className="space-y-5" data-testid="portfolio-intelligence-accordions">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Pedidos por maturidade</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Cada pedido tem um único status. Alertas técnicos podem aparecer junto e não
          trocam o status.
        </p>
      </div>

      {duplicationWarning ? (
        <p
          className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-950"
          data-testid="portfolio-intelligence-duplication-warning"
        >
          {duplicationWarning}
        </p>
      ) : null}

      {INTELLIGENCE_ACCORDION_GROUPS.map((group) => (
        <div
          key={group.id}
          className="space-y-2"
          data-testid={`portfolio-intelligence-accordion-group-${group.id}`}
        >
          <div className="px-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <p className="text-[11px] text-muted-foreground">{group.description}</p>
          </div>

          {group.keys.map((key) => {
            const stats = statsForIntelligenceAccordion(
              key,
              groups,
              cards,
              rows,
              carteiraTotal
            );
            const expanded = expandedKey === key;
            const groupRows = rowsForIntelligenceAccordion(key, rows);
            const title = intelligenceAccordionTitle(key);
            const hint = INTELLIGENCE_ACCORDION_HINT[key];
            return (
              <section
                key={key}
                className={cn("overflow-hidden rounded-2xl border shadow-sm", TONE_CLASS[key])}
                data-testid={`portfolio-intelligence-accordion-${key}`}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/50"
                  aria-expanded={expanded}
                  onClick={() => onExpandedChange(expanded ? null : key)}
                  data-testid={`portfolio-intelligence-accordion-toggle-${key}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                      <span>{title}</span>
                      {stats.isAlert ? (
                        <span className="rounded-md border border-orange-200/80 bg-orange-50/90 px-1.5 py-0.5 text-[10px] font-medium text-orange-900">
                          alerta
                        </span>
                      ) : null}
                      <span
                        className="inline-flex"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <MetricHelpTooltip
                          title={intelligenceCardTitle(key, title)}
                          explanation={explanationForAccordion(key, cards)}
                          missingExplanation={!explanationForAccordion(key, cards)}
                        />
                      </span>
                    </p>
                    {hint ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {formatFinanceCurrencyCompact(stats.value)}
                      </span>
                      {" · "}
                      {formatFinanceInteger(stats.count)} pedido(s)
                      {stats.percentage != null
                        ? ` · ${formatFinancePercent(stats.percentage)}`
                        : ""}
                      {" · confiança média "}
                      {stats.averageConfidence.toLocaleString("pt-BR", {
                        maximumFractionDigits: 0,
                      })}
                      {stats.isAlert ? " · não soma carteira" : ""}
                    </p>
                  </div>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {expanded ? (
                  <div className="border-t border-border/40 bg-white/80 px-3 py-3 sm:px-4">
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
      ))}

      {/* Mantém referência às chaves para testes de contrato. */}
      <span className="sr-only">{INTELLIGENCE_ACCORDION_KEYS.join(",")}</span>
    </div>
  );
}
