import React from "react";
import { cn } from "@/src/lib/utils";

export function FinanceBillingSourceBadge({
  variant = "official",
}: {
  variant?: "official" | "diagnostic" | "warning";
}) {
  const styles = {
    official: "bg-blue-50 text-blue-800 border-blue-200",
    diagnostic: "bg-amber-50 text-amber-900 border-amber-200",
    warning: "bg-red-50 text-red-800 border-red-200",
  };
  const labels = {
    official: "Fonte atual: Pedidos/NF em SalesOrder",
    diagnostic: "Fonte diagnóstica: NF-e Nomus (em validação)",
    warning: "Fonte NF-e em validação — dashboard oficial usa SalesOrder",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold",
        styles[variant]
      )}
    >
      {labels[variant]}
    </span>
  );
}
