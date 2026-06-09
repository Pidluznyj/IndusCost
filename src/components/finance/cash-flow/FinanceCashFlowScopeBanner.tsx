import React from "react";
import { Filter } from "lucide-react";
import { controlRoomCardClass } from "@/src/lib/financeControlRoomTheme";
import { FINANCE_FILTER_APPLIED_SCOPE } from "@/src/lib/financeFilterScope";

export function FinanceCashFlowScopeBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className={`${controlRoomCardClass} border-[#2C5530]/25 bg-[#E8F0E9] px-3 py-2 flex items-center gap-2`}
    >
      <Filter className="h-3.5 w-3.5 text-[#2C5530] shrink-0" />
      <p className="font-ui text-[11px] font-medium text-[#1C1917]">{FINANCE_FILTER_APPLIED_SCOPE}</p>
    </div>
  );
}
