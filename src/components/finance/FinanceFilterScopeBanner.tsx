import React from "react";
import { Filter, ShieldCheck } from "lucide-react";
import {
  FINANCE_FILTER_APPLIED_SCOPE,
  FINANCE_MANAGEMENT_SANITIZATION_SCOPE,
} from "@/src/lib/financeFilterScope";
import type { FinanceDataSanitization } from "@/src/lib/financeInternalGroupExclusions";
import { totalFinanceDataSanitizationIgnored } from "@/src/lib/financeInternalGroupExclusions";
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

export function FinanceManagementSanitizationNote({
  dataSanitization,
  className,
}: {
  dataSanitization?: FinanceDataSanitization | null;
  className?: string;
}) {
  const ignored = dataSanitization ? totalFinanceDataSanitizationIgnored(dataSanitization) : 0;
  return (
    <div
      data-testid="finance-management-sanitization-note"
      className={`${financeBiCardClass} border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 flex items-start gap-2 ${className ?? ""}`.trim()}
      title={FINANCE_MANAGEMENT_SANITIZATION_SCOPE}
    >
      <ShieldCheck className="h-3.5 w-3.5 text-[#6B7280] shrink-0 mt-0.5" />
      <p className="text-[10px] text-[#6B7280] leading-snug">
        {FINANCE_MANAGEMENT_SANITIZATION_SCOPE}
        {ignored > 0 ? ` (${ignored} registros ignorados por saneamento financeiro.)` : ""}
      </p>
    </div>
  );
}
