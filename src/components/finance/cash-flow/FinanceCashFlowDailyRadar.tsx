import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildDailyRadarQuery,
  dailyRadarDayCardLabel,
  formatDailyRadarPayableScheduledDisplay,
  toggleSortState,
  type DailyRadarDetailGroup,
  type DailyRadarPayableRow,
  type DailyRadarPayload,
  type DailyRadarRangeKey,
  type DailyRadarRangeSummary,
  type DailyRadarReceivableRow,
  type SortState,
} from "@/src/lib/financeCashFlowDailyRadar";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { FinanceCashFlowDailyRadarExportButtons } from "@/src/components/finance/cash-flow/FinanceCashFlowDailyRadarExportButtons";
import "./finance-cash-flow-daily-radar-payables-grid.css";

type PayableSortKey = "supplier" | "company" | "amount" | "status" | "operationalDate";
type ReceivableSortKey = "customer" | "company" | "amount" | "status" | "operationalDate";

function netTone(net: number): string {
  if (net > 0) return "text-[#059669]";
  if (net < 0) return "text-[#DC2626]";
  return "text-[#6B7280]";
}

function timingBadge(timing: "overdue" | "today" | "future"): string {
  if (timing === "overdue") return "Vencido";
  if (timing === "today") return "Hoje";
  return "Futuro";
}

function RangeCard({
  range,
  active,
  onSelect,
}: {
  range: DailyRadarRangeSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`cash-flow-radar-range-${range.key}`}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        financeBiCardClass,
        "p-4 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] shadow-sm"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{range.label}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium text-[#9CA3AF]">Entradas</p>
          <p className="text-sm font-bold text-[#059669]">{formatFinanceCurrency(range.receivableTotal)}</p>
          <p className="text-[10px] text-[#9CA3AF]">{formatFinanceInteger(range.receivableCount)} título(s)</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#9CA3AF]">Saídas</p>
          <p className="text-sm font-bold text-[#DC2626]">{formatFinanceCurrency(range.payableTotal)}</p>
          <p className="text-[10px] text-[#9CA3AF]">{formatFinanceInteger(range.payableCount)} título(s)</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#9CA3AF]">Saldo líquido</p>
          <p className={cn("text-sm font-bold", netTone(range.netTotal))}>
            {formatFinanceCurrency(range.netTotal)}
          </p>
        </div>
      </div>
    </button>
  );
}

function DayCard({
  day,
  active,
  onSelect,
}: {
  day: NonNullable<DailyRadarPayload["selectedRange"]>["days"][number];
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`cash-flow-radar-day-${day.date}`}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "min-w-[148px] flex-1 rounded-xl border border-[#E5E7EB] bg-white p-3 text-left transition-shadow",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] border-[#BFDBFE] shadow-sm"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-[#111827]">{dailyRadarDayCardLabel(day.dayOffset)}</p>
        <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[9px] font-semibold text-[#6B7280]">
          {timingBadge(day.timing)}
        </span>
      </div>
      <p className="text-[10px] text-[#6B7280] mt-0.5">{formatFinanceDate(day.date)}</p>
      <p className="text-[10px] text-[#9CA3AF]">{day.weekday}</p>
      <div className="mt-2 space-y-1">
        <p className="text-[10px] text-[#059669]">
          Entradas: <span className="font-semibold">{formatFinanceCurrency(day.receivableTotal)}</span>
        </p>
        <p className="text-[10px] text-[#DC2626]">
          Saídas: <span className="font-semibold">{formatFinanceCurrency(day.payableTotal)}</span>
        </p>
        <p className={cn("text-[11px] font-bold", netTone(day.netTotal))}>
          Saldo: {formatFinanceCurrency(day.netTotal)}
        </p>
        <p className="text-[9px] text-[#9CA3AF]">
          {formatFinanceInteger(day.receivableCount)} rec. · {formatFinanceInteger(day.payableCount)} pag.
        </p>
      </div>
    </button>
  );
}

export function FinanceCashFlowDailyRadar() {
  const [payload, setPayload] = useState<DailyRadarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<DailyRadarRangeKey | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [payableSort, setPayableSort] = useState<SortState<PayableSortKey>>({
    key: "amount",
    direction: "desc",
  });
  const [receivableSort, setReceivableSort] = useState<SortState<ReceivableSortKey>>({
    key: "amount",
    direction: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildDailyRadarQuery({
        range: selectedRange ?? undefined,
        day: selectedDay ?? undefined,
        search: search || undefined,
        payableSortBy: payableSort.key,
        payableSortDirection: payableSort.direction,
        receivableSortBy: receivableSort.key,
        receivableSortDirection: receivableSort.direction,
        page,
        pageSize,
      });
      const data = await fetchJsonOk<DailyRadarPayload>(
        `/api/finance/cash-flow/daily-radar?${qs}`
      );
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o Radar Diário de Caixa.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, payableSort, receivableSort, search, selectedDay, selectedRange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const selectedRangeSummary = useMemo(
    () => payload?.ranges.find((r) => r.key === selectedRange) ?? null,
    [payload?.ranges, selectedRange]
  );

  const handleRangeClick = (key: DailyRadarRangeKey) => {
    setSelectedRange((current) => (current === key ? null : key));
    setSelectedDay(null);
    setPage(1);
  };

  const handleDayClick = (date: string) => {
    setSelectedDay((current) => (current === date ? null : date));
    setPage(1);
  };

  const handlePayableSort = (key: PayableSortKey) => {
    setPayableSort((prev) => toggleSortState(prev, key, "desc"));
    setPage(1);
  };

  const handleReceivableSort = (key: ReceivableSortKey) => {
    setReceivableSort((prev) => toggleSortState(prev, key, "desc"));
    setPage(1);
  };

  const detail = payload?.selectedDetail;
  const isDayLevel = detail?.level === "day";

  return (
    <section
      className="space-y-4"
      data-testid="cash-flow-daily-radar"
      aria-label="Radar Diário de Caixa"
    >
      <div>
        <h2 className="text-sm font-bold text-[#111827]">Radar Diário de Caixa</h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          Comparativo diário de entradas e saídas, independente dos filtros gerais da página.
        </p>
        {payload?.baseDate ? (
          <p className="text-[10px] text-[#9CA3AF] mt-1">
            Data-base operacional: {formatFinanceDate(payload.baseDate)}
          </p>
        ) : null}
      </div>

      {loading && !payload ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`radar-skel-${i}`} className={cn(financeBiCardClass, "h-28 animate-pulse bg-[#F9FAFB]")} />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : payload ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {payload.ranges.map((range) => (
              <RangeCard
                key={range.key}
                range={range}
                active={selectedRange === range.key}
                onSelect={() => handleRangeClick(range.key)}
              />
            ))}
          </div>

          {selectedRangeSummary && payload.selectedRange ? (
            <div className={cn(financeBiCardClass, "p-4 space-y-3")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#111827]">
                    Dias da faixa: {selectedRangeSummary.label}
                  </h3>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">
                    Clique em um dia para ver contas a pagar e receber.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRange(null);
                    setSelectedDay(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                >
                  <X className="h-3.5 w-3.5" />
                  Limpar faixa
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {payload.selectedRange.days.map((day) => (
                  <DayCard
                    key={day.date}
                    day={day}
                    active={selectedDay === day.date}
                    onSelect={() => handleDayClick(day.date)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {detail ? (
            <div className={cn(financeBiCardClass, "p-4 space-y-4")} data-testid="cash-flow-radar-day-detail">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#111827]">
                    {isDayLevel && detail.date
                      ? `Detalhe do dia — ${formatFinanceDate(detail.date)}`
                      : `Detalhe da faixa — ${detail.rangeLabel}`}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-4 text-[11px]">
                    <span className="text-[#059669]">
                      Entradas: <strong>{formatFinanceCurrency(detail.entriesTotal)}</strong>
                    </span>
                    <span className="text-[#DC2626]">
                      Saídas: <strong>{formatFinanceCurrency(detail.exitsTotal)}</strong>
                    </span>
                    <span className={netTone(detail.netTotal)}>
                      Saldo líquido: <strong>{formatFinanceCurrency(detail.netTotal)}</strong>
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FinanceCashFlowDailyRadarExportButtons
                    rangeKey={detail.rangeKey}
                    rangeLabel={detail.rangeLabel}
                    baseDate={payload.baseDate}
                    selectedDate={detail.date}
                    search={search || undefined}
                    payableSortBy={payableSort.key}
                    payableSortDirection={payableSort.direction}
                    receivableSortBy={receivableSort.key}
                    receivableSortDirection={receivableSort.direction}
                    disabled={loading}
                  />
                  {isDayLevel ? (
                    <button
                      type="button"
                      onClick={() => setSelectedDay(null)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                    >
                      <X className="h-3.5 w-3.5" />
                      Limpar dia
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRange(null);
                        setSelectedDay(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                    >
                      <X className="h-3.5 w-3.5" />
                      Limpar faixa
                    </button>
                  )}
                </div>
              </div>

              <FinanceCostCenterGridSearchBar
                value={searchDraft}
                onChange={setSearchDraft}
                placeholder="Buscar fornecedor, cliente, descrição ou documento…"
                testId="cash-flow-radar-search"
              />

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando títulos do período…
                </div>
              ) : (
                <div className="space-y-6">
                  <PayablesGrid
                    detail={detail.payables}
                    sort={payableSort}
                    onSort={handlePayableSort}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  />
                  <ReceivablesGrid
                    detail={detail.receivables}
                    sort={receivableSort}
                    onSort={handleReceivableSort}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function GridTotalizers({
  summary,
  variant,
}: {
  summary: DailyRadarDetailGroup<unknown>["summary"];
  variant: "payable" | "receivable";
}) {
  const totalLabel = variant === "payable" ? "Total a pagar" : "Total a receber";
  const totalTone = variant === "payable" ? "text-[#DC2626]" : "text-[#059669]";
  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Títulos", value: formatFinanceInteger(summary.count) },
    { label: totalLabel, value: formatFinanceCurrency(summary.total), tone: totalTone },
    { label: "Vencido", value: formatFinanceCurrency(summary.overdueTotal), tone: "text-[#B91C1C]" },
    { label: "A vencer", value: formatFinanceCurrency(summary.upcomingTotal) },
    { label: "Maior título", value: formatFinanceCurrency(summary.maxAmount) },
    { label: "Ticket médio", value: formatFinanceCurrency(summary.averageAmount) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1.5">
          <p className="text-[9px] font-medium uppercase tracking-wide text-[#9CA3AF]">{s.label}</p>
          <p className={cn("text-[12px] font-bold text-[#111827]", s.tone)}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function PayablesGrid({
  detail,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  detail: DailyRadarDetailGroup<DailyRadarPayableRow>;
  sort: SortState<PayableSortKey>;
  onSort: (key: PayableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="space-y-2" data-testid="cash-flow-radar-payables">
      <div>
        <h4 className="text-xs font-bold text-[#111827]">Contas a Pagar</h4>
        <p className="text-[10px] text-[#6B7280]">
          {formatFinanceInteger(detail.summary.count)} título(s) · Total{" "}
          {formatFinanceCurrency(detail.summary.total)}
        </p>
      </div>
      <GridTotalizers summary={detail.summary} variant="payable" />
      {detail.summary.count === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhuma conta a pagar encontrada para este filtro.
        </p>
      ) : (
        <FinanceCostCenterGridTableShell
          tableClassName="cash-flow-radar-payables-grid min-w-[960px]"
          head={
            <tr>
              <FinanceCostCenterSortableTh
                label="Fornecedor"
                sortKey="supplier"
                sort={sort}
                onSort={onSort}
                className="cash-flow-radar-payables-col-supplier"
              />
              <FinanceCostCenterSortableTh
                label="Empresa"
                sortKey="company"
                sort={sort}
                onSort={onSort}
                className="cash-flow-radar-payables-col-company"
              />
              <th className="cash-flow-radar-payables-col-description px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Descrição
              </th>
              <th className="cash-flow-radar-payables-col-document px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Documento
              </th>
              <FinanceCostCenterSortableTh
                label="Vencimento"
                sortKey="operationalDate"
                sort={sort}
                onSort={onSort}
                className="cash-flow-radar-payables-col-due"
              />
              <FinanceCostCenterSortableTh
                label="Valor"
                sortKey="amount"
                sort={sort}
                onSort={onSort}
                align="right"
                className="cash-flow-radar-payables-col-value"
              />
              <th className="cash-flow-radar-payables-col-scheduled px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Agendado
              </th>
            </tr>
          }
          footer={
            detail.totalPages > 1 ? (
              <FinanceCostCenterGridPagination
                page={page}
                totalPages={detail.totalPages}
                pageSize={pageSize}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            ) : null
          }
        >
          {detail.rows.map((row) => {
            const descriptionText = displayFinanceText(row.description);
            return (
              <tr key={row.id} className="border-t border-border text-xs">
                <td className="cash-flow-radar-payables-col-supplier px-3 py-2">
                  <span className="block truncate" title={row.supplier ?? undefined}>
                    {displayFinanceText(row.supplier)}
                  </span>
                </td>
                <td className="cash-flow-radar-payables-col-company px-3 py-2">
                  <span className="block truncate" title={row.company ?? undefined}>
                    {displayFinanceText(row.company)}
                  </span>
                </td>
                <td className="cash-flow-radar-payables-col-description px-3 py-2">
                  <span className="block truncate" title={row.description ?? undefined}>
                    {descriptionText}
                  </span>
                </td>
                <td className="cash-flow-radar-payables-col-document px-3 py-2 whitespace-nowrap">
                  {displayFinanceText(row.document)}
                </td>
                <td className="cash-flow-radar-payables-col-due px-3 py-2 whitespace-nowrap">
                  {formatFinanceDate(row.operationalDate)}
                </td>
                <td className="cash-flow-radar-payables-col-value px-3 py-2 text-right font-medium tabular-nums">
                  {formatFinanceCurrency(row.amount)}
                </td>
                <td className="cash-flow-radar-payables-col-scheduled px-3 py-2 whitespace-nowrap">
                  {formatDailyRadarPayableScheduledDisplay(row)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border bg-[#F9FAFB] text-xs font-bold text-[#111827]">
            <td className="px-3 py-2" colSpan={5}>
              Total ({formatFinanceInteger(detail.summary.count)} título(s))
            </td>
            <td className="cash-flow-radar-payables-col-value px-3 py-2 text-right tabular-nums">
              {formatFinanceCurrency(detail.summary.total)}
            </td>
            <td className="px-3 py-2" />
          </tr>
        </FinanceCostCenterGridTableShell>
      )}
    </div>
  );
}

function ReceivablesGrid({
  detail,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  detail: DailyRadarDetailGroup<DailyRadarReceivableRow>;
  sort: SortState<ReceivableSortKey>;
  onSort: (key: ReceivableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="space-y-2" data-testid="cash-flow-radar-receivables">
      <div>
        <h4 className="text-xs font-bold text-[#111827]">Contas a Receber</h4>
        <p className="text-[10px] text-[#6B7280]">
          {formatFinanceInteger(detail.summary.count)} título(s) · Total{" "}
          {formatFinanceCurrency(detail.summary.total)}
        </p>
      </div>
      <GridTotalizers summary={detail.summary} variant="receivable" />
      {detail.summary.count === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhuma conta a receber encontrada para este filtro.
        </p>
      ) : (
        <FinanceCostCenterGridTableShell
          head={
            <tr>
              <FinanceCostCenterSortableTh label="Cliente" sortKey="customer" sort={sort} onSort={onSort} />
              <FinanceCostCenterSortableTh label="Empresa" sortKey="company" sort={sort} onSort={onSort} />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Pedido/NF
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Descrição
              </th>
              <FinanceCostCenterSortableTh
                label="Vencimento"
                sortKey="operationalDate"
                sort={sort}
                onSort={onSort}
              />
              <FinanceCostCenterSortableTh label="Valor" sortKey="amount" sort={sort} onSort={onSort} align="right" />
              <FinanceCostCenterSortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                NF emitida
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Condição
              </th>
            </tr>
          }
          footer={
            detail.totalPages > 1 ? (
              <FinanceCostCenterGridPagination
                page={page}
                totalPages={detail.totalPages}
                pageSize={pageSize}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            ) : null
          }
        >
          {detail.rows.map((row) => (
            <tr key={row.id} className="border-t border-border text-xs">
              <td className="px-3 py-2 max-w-[140px] truncate">{displayFinanceText(row.customer)}</td>
              <td className="px-3 py-2 max-w-[120px] truncate">{displayFinanceText(row.company)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.document)}</td>
              <td className="px-3 py-2 max-w-[160px] truncate">{displayFinanceText(row.description)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.operationalDate)}</td>
              <td className="px-3 py-2 text-right font-medium">{formatFinanceCurrency(row.amount)}</td>
              <td className="px-3 py-2">{displayFinanceText(row.status)}</td>
              <td className="px-3 py-2">{row.invoiceIssued ? "Sim" : "Não"}</td>
              <td className="px-3 py-2">{displayFinanceText(row.paymentMethod)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-[#F9FAFB] text-xs font-bold text-[#111827]">
            <td className="px-3 py-2" colSpan={5}>
              Total ({formatFinanceInteger(detail.summary.count)} título(s))
            </td>
            <td className="px-3 py-2 text-right">{formatFinanceCurrency(detail.summary.total)}</td>
            <td className="px-3 py-2" colSpan={3} />
          </tr>
        </FinanceCostCenterGridTableShell>
      )}
    </div>
  );
}
