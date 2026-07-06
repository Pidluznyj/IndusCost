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
    <button
      type="button"
      title={rule}
      aria-label={rule}
      className={cn(
        "inline-flex shrink-0 cursor-help border-0 bg-transparent p-0 text-[#6B7280] hover:text-[#2563EB] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40 rounded-sm",
        className
      )}
    >
      <Info className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
