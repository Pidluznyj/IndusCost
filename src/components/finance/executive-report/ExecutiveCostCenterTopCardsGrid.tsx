import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  FinanceExecutiveReportCostCenterTopCard,
  FinanceExecutiveReportCostCenterTopCardsSummary,
} from "@/src/lib/financeExecutiveReportCostCenterTopCards";
import type { CostCenterExpenseMapAggregateTotals } from "@/src/lib/financeCostCenterExpenseMap";
import { FinanceCostCenterExpenseMapExecutiveSummary } from "@/src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary";
import { cn } from "@/src/lib/utils";

type Props = {
  topCards: FinanceExecutiveReportCostCenterTopCard[];
  summary: FinanceExecutiveReportCostCenterTopCardsSummary;
  totals: CostCenterExpenseMapAggregateTotals;
};

function ExecutiveCostCenterTopCard({ card }: { card: FinanceExecutiveReportCostCenterTopCard }) {
  const shareWidth = Math.min(100, Math.max(0, card.participationPercent));
  return (
    <article
      className="executive-cc-top-card rounded-lg border border-border/80 bg-card p-3"
      data-testid={`executive-cc-top-card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
            {card.code}
          </p>
          <h4 className="text-sm font-bold text-foreground leading-snug">{card.name}</h4>
          {card.parentName ? (
            <p className="text-[10px] text-muted-foreground truncate">{card.parentName}</p>
          ) : card.category ? (
            <p className="text-[10px] text-muted-foreground truncate">{card.category}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            card.status === "ACTIVE"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-muted text-muted-foreground"
          )}
        >
          {card.status === "ACTIVE" ? "Ativo" : "Inativo"}
        </span>
      </div>

      <p className="mt-2 text-lg font-bold tabular-nums leading-tight">
        {formatFinanceCurrency(card.totalAmount)}
      </p>
      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${shareWidth}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {formatFinancePercent(card.participationPercent)} do total ·{" "}
        {formatFinanceInteger(card.titlesCount)} título(s)
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        <span className="executive-cc-chip executive-cc-chip--overdue rounded-full px-2 py-0.5 text-[10px] font-semibold">
          Vencido {formatFinanceCurrency(card.overdueAmount)}
        </span>
        <span className="executive-cc-chip executive-cc-chip--upcoming rounded-full px-2 py-0.5 text-[10px] font-semibold">
          A vencer {formatFinanceCurrency(card.upcomingAmount)}
        </span>
        {card.paidAmount > 0 ? (
          <span className="executive-cc-chip executive-cc-chip--paid rounded-full px-2 py-0.5 text-[10px] font-semibold">
            Pago {formatFinanceCurrency(card.paidAmount)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function ExecutiveCostCenterTopCardsGrid({ topCards, summary, totals }: Props) {
  if (topCards.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
        data-testid="executive-cc-top-cards-empty"
      >
        {summary.headline}
      </div>
    );
  }

  return (
    <div className="executive-cc-top-cards-section" data-testid="executive-cc-top-cards">
      <FinanceCostCenterExpenseMapExecutiveSummary
        totals={totals}
        hasSelection={false}
        titleOverride={`Resumo dos ${formatFinanceInteger(totals.centersCount)} principais centros de custo`}
        eyebrowOverride="Top por valor no período filtrado · Participação sobre o gasto classificado"
        footerOverride={`${formatFinanceInteger(totals.centersCount)} centros exibidos · ${formatFinanceInteger(totals.totalFilteredCentersCount)} centros com valor no período`}
      />
      <p className="text-sm text-muted-foreground mt-4 mb-3">{summary.headline}</p>
      <div className="executive-cc-top-cards-grid">
        {topCards.map((card) => (
          <ExecutiveCostCenterTopCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
