import React from "react";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildSalesOrderMarginTooltipText,
  resolveSalesOrderListMarginTextClass,
} from "@/src/lib/salesOrderListUi";
import {
  pickSalesOrderListMarginPercent,
  pickSalesOrderListMarginValue,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";

export function SalesOrderListMarginCell({
  marginSummary,
}: {
  marginSummary?: SalesOrderMarginSummaryPayload | null;
}) {
  const percentLabel = pickSalesOrderListMarginPercent(marginSummary);
  const valueLabel = pickSalesOrderListMarginValue(marginSummary);
  const tooltip = buildSalesOrderMarginTooltipText(marginSummary);
  const toneClass = resolveSalesOrderListMarginTextClass(marginSummary);

  if (!marginSummary) {
    return (
      <div className="text-right text-muted-foreground text-xs" data-testid="sales-order-list-margin-cell">
        Margem não calculada
      </div>
    );
  }

  return (
    <div
      className="relative text-right"
      data-testid="sales-order-list-margin-cell"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="inline-flex items-start justify-end gap-1 sales-order-margin-tooltip-wrap">
        <div className="min-w-0">
          <p className={cn("text-sm tabular-nums leading-tight", toneClass)}>{percentLabel}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground mt-0.5">{valueLabel}</p>
          {marginSummary ? (
            <SalesOrderMarginStatusBadge
              label={marginSummary.statusLabel}
              status={marginSummary.status}
              className="mt-1 !text-[9px] !px-1.5 !py-0 !normal-case !tracking-normal !font-semibold"
            />
          ) : null}
        </div>
        <button
          type="button"
          className="mt-0.5 inline-flex shrink-0 cursor-help rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Como a margem é calculada"
          data-testid="sales-order-list-margin-tooltip-trigger"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
        <div
          className="sales-order-margin-tooltip-panel text-left"
          role="tooltip"
          data-testid="sales-order-list-margin-tooltip"
        >
          {tooltip}
        </div>
      </div>
    </div>
  );
}
