/**
 * Helpers browser-safe da tela Comercial → Documentos de Saída.
 */
import { COMMERCIAL_ACTIONS, COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type {
  OutputDocumentsListItem,
  OutputDocumentsSortBy,
  OutputDocumentsSortDir,
  OutputDocumentsTriState,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import type { OutputDocumentDetailItem } from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";
import type { OverlayBadgeTone } from "@/src/components/ui/overlay";
import { formatCurrency } from "@/src/lib/utils.js";

export const OUTPUT_DOCUMENTS_MODULE_ID = "output-documents" as const;
export const OUTPUT_DOCUMENTS_ROUTE_PATH = "/output-documents";
export const OUTPUT_DOCUMENTS_PAGE_TITLE = "Documentos de Saída";
export const OUTPUT_DOCUMENTS_PAGE_SUBTITLE =
  "Consulta read-only dos documentos sincronizados do Nomus.";
export const OUTPUT_DOCUMENTS_BREADCRUMB = "Comercial / Documentos de Saída";
export const OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION =
  "output_documents.view" as const;
export const OUTPUT_DOCUMENTS_PAGE_SIZE = 50;

export const OUTPUT_DOCUMENT_FINANCIAL_STATUS_OPTIONS: ReadonlyArray<{
  value: OutputDocumentFinancialStatus;
  label: string;
}> = [
  { value: "aguardando_cr", label: "Aguardando CR" },
  { value: "cr_em_aberto", label: "CR em aberto" },
  { value: "parcialmente_recebido", label: "Parcialmente recebido" },
  { value: "recebido", label: "Recebido" },
  { value: "vencido", label: "Vencido" },
  { value: "sem_informacao_financeira", label: "Sem informação financeira" },
  { value: "cancelado", label: "Cancelado" },
];

export function canViewOutputDocuments(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.(OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION)
  );
}

export function canAccessOutputDocumentsModule(
  check: PermissionChecker
): boolean {
  return check.hasPermission(OUTPUT_DOCUMENTS_VIEW_LEGACY_PERMISSION);
}

export function isOutputDocumentsDateRangeInvalid(
  from: string,
  to: string
): boolean {
  return Boolean(from && to && from > to);
}

export type OutputDocumentsActiveFiltersInput = {
  search: string;
  customer: string;
  from: string;
  to: string;
  year?: string;
  month?: string;
  /** Ano padrão da tela (ex.: ano corrente) — não conta como filtro “extra”. */
  defaultYear?: string;
  status?: string;
  order?: string;
  nfe?: string;
  customerId?: string | null;
  personExternalId?: string | number | null;
  financialStatus?: string | null;
  cancelled?: string | null;
  hasReceivable?: string | null;
};

export function hasActiveOutputDocumentsFilters(
  input: OutputDocumentsActiveFiltersInput
): boolean {
  const personExternalId =
    input.personExternalId == null ? "" : String(input.personExternalId).trim();
  const defaultYear = (input.defaultYear ?? "").trim();
  const year = (input.year ?? "").trim();
  const yearIsExtra = Boolean(year && year !== defaultYear);
  return Boolean(
    input.search.trim() ||
      input.customer.trim() ||
      input.customerId?.trim() ||
      personExternalId ||
      input.from ||
      input.to ||
      yearIsExtra ||
      input.month?.trim() ||
      input.status?.trim() ||
      input.order?.trim() ||
      input.nfe?.trim() ||
      input.financialStatus?.trim() ||
      (input.cancelled && input.cancelled !== "all") ||
      (input.hasReceivable && input.hasReceivable !== "all")
  );
}

/** Status Nomus observados em documentos de estoque / saída (filtro por contains). */
export const OUTPUT_DOCUMENT_STATUS_RAW_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "Aberto", label: "Aberto" },
  { value: "Emitido", label: "Emitido" },
  { value: "Cancelado", label: "Cancelado" },
];

export const OUTPUT_DOCUMENTS_TRI_STATE_OPTIONS: ReadonlyArray<{
  value: OutputDocumentsTriState;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
];

export function parseOutputDocumentsTriStateParam(
  value: string | null | undefined
): OutputDocumentsTriState {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === "yes" || trimmed === "no") return trimmed;
  return "all";
}

export const OUTPUT_DOCUMENTS_SORTABLE_COLUMNS: ReadonlyArray<{
  key: OutputDocumentsSortBy;
  label: string;
  align?: "left" | "right";
}> = [
  { key: "documentNumber", label: "Documento" },
  { key: "dataDocumento", label: "Emissão" },
  { key: "personName", label: "Cliente" },
  { key: "companyName", label: "Empresa" },
  { key: "statusRaw", label: "Status" },
  { key: "totalValue", label: "Valor", align: "right" },
  { key: "syncedAt", label: "Última sincronização" },
];

export function parseOutputDocumentsSortByParam(
  value: string | null | undefined
): OutputDocumentsSortBy {
  const trimmed = value?.trim() as OutputDocumentsSortBy | undefined;
  if (
    trimmed &&
    OUTPUT_DOCUMENTS_SORTABLE_COLUMNS.some((column) => column.key === trimmed)
  ) {
    return trimmed;
  }
  return "dataDocumento";
}

export function parseOutputDocumentsSortDirParam(
  value: string | null | undefined
): OutputDocumentsSortDir {
  return value?.trim() === "asc" ? "asc" : "desc";
}

export function nextOutputDocumentsSortDir(
  currentSortBy: OutputDocumentsSortBy,
  currentSortDir: OutputDocumentsSortDir,
  nextSortBy: OutputDocumentsSortBy
): OutputDocumentsSortDir {
  if (currentSortBy !== nextSortBy) return "desc";
  return currentSortDir === "desc" ? "asc" : "desc";
}

export type OutputDocumentsKpiFilterPreset =
  | "all"
  | "with_nfe"
  | "with_receivable"
  | "awaiting_receivable"
  | "cancelled";

export function applyOutputDocumentsKpiPreset(preset: OutputDocumentsKpiFilterPreset): {
  cancelled: OutputDocumentsTriState;
  hasReceivable: OutputDocumentsTriState;
  financialStatus: OutputDocumentFinancialStatus | null;
} {
  switch (preset) {
    case "with_receivable":
      return {
        cancelled: "all",
        hasReceivable: "yes",
        financialStatus: null,
      };
    case "awaiting_receivable":
      return {
        cancelled: "all",
        hasReceivable: "all",
        financialStatus: "aguardando_cr",
      };
    case "cancelled":
      return {
        cancelled: "yes",
        hasReceivable: "all",
        financialStatus: null,
      };
    case "with_nfe":
      // Sem filtro dedicado hasNfe na API — limpa filtros financeiros/cancelamento.
      return {
        cancelled: "no",
        hasReceivable: "all",
        financialStatus: null,
      };
    default:
      return {
        cancelled: "all",
        hasReceivable: "all",
        financialStatus: null,
      };
  }
}

export function buildOutputDocumentSalesOrderHref(order: {
  salesOrderId: string;
  orderCode: string | null;
}): string {
  const code = order.orderCode?.trim();
  if (code) {
    return `/commercial/sales-order-flow?search=${encodeURIComponent(code)}`;
  }
  return `/sales-orders?search=${encodeURIComponent(order.salesOrderId)}`;
}

export function buildOutputDocumentNfeSearchHref(nfe: {
  numero: string | null;
  externalId: number;
}): string {
  const label = nfe.numero?.trim() || String(nfe.externalId);
  return `${OUTPUT_DOCUMENTS_ROUTE_PATH}?search=${encodeURIComponent(label)}`;
}

/**
 * Abre a lista filtrada pela NF-e preservando os demais filtros (sem documentId).
 */
export function buildOutputDocumentNfeListHref(
  nfe: { numero: string | null; externalId: number },
  current?: URLSearchParams | null
): string {
  const next = current ? new URLSearchParams(current) : new URLSearchParams();
  const label = nfe.numero?.trim() || String(nfe.externalId);
  next.set("nfe", label);
  next.delete("documentId");
  next.delete("page");
  const qs = next.toString();
  return qs
    ? `${OUTPUT_DOCUMENTS_ROUTE_PATH}?${qs}`
    : OUTPUT_DOCUMENTS_ROUTE_PATH;
}

/**
 * Deep link da Auditoria 360º → Comercial · Documentos de Saída.
 * Prefere `documentId` (UUID local); senão busca por número/externalId.
 */
export function buildOutputDocumentAuditHref(doc: {
  stockDocumentId?: string | null;
  documentNumber?: string | null;
  stockDocumentExternalId: number;
}): string {
  const id = doc.stockDocumentId?.trim();
  if (id) {
    return `${OUTPUT_DOCUMENTS_ROUTE_PATH}?documentId=${encodeURIComponent(id)}`;
  }
  const search =
    doc.documentNumber?.trim() || String(doc.stockDocumentExternalId);
  return `${OUTPUT_DOCUMENTS_ROUTE_PATH}?search=${encodeURIComponent(search)}`;
}

/** Deep link oficial para Auditoria 360° (Conciliação de Carteira) a partir de um pedido. */
export function buildOutputDocumentPortfolioAudit360Href(
  salesOrderId: string
): string {
  return `/finance/portfolio-reconciliation?auditOrderId=${encodeURIComponent(salesOrderId)}`;
}

/**
 * Compara search params sem depender da ordem das chaves —
 * evita loops de `setSearchParams` no deep link.
 */
export function areOutputDocumentsSearchParamsEqual(
  a: URLSearchParams,
  b: URLSearchParams
): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    if ((a.get(key) ?? "") !== (b.get(key) ?? "")) return false;
  }
  return true;
}

export type OutputDocumentDetailNavigationCapabilities = {
  canOpenPortfolioAudit360: boolean;
};

export function resolveOutputDocumentDetailNavigationCapabilities(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  canViewModule?: (moduleId: string) => boolean;
}): OutputDocumentDetailNavigationCapabilities {
  return {
    canOpenPortfolioAudit360: Boolean(
      check.canPerformAction?.("finance.portfolio_reconciliation", "view") ||
        check.canViewModule?.("portfolio-reconciliation")
    ),
  };
}

export type OutputDocumentDetailHeaderLink = {
  id: "nfe" | "portfolio_audit_360";
  label: string;
  href: string;
  testId: string;
};

/**
 * Links oficiais do drawer — só rotas com permissão e evidência local.
 * NF-e filtra a própria lista (rota oficial existente). Auditoria 360° exige pedido + permissão.
 */
export function resolveOutputDocumentDetailHeaderLinks(
  detail: {
    nfes: ReadonlyArray<{ numero: string | null; externalId: number; isPrimary: boolean }>;
    orders: ReadonlyArray<{ salesOrderId: string }>;
  },
  capabilities: OutputDocumentDetailNavigationCapabilities,
  options?: { currentSearchParams?: URLSearchParams | null }
): OutputDocumentDetailHeaderLink[] {
  const links: OutputDocumentDetailHeaderLink[] = [];
  const primaryNfe =
    detail.nfes.find((nfe) => nfe.isPrimary) ?? detail.nfes[0] ?? null;
  if (primaryNfe) {
    links.push({
      id: "nfe",
      label: "Abrir NF-e",
      href: buildOutputDocumentNfeListHref(
        primaryNfe,
        options?.currentSearchParams
      ),
      testId: "output-document-detail-open-nfe",
    });
  }
  const firstOrder = detail.orders[0];
  if (firstOrder && capabilities.canOpenPortfolioAudit360) {
    links.push({
      id: "portfolio_audit_360",
      label: "Auditoria 360°",
      href: buildOutputDocumentPortfolioAudit360Href(firstOrder.salesOrderId),
      testId: "output-document-detail-open-audit-360",
    });
  }
  return links;
}

export function formatOutputDocumentCoverageStatus(
  status:
    | "nao_alocado"
    | "parcial"
    | "completo"
    | "superalocado"
    | "arredondamento"
    | string
    | null
    | undefined
): string {
  switch (status) {
    case "completo":
      return "Completo";
    case "parcial":
      return "Parcial";
    case "nao_alocado":
      return "Não alocado";
    case "superalocado":
      return "Superalocado";
    case "arredondamento":
      return "Arredondamento";
    default:
      return status?.trim() || "—";
  }
}

export function canViewOutputDocumentsFinancial(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsFinancial,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.("output_documents.financial.view")
  );
}

export function canViewOutputDocumentsAudit(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsAudit,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.("output_documents.audit.view")
  );
}

export function canViewOutputDocumentsRaw(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.outputDocumentsRaw,
      COMMERCIAL_ACTIONS.view
    ) ||
      check.hasPermission?.("output_documents.raw.view") ||
      check.hasPermission?.("audit.raw.read")
  );
}

/** Mensagem oficial quando o CR ainda não materializou. */
export const OUTPUT_DOCUMENT_AWAITING_CR_MESSAGE =
  "Aguardando materialização do CR";

export function formatOutputDocumentNfeCancellation(nfe: {
  isCancelled: boolean;
}): string {
  return nfe.isCancelled ? "Cancelada" : "Não";
}

export function formatOutputDocumentNfeDocumentaryDiffs(
  nfe: {
    externalId: number;
    numero: string | null;
    foundLocally: boolean;
    isCancelled: boolean;
  },
  inconsistencies: ReadonlyArray<{ code: string; message: string }>
): string {
  const diffs: string[] = [];
  if (!nfe.foundLocally) {
    diffs.push("Ausente no stage local");
  }
  if (nfe.isCancelled) {
    diffs.push("NF-e cancelada");
  }
  const needle = String(nfe.externalId);
  const numero = nfe.numero?.trim();
  for (const entry of inconsistencies) {
    if (!entry.code.startsWith("NFE_")) continue;
    if (
      entry.message.includes(needle) ||
      (numero != null && numero !== "" && entry.message.includes(numero))
    ) {
      diffs.push(entry.message);
    }
  }
  return diffs.length > 0 ? [...new Set(diffs)].join(" · ") : "—";
}

export function outputDocumentInconsistencyTone(
  severity: "info" | "warning" | "error" | string
): OverlayBadgeTone {
  if (severity === "error") return "rose";
  if (severity === "warning") return "amber";
  return "sky";
}

export function classifyOutputDocumentsListError(error: unknown): {
  kind: "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar Documentos de Saída.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API de Documentos de Saída indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar Documentos de Saída.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API de Documentos de Saída indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar Documentos de Saída.",
  };
}

export function classifyOutputDocumentsDetailError(error: unknown): {
  kind: "not_found" | "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return {
        kind: "not_found",
        message: "Documento de Saída não encontrado.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar este Documento de Saída.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API de Documentos de Saída indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar o detalhe do Documento de Saída.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API de Documentos de Saída indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar o detalhe do Documento de Saída.",
  };
}

export function formatOutputDocumentItemLinkStatusLabel(
  status: string | null | undefined
): string {
  switch (status) {
    case "resolved":
      return "Resolvido";
    case "partial":
      return "Parcial";
    case "conflict":
      return "Conflito";
    case "unresolved":
      return "Não resolvido";
    default:
      return status?.trim() || "—";
  }
}

export function outputDocumentItemLinkStatusTone(
  status: string | null | undefined
): OverlayBadgeTone {
  switch (status) {
    case "resolved":
      return "emerald";
    case "partial":
      return "amber";
    case "conflict":
      return "rose";
    case "unresolved":
      return "slate";
    default:
      return "slate";
  }
}

export function formatOutputDocumentItemCode(
  item: Pick<
    OutputDocumentDetailItem,
    "sku" | "externalProductId" | "externalItemId"
  >
): string {
  if (item.sku?.trim()) return item.sku.trim();
  if (item.externalProductId != null) return String(item.externalProductId);
  if (item.externalItemId != null) return `Item ${item.externalItemId}`;
  return "—";
}

export function formatOutputDocumentItemSkuLabel(
  item: Pick<
    OutputDocumentDetailItem,
    "sku" | "externalProductId" | "externalItemId"
  >
): string {
  const code = formatOutputDocumentItemCode(item);
  if (code === "—") return "—";
  if (item.sku?.trim()) return code;
  return `SKU ${code}`;
}

export function formatOutputDocumentItemDescription(
  item: Pick<
    OutputDocumentDetailItem,
    "productName" | "externalProductId" | "alerts"
  >
): string {
  if (item.productName?.trim()) return item.productName.trim();
  if (item.externalProductId != null) {
    return `Produto Nomus #${item.externalProductId}`;
  }
  const alert = item.alerts.find((entry) => entry.trim().length > 0);
  return alert?.trim() || "Sem descrição no stage";
}

export function formatOutputDocumentItemUnit(
  item: Pick<OutputDocumentDetailItem, "unitCode">
): string {
  return item.unitCode?.trim() || "—";
}

export function formatOutputDocumentItemLocalProduct(
  item: Pick<OutputDocumentDetailItem, "productLink" | "sku">
): string {
  if (item.sku?.trim()) return `SKU ${item.sku.trim()}`;
  return item.productLink.hasProductId
    ? `ID ${item.productLink.externalProductId}`
    : "Não vinculado";
}

export function formatOutputDocumentItemOrder(
  item: Pick<OutputDocumentDetailItem, "links">
): string {
  const first = item.links[0];
  if (!first) return "—";
  const label = first.orderCode?.trim() || first.salesOrderId || "—";
  const extra = item.links.length - 1;
  return extra > 0 ? `${label} (+${extra})` : label;
}

export function formatOutputDocumentItemOrderItem(
  item: Pick<OutputDocumentDetailItem, "links">
): string {
  const first = item.links[0];
  if (!first?.salesOrderItemId) return "—";
  return first.salesOrderItemId;
}

export function formatOutputDocumentCancellation(
  cancellation: {
    isCancelled: boolean;
    cancelledAt: string | null;
    reason: string | null;
  }
): string {
  if (!cancellation.isCancelled) return "Não";
  const when = formatOutputDocumentDateTime(cancellation.cancelledAt);
  const reason = cancellation.reason?.trim();
  if (reason && when !== "—") return `Sim · ${when} · ${reason}`;
  if (reason) return `Sim · ${reason}`;
  if (when !== "—") return `Sim · ${when}`;
  return "Sim";
}

export function formatOutputDocumentPrimaryNfe(
  nfes: ReadonlyArray<{
    numero: string | null;
    externalId: number;
    isPrimary: boolean;
    isCancelled: boolean;
  }>
): string {
  const primary = nfes.find((nfe) => nfe.isPrimary) ?? nfes[0];
  if (!primary) return "—";
  const number = primary.numero?.trim() || String(primary.externalId);
  return primary.isCancelled ? `${number} (cancelada)` : number;
}


export function formatOutputDocumentDate(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function formatOutputDocumentDateTime(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatOutputDocumentMoney(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value, 2);
}

export function formatOutputDocumentLabel(
  value: string | null | undefined
): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function formatOutputDocumentNumber(
  item: Pick<OutputDocumentsListItem, "documentNumber" | "externalId">
): string {
  return item.documentNumber?.trim() || String(item.externalId);
}

export function formatOutputDocumentOrdersCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "—";
  return count === 1 ? "1 pedido" : `${count} pedidos`;
}

/** Preferência: código oficial; senão contagem. */
export function formatOutputDocumentOrdersLabel(
  item: Pick<
    OutputDocumentsListItem,
    "allocatedOrdersCount" | "primaryOrderCode" | "orderCodes"
  >
): string {
  const code = item.primaryOrderCode?.trim();
  const count = item.allocatedOrdersCount;
  if (code && count <= 1) return code;
  if (code && count > 1) return `${code} +${count - 1}`;
  return formatOutputDocumentOrdersCount(count);
}

export function formatOutputDocumentNfe(
  item: Pick<OutputDocumentsListItem, "nfeNumber" | "idNfe">
): string {
  if (item.nfeNumber?.trim()) return item.nfeNumber.trim();
  if (item.idNfe != null) return String(item.idNfe);
  return "—";
}

export function formatOutputDocumentFinancialStatusLabel(
  status: OutputDocumentFinancialStatus | string | null | undefined
): string {
  if (status == null || status === "") return "—";
  const known = OUTPUT_DOCUMENT_FINANCIAL_STATUS_OPTIONS.find(
    (option) => option.value === status
  );
  return known?.label ?? status;
}

export function outputDocumentFinancialStatusTone(
  status: OutputDocumentFinancialStatus | string | null | undefined
): OverlayBadgeTone {
  switch (status) {
    case "recebido":
      return "emerald";
    case "parcialmente_recebido":
    case "cr_em_aberto":
      return "sky";
    case "aguardando_cr":
      return "amber";
    case "vencido":
    case "cancelado":
      return "rose";
    default:
      return "slate";
  }
}

export function outputDocumentStatusTone(
  item: Pick<OutputDocumentsListItem, "isCancelled" | "statusRaw">
): OverlayBadgeTone {
  if (item.isCancelled) return "rose";
  const folded = (item.statusRaw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (folded.includes("cancel")) return "rose";
  if (folded.includes("fatur") || folded.includes("emitid")) return "emerald";
  if (folded.includes("pend") || folded.includes("aguard")) return "amber";
  return "slate";
}

export function formatOutputDocumentStatusLabel(
  item: Pick<OutputDocumentsListItem, "isCancelled" | "statusRaw">
): string {
  if (item.isCancelled) return "Cancelado";
  return formatOutputDocumentLabel(item.statusRaw);
}

export function parseOutputDocumentsFinancialStatusParam(
  value: string | null | undefined
): OutputDocumentFinancialStatus | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return OUTPUT_DOCUMENT_FINANCIAL_STATUS_OPTIONS.some(
    (option) => option.value === trimmed
  )
    ? (trimmed as OutputDocumentFinancialStatus)
    : null;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** CSV da página atual (exportação leve no browser). */
export function buildOutputDocumentsPageCsv(
  items: ReadonlyArray<OutputDocumentsListItem>
): string {
  const headers = [
    "Documento",
    "Emissão",
    "Cliente",
    "Empresa",
    "Status",
    "Valor",
    "Pedidos",
    "NF-e",
    "Financeiro",
    "Valor aberto",
    "Última sincronização",
    "ExternalId",
  ];
  const rows = items.map((item) =>
    [
      formatOutputDocumentNumber(item),
      formatOutputDocumentDate(item.dataDocumento),
      item.customerName?.trim() || "",
      item.companyName?.trim() || "",
      formatOutputDocumentStatusLabel(item),
      item.totalValue == null ? "" : String(item.totalValue),
      String(item.allocatedOrdersCount),
      formatOutputDocumentNfe(item),
      formatOutputDocumentFinancialStatusLabel(item.financialStatus),
      item.receivableOpenValue == null ? "" : String(item.receivableOpenValue),
      formatOutputDocumentDateTime(item.syncedAt),
      String(item.externalId),
    ]
      .map((cell) => csvEscape(cell))
      .join(",")
  );
  return `\uFEFF${[headers.join(","), ...rows].join("\r\n")}`;
}

export function downloadOutputDocumentsPageCsv(
  items: ReadonlyArray<OutputDocumentsListItem>,
  fileName = "documentos-de-saida.csv"
): void {
  const csv = buildOutputDocumentsPageCsv(items);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
