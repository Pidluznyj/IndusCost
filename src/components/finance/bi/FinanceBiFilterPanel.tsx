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
  title = "Filtros",
  alwaysVisible,
  advancedLabel = "Filtros avançados",
  filterScopeNote,
  compact = false,
}: {
  expanded: boolean;
  onToggle: () => void;
  filterStatus: FinanceBiFilterStatus;
  chips?: FinanceBiFilterChip[];
  onApply: () => void;
  onClear: () => void;
  applyDisabled?: boolean;
  children?: React.ReactNode;
  hint?: React.ReactNode;
  title?: string;
  alwaysVisible?: React.ReactNode;
  advancedLabel?: string;
  filterScopeNote?: string | null;
  compact?: boolean;
}) {
  const hasAdvanced = children != null;
  const sectionPad = compact ? "px-4 py-3" : "px-5 py-4";
  const sectionPadTight = compact ? "px-4 py-2.5" : "px-5 py-3.5";

  return (
    <div className="space-y-2">
      <section className={financeBiSectionClass}>
        {alwaysVisible ? (
          <div className={`${sectionPad} border-b border-[#E5E7EB] space-y-3`}>
            <div className="flex items-center gap-2 min-w-0">
              <Filter className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
              <span className="text-sm font-semibold text-[#111827]">{title}</span>
              <FinanceBiFilterStatusBadge status={filterStatus} />
            </div>
            {alwaysVisible}
          </div>
        ) : null}

        {hasAdvanced ? (
          <button
            type="button"
            onClick={onToggle}
            className={`w-full flex items-center justify-between ${sectionPadTight} hover:bg-[#F9FAFB] transition-colors`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {!alwaysVisible ? (
                <>
                  <Filter className="h-4 w-4 text-[#6B7280] shrink-0" />
                  <span className="text-sm font-semibold text-[#111827]">{title}</span>
                  <FinanceBiFilterStatusBadge status={filterStatus} />
                </>
              ) : (
                <span className="text-sm font-semibold text-[#111827]">{advancedLabel}</span>
              )}
            </div>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[#6B7280] shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0" />
            )}
          </button>
        ) : null}

        {hasAdvanced && expanded ? (
          <div
            className={`border-t border-[#E5E7EB] ${compact ? "p-4 space-y-3" : "p-5 space-y-4"} bg-[#F9FAFB]/60`}
          >
            {hint ? <div className="text-[11px] text-[#6B7280]">{hint}</div> : null}
            {children}
          </div>
        ) : null}

        <div
          className={
            alwaysVisible || (hasAdvanced && expanded)
              ? `border-t border-[#E5E7EB] ${sectionPad} flex items-center gap-2 bg-white`
              : `${sectionPad} flex items-center gap-2`
          }
        >
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled}
            className={financeBiButtonPrimaryClass}
          >
            <Filter className="h-3.5 w-3.5" />
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={onClear}
            className={financeBiButtonOutlineClass}
            data-testid="finance-bi-clear-filters"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
      </section>
      {filterScopeNote ? (
        <p
          className="text-[11px] text-[#6B7280] px-1"
          data-testid="finance-filter-scope-note"
        >
          {filterScopeNote}
        </p>
      ) : null}
      <FinanceBiFilterChips chips={chips} />
    </div>
  );
}
