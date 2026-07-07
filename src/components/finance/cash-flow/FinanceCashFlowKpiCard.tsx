import React from "react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";

/** KPI do fluxo de caixa com valor compacto e tooltip com valor integral. */
export function FinanceCashFlowKpiCard({
  testId,
  valueFull,
  valueClassName,
  featured,
  compact,
  ...props
}: React.ComponentProps<typeof FinanceBiKpiCard> & {
  testId?: string;
  valueFull?: string;
  featured?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      title={valueFull}
      className={featured ? "rounded-xl ring-2 ring-[#2563EB]/15" : undefined}
    >
      <FinanceBiKpiCard
        {...props}
        valueTitle={props.valueTitle ?? valueFull}
        compact={compact}
        valueClassName={
          valueClassName ?? "break-words leading-tight text-xl sm:text-2xl lg:text-3xl"
        }
      />
    </div>
  );
}
