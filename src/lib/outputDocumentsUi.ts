/**
 * Helpers browser-safe da tela Comercial → Documentos de Saída.
 */
import { COMMERCIAL_ACTIONS, COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type { OutputDocumentsListItem } from "@/src/lib/output-documents/outputDocumentsListTypes.js";
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
  company: string;
  customer: string;
  from: string;
  to: string;
  status?: string;
  order?: string;
  nfe?: string;
  financialStatus?: string | null;
  cancelled?: string | null;
};

export function hasActiveOutputDocumentsFilters(
  input: OutputDocumentsActiveFiltersInput
): boolean {
  return Boolean(
    input.search.trim() ||
      input.company.trim() ||
      input.customer.trim() ||
      input.from ||
      input.to ||
      input.status?.trim() ||
      input.order?.trim() ||
      input.nfe?.trim() ||
      input.financialStatus?.trim() ||
      (input.cancelled && input.cancelled !== "all")
  );
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
  item: Pick<OutputDocumentDetailItem, "externalProductId" | "externalItemId">
): string {
  if (item.externalProductId != null) return String(item.externalProductId);
  if (item.externalItemId != null) return `Item ${item.externalItemId}`;
  return "—";
}

export function formatOutputDocumentItemDescription(
  item: Pick<OutputDocumentDetailItem, "externalProductId" | "alerts">
): string {
  if (item.externalProductId != null) {
    return `Produto Nomus #${item.externalProductId}`;
  }
  const alert = item.alerts.find((entry) => entry.trim().length > 0);
  return alert?.trim() || "Sem descrição no stage";
}

export function formatOutputDocumentItemLocalProduct(
  item: Pick<OutputDocumentDetailItem, "productLink">
): string {
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
