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
  dailyRadarDayCardLabel,
  EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY,
  formatDailyRadarPayableScheduledDisplay,
  toggleSortState,
  type DailyRadarPayableRow,
  type DailyRadarRangeKey,
  type DailyRadarRangeSummary,
  type DailyRadarReceivableRow,
  type SortState,
} from "@/src/lib/financeCashFlowDailyRadar";
import type { FinanceExecutiveReportCashRadar } from "@/src/lib/financeExecutiveReportCashRadar";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";
import { FinanceCashFlowDailyRadarPdfSection } from "@/src/components/finance/executive-report/FinanceCashFlowDailyRadarPdfSection";
import "@/src/components/finance/cash-flow/finance-cash-flow-daily-radar-payables-grid.css";

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
  staticMode,
}: {
  range: DailyRadarRangeSummary;
  active: boolean;
  onSelect?: () => void;
  staticMode: boolean;
}) {
  const body = (
    <>
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
    </>
  );

  if (staticMode) {
    return (
      <div
        className={cn(financeBiCardClass, "p-4", active && "ring-2 ring-[#2563EB] shadow-sm")}
        data-testid={`executive-report-cash-radar-range-${range.key}`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`executive-report-cash-radar-range-${range.key}`}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        financeBiCardClass,
        "p-4 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] shadow-sm"
      )}
    >
      {body}
    </button>
  );
}

function DayCard({
  day,
  active,
  onSelect,
  staticMode,
}: {
  day: NonNullable<FinanceExecutiveReportCashRadar["radarPayload"]["selectedRange"]>["days"][number];
  active: boolean;
  onSelect?: () => void;
  staticMode: boolean;
}) {
  const body = (
    <>
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
    </>
  );

  if (staticMode) {
    return (
      <div
        className={cn(
          "min-w-[148px] flex-1 rounded-xl border border-[#E5E7EB] bg-white p-3",
          active && "ring-2 ring-[#2563EB] border-[#BFDBFE] shadow-sm"
        )}
        data-testid={`executive-report-cash-radar-day-${day.date}`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`executive-report-cash-radar-day-${day.date}`}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "min-w-[148px] flex-1 rounded-xl border border-[#E5E7EB] bg-white p-3 text-left transition-shadow",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] border-[#BFDBFE] shadow-sm"
      )}
    >
      {body}
    </button>
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
  staticMode,
}: {
  detail: NonNullable<FinanceExecutiveReportCashRadar["selectedRangeDetail"]>["payables"];
  sort: SortState<PayableSortKey>;
  onSort: (key: PayableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  staticMode: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="executive-report-cash-radar-payables">
      <div>
        <h4 className="text-xs font-bold text-[#111827]">Contas a Pagar</h4>
        <p className="text-[10px] text-[#6B7280]">
          {formatFinanceInteger(detail.summary.count)} título(s) · Total{" "}
          {formatFinanceCurrency(detail.summary.total)}
        </p>
      </div>
      {detail.summary.count === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhuma conta a pagar encontrada na faixa.
        </p>
      ) : (
        <FinanceCostCenterGridTableShell
          head={
            <tr>
              <FinanceCostCenterSortableTh
                label="Fornecedor"
                sortKey="supplier"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <FinanceCostCenterSortableTh
                label="Empresa"
                sortKey="company"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Documento/NF
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Descrição
              </th>
              <FinanceCostCenterSortableTh
                label="Vencimento/agendado"
                sortKey="operationalDate"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <FinanceCostCenterSortableTh
                label="Valor"
                sortKey="amount"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
                align="right"
              />
              <FinanceCostCenterSortableTh
                label="Status"
                sortKey="status"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Centro de custo
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Origem
              </th>
            </tr>
          }
          footer={
            !staticMode && detail.totalPages > 1 ? (
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
          {detail.rows.map((row: DailyRadarPayableRow) => (
            <tr key={row.id} className="border-t border-border text-xs finance-cash-flow-daily-radar-payables-row">
              <td className="px-3 py-2 max-w-[140px] truncate">{displayFinanceText(row.supplier)}</td>
              <td className="px-3 py-2 max-w-[120px] truncate">{displayFinanceText(row.company)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.document)}</td>
              <td className="px-3 py-2 max-w-[160px] truncate">{displayFinanceText(row.description)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDailyRadarPayableScheduledDisplay(row)}
              </td>
              <td className="px-3 py-2 text-right font-medium">{formatFinanceCurrency(row.amount)}</td>
              <td className="px-3 py-2">{displayFinanceText(row.status)}</td>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">Nomus AP</td>
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

function ReceivablesGrid({
  detail,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  staticMode,
}: {
  detail: NonNullable<FinanceExecutiveReportCashRadar["selectedRangeDetail"]>["receivables"];
  sort: SortState<ReceivableSortKey>;
  onSort: (key: ReceivableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  staticMode: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="executive-report-cash-radar-receivables">
      <div>
        <h4 className="text-xs font-bold text-[#111827]">Contas a Receber</h4>
        <p className="text-[10px] text-[#6B7280]">
          {formatFinanceInteger(detail.summary.count)} título(s) · Total{" "}
          {formatFinanceCurrency(detail.summary.total)}
        </p>
      </div>
      {detail.summary.count === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhuma conta a receber encontrada na faixa.
        </p>
      ) : (
        <FinanceCostCenterGridTableShell
          head={
            <tr>
              <FinanceCostCenterSortableTh
                label="Cliente"
                sortKey="customer"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <FinanceCostCenterSortableTh
                label="Empresa"
                sortKey="company"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Documento/NF
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Descrição
              </th>
              <FinanceCostCenterSortableTh
                label="Vencimento/previsão"
                sortKey="operationalDate"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <FinanceCostCenterSortableTh
                label="Valor"
                sortKey="amount"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
                align="right"
              />
              <FinanceCostCenterSortableTh
                label="Status"
                sortKey="status"
                sort={sort}
                onSort={staticMode ? () => {} : onSort}
              />
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Origem
              </th>
            </tr>
          }
          footer={
            !staticMode && detail.totalPages > 1 ? (
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
          {detail.rows.map((row: DailyRadarReceivableRow) => (
            <tr key={row.id} className="border-t border-border text-xs">
              <td className="px-3 py-2 max-w-[140px] truncate">{displayFinanceText(row.customer)}</td>
              <td className="px-3 py-2 max-w-[120px] truncate">{displayFinanceText(row.company)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.document)}</td>
              <td className="px-3 py-2 max-w-[160px] truncate">{displayFinanceText(row.description)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.operationalDate)}</td>
              <td className="px-3 py-2 text-right font-medium">{formatFinanceCurrency(row.amount)}</td>
              <td className="px-3 py-2">{displayFinanceText(row.status)}</td>
              <td className="px-3 py-2">Nomus AR</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-[#F9FAFB] text-xs font-bold text-[#111827]">
            <td className="px-3 py-2" colSpan={5}>
              Total ({formatFinanceInteger(detail.summary.count)} título(s))
            </td>
            <td className="px-3 py-2 text-right">{formatFinanceCurrency(detail.summary.total)}</td>
            <td className="px-3 py-2" colSpan={2} />
          </tr>
        </FinanceCostCenterGridTableShell>
      )}
    </div>
  );
}

export function ExecutiveReportCashRadarSection({
  cashRadar,
  reportQuery,
  showHeader = true,
}: {
  cashRadar: FinanceExecutiveReportCashRadar;
  reportQuery: string;
  showHeader?: boolean;
}) {
  const pdfMode = useExecutiveReportPdfMode();
  const staticMode = pdfMode;
  const defaultRange = cashRadar.defaultOpenRange;

  const [data, setData] = useState(cashRadar);
  const [selectedRange, setSelectedRange] = useState<DailyRadarRangeKey>(defaultRange);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
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
  const isInitialMount = React.useRef(true);

  useEffect(() => {
    setData(cashRadar);
    setSelectedRange(cashRadar.defaultOpenRange);
    setSelectedDay(null);
    isInitialMount.current = true;
  }, [cashRadar]);

  useEffect(() => {
    if (staticMode) return;
    const timer = window.setTimeout(() => {
      setSearch(searchDraft);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, staticMode]);

  const loadRadar = useCallback(async () => {
    if (staticMode) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(reportQuery);
      params.set("range", selectedRange);
      if (selectedDay) params.set("day", selectedDay);
      if (search) params.set("search", search);
      const next = await fetchJsonOk<FinanceExecutiveReportCashRadar>(
        `/api/finance/executive-report/cash-radar?${params.toString()}`
      );
      setData(next);
    } finally {
      setLoading(false);
    }
  }, [reportQuery, search, selectedDay, selectedRange, staticMode]);

  useEffect(() => {
    if (staticMode) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    void loadRadar();
  }, [loadRadar, staticMode]);

  const payload = data.radarPayload;
  const detail = data.selectedRangeDetail ?? payload.selectedDetail;
  const selectedRangeSummary = useMemo(
    () => data.ranges.find((r) => r.key === selectedRange) ?? null,
    [data.ranges, selectedRange]
  );
  const showDays = Boolean(payload.selectedRange && selectedRangeSummary);

  if (pdfMode) {
    return (
      <FinanceCashFlowDailyRadarPdfSection cashRadar={data} />
    );
  }

  return (
    <section
      className="space-y-4 executive-report-cash-radar-section"
      data-testid="executive-report-cash-radar"
      aria-label="Radar Diário de Caixa"
    >
      <div>
        {showHeader ? (
          <>
            <h2 className="text-sm font-bold text-[#111827]">Radar Diário de Caixa</h2>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              Comparativo diário de entradas e saídas conforme os filtros do Relatório Presidencial.
            </p>
          </>
        ) : null}
        <p className={cn("text-[10px] text-[#9CA3AF]", showHeader ? "mt-1" : "")}>
          Data-base operacional: {formatFinanceDate(data.baseDate)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="executive-report-cash-radar-filter-chips">
        <span className="text-[10px] font-semibold text-[#6B7280] self-center">Filtros aplicados:</span>
        {data.filtersApplied.map((line) => (
          <span
            key={line.label}
            title={
              line.notApplicable
                ? `Filtro ${line.label} não aplicável ao Radar Diário de Caixa.`
                : undefined
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium",
              line.notApplicable
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-[#E5E7EB] bg-[#F9FAFB] text-[#374151]"
            )}
          >
            <span className="text-[#9CA3AF]">{line.label}:</span> {line.value}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#6B7280]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Atualizando radar…
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.ranges.map((range) => (
          <RangeCard
            key={range.key}
            range={range}
            active={selectedRange === range.key}
            staticMode={staticMode}
            onSelect={() => {
              setSelectedRange(range.key);
              setSelectedDay(null);
              setPage(1);
            }}
          />
        ))}
      </div>

      {showDays && payload.selectedRange ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">
                Dias da faixa: {selectedRangeSummary?.label}
              </h3>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                Clique em um dia para ver contas a pagar e receber.
              </p>
            </div>
            {!staticMode ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedRange(defaultRange);
                  setSelectedDay(null);
                  setPage(1);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
              >
                <X className="h-3.5 w-3.5" />
                Limpar faixa
              </button>
            ) : null}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {payload.selectedRange.days.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                active={selectedDay === day.date}
                staticMode={staticMode}
                onSelect={() => {
                  setSelectedDay((current) => (current === day.date ? null : day.date));
                  setPage(1);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-4")} data-testid="executive-report-cash-radar-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">
                {detail.date
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
          </div>

          {!staticMode ? (
            <FinanceCostCenterGridSearchBar
              value={searchDraft}
              onChange={setSearchDraft}
              placeholder="Buscar cliente, fornecedor, descrição ou documento…"
            />
          ) : null}

          <ReceivablesGrid
            detail={detail.receivables}
            sort={receivableSort}
            onSort={(key) => {
              setReceivableSort((prev) => toggleSortState(prev, key, "desc"));
              setPage(1);
            }}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            staticMode={staticMode}
          />

          <PayablesGrid
            detail={detail.payables}
            sort={payableSort}
            onSort={(key) => {
              setPayableSort((prev) => toggleSortState(prev, key, "desc"));
              setPage(1);
            }}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            staticMode={staticMode}
          />
        </div>
      ) : null}
    </section>
  );
}
