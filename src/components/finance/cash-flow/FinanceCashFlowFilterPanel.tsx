import React from "react";
import { ChevronDown, ChevronUp, Filter, RotateCcw, X } from "lucide-react";
import {
  controlRoomButtonOutlineClass,
  controlRoomButtonPrimaryClass,
  controlRoomCardClass,
  controlRoomSectionClass,
} from "@/src/lib/financeControlRoomTheme";
import type { FinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import { cn } from "@/src/lib/utils";

function FilterStatusBadge({ status, count }: { status: FinanceBiFilterStatus; count: number }) {
  if (status === "none" && count === 0) return null;
  const label =
    status === "pending"
      ? "Pendente"
      : count > 0
        ? `${count} ativo${count === 1 ? "" : "s"}`
        : "Ativo";
  return (
    <span
      className={cn(
        "font-mono rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        status === "pending"
          ? "border-[#D07722]/40 bg-[#FBF3E8] text-[#D07722]"
          : "border-[#D6D3D1] bg-[#F5F5F4] text-[#57534E]"
      )}
    >
      {label}
    </span>
  );
}

export function FinanceCashFlowFilterPanel({
  expanded,
  onToggle,
  filterStatus,
  activeFilterCount,
  chips = [],
  onApply,
  onClear,
  applyDisabled,
  children,
  hint,
  alwaysVisible,
}: {
  expanded: boolean;
  onToggle: () => void;
  filterStatus: FinanceBiFilterStatus;
  activeFilterCount: number;
  chips?: FinanceBiFilterChip[];
  onApply: () => void;
  onClear: () => void;
  applyDisabled?: boolean;
  children?: React.ReactNode;
  hint?: React.ReactNode;
  alwaysVisible?: React.ReactNode;
}) {
  const hasAdvanced = children != null;

  return (
    <div data-testid="cash-flow-filters" className="space-y-2">
      <section className={controlRoomSectionClass}>
        {alwaysVisible ? (
          <div className="px-4 py-3 border-b border-[#E7E5E4] space-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <Filter className="h-3.5 w-3.5 text-[#57534E] shrink-0" />
              <span className="font-ui text-sm font-semibold text-[#1C1917]">Filtros</span>
              <FilterStatusBadge status={filterStatus} count={activeFilterCount} />
            </div>
            {alwaysVisible}
          </div>
        ) : null}

        {hasAdvanced ? (
          <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#F5F5F4] transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#1C1917]/10"
          >
            <span className="font-ui text-sm font-semibold text-[#1C1917]">Filtros avançados</span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[#57534E]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#57534E]" />
            )}
          </button>
        ) : null}

        {hasAdvanced && expanded ? (
          <div className="border-t border-[#E7E5E4] px-4 py-3 space-y-3 bg-[#F5F5F4]/50">
            {hint ? <div className="font-mono text-[10px] text-[#D07722]">{hint}</div> : null}
            {children}
          </div>
        ) : null}

        <div className="border-t border-[#E7E5E4] px-4 py-3 flex items-center gap-2 bg-[#FDFDFC]">
          <button
            type="button"
            data-testid="cash-flow-filters-apply-btn"
            onClick={onApply}
            disabled={applyDisabled}
            className={controlRoomButtonPrimaryClass}
          >
            <Filter className="h-3 w-3" />
            Aplicar
          </button>
          <button
            type="button"
            data-testid="cash-flow-filters-clear-btn"
            onClick={onClear}
            className={controlRoomButtonOutlineClass}
          >
            <RotateCcw className="h-3 w-3" />
            Limpar
          </button>
        </div>
      </section>

      {chips.length > 0 ? (
        <div className={cn(controlRoomCardClass, "px-3 py-2 flex flex-wrap items-center gap-1.5")}>
          <span className="font-ui text-[10px] font-bold uppercase tracking-wide text-[#57534E] mr-0.5">
            Ativos
          </span>
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="font-ui inline-flex items-center gap-1 rounded-full border border-[#D6D3D1] bg-[#F5F5F4] px-2 py-0.5 text-[10px] font-medium text-[#1C1917]"
            >
              {chip.label}
              {chip.onRemove ? (
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="rounded-full p-0.5 hover:bg-[#E7E5E4] text-[#57534E] focus:outline-none focus:ring-1 focus:ring-[#1C1917]/20"
                  aria-label={`Remover filtro ${chip.label}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
