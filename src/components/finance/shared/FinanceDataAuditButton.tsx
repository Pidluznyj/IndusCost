import React from "react";
import { ClipboardList } from "lucide-react";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FINANCE_AUDIT_DRAWER_TITLE } from "@/src/lib/financeDataAuditCopy";
import { cn } from "@/src/lib/utils";

export function FinanceDataAuditButton({
  onClick,
  warningCount = 0,
  disabled,
  title,
}: {
  onClick: () => void;
  warningCount?: number;
  disabled?: boolean;
  title?: string;
}) {
  const hasWarnings = warningCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="finance-data-audit-button"
      title={
        title ??
        (hasWarnings
          ? "Há regras gerenciais ou avisos nesta visão."
          : "Fonte dos dados, sync, filtros e regras gerenciais.")
      }
      className={cn(financeBiButtonOutlineClass, "relative")}
    >
      <ClipboardList className="h-4 w-4" />
      {FINANCE_AUDIT_DRAWER_TITLE}
      {hasWarnings ? (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
          {warningCount} aviso{warningCount !== 1 ? "s" : ""}
        </span>
      ) : null}
    </button>
  );
}
