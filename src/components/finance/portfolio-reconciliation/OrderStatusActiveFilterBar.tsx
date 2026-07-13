import React from "react";
import { FinanceBiFilterChips } from "@/src/components/finance/bi/FinanceBiFilterChips";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";

type Props = {
  chips: FinanceBiFilterChip[];
  onClearAll: () => void;
};

/** Barra de contexto dos filtros ativos (chips removíveis). */
export function OrderStatusActiveFilterBar({ chips, onClearAll }: Props) {
  if (!chips.length) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      data-testid="order-status-active-filters"
    >
      <div className="min-w-0 flex-1 overflow-x-auto">
        <FinanceBiFilterChips chips={chips} />
      </div>
      <button
        type="button"
        className="shrink-0 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#344054] hover:bg-[#F9FAFB]"
        onClick={onClearAll}
        data-testid="order-status-clear-chips"
      >
        Limpar tudo
      </button>
    </div>
  );
}
