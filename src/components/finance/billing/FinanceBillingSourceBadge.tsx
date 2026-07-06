import React from "react";
import type { FinanceBillingSource } from "@/src/lib/financeBillingSourceTypes";
import { financeBillingSourceChip } from "@/src/lib/financeBillingSourceTypes";
import { cn } from "@/src/lib/utils";

type LegacyVariant = "official" | "diagnostic" | "warning";

export function FinanceBillingSourceBadge({
  source,
  variant,
  className,
}: {
  source?: FinanceBillingSource;
  variant?: LegacyVariant;
  className?: string;
}) {
  if (source) {
    const isNfe = source === "nfe";
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold",
          isNfe
            ? "bg-emerald-50 text-emerald-900 border-emerald-200"
            : "bg-blue-50 text-blue-800 border-blue-200",
          className
        )}
      >
        {financeBillingSourceChip(source)}
      </span>
    );
  }

  const styles: Record<LegacyVariant, string> = {
    official: "bg-emerald-50 text-emerald-900 border-emerald-200",
    diagnostic: "bg-amber-50 text-amber-900 border-amber-200",
    warning: "bg-red-50 text-red-800 border-red-200",
  };
  const labels: Record<LegacyVariant, string> = {
    official: "Fonte: NF-e fiscal · Status: Autorizada · Mercado: Sim",
    diagnostic: "Comparativo: SalesOrder × NomusNfe",
    warning: "NF-e ainda não sincronizada neste período",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold",
        styles[variant ?? "official"],
        className
      )}
    >
      {labels[variant ?? "official"]}
    </span>
  );
}
