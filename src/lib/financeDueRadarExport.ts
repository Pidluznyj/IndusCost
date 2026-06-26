import { DAILY_RADAR_EXPORT_PAGE_SIZE } from "./financeCashFlowDailyRadar.js";
import type {
  DueRadarPayload,
  DueRadarPayableGridRow,
  DueRadarReceivableGridRow,
} from "./financeDueRadar.js";
import { parseDueRadarQuery } from "./financeDueRadar.js";
import type { DailyRadarRangeKey } from "./financeCashFlowDailyRadar.js";
import { formatFinanceDate } from "./financeAccountsReceivableFormat.js";
import * as XLSX from "xlsx";

export type DueRadarExportAppliedFilterLine = {
  label: string;
  value: string;
};

export type DueRadarExportPayload = {
  generatedAt: string;
  mode: DueRadarPayload["mode"];
  operationalBaseDate: string;
  level: "range" | "day";
  rangeKey: DailyRadarRangeKey;
  rangeLabel: string;
  selectedDate: string | null;
  totalAmount: number;
  titleCount: number;
  receivableRows: DueRadarReceivableGridRow[];
  payableRows: DueRadarPayableGridRow[];
  receivableSummary: DueRadarPayload["selectedDetail"] extends infer D
    ? D extends { receivables?: infer R }
      ? R extends { summary: infer S }
        ? S
        : never
      : never
    : never;
  payableSummary: DueRadarPayload["selectedDetail"] extends infer D
    ? D extends { payables?: infer P }
      ? P extends { summary: infer S }
        ? S
        : never
      : never
    : never;
  daySummaries: NonNullable<DueRadarPayload["selectedRange"]>["days"];
  appliedFilters: DueRadarExportAppliedFilterLine[];
  userName: string | null;
  filename: string;
};

export class DueRadarExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DueRadarExportError";
    this.code = code;
  }
}

export function parseDueRadarExportQuery(
  query: Record<string, unknown>
): ReturnType<typeof parseDueRadarQuery> {
  const parsed = parseDueRadarQuery({
    ...query,
    page: "1",
    pageSize: String(DAILY_RADAR_EXPORT_PAGE_SIZE),
  });
  if (!parsed.rangeKey) {
    throw new DueRadarExportError("MISSING_RANGE", "Faixa do radar é obrigatória para exportação.");
  }
  return { ...parsed, page: 1, pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE, exportAll: true };
}

export function buildDueRadarExportQueryString(params: {
  baseDate?: string;
  range: DailyRadarRangeKey;
  day?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.baseDate) qs.set("baseDate", params.baseDate);
  qs.set("range", params.range);
  if (params.day) qs.set("day", params.day);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.sortBy) qs.set("sortBy", params.sortBy);
  if (params.sortDirection) qs.set("sortDirection", params.sortDirection);
  return qs.toString();
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildDueRadarExportFilename(payload: Pick<DueRadarExportPayload, "mode" | "selectedDate" | "rangeLabel">): string {
  const prefix = payload.mode === "receivable" ? "contas-a-receber-radar" : "contas-a-pagar-radar";
  if (payload.selectedDate) {
    const [y, m, d] = payload.selectedDate.split("-");
    return `${prefix}-${d}-${m}-${y}.xlsx`;
  }
  return `${prefix}-${slugify(payload.rangeLabel)}.xlsx`;
}

function filtersToLines(filters: Record<string, unknown>): DueRadarExportAppliedFilterLine[] {
  const lines: DueRadarExportAppliedFilterLine[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "") return;
    lines.push({ label, value: String(value) });
  };
  push("Empresa", filters.companyName);
  push("Cliente/Fornecedor", filters.personName);
  push("CNPJ", filters.personCnpj);
  push("Status", filters.status);
  push("Vencimento de", filters.dueDateFrom);
  push("Vencimento até", filters.dueDateTo);
  return lines;
}

export function buildDueRadarExportPayload(
  payload: DueRadarPayload,
  opts: { userName: string | null; filtersApplied: Record<string, unknown> }
): DueRadarExportPayload {
  const detail = payload.selectedDetail;
  if (!detail) {
    throw new DueRadarExportError("MISSING_DETAIL", "Selecione uma faixa para exportar.");
  }

  const receivableRows = detail.receivables?.rows ?? [];
  const payableRows = detail.payables?.rows ?? [];
  const receivableSummary = detail.receivables?.summary ?? {
    count: 0,
    total: 0,
    overdueTotal: 0,
    upcomingTotal: 0,
    maxAmount: 0,
    averageAmount: 0,
  };
  const payableSummary = detail.payables?.summary ?? {
    count: 0,
    total: 0,
    overdueTotal: 0,
    upcomingTotal: 0,
    maxAmount: 0,
    averageAmount: 0,
  };

  const exportPayload: DueRadarExportPayload = {
    generatedAt: new Date().toISOString(),
    mode: payload.mode,
    operationalBaseDate: payload.baseDate,
    level: detail.level,
    rangeKey: detail.rangeKey,
    rangeLabel: detail.rangeLabel,
    selectedDate: detail.date,
    totalAmount: detail.totalAmount,
    titleCount: payload.mode === "receivable" ? receivableSummary.count : payableSummary.count,
    receivableRows,
    payableRows,
    receivableSummary,
    payableSummary,
    daySummaries: payload.selectedRange?.days ?? [],
    appliedFilters: filtersToLines(opts.filtersApplied),
    userName: opts.userName,
    filename: "",
  };
  exportPayload.filename = buildDueRadarExportFilename(exportPayload);
  return exportPayload;
}

export function buildDueRadarExportBuffer(payload: DueRadarExportPayload): Buffer {
  const wb = XLSX.utils.book_new();
  const summaryRows: Array<Record<string, string | number>> = [
    { Campo: "Gerado em", Valor: formatFinanceDate(payload.generatedAt.slice(0, 10)) },
    { Campo: "Data-base", Valor: formatFinanceDate(payload.operationalBaseDate) },
    { Campo: "Faixa", Valor: payload.rangeLabel },
    { Campo: "Dia selecionado", Valor: payload.selectedDate ? formatFinanceDate(payload.selectedDate) : "—" },
    { Campo: "Total", Valor: payload.totalAmount },
    { Campo: "Títulos", Valor: payload.titleCount },
  ];
  for (const f of payload.appliedFilters) {
    summaryRows.push({ Campo: f.label, Valor: f.value });
  }
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Resumo");

  if (payload.mode === "receivable") {
    const rows = payload.receivableRows.map((r) => ({
      Cliente: r.customer ?? "",
      Empresa: r.company ?? "",
      Descrição: r.description ?? "",
      "Documento/NF": r.document ?? "",
      Vencimento: r.operationalDate ? formatFinanceDate(r.operationalDate) : "",
      Valor: r.amount,
      Saldo: r.balance,
      Status: r.status,
      "Recebido/Baixa": r.settlementDate ? formatFinanceDate(r.settlementDate) : "",
    }));
    rows.push({
      Cliente: `Total (${payload.receivableSummary.count} título(s))`,
      Empresa: "",
      Descrição: "",
      "Documento/NF": "",
      Vencimento: "",
      Valor: payload.receivableSummary.total,
      Saldo: payload.receivableSummary.total,
      Status: "",
      "Recebido/Baixa": "",
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, "Contas a Receber");
  } else {
    const rows = payload.payableRows.map((r) => ({
      Fornecedor: r.supplier ?? "",
      Empresa: r.company ?? "",
      Descrição: r.description ?? "",
      Documento: r.document ?? "",
      Vencimento: r.operationalDate ? formatFinanceDate(r.operationalDate) : "",
      Valor: r.amount,
      Saldo: r.balance,
      Agendado: r.scheduledDisplay,
    }));
    rows.push({
      Fornecedor: `Total (${payload.payableSummary.count} título(s))`,
      Empresa: "",
      Descrição: "",
      Documento: "",
      Vencimento: "",
      Valor: payload.payableSummary.total,
      Saldo: payload.payableSummary.total,
      Agendado: "",
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, "Contas a Pagar");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
