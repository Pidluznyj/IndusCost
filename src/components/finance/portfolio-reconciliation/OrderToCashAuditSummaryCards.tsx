import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { OrderToCashAuditListSummary } from "@/src/lib/finance/orderToCashAuditApi";

type Props = {
  summary: OrderToCashAuditListSummary;
};

type CardDef = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

/**
 * Cards usam exclusivamente o `summary` da API (run ou filtered_facts).
 * Não recalcula nem soma CR a partir das rows da tabela.
 */
export function OrderToCashAuditSummaryCards({ summary }: Props) {
  const alertTotal = Object.values(summary.alertCounts ?? {}).reduce((a, b) => a + b, 0);
  const sourceHint =
    summary.summarySource === "run"
      ? "Totais da OrderToCashAuditRun (sem somar linhas)"
      : "Resumo filtrado agregado por pedido (CR sem duplicar linhas)";

  const cards: CardDef[] = [
    {
      id: "rows",
      label: "Linhas encontradas",
      value: formatFinanceInteger(summary.totalRows),
      hint: sourceHint,
    },
    {
      id: "orders",
      label: "Pedidos",
      value: formatFinanceInteger(summary.totalOrders),
      hint: sourceHint,
    },
    {
      id: "orderValue",
      label: "Valor pedido",
      value: formatFinanceCurrency(summary.totalOrderValue),
      hint: sourceHint,
    },
    {
      id: "allocated",
      label: "Valor atribuído",
      value: formatFinanceCurrency(summary.totalAllocatedValue),
      hint: sourceHint,
    },
    {
      id: "cr",
      label: "CR total",
      value: formatFinanceCurrency(summary.totalReceivableValue),
      hint: sourceHint,
    },
    {
      id: "received",
      label: "Recebido",
      value: formatFinanceCurrency(summary.totalReceivedValue),
      hint: sourceHint,
    },
    {
      id: "open",
      label: "Aberto",
      value: formatFinanceCurrency(summary.totalOpenValue),
      hint: sourceHint,
    },
    {
      id: "alerts",
      label: "Alertas",
      value: formatFinanceInteger(alertTotal),
      hint: sourceHint,
    },
    {
      id: "blocked",
      label: "Bloqueado/revisão",
      value:
        summary.totalBlockedValue > 0
          ? formatFinanceCurrency(summary.totalBlockedValue)
          : formatFinanceInteger(summary.stageCounts?.BLOQUEADO_REVISAO ?? 0),
      hint: sourceHint,
    },
  ];

  return (
    <div className="mb-4 space-y-2" data-testid="order-to-cash-audit-summary">
      <p className="text-[11px] text-muted-foreground" data-testid="order-to-cash-audit-summary-source">
        Origem do resumo:{" "}
        <span className="font-semibold text-[#344054]">
          {summary.summarySource === "run" ? "totais da run" : "agregação filtrada por pedido"}
        </span>
      </p>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9"
        data-testid="order-to-cash-audit-summary-cards"
      >
        {cards.map((card) => (
          <div
            key={card.id}
            className={cn(financeBiCardClass, "px-3 py-2.5")}
            title={card.hint}
            data-testid={`order-to-cash-audit-card-${card.id}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
              {card.label}
            </p>
            <p className="mt-1 text-[15px] font-bold tabular-nums leading-tight text-[#101828]">
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
