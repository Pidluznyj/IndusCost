import React, { useMemo } from "react";
import type { FinanceCashFlowDailyPoint } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  controlRoomCaptionClass,
  controlRoomCardClass,
} from "@/src/lib/financeControlRoomTheme";
import { cn } from "@/src/lib/utils";

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"] as const;

function cellTone(point: FinanceCashFlowDailyPoint): string {
  if (point.overdueCount > 0) return "border-[#D07722]/35 bg-[#FBF3E8]";
  if (!point.hasMovement) return "border-[#E7E5E4] bg-[#FDFDFC]";
  if (point.netFlowAmount < 0) return "border-[#B64230]/25 bg-[#F9EBE8]";
  if (point.netFlowAmount > 0) return "border-[#2C5530]/25 bg-[#E8F0E9]";
  return "border-[#E7E5E4] bg-[#F5F5F4]";
}

export function FinanceCashFlowCalendar({
  points,
  monthLabel,
}: {
  points: FinanceCashFlowDailyPoint[];
  monthLabel: string;
}) {
  const { leadingBlanks, days } = useMemo(() => {
    if (points.length === 0) return { leadingBlanks: 0, days: [] as FinanceCashFlowDailyPoint[] };
    const firstWeekday = points[0]!.weekday;
    return { leadingBlanks: firstWeekday, days: points };
  }, [points]);

  if (points.length === 0) {
    return (
      <div data-testid="cash-flow-calendar" className={cn(controlRoomCardClass, "p-4")}>
        <p className="font-ui text-sm font-semibold text-[#1C1917]">Calendário de caixa</p>
        <p className={cn(controlRoomCaptionClass, "mt-1")}>
          Sem movimentos para os filtros aplicados.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="cash-flow-calendar" className={cn(controlRoomCardClass, "p-4 space-y-3")}>
      <div>
        <h3 className="font-ui text-sm font-semibold text-[#1C1917]">Calendário de caixa</h3>
        <p className={controlRoomCaptionClass}>{monthLabel} · entradas, saídas e saldo líquido por dia</p>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="font-mono text-[9px] font-semibold uppercase tracking-wide text-[#57534E] text-center py-1"
          >
            {wd}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} className="min-h-[72px]" aria-hidden />
        ))}
        {days.map((point) => (
          <div
            key={point.date}
            data-testid={`calendar-day-${point.date}`}
            className={cn(
              "min-h-[72px] rounded-md border p-1.5 flex flex-col gap-0.5",
              cellTone(point)
            )}
          >
            <span className="font-mono text-[11px] font-semibold text-[#1C1917]">{point.day}</span>
            {point.hasMovement ? (
              <>
                {point.inflowAmount > 0 ? (
                  <span className="font-mono text-[9px] text-[#2C5530] leading-tight">
                    +{formatFinanceCurrencyCompact(point.inflowAmount)}
                  </span>
                ) : null}
                {point.outflowAmount > 0 ? (
                  <span className="font-mono text-[9px] text-[#B64230] leading-tight">
                    −{formatFinanceCurrencyCompact(point.outflowAmount)}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "font-mono text-[9px] font-medium leading-tight",
                    point.netFlowAmount < 0 ? "text-[#B64230]" : "text-[#2C5530]"
                  )}
                >
                  ={formatFinanceCurrencyCompact(point.netFlowAmount)}
                </span>
              </>
            ) : (
              <span className="font-mono text-[9px] text-[#57534E]/70">—</span>
            )}
            {point.overdueCount > 0 ? (
              <span className="font-mono text-[8px] text-[#D07722]">{point.overdueCount} venc.</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
