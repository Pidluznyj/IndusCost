import React from "react";
import {
  controlRoomButtonAccentClass,
  controlRoomButtonOutlineClass,
  controlRoomEyebrowClass,
  controlRoomHeaderClass,
  controlRoomMetaLabelClass,
  controlRoomMetaValueClass,
  controlRoomPillClass,
  controlRoomSubtitleClass,
  controlRoomTitleClass,
} from "@/src/lib/financeControlRoomTheme";
import type { FinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

export type FinanceCashFlowHeaderAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  variant?: "outline" | "accent";
  testId?: string;
};

export type FinanceCashFlowHeaderMeta = {
  label: string;
  value: React.ReactNode;
  hint?: string;
};

function filterStatusPill(status?: FinanceBiFilterStatus) {
  if (!status || status === "none") return null;
  const label =
    status === "pending" ? "Filtros pendentes" : status === "applied" ? "Filtros ativos" : "";
  if (!label) return null;
  return (
    <span
      className={cn(
        controlRoomPillClass,
        status === "pending" && "border-[#D07722]/40 bg-[#FBF3E8] text-[#D07722]"
      )}
    >
      {label}
    </span>
  );
}

export function FinanceCashFlowHeader({
  title,
  subtitle,
  scopePill,
  meta = [],
  filterStatus,
  actions = [],
}: {
  title: string;
  subtitle?: React.ReactNode;
  scopePill?: string;
  meta?: FinanceCashFlowHeaderMeta[];
  filterStatus?: FinanceBiFilterStatus;
  actions?: FinanceCashFlowHeaderAction[];
}) {
  return (
    <header className={controlRoomHeaderClass}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={controlRoomEyebrowClass}>Financeiro · Control Room</p>
            {filterStatusPill(filterStatus)}
            {scopePill ? <span className={controlRoomPillClass}>{scopePill}</span> : null}
          </div>
          <h1 className={controlRoomTitleClass}>{title}</h1>
          {subtitle ? <p className={controlRoomSubtitleClass}>{subtitle}</p> : null}
          {meta.length > 0 ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-0.5">
              {meta.map((item) => (
                <div key={item.label} className="inline-flex items-center gap-1">
                  <dt className={`inline ${controlRoomMetaLabelClass}`}>
                    {item.label}
                    {item.hint ? <FinanceBiCalcTooltip rule={item.hint} /> : null}:{" "}
                  </dt>
                  <dd className={`inline ${controlRoomMetaValueClass}`}>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={action.testId}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-busy={action.loading}
                className={
                  action.variant === "accent" ? controlRoomButtonAccentClass : controlRoomButtonOutlineClass
                }
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
