import React from "react";
import { ChevronDown, ChevronUp, Filter, RotateCcw } from "lucide-react";
import {
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
  financeBiSectionClass,
} from "@/src/lib/financeBiDashboardTheme";
import type { FinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { FinanceBiFilterStatusBadge } from "@/src/components/finance/bi/FinanceBiFilterStatusBadge";
import { FinanceBiFilterChips } from "@/src/components/finance/bi/FinanceBiFilterChips";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";

export function FinanceBiFilterPanel({
  expanded,
  onToggle,
  filterStatus,
  chips = [],
  onApply,
  onClear,
  applyDisabled,
  children,
  hint,
}: {
  expanded: boolean;
  onToggle: () => void;
  filterStatus: FinanceBiFilterStatus;
  chips?: FinanceBiFilterChip[];
  onApply: () => void;
  onClear: () => void;
  applyDisabled?: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <section className={financeBiSectionClass}>
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#F9FAFB] transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Filter className="h-4 w-4 text-[#6B7280] shrink-0" />
            <span className="text-sm font-semibold text-[#111827]">Filtros</span>
            <FinanceBiFilterStatusBadge status={filterStatus} />
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[#6B7280] shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0" />
          )}
        </button>
        {expanded ? (
          <div className="border-t border-[#E5E7EB] p-5 space-y-4 bg-[#F9FAFB]/60">
            {hint ? <div className="text-[11px] text-[#6B7280]">{hint}</div> : null}
            {children}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onApply}
                disabled={applyDisabled}
                className={financeBiButtonPrimaryClass}
              >
                <Filter className="h-3.5 w-3.5" />
                Aplicar filtros
              </button>
              <button type="button" onClick={onClear} className={financeBiButtonOutlineClass}>
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <FinanceBiFilterChips chips={chips} />
    </div>
  );
}
