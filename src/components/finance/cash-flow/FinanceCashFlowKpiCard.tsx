import React from "react";
import {
  controlRoomCardClass,
  controlRoomCaptionClass,
  controlRoomKpiLabelClass,
  controlRoomKpiValueClass,
} from "@/src/lib/financeControlRoomTheme";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowKpiCard({
  testId,
  icon: Icon,
  label,
  value,
  sub,
  hint,
  scopeNote,
  colorClass = "text-[#1C1917]",
  loading = false,
}: {
  testId?: string;
  icon?: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  scopeNote?: string;
  colorClass?: string;
  loading?: boolean;
}) {
  return (
    <div data-testid={testId} className={cn(controlRoomCardClass, "p-3.5 space-y-2")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(controlRoomKpiLabelClass, "flex items-center gap-1")}>
          {label}
          {hint ? <FinanceBiCalcTooltip rule={hint} /> : null}
        </span>
        {Icon ? (
          <span className="h-7 w-7 rounded-md border border-[#E7E5E4] bg-[#F5F5F4] flex items-center justify-center shrink-0">
            <Icon className={cn("h-3.5 w-3.5", colorClass)} />
          </span>
        ) : null}
      </div>
      {scopeNote ? <p className={controlRoomCaptionClass}>{scopeNote}</p> : null}
      {loading ? (
        <div className="cr-skeleton h-7 w-28 rounded-md" />
      ) : (
        <p className={cn(controlRoomKpiValueClass, colorClass)}>{value}</p>
      )}
      {sub ? <p className={controlRoomCaptionClass}>{sub}</p> : null}
    </div>
  );
}
