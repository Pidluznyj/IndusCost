import React, { memo, useMemo } from "react";
import { cn } from "@/src/lib/utils";
import { resolveSalesOrderListMarginTextClass } from "@/src/lib/salesOrderListUi";
import {
  pickSalesOrderListMarginPercent,
  pickSalesOrderListMarginValue,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderItemMarginPayload, SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";

export const SalesOrderListMarginCell = memo(function SalesOrderListMarginCell({
  marginSummary,
  marginItems,
  orderIssueDate,
}: {
  marginSummary?: SalesOrderMarginSummaryPayload | null;
  marginItems?: Array<SalesOrderItemMarginPayload | null | undefined>;
  orderIssueDate?: string | null;
}) {
  const percentLabel = useMemo(
    () => pickSalesOrderListMarginPercent(marginSummary),
    [marginSummary]
  );
  const valueLabel = useMemo(
    () => pickSalesOrderListMarginValue(marginSummary),
    [marginSummary]
  );
  const toneClass = useMemo(
    () => resolveSalesOrderListMarginTextClass(marginSummary),
    [marginSummary]
  );

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
          <SalesOrderMarginStatusBadge
            label={marginSummary.statusLabel}
            status={marginSummary.status}
            className="mt-1 !text-[9px] !px-1.5 !py-0 !normal-case !tracking-normal !font-semibold"
          />
        </div>
        <SalesOrderMarginInfoTooltip
          summary={marginSummary}
          itemMargins={marginItems}
          orderIssueDate={orderIssueDate}
          testId="sales-order-list-margin-tooltip"
        />
      </div>
    </div>
  );
});
