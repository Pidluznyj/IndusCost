import React, { memo } from "react";
import { CalendarClock, Percent, Receipt, ShoppingBag, Ticket } from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import { SALES_ORDER_LIST_KPI_SECTION } from "@/src/lib/salesOrderManagementKpiLabels";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import {
  GRANTED_PAYMENT_TERM_CARD_LABEL,
  GRANTED_PAYMENT_TERM_CARD_TEST_ID,
  resolveGrantedPaymentTermCardPresentation,
  type SalesOrderGrantedPaymentTermSummary,
} from "@/src/lib/salesOrderGrantedPaymentTerm";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary";
import type { SalesOrderListMarginSummary } from "@/src/lib/salesOrderListMarginSummary";
import "./sales-order-list-summary-cards.css";

/**
 * Visão Geral da listagem de Pedidos de Venda.
 *
 * Ordem: Pedidos filtrados · Valor vendido · Prazo médio de recebimento · Ticket médio ·
 * Margem comercial (só com permissão econômica). Os cards de imposto e de custo
 * saíram deste overview (2026-09) — os cálculos continuam no motor de margem,
 * relatórios, abas Custos/Tributos e Gestão de Pedidos.
 */
export const SalesOrderListSummaryCards = memo(function SalesOrderListSummaryCards({
  summary,
  marginSummary,
  paymentTermSummary,
  paymentTermSummaryLoading = false,
  showMarginCard = false,
  loading,
}: {
  summary: SalesOrderListSummary;
  marginSummary?: SalesOrderListMarginSummary | null;
  /**
   * Prazo médio de recebimento — endpoint dedicado (GET /api/sales-orders/payment-term-summary),
   * visível para todos que veem Pedidos de Venda. `null` = indisponível/falha do endpoint.
   */
  paymentTermSummary?: SalesOrderGrantedPaymentTermSummary | null;
  paymentTermSummaryLoading?: boolean;
  showMarginCard?: boolean;
  loading: boolean;
}) {
  const marginPartial = marginSummary?.marginCoverage === "PARTIAL";
  const marginUnavailable = !marginSummary?.available;
  const marginPercentLabel = marginUnavailable
    ? "Indisponível"
    : formatSalesOrderMarginPercent(marginSummary?.totalMarginPercentage);
  const marginMoneyLabel = marginUnavailable
    ? "—"
    : formatCompactCurrency(marginSummary?.totalMarginValue ?? null);

  // Estado visual FULL/PARTIAL/LOW/UNAVAILABLE resolvido no motor puro (sem cálculo no React).
  const paymentTermLoading = loading || paymentTermSummaryLoading;
  const paymentTerm = resolveGrantedPaymentTermCardPresentation(paymentTermSummary);

  return (
    <SalesOrderKpiSection
      testId="sales-order-list-overview"
      title={SALES_ORDER_LIST_KPI_SECTION.title}
      subtitle={SALES_ORDER_LIST_KPI_SECTION.subtitle}
      className="sales-order-list-overview-kpi"
    >
      <SummaryKpiGrid
        minColumnWidth={152}
        className={`${SYSTEM_TOTALIZER_GRID_CLASS} sales-order-list-summary-grid`}
      >
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Pedidos filtrados"
          amount={loading ? null : summary.totalOrders}
          amountFormat="number"
          tone="info"
          icon={ShoppingBag}
          helperText="Quantidade de pedidos que atendem aos filtros aplicados."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Valor vendido"
          amount={loading ? null : summary.totalNetAmount}
          amountFormat="currency"
          tone="money"
          icon={Receipt}
          helperText="Soma do valor líquido dos pedidos filtrados."
          loading={loading}
        />
        <div
          data-testid={GRANTED_PAYMENT_TERM_CARD_TEST_ID}
          data-quality={paymentTermLoading ? "LOADING" : paymentTerm.quality}
          className="min-w-0"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label={GRANTED_PAYMENT_TERM_CARD_LABEL}
            value={paymentTermLoading ? undefined : paymentTerm.value}
            subtitle={paymentTermLoading ? undefined : paymentTerm.subtitle}
            tone={paymentTerm.tone}
            icon={CalendarClock}
            helperText={paymentTerm.helperText}
            valueSize={paymentTermLoading ? "default" : paymentTerm.valueSize}
            loading={paymentTermLoading}
          />
        </div>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Ticket médio"
          amount={loading || summary.totalOrders <= 0 ? null : summary.averageTicket}
          amountFormat="currency"
          tone="neutral"
          icon={Ticket}
          helperText="Valor líquido total ÷ quantidade de pedidos."
          loading={loading}
        />
        {showMarginCard ? (
          <div data-testid="sales-order-list-general-margin-card" className="min-w-0">
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Margem comercial"
              value={loading ? undefined : marginPercentLabel}
              subtitle={loading ? undefined : marginMoneyLabel}
              tone={marginUnavailable ? "neutral" : marginPartial ? "warning" : "margin"}
              icon={Percent}
              helperText={
                marginUnavailable
                  ? "Sem formação de preço identificada para calcular a margem comercial."
                  : marginPartial
                    ? "Há itens sem formação identificada — cobertura parcial do valor vendido."
                    : "Margem comercial do Pedido ponderada pelo valor efetivamente vendido."
              }
              valueSize={marginUnavailable ? "text" : "default"}
              labelAccessory={
                marginSummary?.tooltipSummary && !loading ? (
                  <SalesOrderMarginInfoTooltip
                    summary={marginSummary.tooltipSummary}
                    titleOverride="Margem comercial do Pedido"
                    testId="sales-order-list-general-margin-tooltip"
                  />
                ) : undefined
              }
              footer={
                marginPartial && !loading && !marginUnavailable ? (
                  <span
                    className="sales-order-list-summary-margin-badge"
                    data-testid="sales-order-list-general-margin-partial-badge"
                  >
                    Margem comercial parcial
                  </span>
                ) : undefined
              }
              loading={loading}
            />
          </div>
        ) : null}
      </SummaryKpiGrid>
    </SalesOrderKpiSection>
  );
});
