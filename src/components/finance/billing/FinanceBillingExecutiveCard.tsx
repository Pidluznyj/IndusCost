import React from "react";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";

export function FinanceBillingExecutiveCard({
  label,
  value,
  sub,
  hint,
  scopeNote,
  colorClass = "text-[#111827]",
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  scopeNote?: string;
  colorClass?: string;
  valueClassName?: string;
  loading?: boolean;
}) {
  return (
    <FinanceExecutiveTotalizerCard
      label={label}
      value={value}
      sub={sub}
      hint={hint}
      scopeNote={scopeNote}
      colorClass={colorClass}
      loading={loading}
    />
  );
}
