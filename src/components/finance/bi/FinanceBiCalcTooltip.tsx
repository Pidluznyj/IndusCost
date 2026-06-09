import React from "react";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";

/** Tooltip de regra de cálculo / escopo — padrão BI Financeiro. */
export function FinanceBiCalcTooltip({
  rule,
  className,
}: {
  rule: string;
  className?: string;
}) {
  return (
    <span
      title={rule}
      className={cn("inline-flex cursor-help text-[#6B7280] hover:text-[#2563EB]", className)}
      aria-label={rule}
      role="img"
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}
