import React, { memo, useMemo } from "react";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildOfficialSalesOrderMarginTooltipText } from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderMarginTooltipInput } from "@/src/lib/salesOrderMarginDisplay";

type SalesOrderMarginInfoTooltipProps = SalesOrderMarginTooltipInput & {
  className?: string;
  testId?: string;
  panelClassName?: string;
};

/**
 * Ícone (i) com painel de tooltip — cálculo oficial de margem gerencial.
 * Memoizado: texto só reconstrói quando inputs oficiais mudam (não a cada
 * re-render da lista ao digitar filtro).
 */
export const SalesOrderMarginInfoTooltip = memo(function SalesOrderMarginInfoTooltip({
  summary,
  itemMargins,
  orderIssueDate,
  titleOverride,
  commercialComposition,
  className,
  testId = "sales-order-margin-tooltip",
  panelClassName,
}: SalesOrderMarginInfoTooltipProps) {
  const text = useMemo(
    () =>
      buildOfficialSalesOrderMarginTooltipText({
        summary,
        itemMargins,
        orderIssueDate,
        titleOverride,
        commercialComposition:
          commercialComposition ??
          (summary?.commercialMargin?.commercialComposition
            ? {
                ...summary.commercialMargin.commercialComposition,
                discountStatus:
                  summary.commercialMargin.commercialComposition.additionTotalValue >
                  summary.commercialMargin.commercialComposition.discountTotalValue
                    ? "ADDITION"
                    : summary.commercialMargin.commercialComposition.discountTotalValue > 0
                      ? "DISCOUNT"
                      : "NO_DISCOUNT",
                itemsWithDiscount: 0,
                itemsWithAddition: 0,
                itemsActive: summary.commercialMargin.itemsActive,
              }
            : null),
      }),
    [summary, itemMargins, orderIssueDate, titleOverride, commercialComposition]
  );

  return (
    <span
      className={cn("inline-flex shrink-0 sales-order-margin-tooltip-wrap", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex cursor-help rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="Como a margem é calculada"
        data-testid={`${testId}-trigger`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <div
        className={cn("sales-order-margin-tooltip-panel text-left whitespace-pre-line", panelClassName)}
        role="tooltip"
        data-testid={testId}
      >
        {text}
      </div>
    </span>
  );
});
