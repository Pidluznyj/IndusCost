import React from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Layers,
  Scale,
  Wallet,
} from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  ORDER_STATUS_PEDIDOS_STATUS_HINT,
  ORDER_STATUS_PEDIDOS_STATUS_LABEL,
  type OrderStatusPedidosStatus,
  type OrderStatusPedidosSummary,
} from "@/src/lib/finance/orderStatusPedidosApi";
import { cn } from "@/src/lib/utils";

type Props = {
  summary: OrderStatusPedidosSummary;
};

type CardDef = {
  id: string;
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  accent: string;
};

const STATUS_ACCENT: Record<OrderStatusPedidosStatus, string> = {
  RECEBIDO: "text-emerald-700",
  CR_ABERTO: "text-sky-700",
  PARCIAL: "text-amber-700",
  SEM_ATENDIMENTO: "text-slate-600",
  DIVERGENCIA: "text-orange-700",
  BLOQUEADO: "text-rose-700",
};

/**
 * Cards contam pedidos distintos (summary.totalOrders / statusCounts).
 * Não usam totalFacts nem somam CR por linha de evidência.
 */
export function OrderStatusPedidosSummaryCards({ summary }: Props) {
  const cards: CardDef[] = [
    {
      id: "orders",
      label: "Pedidos",
      value: formatFinanceInteger(summary.totalOrders),
      hint: "Pedidos distintos na agregação (não linhas de evidência).",
      icon: <Layers className="h-3.5 w-3.5" />,
      accent: "text-[#344054]",
    },
    {
      id: "RECEBIDO",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.RECEBIDO,
      value: formatFinanceInteger(summary.statusCounts.RECEBIDO),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.RECEBIDO,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.RECEBIDO,
    },
    {
      id: "CR_ABERTO",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.CR_ABERTO,
      value: formatFinanceInteger(summary.statusCounts.CR_ABERTO),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.CR_ABERTO,
      icon: <Wallet className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.CR_ABERTO,
    },
    {
      id: "PARCIAL",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.PARCIAL,
      value: formatFinanceInteger(summary.statusCounts.PARCIAL),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.PARCIAL,
      icon: <CircleDashed className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.PARCIAL,
    },
    {
      id: "SEM_ATENDIMENTO",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.SEM_ATENDIMENTO,
      value: formatFinanceInteger(summary.statusCounts.SEM_ATENDIMENTO),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.SEM_ATENDIMENTO,
      icon: <Scale className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.SEM_ATENDIMENTO,
    },
    {
      id: "DIVERGENCIA",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.DIVERGENCIA,
      value: formatFinanceInteger(summary.statusCounts.DIVERGENCIA),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.DIVERGENCIA,
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.DIVERGENCIA,
    },
    {
      id: "BLOQUEADO",
      label: ORDER_STATUS_PEDIDOS_STATUS_LABEL.BLOQUEADO,
      value: formatFinanceInteger(summary.statusCounts.BLOQUEADO),
      hint: ORDER_STATUS_PEDIDOS_STATUS_HINT.BLOQUEADO,
      icon: <Ban className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.BLOQUEADO,
    },
    {
      id: "orderValue",
      label: "Valor pedidos",
      value: formatFinanceCurrency(summary.totalOrderValue),
      hint: "Soma do valor líquido uma vez por pedido.",
      icon: <Layers className="h-3.5 w-3.5" />,
      accent: "text-[#344054]",
    },
    {
      id: "cr",
      label: "CR (1×/pedido)",
      value: formatFinanceCurrency(summary.totalReceivableValue),
      hint: "CR agregado uma vez por pedido (não soma linhas de evidência).",
      icon: <Wallet className="h-3.5 w-3.5" />,
      accent: STATUS_ACCENT.CR_ABERTO,
    },
  ];

  return (
    <div className="mb-4 space-y-2" data-testid="order-status-pedidos-summary">
      <p className="text-[11px] text-muted-foreground">
        Origem do resumo:{" "}
        <span className="font-semibold text-[#344054]">
          agregação por pedido (OrderToCashAuditFact)
        </span>
      </p>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9"
        data-testid="order-status-pedidos-summary-cards"
      >
        {cards.map((card) => (
          <div
            key={card.id}
            className={cn(financeBiCardClass, "px-3 py-2.5")}
            title={card.hint}
            data-testid={`order-status-pedidos-card-${card.id}`}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
              <span className={cn("opacity-80", card.accent)}>{card.icon}</span>
              {card.label}
            </div>
            <p
              className={cn(
                "mt-1 text-[15px] font-bold tabular-nums leading-tight",
                card.accent
              )}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
