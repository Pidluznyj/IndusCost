/**
 * DS-04.1 — Lógica pura de lista/resumo de Documentos de Saída.
 *
 * - valor válido = soma de totalValue do documento (uma vez), excluindo cancelados;
 * - não duplica valor por alocação/pedido;
 * - situação financeira via resolver oficial DS-03.9.
 */

import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import {
  resolveOutputDocumentFinancialStatus,
  type OutputDocumentFinancialReceivableInput,
  type OutputDocumentFinancialStatus,
  type OutputDocumentFinancialStatusResult,
} from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type {
  OutputDocumentsListItem,
  OutputDocumentsListSummary,
  OutputDocumentsSortBy,
  OutputDocumentsSortDir,
  OutputDocumentsTriState,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";

export type OutputDocumentListStageRow = {
  id: string;
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  totalValue: unknown;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  paymentTermsRaw: string | null;
  syncedAt: Date;
};

export type OutputDocumentListNfeRow = {
  externalId: number;
  numero: string | null;
  status: number | null;
  valorLiquido: unknown;
  xmlVNF: unknown;
};

export type OutputDocumentListEnrichment = {
  nfeByExternalId: Map<number, OutputDocumentListNfeRow>;
  receivablesByNfe: Map<number, OutputDocumentFinancialReceivableInput[]>;
  allocatedOrdersCountByDoc: Map<number, number>;
  referenceDate?: Date;
};

function toIso(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function documentTotalNumber(row: OutputDocumentListStageRow): number | null {
  return decimalToNumber(row.totalValue);
}

export function resolveListDocumentFinancialStatus(
  row: OutputDocumentListStageRow,
  enrichment: OutputDocumentListEnrichment
): OutputDocumentFinancialStatusResult {
  const idNfe = row.idNfe;
  const nfe = idNfe != null ? enrichment.nfeByExternalId.get(idNfe) : undefined;
  const receivables =
    idNfe != null ? enrichment.receivablesByNfe.get(idNfe) ?? [] : [];
  const nfeValue = nfe?.xmlVNF ?? nfe?.valorLiquido ?? null;

  return resolveOutputDocumentFinancialStatus({
    stockDocumentExternalId: row.externalId,
    idNfe,
    isCancelled: row.isCancelled,
    paymentTermsRaw: row.paymentTermsRaw,
    documentTotalValue: row.totalValue,
    nfeValue,
    nfeStatus: nfe?.status ?? null,
    receivables,
    referenceDate: enrichment.referenceDate,
  });
}

export function matchesTriState(
  flag: boolean,
  filter: OutputDocumentsTriState
): boolean {
  if (filter === "all") return true;
  if (filter === "yes") return flag;
  return !flag;
}

export function matchesFinancialFilters(
  financial: OutputDocumentFinancialStatusResult,
  filters: {
    hasReceivable: OutputDocumentsTriState;
    financialStatus: OutputDocumentFinancialStatus | null;
  }
): boolean {
  const hasCr = financial.installmentCount > 0;
  if (!matchesTriState(hasCr, filters.hasReceivable)) return false;
  if (
    filters.financialStatus != null &&
    financial.status !== filters.financialStatus
  ) {
    return false;
  }
  return true;
}

export function needsFinancialPostFilter(filters: {
  hasReceivable: OutputDocumentsTriState;
  financialStatus: OutputDocumentFinancialStatus | null;
}): boolean {
  return filters.hasReceivable !== "all" || filters.financialStatus != null;
}

export function compareOutputDocumentListRows(
  a: OutputDocumentListStageRow,
  b: OutputDocumentListStageRow,
  sortBy: OutputDocumentsSortBy,
  sortDir: OutputDocumentsSortDir
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  const av = readSortValue(a, sortBy);
  const bv = readSortValue(b, sortBy);

  if (av == null && bv == null) return a.externalId - b.externalId;
  if (av == null) return 1;
  if (bv == null) return -1;

  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else if (av instanceof Date && bv instanceof Date) {
    cmp = av.getTime() - bv.getTime();
  } else {
    cmp = String(av).localeCompare(String(bv), "pt-BR", {
      sensitivity: "base",
      numeric: true,
    });
  }
  if (cmp !== 0) return cmp * dir;
  return (a.externalId - b.externalId) * dir;
}

function readSortValue(
  row: OutputDocumentListStageRow,
  sortBy: OutputDocumentsSortBy
): string | number | Date | null {
  switch (sortBy) {
    case "dataDocumento":
      return row.dataDocumento;
    case "externalId":
      return row.externalId;
    case "totalValue":
      return documentTotalNumber(row);
    case "documentNumber":
      return row.documentNumber;
    case "personName":
      return row.personName;
    case "companyName":
      return row.companyName;
    case "syncedAt":
      return row.syncedAt;
    case "statusRaw":
      return row.statusRaw;
    default:
      return row.dataDocumento;
  }
}

export function buildOutputDocumentListItem(
  row: OutputDocumentListStageRow,
  enrichment: OutputDocumentListEnrichment
): OutputDocumentsListItem {
  const financial = resolveListDocumentFinancialStatus(row, enrichment);
  const idNfe = row.idNfe;
  const nfe = idNfe != null ? enrichment.nfeByExternalId.get(idNfe) : undefined;

  return {
    id: row.id,
    externalId: row.externalId,
    tipoDocumentoEstoque: row.tipoDocumentoEstoque,
    dataDocumento: toIso(row.dataDocumento),
    documentNumber: row.documentNumber,
    statusRaw: row.statusRaw,
    isCancelled: row.isCancelled,
    idNfe,
    nfeNumber: nfe?.numero ?? null,
    customerName: row.personName,
    personExternalId: row.personExternalId,
    companyName: row.companyName,
    companyExternalId: row.companyExternalId,
    totalValue: documentTotalNumber(row),
    allocatedOrdersCount:
      enrichment.allocatedOrdersCountByDoc.get(row.externalId) ?? 0,
    hasReceivable: financial.installmentCount > 0,
    financialStatus: financial.status,
    receivableOpenValue:
      financial.installmentCount > 0 ? financial.open : null,
    syncedAt: row.syncedAt.toISOString(),
  };
}

/**
 * Agrega cards do resumo a partir das linhas já filtradas (mesmos filtros da lista).
 * Valor válido: soma do totalValue do documento uma vez; cancelados fora.
 */
export function buildOutputDocumentsListSummary(
  rows: ReadonlyArray<OutputDocumentListStageRow>,
  enrichment: OutputDocumentListEnrichment
): OutputDocumentsListSummary {
  let documentCount = 0;
  let validTotalValue = 0;
  let withNfe = 0;
  let withReceivable = 0;
  let awaitingReceivable = 0;
  let cancelled = 0;

  for (const row of rows) {
    documentCount += 1;
    if (row.isCancelled) {
      cancelled += 1;
    } else {
      const value = documentTotalNumber(row);
      if (value != null) validTotalValue += value;
    }
    if (row.idNfe != null) withNfe += 1;

    const financial = resolveListDocumentFinancialStatus(row, enrichment);
    if (financial.installmentCount > 0) withReceivable += 1;
    if (financial.status === "aguardando_cr") awaitingReceivable += 1;
  }

  return {
    documentCount,
    validTotalValue: Math.round(validTotalValue * 100) / 100,
    withNfe,
    withReceivable,
    awaitingReceivable,
    cancelled,
  };
}

export function paginateRows<T>(
  rows: ReadonlyArray<T>,
  page: number,
  pageSize: number
): { items: T[]; totalItems: number; totalPages: number } {
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
  const skip = (page - 1) * pageSize;
  return {
    items: rows.slice(skip, skip + pageSize) as T[],
    totalItems,
    totalPages,
  };
}
