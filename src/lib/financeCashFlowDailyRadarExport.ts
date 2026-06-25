import {
  buildFinanceCashFlowDailyRadar,
  DAILY_RADAR_EXPORT_PAGE_SIZE,
  parseDailyRadarQuery,
  type DailyRadarDaySummary,
  type DailyRadarDetailLevel,
  type DailyRadarGridSummary,
  type DailyRadarPayableRow,
  type DailyRadarRangeKey,
  type DailyRadarReceivableRow,
} from "./financeCashFlowDailyRadar.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import { formatFinanceDate } from "./financeAccountsReceivableFormat.js";

export type FinanceCashFlowDailyRadarAppliedFilterLine = {
  label: string;
  value: string;
};

export type FinanceCashFlowDailyRadarExportPayload = {
  generatedAt: string;
  operationalBaseDate: string;
  level: DailyRadarDetailLevel;
  rangeKey: DailyRadarRangeKey;
  rangeLabel: string;
  selectedDate: string | null;
  entriesTotal: number;
  exitsTotal: number;
  netTotal: number;
  payableCount: number;
  receivableCount: number;
  payables: {
    summary: DailyRadarGridSummary;
    rows: DailyRadarPayableRow[];
  };
  receivables: {
    summary: DailyRadarGridSummary;
    rows: DailyRadarReceivableRow[];
  };
  daySummaries: DailyRadarDaySummary[];
  appliedFilters: FinanceCashFlowDailyRadarAppliedFilterLine[];
  userName: string | null;
};

export class FinanceCashFlowDailyRadarExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceCashFlowDailyRadarExportError";
    this.code = code;
  }
}

export function parseDailyRadarExportQuery(
  query: Record<string, unknown>
): ReturnType<typeof parseDailyRadarQuery> {
  const parsed = parseDailyRadarQuery({
    ...query,
    page: "1",
    pageSize: String(DAILY_RADAR_EXPORT_PAGE_SIZE),
  });
  if (!parsed.rangeKey) {
    throw new FinanceCashFlowDailyRadarExportError(
      "MISSING_RANGE",
      "Faixa do radar diário é obrigatória para exportação."
    );
  }
  return {
    ...parsed,
    page: 1,
    pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE,
    exportAll: true,
  };
}

export function buildDailyRadarExportQueryString(params: {
  baseDate?: string;
  range: DailyRadarRangeKey;
  day?: string;
  search?: string;
  payableSortBy?: string;
  payableSortDirection?: string;
  receivableSortBy?: string;
  receivableSortDirection?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.baseDate) qs.set("baseDate", params.baseDate);
  qs.set("range", params.range);
  if (params.day) qs.set("day", params.day);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.payableSortBy) qs.set("payableSortBy", params.payableSortBy);
  if (params.payableSortDirection) qs.set("payableSortDirection", params.payableSortDirection);
  if (params.receivableSortBy) qs.set("receivableSortBy", params.receivableSortBy);
  if (params.receivableSortDirection) {
    qs.set("receivableSortDirection", params.receivableSortDirection);
  }
  return qs.toString();
}

export function buildFinanceCashFlowDailyRadarAppliedFilterLines(input: {
  rangeLabel: string;
  selectedDate: string | null;
  search?: string;
  operationalBaseDate: string;
}): FinanceCashFlowDailyRadarAppliedFilterLine[] {
  return [
    { label: "Faixa", value: input.rangeLabel },
    {
      label: "Dia",
      value: input.selectedDate ? formatFinanceDate(input.selectedDate) : "Todos os dias da faixa",
    },
    { label: "Busca", value: input.search?.trim() || "—" },
    {
      label: "Data-base operacional",
      value: formatFinanceDate(input.operationalBaseDate),
    },
  ];
}

export function buildFinanceCashFlowDailyRadarExportPayload(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  query: ReturnType<typeof parseDailyRadarExportQuery>,
  userContext: { userName: string | null },
  referenceDate: Date = new Date()
): FinanceCashFlowDailyRadarExportPayload {
  const radar = buildFinanceCashFlowDailyRadar(arRows, apRows, query, referenceDate);
  const detail = radar.selectedDetail;
  if (!detail) {
    throw new FinanceCashFlowDailyRadarExportError(
      "MISSING_DETAIL",
      "Não foi possível montar o detalhe do radar para exportação."
    );
  }

  return {
    generatedAt: referenceDate.toISOString(),
    operationalBaseDate: radar.baseDate,
    level: detail.level,
    rangeKey: detail.rangeKey,
    rangeLabel: detail.rangeLabel,
    selectedDate: detail.date,
    entriesTotal: detail.entriesTotal,
    exitsTotal: detail.exitsTotal,
    netTotal: detail.netTotal,
    payableCount: detail.payables.summary.count,
    receivableCount: detail.receivables.summary.count,
    payables: {
      summary: detail.payables.summary,
      rows: detail.payables.rows,
    },
    receivables: {
      summary: detail.receivables.summary,
      rows: detail.receivables.rows,
    },
    daySummaries: radar.selectedRange?.days ?? [],
    appliedFilters: buildFinanceCashFlowDailyRadarAppliedFilterLines({
      rangeLabel: detail.rangeLabel,
      selectedDate: detail.date,
      search: query.search,
      operationalBaseDate: radar.baseDate,
    }),
    userName: userContext.userName,
  };
}
