import React from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/src/lib/utils";

/** Botão no canto do card para abrir o gráfico em modo apresentação. */
export function FinanceBiChartExpandButton({
  onClick,
  testId,
  className,
  label = "Ampliar gráfico",
}: {
  onClick: () => void;
  testId?: string;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280]",
        "hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        className
      )}
    >
      <Maximize2 className="h-4 w-4" aria-hidden />
    </button>
  );
}
