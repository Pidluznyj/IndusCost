import React from "react";
import {
  AlertTriangle,
  Package,
  Receipt,
  Scale,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { formatFinanceCurrencyCompact, formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioReconciliationSummaryCards } from "@/src/lib/financePortfolioReconciliationClient";

export function PortfolioReconciliationSummaryCardsView({
  summary,
}: {
  summary: PortfolioReconciliationSummaryCards;
}) {
  const pedidosLabel = `${formatFinanceInteger(summary.totalPedidos)} pedido${
    summary.totalPedidos === 1 ? "" : "s"
  } no filtro atual`;

  return (
    <div
      className={SYSTEM_TOTALIZER_GRID_CLASS}
      data-testid="portfolio-reconciliation-summary-cards"
    >
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Total em pedidos"
        value={formatFinanceCurrencyCompact(summary.totalValorPedidos)}
        icon={Package}
        tone="neutral"
        subtitle={pedidosLabel}
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Total alocado ao pedido"
        value={formatFinanceCurrencyCompact(summary.totalAlocadoPorPrecoPedido)}
        icon={Scale}
        tone="info"
        subtitle="Preço do pedido × quantidade alocada"
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Total em contas a receber"
        value={formatFinanceCurrencyCompact(summary.totalContasReceber)}
        icon={Receipt}
        tone="money"
        subtitle="CR rateado / vinculado à conciliação do pedido"
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Total recebido"
        value={formatFinanceCurrencyCompact(summary.totalRecebido)}
        icon={Wallet}
        tone="success"
        subtitle="Recebido rateado ao pedido"
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Saldo projetado"
        value={formatFinanceCurrencyCompact(summary.saldoCarteira)}
        icon={Wallet}
        tone="warning"
        subtitle="Saldo de carteira no filtro"
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Divergências"
        value={formatFinanceCurrencyCompact(summary.valorComDivergencia)}
        icon={AlertTriangle}
        tone="danger"
        subtitle={`Valor de pedidos com divergência · ${formatFinanceInteger(summary.divergenciasEncontradas)} facts divergentes`}
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Sem confiança / itemização"
        value={formatFinanceCurrencyCompact(summary.valorSemConfianca)}
        icon={ShieldAlert}
        tone="warning"
        subtitle="Valor de pedidos com itens LOW/BLOCKED ou alertas bloqueantes"
      />
      <SystemTotalizerCard
        className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
        label="Pedidos com alerta"
        value={formatFinanceInteger(summary.pedidosComAlerta)}
        icon={AlertTriangle}
        tone="danger"
        subtitle={`${formatFinanceInteger(summary.alertasEncontrados)} alertas encontrados`}
      />
    </div>
  );
}
