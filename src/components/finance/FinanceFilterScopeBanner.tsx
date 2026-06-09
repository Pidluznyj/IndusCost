import React from "react";
import { Filter } from "lucide-react";
import { FINANCE_FILTER_APPLIED_SCOPE } from "@/src/lib/financeFilterScope";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceFilterScopeBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className={`${financeBiCardClass} border-[#2563EB]/20 bg-[#2563EB]/5 px-4 py-2.5 flex items-center gap-2`}
    >
      <Filter className="h-3.5 w-3.5 text-[#2563EB] shrink-0" />
      <p className="text-[11px] font-medium text-[#111827]">{FINANCE_FILTER_APPLIED_SCOPE}</p>
    </div>
  );
}

export function FinanceFilterScopeNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[11px] text-[#6B7280] ${className ?? ""}`.trim()}>{children}</p>
  );
}
