import React from "react";
import { OUT_OF_TABLE_PRICE_TOOLTIP } from "@/src/lib/commissions/commissionOutOfTable";

type Props = {
  className?: string;
  compact?: boolean;
};

export function CommissionOutOfTableBadge({ className = "", compact = false }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200 ${className}`}
      title={OUT_OF_TABLE_PRICE_TOOLTIP}
      data-testid="commission-out-of-table-badge"
    >
      {compact ? "Fora tabela" : "Preço fora da tabela"}
    </span>
  );
}

export function CommissionOutOfTableFlag({ show }: { show: boolean }) {
  if (!show) return null;
  return <CommissionOutOfTableBadge className="ml-1.5" />;
}
