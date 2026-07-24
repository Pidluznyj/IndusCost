import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import { fetchJsonOk } from "@/src/lib/http";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import {
  buildDueRadarQuery,
  dailyRadarDayCardLabel,
  toggleSortState,
  type DueRadarDetailGroup,
  type DueRadarPayload,
  type DueRadarPayableGridRow,
  type DueRadarRangeKey,
  type DueRadarRangeSummary,
  type DueRadarReceivableGridRow,
  type SortState,
} from "@/src/lib/financeDueRadar";
import { buildDueRadarApiUrl, DUE_RADAR_COPY } from "@/src/lib/financeDueRadarApi";
import type { DueRadarMode } from "@/src/lib/financeDueRadarFilters";
import {
  buildDueRadarExportQueryString,
  type DueRadarExportPayload,
} from "@/src/lib/financeDueRadarExport";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import "@/src/components/finance/cash-flow/finance-cash-flow-daily-radar-payables-grid.css";
import "@/src/components/finance/cash-flow/finance-cash-flow-daily-radar-print.css";

type ReceivableSortKey = "customer" | "company" | "amount" | "status" | "operationalDate";
type PayableSortKey = "supplier" | "company" | "amount" | "operationalDate";

function timingBadge(timing: "overdue" | "today" | "future"): string {
  if (timing === "overdue") return "Vencido";
  if (timing === "today") return "Hoje";
  return "Futuro";
}

function RangeCard({
  range,
  active,
  onSelect,
  mode,
}: {
  range: DueRadarRangeSummary;
  active: boolean;
  onSelect: () => void;
  mode: DueRadarMode;
}) {
  const toneClass =
    range.tone === "overdue"
      ? "text-[#DC2626]"
      : mode === "receivable"
        ? "text-[#059669]"
        : "text-[#EA580C]";
  return (
    <button
      type="button"
      data-testid={`due-radar-range-${range.key}`}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        financeBiCardClass,
        "p-4 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] shadow-sm"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{range.label}</p>
      <p className={cn("text-lg font-bold mt-2", toneClass)}>{formatFinanceCurrency(range.totalAmount)}</p>
      <p className="text-[10px] text-[#9CA3AF] mt-1">
        {formatFinanceInteger(range.titleCount)} título(s)
      </p>
    </button>
  );
}

function DayCard({
  day,
  active,
  onSelect,
  mode,
}: {
  day: NonNullable<DueRadarPayload["selectedRange"]>["days"][number];
  active: boolean;
  onSelect: () => void;
  mode: DueRadarMode;
}) {
  const toneClass =
    day.timing === "overdue"
      ? "text-[#DC2626]"
      : mode === "receivable"
        ? "text-[#059669]"
        : "text-[#EA580C]";
  return (
    <button
      type="button"
      data-testid={`due-radar-day-${day.date}`}
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
      <p className={cn("text-sm font-bold mt-2", toneClass)}>{formatFinanceCurrency(day.totalAmount)}</p>
      <p className="text-[9px] text-[#9CA3AF]">{formatFinanceInteger(day.titleCount)} título(s)</p>
    </button>
  );
}

function DueRadarExportButtons({
  mode,
  dashboardQuery,
  rangeKey,
  baseDate,
  selectedDate,
  search,
  sortBy,
  sortDirection,
  disabled,
}: {
  mode: DueRadarMode;
  dashboardQuery: string;
  rangeKey: DailyRadarRangeKey;
  baseDate?: string;
  selectedDate?: string | null;
  search?: string;
  sortBy?: string;
  sortDirection?: string;
  disabled?: boolean;
}) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printPayload, setPrintPayload] = useState<DueRadarExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const radarQs = buildDueRadarExportQueryString({
    baseDate,
    range: rangeKey,
    day: selectedDate ?? undefined,
    search,
    sortBy,
    sortDirection,
  });
  const exportUrl = buildDueRadarApiUrl(mode, dashboardQuery, radarQs);

  const handleExportExcel = async () => {
    if (exportingExcel || exportingPdf || disabled) return;
    setExportingExcel(true);
    setError(null);
    try {
      const res = await fetch(`${exportUrl.replace("/due-radar?", "/due-radar/export.xlsx?")}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível exportar o Excel.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "radar-export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro na exportação.");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingExcel || exportingPdf || disabled) return;
    setExportingPdf(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<DueRadarExportPayload>(
        exportUrl.replace("/due-radar?", "/due-radar/export-data?")
      );
      setPrintPayload(payload);
      document.body.classList.add("cash-flow-daily-radar-print-route");
      window.setTimeout(() => window.print(), 120);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro na exportação PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  useEffect(() => {
    const onAfterPrint = () => {
      document.body.classList.remove("cash-flow-daily-radar-print-route");
      setPrintPayload(null);
    };
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || exportingExcel || exportingPdf}
          onClick={() => void handleExportExcel()}
          className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
          data-testid="due-radar-export-excel"
        >
          {exportingExcel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exportar Excel
        </button>
        <button
          type="button"
          disabled={disabled || exportingExcel || exportingPdf}
          onClick={() => void handleExportPdf()}
          className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
          data-testid="due-radar-export-pdf"
        >
          {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
          Exportar PDF
        </button>
      </div>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      {printPayload
        ? createPortal(
            <div className="cash-flow-daily-radar-print-root p-6">
              <h1 className="text-lg font-bold">{DUE_RADAR_COPY[printPayload.mode].title}</h1>
              <p className="text-sm text-gray-600">
                {printPayload.rangeLabel}
                {printPayload.selectedDate ? ` — ${formatFinanceDate(printPayload.selectedDate)}` : ""}
              </p>
              <p className="text-sm font-semibold mt-2">
                {DUE_RADAR_COPY[printPayload.mode].totalLabel}: {formatFinanceCurrency(printPayload.totalAmount)}
              </p>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function FinanceDueRadar({
  mode,
  dashboardQuery,
}: {
  mode: DueRadarMode;
  dashboardQuery: string;
}) {
  const copy = DUE_RADAR_COPY[mode];
  const sectionRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<DueRadarPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<DailyRadarRangeKey | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [receivableSort, setReceivableSort] = useState<SortState<ReceivableSortKey>>({
    key: "amount",
    direction: "desc",
  });
  const [payableSort, setPayableSort] = useState<SortState<PayableSortKey>>({
    key: "amount",
    direction: "desc",
  });

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "120px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const sort = mode === "receivable" ? receivableSort : payableSort;

  const load = useCallback(async () => {
    if (!visible) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const radarQs = buildDueRadarQuery({
        range: selectedRange ?? undefined,
        day: selectedDay ?? undefined,
        search: search || undefined,
        sortBy: sort.key,
        sortDirection: sort.direction,
        page,
        pageSize,
      });
      const url = buildDueRadarApiUrl(mode, dashboardQuery, radarQs);
      const data = await fetchUiSessionCachedJson<DueRadarPayload>(url, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPayload(data);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPayload(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o radar.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [visible, mode, dashboardQuery, selectedRange, selectedDay, search, sort, page, pageSize]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
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

  const detail = payload?.selectedDetail;
  const isDayLevel = detail?.level === "day";

  return (
    <section
      ref={sectionRef}
      className="space-y-4 mt-8 pt-6 border-t border-[#E5E7EB]"
      data-testid={copy.testId}
      aria-label={copy.title}
    >
      <div>
        <h2 className="text-sm font-bold text-[#111827]">{copy.title}</h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">{copy.subtitle}</p>
        {payload?.baseDate ? (
          <p className="text-[10px] text-[#9CA3AF] mt-1">
            Data-base: {formatFinanceDate(payload.baseDate)}
          </p>
        ) : null}
      </div>

      {!visible ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`due-radar-skel-${i}`} className={cn(financeBiCardClass, "h-24 animate-pulse bg-[#F9FAFB]")} />
          ))}
        </div>
      ) : loading && !payload ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#6B7280]" data-testid="due-radar-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando radar…
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
                onSelect={() => {
                  setSelectedRange((c) => (c === range.key ? null : range.key));
                  setSelectedDay(null);
                  setPage(1);
                }}
                mode={mode}
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
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{copy.dayHint}</p>
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
                    onSelect={() => {
                      setSelectedDay((c) => (c === day.date ? null : day.date));
                      setPage(1);
                    }}
                    mode={mode}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {detail ? (
            <div className={cn(financeBiCardClass, "p-4 space-y-4")} data-testid="due-radar-detail">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#111827]">
                    {isDayLevel && detail.date
                      ? `Detalhe do dia — ${formatFinanceDate(detail.date)}`
                      : `Detalhe da faixa — ${detail.rangeLabel}`}
                  </h3>
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    {copy.totalLabel}: <strong>{formatFinanceCurrency(detail.totalAmount)}</strong>
                    {" · "}
                    Quantidade:{" "}
                    <strong>
                      {formatFinanceInteger(
                        mode === "receivable"
                          ? (detail.receivables?.summary.count ?? 0)
                          : (detail.payables?.summary.count ?? 0)
                      )}{" "}
                      título(s)
                    </strong>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DueRadarExportButtons
                    mode={mode}
                    dashboardQuery={dashboardQuery}
                    rangeKey={detail.rangeKey}
                    baseDate={payload.baseDate}
                    selectedDate={detail.date}
                    search={search || undefined}
                    sortBy={sort.key}
                    sortDirection={sort.direction}
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
                  ) : null}
                </div>
              </div>

              <FinanceCostCenterGridSearchBar
                value={searchDraft}
                onChange={setSearchDraft}
                placeholder={copy.searchPlaceholder}
                testId="due-radar-search"
              />

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando títulos…
                </div>
              ) : mode === "receivable" && detail.receivables ? (
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
                  emptyMessage={copy.emptyMessage}
                />
              ) : mode === "payable" && detail.payables ? (
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
                  emptyMessage={copy.emptyMessage}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
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
  emptyMessage,
}: {
  detail: DueRadarDetailGroup<DueRadarReceivableGridRow>;
  sort: SortState<ReceivableSortKey>;
  onSort: (key: ReceivableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  emptyMessage: string;
}) {
  if (detail.summary.count === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>;
  }
  return (
    <FinanceCostCenterGridTableShell
      head={
        <tr>
          <FinanceCostCenterSortableTh label="Cliente" sortKey="customer" sort={sort} onSort={onSort} />
          <FinanceCostCenterSortableTh label="Empresa" sortKey="company" sort={sort} onSort={onSort} />
          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground min-w-[200px]">
            Descrição
          </th>
          <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Documento/NF
          </th>
          <FinanceCostCenterSortableTh label="Vencimento" sortKey="operationalDate" sort={sort} onSort={onSort} />
          <FinanceCostCenterSortableTh label="Valor" sortKey="amount" sort={sort} onSort={onSort} align="right" />
          <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Saldo
          </th>
          <FinanceCostCenterSortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
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
          <td className="px-3 py-2 min-w-[200px] max-w-[320px] truncate" title={row.description ?? undefined}>
            {displayFinanceText(row.description)}
          </td>
          <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.document)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.operationalDate)}</td>
          <td className="px-3 py-2 text-right font-medium">{formatFinanceCurrency(row.amount)}</td>
          <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.balance)}</td>
          <td className="px-3 py-2">{displayFinanceText(row.status)}</td>
        </tr>
      ))}
      <tr className="border-t-2 border-border bg-[#F9FAFB] text-xs font-bold">
        <td className="px-3 py-2" colSpan={5}>
          Total ({formatFinanceInteger(detail.summary.count)} título(s))
        </td>
        <td className="px-3 py-2 text-right">{formatFinanceCurrency(detail.summary.total)}</td>
        <td className="px-3 py-2" colSpan={2} />
      </tr>
    </FinanceCostCenterGridTableShell>
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
  emptyMessage,
}: {
  detail: DueRadarDetailGroup<DueRadarPayableGridRow>;
  sort: SortState<PayableSortKey>;
  onSort: (key: PayableSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  emptyMessage: string;
}) {
  if (detail.summary.count === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>;
  }
  return (
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
          <th className="cash-flow-radar-payables-col-value px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Saldo
          </th>
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
      {detail.rows.map((row) => (
        <tr key={row.id} className="border-t border-border text-xs">
          <td className="cash-flow-radar-payables-col-supplier px-3 py-2 truncate">
            {displayFinanceText(row.supplier)}
          </td>
          <td className="cash-flow-radar-payables-col-company px-3 py-2 truncate">
            {displayFinanceText(row.company)}
          </td>
          <td className="cash-flow-radar-payables-col-description px-3 py-2 truncate" title={row.description ?? undefined}>
            {displayFinanceText(row.description)}
          </td>
          <td className="cash-flow-radar-payables-col-document px-3 py-2 whitespace-nowrap">
            {displayFinanceText(row.document)}
          </td>
          <td className="cash-flow-radar-payables-col-due px-3 py-2 whitespace-nowrap">
            {formatFinanceDate(row.operationalDate)}
          </td>
          <td className="cash-flow-radar-payables-col-value px-3 py-2 text-right font-medium">
            {formatFinanceCurrency(row.amount)}
          </td>
          <td className="cash-flow-radar-payables-col-value px-3 py-2 text-right">
            {formatFinanceCurrency(row.balance)}
          </td>
          <td className="cash-flow-radar-payables-col-scheduled px-3 py-2 whitespace-nowrap">
            {row.scheduledDisplay}
          </td>
        </tr>
      ))}
      <tr className="border-t-2 border-border bg-[#F9FAFB] text-xs font-bold">
        <td className="px-3 py-2" colSpan={5}>
          Total ({formatFinanceInteger(detail.summary.count)} título(s))
        </td>
        <td className="cash-flow-radar-payables-col-value px-3 py-2 text-right">
          {formatFinanceCurrency(detail.summary.total)}
        </td>
        <td className="px-3 py-2" colSpan={2} />
      </tr>
    </FinanceCostCenterGridTableShell>
  );
}
