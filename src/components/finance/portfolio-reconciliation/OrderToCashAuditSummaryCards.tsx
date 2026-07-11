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

export function OrderToCashAuditSummaryCards({ summary }: Props) {
  const alertTotal = Object.values(summary.alertCounts ?? {}).reduce((a, b) => a + b, 0);
  const blocked =
    summary.totalBlockedValue > 0
      ? formatFinanceCurrency(summary.totalBlockedValue)
      : formatFinanceInteger(summary.stageCounts?.BLOQUEADO_REVISAO ?? 0);

  const cards: CardDef[] = [
    {
      id: "rows",
      label: "Linhas encontradas",
      value: formatFinanceInteger(summary.totalRows),
    },
    {
      id: "orders",
      label: "Pedidos",
      value: formatFinanceInteger(summary.totalOrders),
    },
    {
      id: "orderValue",
      label: "Valor pedido",
      value: formatFinanceCurrency(summary.totalOrderValue),
    },
    {
      id: "allocated",
      label: "Valor atribuído",
      value: formatFinanceCurrency(summary.totalAllocatedValue),
    },
    {
      id: "cr",
      label: "CR total",
      value: formatFinanceCurrency(summary.totalReceivableValue),
    },
    {
      id: "received",
      label: "Recebido",
      value: formatFinanceCurrency(summary.totalReceivedValue),
    },
    {
      id: "open",
      label: "Aberto",
      value: formatFinanceCurrency(summary.totalOpenValue),
    },
    {
      id: "alerts",
      label: "Alertas",
      value: formatFinanceInteger(alertTotal),
    },
    {
      id: "blocked",
      label: "Bloqueado/revisão",
      value: blocked,
      hint:
        summary.totalBlockedValue > 0
          ? "Valor em bloqueio/revisão"
          : "Linhas no estágio BLOQUEADO_REVISAO",
    },
  ];

  return (
    <div
      className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9"
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
  );
}
