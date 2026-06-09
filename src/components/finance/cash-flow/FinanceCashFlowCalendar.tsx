import React, { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import type { FinanceCashFlowDailyPoint } from "@/src/lib/financeCashFlowCfoDiagnostics";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowCalendar({
  days,
  monthLabel,
}: {
  days: FinanceCashFlowDailyPoint[];
  monthLabel: string;
}) {
  const grid = useMemo(() => buildCalendarGrid(days), [days]);

  if (days.length === 0) {
    return (
      <FinanceBiEmptyState
        title="Calendário financeiro"
        description="Sem movimentos diários para o mês e filtros aplicados."
      />
    );
  }

  return (
    <section className={financeBiSectionClass} data-testid="cash-flow-calendar">
      <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-[#2563EB]" />
        <div>
          <h2 className="text-sm font-bold text-[#111827]">Calendário financeiro</h2>
          <p className="text-[11px] text-[#6B7280]">{monthLabel} — entradas, saídas e líquido por dia</p>
        </div>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-semibold uppercase text-[#6B7280] py-1"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.cells.map((cell, idx) => {
            if (cell.type === "pad") {
              return <div key={`pad-${idx}`} className="min-h-[72px]" />;
            }
            const day = cell.day!;
            return (
              <div
                key={day.date}
                className={cn(
                  "min-h-[72px] rounded-lg border p-1.5 text-[10px] space-y-0.5",
                  day.status === "negative"
                    ? "border-red-200 bg-red-50/60"
                    : day.status === "positive"
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-[#E5E7EB] bg-white",
                  day.hasLargeInflow && "ring-1 ring-emerald-400/50",
                  day.hasLargeOutflow && "ring-1 ring-red-400/50"
                )}
                title={day.summary}
              >
                <p className="font-bold text-[#111827]">{cell.dayNumber}</p>
                {day.inflowAmount > 0 ? (
                  <p className="text-[#059669] truncate">+{formatFinanceCurrency(day.inflowAmount)}</p>
                ) : null}
                {day.outflowAmount > 0 ? (
                  <p className="text-[#DC2626] truncate">−{formatFinanceCurrency(day.outflowAmount)}</p>
                ) : null}
                {(day.inflowAmount > 0 || day.outflowAmount > 0) && (
                  <p
                    className={cn(
                      "font-semibold truncate",
                      day.netAmount < 0
                        ? "text-[#DC2626]"
                        : day.netAmount > 0
                          ? "text-[#059669]"
                          : "text-[#6B7280]"
                    )}
                  >
                    ={formatFinanceCurrency(day.netAmount)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-[#6B7280]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border border-emerald-200 bg-emerald-50" /> Dia positivo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border border-red-200 bg-red-50" /> Dia negativo
          </span>
          <span>Contorno verde = grande entrada · vermelho = grande pagamento</span>
        </div>
      </div>
    </section>
  );
}

function buildCalendarGrid(days: FinanceCashFlowDailyPoint[]) {
  if (days.length === 0) return { cells: [] as Array<{ type: "pad" } | { type: "day"; day: FinanceCashFlowDailyPoint; dayNumber: number }> };

  const first = days[0]!;
  const [y, m] = first.date.split("-").map(Number);
  const startWeekday = new Date(y!, m! - 1, 1).getDay();
  const dayMap = new Map(days.map((d) => [d.date, d]));

  const cells: Array<{ type: "pad" } | { type: "day"; day: FinanceCashFlowDailyPoint; dayNumber: number }> = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push({ type: "pad" });

  const daysInMonth = new Date(y!, m!, 0).getDate();
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const point = dayMap.get(key);
    if (point) {
      cells.push({ type: "day", day: point, dayNumber: d });
    } else {
      cells.push({
        type: "day",
        day: {
          date: key,
          dayLabel: String(d),
          inflowAmount: 0,
          outflowAmount: 0,
          netAmount: 0,
          status: "neutral",
          inflowCount: 0,
          outflowCount: 0,
          hasLargeInflow: false,
          hasLargeOutflow: false,
          summary: "Sem movimentos",
        },
        dayNumber: d,
      });
    }
  }
  return { cells };
}
