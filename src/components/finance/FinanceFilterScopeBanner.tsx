import React from "react";
import { Filter, ShieldCheck } from "lucide-react";
import {
  FINANCE_FILTER_APPLIED_SCOPE,
  financeManagementSanitizationScopeMessage,
} from "@/src/lib/financeFilterScope";
import type { FinanceApPurchaseOrderScheduleAudit } from "@/src/lib/financeAccountsPayableDashboardTypes";
import { formatFinanceCurrency, formatFinanceInteger } from "@/src/lib/financeAccountsPayableFormat";
import type { FinanceDataSanitization, FinanceManagementScope } from "@/src/lib/financeInternalGroupExclusions";
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

export function FinanceApPurchaseOrderScheduleAuditNote({
  audit,
  className,
}: {
  audit?: FinanceApPurchaseOrderScheduleAudit | null;
  className?: string;
}) {
  if (!audit || (audit.excludedCount <= 0 && audit.rescheduledOpenCount <= 0)) return null;
  return (
    <div
      data-testid="finance-ap-purchase-order-audit"
      className={`${financeBiCardClass} border-[#E5E7EB] bg-[#FFFBEB] px-3 py-2 ${className ?? ""}`.trim()}
    >
      <p className="text-[10px] text-[#92400E] leading-snug font-medium">
        Agenda de pedidos de compra excluída da visão gerencial
      </p>
      {audit.excludedCount > 0 ? (
        <p className="text-[10px] text-[#78350F] leading-snug mt-1">
          {formatFinanceInteger(audit.excludedCount)} título
          {audit.excludedCount !== 1 ? "s" : ""} · {formatFinanceCurrency(audit.excludedAmount)}{" "}
          removido{audit.excludedCount !== 1 ? "s" : ""} dos KPIs de atraso
        </p>
      ) : null}
      {audit.rescheduledOpenCount > 0 ? (
        <p className="text-[10px] text-[#78350F] leading-snug mt-1">
          {formatFinanceInteger(audit.rescheduledOpenCount)} título
          {audit.rescheduledOpenCount !== 1 ? "s" : ""} em aberto com agendamento diferente do
          vencimento original ({formatFinanceCurrency(audit.rescheduledOpenAmount)})
        </p>
      ) : null}
    </div>
  );
}

export function FinanceManagementSanitizationNote({
  dataSanitization,
  managementScope = "company",
  className,
}: {
  dataSanitization?: FinanceDataSanitization | null;
  managementScope?: FinanceManagementScope;
  className?: string;
}) {
  const ignored = dataSanitization ? totalFinanceDataSanitizationIgnored(dataSanitization) : 0;
  const scopeMessage = financeManagementSanitizationScopeMessage(managementScope);
  return (
    <div
      data-testid="finance-management-sanitization-note"
      className={`${financeBiCardClass} border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 flex items-start gap-2 ${className ?? ""}`.trim()}
      title={scopeMessage}
    >
      <ShieldCheck className="h-3.5 w-3.5 text-[#6B7280] shrink-0 mt-0.5" />
      <p className="text-[10px] text-[#6B7280] leading-snug">
        {scopeMessage}
        {ignored > 0 ? ` (${ignored} registros ignorados por saneamento financeiro.)` : ""}
      </p>
    </div>
  );
}
