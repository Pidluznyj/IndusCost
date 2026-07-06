import React from "react";
import { X } from "lucide-react";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceBiFilterChips({
  chips,
  className,
}: {
  chips: FinanceBiFilterChip[];
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <div className={`${financeBiCardClass} px-4 py-3 flex flex-wrap items-center gap-2 ${className ?? ""}`.trim()}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] mr-1">
        Filtros ativos
      </span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-[11px] font-medium text-[#111827]"
        >
          {chip.label}
          {chip.onRemove ? (
            <button
              type="button"
              onClick={chip.onRemove}
              className="rounded-full p-0.5 hover:bg-[#E5E7EB] text-[#6B7280]"
              aria-label={`Remover filtro ${chip.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
