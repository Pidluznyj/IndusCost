import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Percent, Receipt, Scale, ShoppingBag, Ticket } from "lucide-react";
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
import { buildSalesOrderListCostBreakdownTooltipText } from "@/src/lib/salesOrderListCostBreakdown";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary";
import type { SalesOrderListMarginSummary } from "@/src/lib/salesOrderListMarginSummary";
import "./sales-order-list-summary-cards.css";

function SalesOrderListCostHoverTooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(22 * 16, Math.max(16 * 16, window.innerWidth * 0.7));
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setCoords({
      top: rect.bottom + 8,
      left,
      width,
    });
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, updatePosition]);

  return (
    <div
      ref={wrapRef}
      className="relative min-w-0"
      data-testid="sales-order-list-estimated-cost-card"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              className="sales-order-list-cost-tooltip-panel"
              role="tooltip"
              data-testid="sales-order-list-estimated-cost-tooltip"
              style={{
                top: coords.top,
                left: coords.left,
                width: coords.width,
              }}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export const SalesOrderListSummaryCards = memo(function SalesOrderListSummaryCards({
  summary,
  marginSummary,
  showMarginCard = false,
  loading,
}: {
  summary: SalesOrderListSummary;
  marginSummary?: SalesOrderListMarginSummary | null;
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
  const costUnavailable = !showMarginCard || marginUnavailable;
  const costAmount =
    loading || costUnavailable ? null : (marginSummary?.totalCost ?? null);
  const costBreakdownTooltip =
    !loading && !costUnavailable
      ? buildSalesOrderListCostBreakdownTooltipText(marginSummary?.costBreakdown)
      : null;

  const costCard = (
    <SystemTotalizerCard
      className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
      label="Custo estimado"
      amount={costAmount}
      amountFormat="currency"
      value={
        loading
          ? undefined
          : costUnavailable
            ? showMarginCard
              ? "Indisponível"
              : "—"
            : undefined
      }
      tone={costUnavailable ? "neutral" : "internal"}
      icon={Scale}
      helperText={
        !showMarginCard
          ? "Custo industrial interno (requer permissão de custo/margem)."
          : costUnavailable
            ? "Sem custo publicado suficiente nos pedidos filtrados."
            : "Passe o mouse para ver MP, HH, HM, demais e impostos."
      }
      valueSize={costUnavailable && !loading ? "text" : "default"}
      labelAccessory={
        costBreakdownTooltip ? (
          <span
            className="inline-flex text-muted-foreground"
            aria-hidden
            title="Discriminação do custo"
          >
            <Info className="h-3.5 w-3.5" />
          </span>
        ) : undefined
      }
      loading={loading}
    />
  );

  return (
    <SalesOrderKpiSection
      testId="sales-order-list-overview"
      title={SALES_ORDER_LIST_KPI_SECTION.title}
      subtitle={SALES_ORDER_LIST_KPI_SECTION.subtitle}
      className="sales-order-list-overview-kpi"
    >
      <SummaryKpiGrid
        minColumnWidth={168}
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
        {costBreakdownTooltip ? (
          <SalesOrderListCostHoverTooltip text={costBreakdownTooltip}>
            {costCard}
          </SalesOrderListCostHoverTooltip>
        ) : (
          <div className="min-w-0" data-testid="sales-order-list-estimated-cost-card">
            {costCard}
          </div>
        )}
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
              label="Margem geral"
              value={loading ? undefined : marginPercentLabel}
              subtitle={loading ? undefined : marginMoneyLabel}
              tone={marginUnavailable ? "neutral" : marginPartial ? "warning" : "margin"}
              icon={Percent}
              helperText={
                marginUnavailable
                  ? "Sem custo suficiente para calcular."
                  : marginPartial
                    ? "Há itens sem custo resolvido."
                    : "Margem ponderada dos pedidos filtrados."
              }
              valueSize={marginUnavailable ? "text" : "default"}
              labelAccessory={
                marginSummary?.tooltipSummary && !loading ? (
                  <SalesOrderMarginInfoTooltip
                    summary={marginSummary.tooltipSummary}
                    titleOverride="Margem geral ponderada"
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
                    Margem parcial
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
