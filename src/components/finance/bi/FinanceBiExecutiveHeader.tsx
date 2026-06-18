import React from "react";
import {
  financeBiEyebrowClass,
  financeBiHeaderClass,
  financeBiMetaLabelClass,
  financeBiMetaValueClass,
  financeBiSubtitleClass,
  financeBiTitleClass,
  financeBiButtonAccentClass,
  financeBiButtonOutlineClass,
} from "@/src/lib/financeBiDashboardTheme";
import type { FinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { FinanceBiFilterStatusBadge } from "@/src/components/finance/bi/FinanceBiFilterStatusBadge";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

export type FinanceBiHeaderMeta = {
  label: string;
  value: React.ReactNode;
  hint?: string;
};
export type FinanceBiHeaderAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  variant?: "outline" | "accent";
};

export function FinanceBiExecutiveHeader({
  eyebrow,
  title,
  subtitle,
  meta = [],
  filterStatus,
  actions = [],
  extraActions,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  meta?: FinanceBiHeaderMeta[];
  filterStatus?: FinanceBiFilterStatus;
  actions?: FinanceBiHeaderAction[];
  extraActions?: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={cn(financeBiHeaderClass, compact && "p-4")}>
      <div className={cn("flex flex-col lg:flex-row lg:items-start lg:justify-between", compact ? "gap-3" : "gap-4")}>
        <div className="min-w-0 space-y-1.5">
          {eyebrow || filterStatus ? (
            <div className="flex flex-wrap items-center gap-2">
              {eyebrow ? <p className={financeBiEyebrowClass}>{eyebrow}</p> : null}
              {filterStatus ? <FinanceBiFilterStatusBadge status={filterStatus} /> : null}
            </div>
          ) : null}
          <h1 className={cn(financeBiTitleClass, compact && "text-xl")}>{title}</h1>
          {subtitle ? <p className={financeBiSubtitleClass}>{subtitle}</p> : null}
          {children}
          {meta.length > 0 ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs pt-1">
              {meta.map((item) => (
                <div key={item.label} className="inline-flex items-center gap-1">
                  <dt className={`inline ${financeBiMetaLabelClass}`}>
                    {item.label}
                    {item.hint ? <FinanceBiCalcTooltip rule={item.hint} /> : null}:{" "}
                  </dt>
                  <dd className={`inline ${financeBiMetaValueClass}`}>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {actions.length > 0 || extraActions ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-busy={action.loading}
                className={cn(
                  action.variant === "accent" ? financeBiButtonAccentClass : financeBiButtonOutlineClass
                )}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
            {extraActions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
