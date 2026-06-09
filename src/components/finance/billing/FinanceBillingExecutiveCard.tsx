import React from "react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";

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
  loading?: boolean;
}) {
  return (
    <FinanceBiKpiCard
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
