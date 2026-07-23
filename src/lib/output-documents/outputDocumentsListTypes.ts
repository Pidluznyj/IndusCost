/**
 * DS-04.1 — Contratos read-only de lista e resumo de Documentos de Saída.
 */

import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";

export type OutputDocumentsSortBy =
  | "dataDocumento"
  | "externalId"
  | "totalValue"
  | "documentNumber"
  | "personName"
  | "companyName"
  | "syncedAt"
  | "statusRaw";

export type OutputDocumentsSortDir = "asc" | "desc";

/** Tri-state: omitido/`all` = sem filtro. */
export type OutputDocumentsTriState = "all" | "yes" | "no";

export type OutputDocumentsListFilters = {
  page: number;
  pageSize: number;
  skip: number;
  sortBy: OutputDocumentsSortBy;
  sortDir: OutputDocumentsSortDir;
  search: string;
  from: Date | null;
  to: Date | null;
  /** Ano civil de emissão (`dataDocumento`); null = sem filtro Ano. */
  year: number | null;
  /** Mês 1–12; só aplica com `year` válido. */
  month: number | null;
  company: string | null;
  companyExternalId: number | null;
  customer: string | null;
  personExternalId: number | null;
  status: string | null;
  cancelled: OutputDocumentsTriState;
  order: string | null;
  nfe: string | null;
  idNfe: number | null;
  hasReceivable: OutputDocumentsTriState;
  financialStatus: OutputDocumentFinancialStatus | null;
};

export type OutputDocumentsListItem = {
  id: string;
  externalId: number;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  idNfe: number | null;
  nfeNumber: string | null;
  customerName: string | null;
  personExternalId: number | null;
  companyName: string | null;
  companyExternalId: number | null;
  /** Valor do documento (cabeçalho stage) — uma vez; null se ausente. */
  totalValue: number | null;
  allocatedOrdersCount: number;
  /** Primeiro código de pedido oficial (NfeLink/O2C), quando houver. */
  primaryOrderCode: string | null;
  /** Códigos de pedido vinculados (únicos, estáveis). */
  orderCodes: string[];
  hasReceivable: boolean;
  financialStatus: OutputDocumentFinancialStatus;
  receivableOpenValue: number | null;
  syncedAt: string;
};

export type OutputDocumentsListSummary = {
  /** Quantidade de documentos no filtro. */
  documentCount: number;
  /**
   * Soma de `totalValue` dos documentos não cancelados.
   * Cancelados excluídos. Sem duplicar por alocação/pedido.
   */
  validTotalValue: number;
  withNfe: number;
  withReceivable: number;
  awaitingReceivable: number;
  cancelled: number;
};

export type OutputDocumentsListPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type OutputDocumentsListPayload = {
  filters: Omit<OutputDocumentsListFilters, "skip" | "from" | "to"> & {
    from: string | null;
    to: string | null;
  };
  pagination: OutputDocumentsListPagination;
  items: OutputDocumentsListItem[];
  generatedAt: string;
};

export type OutputDocumentsSummaryPayload = {
  filters: OutputDocumentsListPayload["filters"];
  summary: OutputDocumentsListSummary;
  generatedAt: string;
};
