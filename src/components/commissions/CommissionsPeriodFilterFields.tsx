import React, { useMemo } from "react";
import {
  buildCommissionsYearOptions,
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
  COMMISSIONS_MONTH_SELECT_OPTIONS,
} from "@/src/lib/commissionsPeriodFilter";
import { cn } from "@/src/lib/utils";

type Props = {
  year: string;
  month: string;
  onYearChange: (year: string) => void;
  onMonthChange: (month: string) => void;
  yearLabel?: string;
  monthLabel?: string;
  /** Quando true, inclui opção vazia “Todos os anos”. */
  allowAllYears?: boolean;
  disabled?: boolean;
  className?: string;
  fieldClassName?: string;
  labelClassName?: string;
};

export function CommissionsPeriodFilterFields({
  year,
  month,
  onYearChange,
  onMonthChange,
  yearLabel = "Ano",
  monthLabel = "Mês",
  allowAllYears = true,
  disabled,
  className,
  fieldClassName = COMMISSIONS_FILTER_FIELD_CLASS,
  labelClassName = COMMISSIONS_FILTER_LABEL_CLASS,
}: Props) {
  const yearOptions = useMemo(() => {
    const parsed = Number.parseInt(year, 10);
    const center = Number.isFinite(parsed) ? parsed : new Date().getFullYear();
    return buildCommissionsYearOptions(center);
  }, [year]);

  return (
    <>
      <label className={cn("space-y-1", className)}>
        <span className={labelClassName}>{yearLabel}</span>
        <select
          className={fieldClassName}
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          disabled={disabled}
          aria-label={yearLabel}
        >
          {allowAllYears ? <option value="">Todos os anos</option> : null}
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className={cn("space-y-1", className)}>
        <span className={labelClassName}>{monthLabel}</span>
        <select
          className={fieldClassName}
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          disabled={disabled}
          aria-label={monthLabel}
        >
          {COMMISSIONS_MONTH_SELECT_OPTIONS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
