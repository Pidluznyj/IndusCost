import React from "react";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

/** Título de bloco do Fluxo com tooltip discreto de regra de cálculo. */
export function FinanceCashFlowBlockTitle({
  title,
  subtitle,
  help,
  testId,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  help?: string;
  testId?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-0.5", className)} data-testid={testId}>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="text-sm font-bold text-[#111827] truncate">{title}</h3>
          {help ? (
            <span data-testid={testId ? `${testId}-tooltip` : undefined}>
              <FinanceBiCalcTooltip rule={help} />
            </span>
          ) : null}
        </div>
      </div>
      {subtitle ? <p className="text-[11px] text-[#6B7280] leading-snug">{subtitle}</p> : null}
    </div>
  );
}
