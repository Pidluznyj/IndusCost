import React from "react";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import type { FinanceBiHeaderAction } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";

export function FinanceExecutivePageHeader({
  eyebrow,
  title,
  subtitle,
  updatedAt,
  updatedAtLabel = "Dados atualizados em",
  actions = [],
  extraActions,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  updatedAt?: string | null;
  updatedAtLabel?: string;
  actions?: FinanceBiHeaderAction[];
  extraActions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <FinanceBiExecutiveHeader
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      actions={actions}
      extraActions={extraActions}
      compact={compact}
    >
      {updatedAt ? (
        <p
          className="text-[11px] text-[#6B7280] tabular-nums"
          data-testid="finance-header-updated-at"
        >
          {updatedAtLabel} {formatFinanceDateTime(updatedAt)}
        </p>
      ) : null}
    </FinanceBiExecutiveHeader>
  );
}
