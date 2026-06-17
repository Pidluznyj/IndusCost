import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from "lucide-react";
import type {
  FinanceCashFlowCalendarDay,
  FinanceCashFlowCalendarPayload,
  FinanceCashFlowCalendarWeekSummary,
} from "@/src/lib/financeCashFlowCalendar";
import {
  CALENDAR_MOVEMENT_NATURE_LABELS,
  filterCalendarMovements,
  sumCalendarMovementAmounts,
} from "@/src/lib/financeCashFlowCalendar";
import type { FinanceCashFlowViewMode } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  DEFAULT_CALENDAR_MOVEMENT_SORT,
  sortCalendarMovements,
  toggleCalendarMovementSort,
  type CalendarMovementSortKey,
} from "@/src/lib/financeCashFlowCalendarTableSort";
import type { SortState } from "@/src/lib/soldProductsTableSort";
import {
  displayFinanceText,
  formatFinanceCurrency,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { cn } from "@/src/lib/utils";

type CalendarCell =
  | { type: "pad" }
  | { type: "day"; day: FinanceCashFlowCalendarDay; dayNumber: number };

type CalendarRow = {
  cells: CalendarCell[];
  weekSummary?: FinanceCashFlowCalendarWeekSummary;
};

function formatDisplayDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("pt-BR");
}

function formatShortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function buildCalendarRows(calendar: FinanceCashFlowCalendarPayload): CalendarRow[] {
  const { year, month, days, weeks } = calendar;
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const flatCells: CalendarCell[] = [];
  for (let i = 0; i < startWeekday; i += 1) flatCells.push({ type: "pad" });
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const day =
      dayMap.get(key) ??
      ({
        date: key,
        day: d,
        inflow: 0,
        outflow: 0,
        net: 0,
        receivableCount: 0,
        payableCount: 0,
        movementCount: 0,
        movements: [],
        status: "neutral",
        hasLargeInflow: false,
        hasLargeOutflow: false,
        summary: "Sem movimentos",
      } satisfies FinanceCashFlowCalendarDay);
    flatCells.push({ type: "day", day, dayNumber: d });
  }

  const rows: CalendarRow[] = [];
  for (let i = 0; i < flatCells.length; i += 7) {
    const cells = flatCells.slice(i, i + 7);
    while (cells.length < 7) cells.push({ type: "pad" });
    const weekSummary = weeks.find((w) => {
      const firstDayInRow = cells.find((c) => c.type === "day") as
        | Extract<CalendarCell, { type: "day" }>
        | undefined;
      if (!firstDayInRow) return false;
      return firstDayInRow.day.date >= w.startDate && firstDayInRow.day.date <= w.endDate;
    });
    rows.push({ cells, weekSummary });
  }
  return rows;
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: CalendarMovementSortKey;
  sort: SortState<CalendarMovementSortKey>;
  onSort: (key: CalendarMovementSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10px] font-bold text-[#6B7280] cursor-pointer select-none whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : null}
      </span>
    </th>
  );
}

function CalendarDayDetail({
  day,
  viewModeLabel,
}: {
  day: FinanceCashFlowCalendarDay;
  viewModeLabel: string;
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | "AR" | "AP">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(DEFAULT_CALENDAR_MOVEMENT_SORT);

  const filtered = useMemo(
    () => filterCalendarMovements(day.movements, typeFilter, search),
    [day.movements, typeFilter, search]
  );
  const rows = useMemo(() => sortCalendarMovements(filtered, sort), [filtered, sort]);
  const totals = useMemo(() => sumCalendarMovementAmounts(filtered), [filtered]);

  const handleSort = (key: CalendarMovementSortKey) => {
    setSort((current) => toggleCalendarMovementSort(current, key));
  };

  return (
    <div
      className={cn(financeBiCardClass, "mt-4 overflow-hidden")}
      data-testid="cash-flow-calendar-detail"
    >
      <div className="px-5 py-4 border-b border-[#E5E7EB] space-y-3">
        <div>
          <h3 className="text-sm font-bold text-[#111827]">
            Movimentos de {formatDisplayDate(day.date)}
          </h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            CR: {formatFinanceCurrency(day.inflow)} | CP: {formatFinanceCurrency(day.outflow)} |
            Saldo:{" "}
            <span
              className={cn(
                "font-semibold",
                day.net < 0 ? "text-[#DC2626]" : day.net > 0 ? "text-[#059669]" : "text-[#6B7280]"
              )}
            >
              {formatFinanceCurrency(day.net)}
            </span>
            {" · "}
            {viewModeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#E5E7EB] p-0.5 bg-[#F9FAFB]">
            {(
              [
                ["all", "Todos"],
                ["AR", "Contas a Receber"],
                ["AP", "Contas a Pagar"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded-md transition-colors",
                  typeFilter === value
                    ? "bg-white shadow-sm font-semibold text-[#111827]"
                    : "text-[#6B7280] hover:text-[#111827]"
                )}
                onClick={() => setTypeFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar título..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#E5E7EB] rounded-lg bg-white"
              data-testid="cash-flow-calendar-search"
            />
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-[#6B7280]">
          Nenhum título encontrado para este dia nos filtros aplicados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <tr>
                <SortableTh label="Tipo" sortKey="type" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold text-[#6B7280] whitespace-nowrap text-left">
                  Natureza
                </th>
                <SortableTh label="Empresa" sortKey="companyName" sort={sort} onSort={handleSort} />
                <SortableTh
                  label="Cliente/Fornecedor"
                  sortKey="personName"
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Documento/NF"
                  sortKey="documentNumber"
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableTh label="Descrição" sortKey="description" sort={sort} onSort={handleSort} />
                <SortableTh label="Vencimento" sortKey="dueDate" sort={sort} onSort={handleSort} />
                <SortableTh
                  label="Agendamento"
                  sortKey="scheduleDate"
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Receb./Pag."
                  sortKey="settlementDate"
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Valor original"
                  sortKey="amountOriginal"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                />
                <SortableTh
                  label="Valor realizado"
                  sortKey="amountRealized"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                />
                <SortableTh
                  label="Saldo aberto"
                  sortKey="balanceOpen"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                <SortableTh label="Origem" sortKey="source" sort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isCr = row.type === "AR";
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA]"
                    title={row.ruleNotes?.join(" ")}
                  >
                    <td
                      className={cn(
                        "px-3 py-2 text-xs font-bold",
                        isCr ? "text-[#059669]" : "text-[#DC2626]"
                      )}
                    >
                      {isCr ? "CR" : "CP"}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-[#374151] whitespace-nowrap">
                      {CALENDAR_MOVEMENT_NATURE_LABELS[row.nature]}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#111827]">
                      {displayFinanceText(row.companyName)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#111827]">
                      {displayFinanceText(row.personName)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6B7280]">
                      {displayFinanceText(row.documentNumber ?? row.invoiceNumber)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6B7280] max-w-[160px] truncate">
                      {displayFinanceText(row.description)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6B7280]">
                      {row.dueDate ? formatDisplayDate(row.dueDate.slice(0, 10)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6B7280]">
                      {row.scheduleDate ? formatDisplayDate(row.scheduleDate.slice(0, 10)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#6B7280]">
                      {row.settlementDate
                        ? formatDisplayDate(row.settlementDate.slice(0, 10))
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-[#111827]">
                      {formatFinanceCurrency(row.amountOriginal)}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-[#111827]">
                      {formatFinanceCurrency(row.amountRealized)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-xs font-semibold text-right tabular-nums",
                        isCr ? "text-[#059669]" : "text-[#DC2626]"
                      )}
                    >
                      {formatFinanceCurrency(row.balanceOpen)}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-[#6B7280]">{row.status}</td>
                    <td className="px-3 py-2 text-[10px] text-[#6B7280]" title={row.externalId ?? ""}>
                      {row.source}
                      {row.externalId ? ` #${row.externalId}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#F9FAFB] border-t border-[#E5E7EB]">
              <tr>
                <td colSpan={9} className="px-3 py-2 text-[11px] font-semibold text-[#6B7280]">
                  Total do grid ({rows.length} título{rows.length === 1 ? "" : "s"})
                </td>
                <td
                  colSpan={5}
                  className="px-3 py-2 text-xs font-bold text-right tabular-nums space-x-3"
                >
                  <span className="text-[#059669]">CR {formatFinanceCurrency(totals.inflow)}</span>
                  <span className="text-[#DC2626]">CP {formatFinanceCurrency(totals.outflow)}</span>
                  <span
                    className={cn(
                      totals.net < 0 ? "text-[#DC2626]" : totals.net > 0 ? "text-[#059669]" : ""
                    )}
                  >
                    Saldo {formatFinanceCurrency(totals.net)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export function FinanceCashFlowCalendar({
  calendar,
  viewMode,
  viewModeLabel,
  filterYearLabel,
  onDisplayMonthChange,
}: {
  calendar: FinanceCashFlowCalendarPayload;
  viewMode: FinanceCashFlowViewMode;
  viewModeLabel: string;
  filterYearLabel: string;
  onDisplayMonthChange?: (month: number) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const rows = useMemo(() => buildCalendarRows(calendar), [calendar]);
  const selectedDay = useMemo(
    () => (selectedDate ? calendar.days.find((d) => d.date === selectedDate) : undefined),
    [calendar.days, selectedDate]
  );

  const displayMonthLabel =
    calendar.monthNav.find((m) => m.month === calendar.displayMonth)?.monthLabel ??
    String(calendar.displayMonth);

  const prevMonth = calendar.displayMonth > 1 ? calendar.displayMonth - 1 : null;
  const nextMonth = calendar.displayMonth < 12 ? calendar.displayMonth + 1 : null;
  const canNavigate = calendar.isAnnualFilter && onDisplayMonthChange != null;

  if (calendar.yearMovementCount === 0) {
    return (
      <FinanceBiEmptyState
        title="Calendário financeiro"
        description="Sem movimentos diários para o ano e filtros aplicados."
      />
    );
  }

  const { monthSummary, reconciliation } = calendar;
  const isProjectedView = viewMode === "projected" || viewMode === "combined";

  const formatMonthNavLabel = (item: (typeof calendar.monthNav)[number]) => {
    if (item.movementCount === 0) return item.monthLabel;
    if (isProjectedView) {
      return `${item.monthLabel} (Entradas est. ${formatFinanceCurrency(item.inflow)} / Saídas est. ${formatFinanceCurrency(item.outflow)})`;
    }
    return `${item.monthLabel} (Recebido ${formatFinanceCurrency(item.inflowRealized)} / Pago ${formatFinanceCurrency(item.outflowRealized)})`;
  };

  return (
    <section className={financeBiSectionClass} data-testid="cash-flow-calendar">
      <div className="px-5 py-4 border-b border-[#E5E7EB] space-y-3">
        <div className="flex items-start gap-2">
          <CalendarDays className="h-4 w-4 text-[#2563EB] mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-[#111827]">
              Calendário financeiro — {displayMonthLabel}/{calendar.year}
            </h2>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              Escopo: Filtro {calendar.isAnnualFilter ? "anual" : "mensal"}{" "}
              {filterYearLabel} | Mês exibido: {displayMonthLabel} | {viewModeLabel}
            </p>
            {calendar.isAnnualFilter ? (
              <p
                className="text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-2 py-1 mt-2 inline-block"
                data-testid="cash-flow-calendar-annual-notice"
              >
                O filtro está anual (Mês = Todos). O calendário exibe um mês por vez — os cards
                da visão geral somam o ano inteiro.
              </p>
            ) : null}
          </div>
        </div>

        {canNavigate ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="cash-flow-calendar-month-nav">
            <button
              type="button"
              disabled={prevMonth == null}
              onClick={() => prevMonth != null && onDisplayMonthChange(prevMonth)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[#E5E7EB] disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {prevMonth
                ? calendar.monthNav.find((m) => m.month === prevMonth)?.monthLabel
                : "Anterior"}
            </button>
            <label className="text-[11px] text-[#6B7280] flex items-center gap-1.5">
              Mês exibido:
              <select
                value={calendar.displayMonth}
                onChange={(e) => onDisplayMonthChange(Number(e.target.value))}
                className="rounded-md border border-[#E5E7EB] px-2 py-1 text-xs text-[#111827] bg-white"
                data-testid="cash-flow-calendar-month-select"
              >
                {calendar.monthNav.map((item) => (
                  <option key={item.month} value={item.month}>
                    {formatMonthNavLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={nextMonth == null}
              onClick={() => nextMonth != null && onDisplayMonthChange(nextMonth)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[#E5E7EB] disabled:opacity-40"
            >
              {nextMonth
                ? calendar.monthNav.find((m) => m.month === nextMonth)?.monthLabel
                : "Próximo"}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div
          className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[11px]"
          data-testid="cash-flow-calendar-month-summary"
        >
          {isProjectedView ? (
            <>
              <div>
                <span className="text-[#6B7280]">Entradas estimadas do mês</span>
                <p className="font-bold text-[#059669] tabular-nums">
                  {formatFinanceCurrency(monthSummary.inflow)}
                </p>
                <p className="text-[10px] text-[#6B7280] tabular-nums mt-0.5">
                  Recebido {formatFinanceCurrency(monthSummary.inflowRealized)} + Aberto{" "}
                  {formatFinanceCurrency(monthSummary.inflowOpen)}
                </p>
              </div>
              <div>
                <span className="text-[#6B7280]">Saídas estimadas do mês</span>
                <p className="font-bold text-[#DC2626] tabular-nums">
                  {formatFinanceCurrency(monthSummary.outflow)}
                </p>
                <p className="text-[10px] text-[#6B7280] tabular-nums mt-0.5">
                  Pago {formatFinanceCurrency(monthSummary.outflowRealized)} + Aberto{" "}
                  {formatFinanceCurrency(monthSummary.outflowOpen)}
                </p>
              </div>
              <div>
                <span className="text-[#6B7280]">Saldo estimado do mês</span>
                <p
                  className={cn(
                    "font-bold tabular-nums",
                    monthSummary.net < 0
                      ? "text-[#DC2626]"
                      : monthSummary.net > 0
                        ? "text-[#059669]"
                        : "text-[#111827]"
                  )}
                >
                  {formatFinanceCurrency(monthSummary.net)}
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-[#6B7280]">Recebido no mês</span>
                <p className="font-bold text-[#059669] tabular-nums">
                  {formatFinanceCurrency(monthSummary.inflowRealized)}
                </p>
              </div>
              <div>
                <span className="text-[#6B7280]">Pago no mês</span>
                <p className="font-bold text-[#DC2626] tabular-nums">
                  {formatFinanceCurrency(monthSummary.outflowRealized)}
                </p>
              </div>
              <div>
                <span className="text-[#6B7280]">Saldo realizado</span>
                <p
                  className={cn(
                    "font-bold tabular-nums",
                    monthSummary.net < 0
                      ? "text-[#DC2626]"
                      : monthSummary.net > 0
                        ? "text-[#059669]"
                        : "text-[#111827]"
                  )}
                >
                  {formatFinanceCurrency(monthSummary.net)}
                </p>
              </div>
            </>
          )}
          <div>
            <span className="text-[#6B7280]">Movimentos</span>
            <p className="font-semibold text-[#111827]">
              CR {monthSummary.receivableCount} · CP {monthSummary.payableCount} · Total{" "}
              {monthSummary.movementCount}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "rounded-lg border px-4 py-2 text-[11px]",
            reconciliation.status === "ok"
              ? "border-emerald-200 bg-emerald-50/50 text-[#065F46]"
              : "border-amber-200 bg-amber-50/60 text-[#92400E]"
          )}
          data-testid="cash-flow-calendar-reconciliation"
        >
          <p className="font-semibold">
            Conciliação com linha do tempo — {displayMonthLabel}/{calendar.year}:{" "}
            {reconciliation.status === "ok" ? "OK" : "Divergência"}
          </p>
          {isProjectedView ? (
            <p className="mt-0.5 tabular-nums">
              Entradas est. calendário {formatFinanceCurrency(reconciliation.calendarEstimatedInflow)}{" "}
              · linha {formatFinanceCurrency(reconciliation.timelineEstimatedInflow)}
              {reconciliation.status === "mismatch"
                ? ` · Δ ${formatFinanceCurrency(reconciliation.estimatedInflowDiff)}`
                : ""}
              {" | "}
              Saídas est. calendário {formatFinanceCurrency(reconciliation.calendarEstimatedOutflow)} ·
              linha {formatFinanceCurrency(reconciliation.timelineEstimatedOutflow)}
              {" | "}
              Saldo calendário {formatFinanceCurrency(reconciliation.calendarNet)} · linha{" "}
              {formatFinanceCurrency(reconciliation.timelineNet)}
            </p>
          ) : (
            <p className="mt-0.5 tabular-nums">
              Recebido calendário {formatFinanceCurrency(reconciliation.calendarReceived)} · linha{" "}
              {formatFinanceCurrency(reconciliation.timelineReceived)}
              {" | "}
              Pago calendário {formatFinanceCurrency(reconciliation.calendarPaid)} · linha{" "}
              {formatFinanceCurrency(reconciliation.timelinePaid)}
              {" | "}
              Saldo calendário {formatFinanceCurrency(reconciliation.calendarNet)} · linha{" "}
              {formatFinanceCurrency(reconciliation.timelineNet)}
            </p>
          )}
        </div>
      </div>
      <div className="p-5">
        {monthSummary.movementCount === 0 ? (
          <p className="text-sm text-[#6B7280] mb-4">
            Nenhum movimento previsto/realizado neste mês nos filtros aplicados. Navegue para outro
            mês para ver os títulos.
          </p>
        ) : null}
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

        <div className="space-y-1">
          {rows.map((row, rowIdx) => (
            <React.Fragment key={`row-${rowIdx}`}>
              <div className="grid grid-cols-7 gap-1">
                {row.cells.map((cell, idx) => {
                  if (cell.type === "pad") {
                    return <div key={`pad-${rowIdx}-${idx}`} className="min-h-[80px]" />;
                  }
                  const day = cell.day;
                  const isSelected = selectedDate === day.date;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setSelectedDate(day.date)}
                      className={cn(
                        "min-h-[80px] rounded-lg border p-1.5 text-[10px] space-y-0.5 text-left transition-shadow",
                        day.status === "negative"
                          ? "border-red-200 bg-red-50/60"
                          : day.status === "positive"
                            ? "border-emerald-200 bg-emerald-50/40"
                            : "border-[#E5E7EB] bg-white",
                        day.hasLargeInflow && "ring-1 ring-emerald-400/50",
                        day.hasLargeOutflow && "ring-1 ring-red-400/50",
                        isSelected && "ring-2 ring-[#2563EB] ring-offset-1",
                        day.movementCount === 0 && "opacity-70"
                      )}
                      title={day.summary}
                      data-testid={`cash-flow-calendar-day-${day.date}`}
                    >
                      <p className="font-bold text-[#111827]">{cell.dayNumber}</p>
                      {day.inflow > 0 ? (
                        <p className="text-[#059669] leading-tight break-all">
                          CR +{formatFinanceCurrency(day.inflow)}
                        </p>
                      ) : null}
                      {day.outflow > 0 ? (
                        <p className="text-[#DC2626] leading-tight break-all">
                          CP −{formatFinanceCurrency(day.outflow)}
                        </p>
                      ) : null}
                      {(day.inflow > 0 || day.outflow > 0) && (
                        <p
                          className={cn(
                            "font-semibold leading-tight break-all",
                            day.net < 0
                              ? "text-[#DC2626]"
                              : day.net > 0
                                ? "text-[#059669]"
                                : "text-[#6B7280]"
                          )}
                        >
                          = {formatFinanceCurrency(day.net)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {row.weekSummary ? (
                <div
                  className="rounded-md bg-[#F3F4F6] px-3 py-1.5 text-[10px] text-[#374151] flex flex-wrap gap-x-4 gap-y-0.5"
                  data-testid={`cash-flow-calendar-week-${row.weekSummary.weekIndex}`}
                >
                  <span className="font-semibold">
                    Semana {formatShortDate(row.weekSummary.startDate)} a{" "}
                    {formatShortDate(row.weekSummary.endDate)}
                  </span>
                  <span>CR: {formatFinanceCurrency(row.weekSummary.inflow)}</span>
                  <span>CP: {formatFinanceCurrency(row.weekSummary.outflow)}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      row.weekSummary.net < 0
                        ? "text-[#DC2626]"
                        : row.weekSummary.net > 0
                          ? "text-[#059669]"
                          : ""
                    )}
                  >
                    Saldo: {formatFinanceCurrency(row.weekSummary.net)}
                  </span>
                </div>
              ) : null}
            </React.Fragment>
          ))}
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

      {selectedDay ? <CalendarDayDetail day={selectedDay} viewModeLabel={viewModeLabel} /> : null}
    </section>
  );
}
