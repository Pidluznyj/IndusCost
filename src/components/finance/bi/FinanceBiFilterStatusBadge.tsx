import React from "react";
import {
  FINANCE_BI_FILTER_STATUS_LABELS,
  type FinanceBiFilterStatus,
} from "@/src/lib/financeBiFilterState";
import { cn } from "@/src/lib/utils";

const STATUS_STYLES: Record<FinanceBiFilterStatus, string> = {
  none: "bg-[#F3F4F6] text-[#6B7280]",
  applied: "bg-[#2563EB]/10 text-[#2563EB]",
  pending: "bg-amber-50 text-amber-800",
};

export function FinanceBiFilterStatusBadge({ status }: { status: FinanceBiFilterStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap",
        STATUS_STYLES[status]
      )}
    >
      {FINANCE_BI_FILTER_STATUS_LABELS[status]}
    </span>
  );
}
