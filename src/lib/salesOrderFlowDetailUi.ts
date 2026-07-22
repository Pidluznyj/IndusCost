/**
 * Helpers UI do drawer de detalhe do Fluxo de Pedidos (browser-safe).
 */
import { HttpError } from "@/src/lib/http.js";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES,
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
  SALES_ORDER_FLOW_STAGE_LABELS,
  isSalesOrderFlowInconsistencyCode,
  isSalesOrderFlowStage,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowInconsistencySeverity,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog.js";
import type {
  SalesOrderFlowDetailPayload,
  SalesOrderFlowEventsPayload,
} from "@/src/lib/sales/salesOrderFlowDetail.js";
import type { SalesOrderFlowListInconsistency } from "@/src/lib/sales/salesOrderFlowList.js";
import {
  SALES_ORDER_FLOW_EVENT_TYPES,
  type SalesOrderFlowEventType,
} from "@/src/lib/sales/salesOrderFlowTimeline.shared.js";
import { formatCurrency } from "@/src/lib/utils.js";

export type SalesOrderFlowDetailTab =
  | "resumo"
  | "itens"
  | "producao"
  | "documentos"
  | "nfe_envio"
  | "timeline"
  | "inconsistencias";

export type SalesOrderFlowDetailItemView = {
  salesOrderItemId: string;
  productLabel: string;
  orderedQuantity: number | null;
  progressProductionOrder: number | null;
  progressProduced: number | null;
  progressDocumented: number | null;
  progressInvoiced: number | null;
  progressShipped: number | null;
  activeRemainingQuantity: number | null;
  cutQuantity: number | null;
  currentStage: string | null;
  stageLabel: string;
  nextAction: string | null;
  fulfillmentClassification: string | null;
  fulfillmentClassificationLabel: string;
  inconsistencies: SalesOrderFlowListInconsistency[];
  isInconsistent: boolean;
};

const FULFILLMENT_CLASSIFICATION_LABELS: Record<string, string> = {
  OPEN: "Em aberto",
  PENDING: "Pendente",
  PARTIAL: "Parcial — saldo pendente",
  PARTIALLY_FULFILLED: "Parcial — saldo pendente",
  FULFILLED: "Atendido integralmente",
  FULLY_FULFILLED: "Atendido integralmente",
  FULFILLED_WITH_CUT: "Atendido com corte — saldo operacional zerado",
  NOT_FULFILLED: "Não atendido",
  CANCELED: "Cancelado",
  UNKNOWN: "Desconhecido",
};

export function classifySalesOrderFlowDetailError(error: unknown): {
  kind: "not_found" | "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return {
        kind: "not_found",
        message: "Pedido não encontrado no Fluxo de Pedidos.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para ver o detalhe deste pedido.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API do detalhe do Fluxo de Pedidos indisponível. Tente novamente.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar o detalhe do pedido.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API do detalhe do Fluxo de Pedidos indisponível. Tente novamente.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar o detalhe do pedido.",
  };
}

export function formatSalesOrderFlowDetailDate(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function formatSalesOrderFlowDetailMoney(
  value: number | null | undefined,
  visible: boolean
): string {
  if (!visible) return "Oculto";
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value, 2);
}

export function formatSalesOrderFlowDetailQuantity(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatSalesOrderFlowDetailPercent(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const clamped = Math.max(0, Math.min(100, value));
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(clamped)}%`;
}

export function formatSalesOrderFlowDetailDays(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value === 1 ? "1 dia" : `${value} dias`;
}

export function formatSalesOrderFlowStageLabel(
  stage: string | null | undefined
): string {
  if (!stage) return "—";
  if (isSalesOrderFlowStage(stage)) {
    return SALES_ORDER_FLOW_STAGE_LABELS[stage as SalesOrderFlowStage];
  }
  return stage;
}

export function formatSalesOrderFlowFulfillmentClassification(
  code: string | null | undefined
): string {
  if (!code?.trim()) return "—";
  const key = code.trim().toUpperCase();
  return FULFILLMENT_CLASSIFICATION_LABELS[key] ?? code;
}

export function formatSalesOrderFlowInconsistencyLabel(code: string): string {
  return (
    SALES_ORDER_FLOW_INCONSISTENCY_LABELS[
      code as SalesOrderFlowInconsistencyCode
    ] ?? code
  );
}

export function formatSalesOrderFlowPriorityLabel(
  priority: string | null | undefined
): string {
  const key = String(priority ?? "NORMAL").trim().toUpperCase();
  if (key === "URGENT") return "Urgente";
  if (key === "HIGH") return "Alta";
  if (key === "LOW") return "Baixa";
  return "Normal";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asInconsistencies(value: unknown): SalesOrderFlowListInconsistency[] {
  if (!Array.isArray(value)) return [];
  const out: SalesOrderFlowListInconsistency[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const code = asString((row as { code?: unknown }).code);
    if (!code) continue;
    out.push({
      code,
      severity: asString((row as { severity?: unknown }).severity) ?? "WARNING",
      detail: asString((row as { detail?: unknown }).detail),
    });
  }
  return out;
}

export function resolveSalesOrderFlowDetailItems(
  payload: SalesOrderFlowDetailPayload
): SalesOrderFlowDetailItemView[] {
  return payload.itemSnapshots.map((raw, index) => {
    const productCode = asString(raw.productCode);
    const productName = asString(raw.productName);
    const salesOrderItemId =
      asString(raw.salesOrderItemId) ?? `item-${index + 1}`;
    const inconsistencies = payload.inconsistenciesVisible
      ? asInconsistencies(raw.inconsistencies)
      : [];
    const currentStage = asString(raw.currentStage);
    const classification = asString(raw.fulfillmentClassification);
    const productLabel =
      [productCode, productName].filter(Boolean).join(" · ") ||
      `Item ${index + 1}`;

    return {
      salesOrderItemId,
      productLabel,
      orderedQuantity:
        asNumber(raw.orderedQuantityDisplay) ?? asNumber(raw.orderedQuantity),
      progressProductionOrder: asNumber(raw.progressProductionOrder),
      progressProduced: asNumber(raw.progressProduced),
      progressDocumented: asNumber(raw.progressDocumented),
      progressInvoiced: asNumber(raw.progressInvoiced),
      progressShipped: asNumber(raw.progressShipped),
      activeRemainingQuantity: asNumber(raw.activeRemainingQuantity),
      cutQuantity: asNumber(raw.cutQuantity),
      currentStage,
      stageLabel: formatSalesOrderFlowStageLabel(currentStage),
      nextAction: asString(raw.nextAction),
      fulfillmentClassification: classification,
      fulfillmentClassificationLabel:
        formatSalesOrderFlowFulfillmentClassification(classification),
      inconsistencies,
      isInconsistent: inconsistencies.length > 0,
    };
  });
}

export function resolveSalesOrderFlowDetailDaysInStage(
  payload: SalesOrderFlowDetailPayload
): number | null {
  const fromSnapshot = asNumber(payload.orderSnapshot?.daysInStage);
  if (fromSnapshot != null) return fromSnapshot;
  return null;
}

export type SalesOrderFlowDetailProductionView = {
  id: string;
  externalId: number;
  label: string;
  status: string | null;
  productCode: string | null;
  linkedQuantity: number | null;
  plannedQuantity: number | null;
  producedQuantity: number | null;
  openedAt: string | null;
  closedAt: string | null;
  linkCount: number;
  isCurrentLink: boolean;
  inconsistencies: Array<{ code: string; detail: string }>;
  href: string;
};

export type SalesOrderFlowDetailDocumentView = {
  id: string;
  externalId: number;
  label: string;
  statusRaw: string | null;
  dataDocumento: string | null;
  itemCount: number;
  itemQuantity: number | null;
  allocatedQuantity: number | null;
  allocationCount: number;
  totalValue: number | null;
  isCancelled: boolean;
  cancellationReason: string | null;
  href: string;
};

export type SalesOrderFlowDetailNfeView = {
  externalId: number;
  label: string;
  serie: string | null;
  statusLabel: string;
  issuedAt: string | null;
  linkedQuantity: number | null;
  linkedValue: number | null;
  isCanceled: boolean;
  href: string;
};

export type SalesOrderFlowDetailShipmentView = {
  production: SalesOrderFlowDetailProductionView[];
  documentsActive: SalesOrderFlowDetailDocumentView[];
  documentsCanceled: SalesOrderFlowDetailDocumentView[];
  nfesActive: SalesOrderFlowDetailNfeView[];
  nfesCanceled: SalesOrderFlowDetailNfeView[];
  firstShippedAt: string | null;
  lastShippedAt: string | null;
  progressShipped: number | null;
  progressInvoiced: number | null;
  activeDocumentCount: number;
  activeNfeCount: number;
};

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asRecordArray(
  value: unknown
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}

export function resolveSalesOrderFlowDetailShipmentViews(
  payload: SalesOrderFlowDetailPayload
): SalesOrderFlowDetailShipmentView {
  const production = payload.productionVisible
    ? asRecordArray(payload.productionOrders).map((raw) => {
        const externalId = asNumber(raw.externalId) ?? 0;
        const inconsistencies = asRecordArray(raw.inconsistencies).map(
          (row) => ({
            code: asString(row.code) ?? "PRODUCTION_LINK_ITEM_MISMATCH",
            detail: asString(row.detail) ?? "",
          })
        );
        return {
          id: asString(raw.id) ?? String(externalId),
          externalId,
          label: `OP ${externalId}`,
          status: asString(raw.status),
          productCode: asString(raw.productCode),
          linkedQuantity: asNumber(raw.linkedQuantity),
          plannedQuantity: asNumber(raw.plannedQuantity),
          producedQuantity: asNumber(raw.producedQuantity),
          openedAt: asString(raw.openedAt),
          closedAt: asString(raw.closedAt),
          linkCount: asNumber(raw.linkCount) ?? 0,
          isCurrentLink: asBoolean(raw.isCurrentLink),
          inconsistencies,
          href:
            asString(raw.href) ??
            `/production-orders?search=${encodeURIComponent(String(externalId))}`,
        };
      })
    : [];

  const documents = payload.fiscalVisible
    ? asRecordArray(payload.stockDocuments).map((raw) => {
        const externalId = asNumber(raw.externalId) ?? 0;
        const documentNumber = asString(raw.documentNumber);
        return {
          id: asString(raw.id) ?? String(externalId),
          externalId,
          label: documentNumber
            ? `DS ${documentNumber}`
            : `DS #${externalId}`,
          statusRaw: asString(raw.statusRaw),
          dataDocumento: asString(raw.dataDocumento),
          itemCount: asNumber(raw.itemCount) ?? 0,
          itemQuantity: asNumber(raw.itemQuantity),
          allocatedQuantity: asNumber(raw.allocatedQuantity),
          allocationCount: asNumber(raw.allocationCount) ?? 0,
          totalValue: asNumber(raw.totalValue),
          isCancelled: asBoolean(raw.isCancelled),
          cancellationReason: asString(raw.cancellationReason),
          href:
            asString(raw.href) ??
            `/output-documents?search=${encodeURIComponent(
              documentNumber || String(externalId)
            )}`,
        };
      })
    : [];

  const nfes = payload.fiscalVisible
    ? asRecordArray(payload.nfes).map((raw) => {
        const externalId = asNumber(raw.externalId) ?? 0;
        const numero = asString(raw.numero);
        const statusObj =
          raw.statusNormalized &&
          typeof raw.statusNormalized === "object" &&
          !Array.isArray(raw.statusNormalized)
            ? (raw.statusNormalized as Record<string, unknown>)
            : {};
        return {
          externalId,
          label: numero ? `NF-e ${numero}` : `NF-e #${externalId}`,
          serie: asString(raw.serie),
          statusLabel:
            asString(statusObj.label) ??
            (asBoolean(raw.isCanceled) ? "Cancelada" : "—"),
          issuedAt: asString(raw.issuedAt),
          linkedQuantity: asNumber(raw.linkedQuantity),
          linkedValue: asNumber(raw.linkedValue),
          isCanceled: asBoolean(raw.isCanceled),
          href:
            asString(raw.href) ??
            (numero
              ? `/output-documents?search=${encodeURIComponent(numero)}`
              : "/output-documents"),
        };
      })
    : [];

  const documentsActive = documents.filter((doc) => !doc.isCancelled);
  const documentsCanceled = documents.filter((doc) => doc.isCancelled);
  const nfesActive = nfes.filter((nfe) => !nfe.isCanceled);
  const nfesCanceled = nfes.filter((nfe) => nfe.isCanceled);

  return {
    production,
    documentsActive,
    documentsCanceled,
    nfesActive,
    nfesCanceled,
    firstShippedAt: payload.shipmentDates?.firstShippedAt ?? null,
    lastShippedAt: payload.shipmentDates?.lastShippedAt ?? null,
    progressShipped: payload.progress?.shipped ?? null,
    progressInvoiced: payload.progress?.invoiced ?? null,
    activeDocumentCount: documentsActive.length,
    activeNfeCount: nfesActive.length,
  };
}

export function resolveSalesOrderFlowDetailAvailableTabs(
  payload: SalesOrderFlowDetailPayload | null
): Array<{ id: SalesOrderFlowDetailTab; label: string; count?: number }> {
  const base: Array<{ id: SalesOrderFlowDetailTab; label: string; count?: number }> = [
    { id: "resumo", label: "Resumo" },
    {
      id: "itens",
      label: "Itens",
      count: payload?.itemSnapshots.length,
    },
  ];
  if (!payload) return base;
  if (payload.productionVisible) {
    base.push({
      id: "producao",
      label: "Produção",
      count: payload.productionOrders.length,
    });
  }
  if (payload.fiscalVisible) {
    const views = resolveSalesOrderFlowDetailShipmentViews(payload);
    base.push({
      id: "documentos",
      label: "Documentos de Saída",
      count: views.activeDocumentCount,
    });
    base.push({
      id: "nfe_envio",
      label: "NF-e e Envio",
      count: views.activeNfeCount,
    });
  }
  if (payload.timelineVisible) {
    base.push({ id: "timeline", label: "Timeline" });
  }
  if (payload.inconsistenciesVisible) {
    const items = resolveSalesOrderFlowDetailItems(payload);
    base.push({
      id: "inconsistencias",
      label: "Inconsistências",
      count: resolveSalesOrderFlowDetailInconsistencyRows(payload, items)
        .length,
    });
  }
  return base;
}

export const SALES_ORDER_FLOW_EVENT_TYPE_LABELS: Record<
  SalesOrderFlowEventType,
  string
> = {
  SNAPSHOT_CREATED: "Snapshot criado",
  STAGE_CHANGED: "Mudança de etapa",
  STAGE_RETURNED: "Retorno de etapa",
  STAGE_COMPLETED: "Etapa concluída",
  CUT_DETECTED: "Corte detectado",
  CANCELED: "Cancelamento",
  INCONSISTENCY_CRITICAL: "Inconsistência crítica",
  INCONSISTENCY_RESOLVED: "Inconsistência crítica sanada por evidência",
  MANAGEMENT_UPDATED: "Gestão atualizada",
};

export type SalesOrderFlowDetailEventView = {
  id: string;
  dedupeKey: string;
  eventType: string;
  eventLabel: string;
  fromStage: string | null;
  toStage: string | null;
  fromStageLabel: string;
  toStageLabel: string;
  occurredAt: string | null;
  observedAt: string | null;
  originLabel: string;
  relatedDocument: string | null;
  reason: string | null;
  isStageReturn: boolean;
  isCut: boolean;
  isCancellation: boolean;
  salesOrderItemId: string | null;
  itemLabel: string | null;
};

export type SalesOrderFlowDetailInconsistencyRow = {
  key: string;
  code: string;
  label: string;
  severity: SalesOrderFlowInconsistencySeverity;
  explanation: string | null;
  entityLabel: string;
  evidence: string | null;
  responsibleArea: string | null;
  conclusionEffect: string;
  detectedAt: string | null;
  salesOrderItemId: string | null;
};

export function formatSalesOrderFlowEventTypeLabel(eventType: string): string {
  if (
    (SALES_ORDER_FLOW_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return SALES_ORDER_FLOW_EVENT_TYPE_LABELS[
      eventType as SalesOrderFlowEventType
    ];
  }
  return eventType;
}

export function formatSalesOrderFlowInconsistencySeverityLabel(
  severity: string
): string {
  const key = severity.trim().toUpperCase();
  if (key === "CRITICAL") return "Crítica";
  if (key === "ERROR") return "Erro";
  if (key === "WARNING") return "Alerta";
  if (key === "INFO") return "Informação";
  return severity;
}

export function salesOrderFlowInconsistencySeverityClassName(
  severity: string
): string {
  const key = severity.trim().toUpperCase();
  if (key === "CRITICAL") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }
  if (key === "WARNING") {
    return "border-amber-200/80 bg-amber-50/70 text-amber-950";
  }
  if (key === "ERROR") {
    return "border-rose-100 bg-rose-50/40 text-rose-900";
  }
  return "border-border bg-muted/40 text-foreground";
}

function normalizeInconsistencySeverity(
  code: string,
  severityRaw: string | null | undefined
): SalesOrderFlowInconsistencySeverity {
  const upper = String(severityRaw ?? "").trim().toUpperCase();
  if (
    (SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES as readonly string[]).includes(
      upper
    )
  ) {
    return upper as SalesOrderFlowInconsistencySeverity;
  }
  if (isSalesOrderFlowInconsistencyCode(code)) {
    return SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE[code];
  }
  return "WARNING";
}

function conclusionEffectForSeverity(
  severity: SalesOrderFlowInconsistencySeverity
): string {
  if (severity === "CRITICAL") {
    return "Impede concluir o fluxo com segurança até nova evidência.";
  }
  if (severity === "ERROR") {
    return "Pode bloquear a conclusão operacional.";
  }
  if (severity === "WARNING") {
    return "Exige atenção; não indica resolução automática.";
  }
  return "Informativo; não altera a conclusão por si só.";
}

function asDetailsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function resolveSalesOrderFlowDetailEventView(
  event: SalesOrderFlowEventsPayload["items"][number],
  itemLookup: Map<string, string> = new Map()
): SalesOrderFlowDetailEventView {
  const details = asDetailsRecord(event.details);
  const scope = asString(details.scope);
  const direction = asString(details.direction);
  const codes = Array.isArray(details.codes)
    ? details.codes
        .map((code) => asString(code))
        .filter((code): code is string => Boolean(code))
    : [];
  const fulfillment = asString(details.fulfillmentClassification);
  const relatedDocument =
    asString(details.documentNumber) ??
    asString(details.relatedDocument) ??
    asString(details.nfeNumero);

  let reason: string | null = null;
  if (codes.length > 0) {
    reason = codes.map((code) => formatSalesOrderFlowInconsistencyLabel(code)).join(" · ");
  } else if (fulfillment) {
    reason = formatSalesOrderFlowFulfillmentClassification(fulfillment);
  } else if (Array.isArray(details.changedFields) && details.changedFields.length) {
    reason = `Campos alterados: ${details.changedFields
      .map((field) => asString(field))
      .filter(Boolean)
      .join(", ")}`;
  } else if (direction === "RETURN") {
    reason = "Retorno de etapa";
  }

  const isStageReturn =
    event.eventType === "STAGE_RETURNED" || direction === "RETURN";
  const isCut = event.eventType === "CUT_DETECTED";
  const isCancellation = event.eventType === "CANCELED";

  const itemId = asString(event.salesOrderItemId);
  const originLabel =
    scope === "ITEM" || itemId
      ? itemId
        ? `Item · ${itemLookup.get(itemId) ?? itemId}`
        : "Item"
      : "Pedido";

  return {
    id: event.id,
    dedupeKey: event.dedupeKey,
    eventType: event.eventType,
    eventLabel: formatSalesOrderFlowEventTypeLabel(event.eventType),
    fromStage: event.fromStage,
    toStage: event.toStage,
    fromStageLabel: formatSalesOrderFlowStageLabel(event.fromStage),
    toStageLabel: formatSalesOrderFlowStageLabel(event.toStage),
    occurredAt: event.occurredAt,
    observedAt: event.observedAt,
    originLabel,
    relatedDocument,
    reason,
    isStageReturn,
    isCut,
    isCancellation,
    salesOrderItemId: itemId,
    itemLabel: itemId ? itemLookup.get(itemId) ?? null : null,
  };
}

export function dedupeSalesOrderFlowDetailEventsByKey<
  T extends { id: string; dedupeKey?: string | null },
>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const event of events) {
    const key = event.dedupeKey?.trim() || event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

export function resolveSalesOrderFlowDetailInconsistencyRows(
  payload: SalesOrderFlowDetailPayload,
  items: SalesOrderFlowDetailItemView[]
): SalesOrderFlowDetailInconsistencyRow[] {
  if (!payload.inconsistenciesVisible) return [];

  const detectedAt =
    asString(payload.orderSnapshot?.computedAt) ?? payload.generatedAt;
  const orderArea =
    asString(payload.responsibleArea) ??
    asString(payload.columnExplanation.responsibleArea);
  const rows: SalesOrderFlowDetailInconsistencyRow[] = [];

  for (const [index, row] of payload.inconsistencies.entries()) {
    const severity = normalizeInconsistencySeverity(row.code, row.severity);
    rows.push({
      key: `order:${row.code}:${index}`,
      code: row.code,
      label: formatSalesOrderFlowInconsistencyLabel(row.code),
      severity,
      explanation: row.detail,
      entityLabel: "Pedido",
      evidence: row.detail,
      responsibleArea: orderArea,
      conclusionEffect: conclusionEffectForSeverity(severity),
      detectedAt,
      salesOrderItemId: null,
    });
  }

  for (const item of items) {
    for (const [index, row] of item.inconsistencies.entries()) {
      const severity = normalizeInconsistencySeverity(row.code, row.severity);
      rows.push({
        key: `item:${item.salesOrderItemId}:${row.code}:${index}`,
        code: row.code,
        label: formatSalesOrderFlowInconsistencyLabel(row.code),
        severity,
        explanation: row.detail,
        entityLabel: `Item · ${item.productLabel}`,
        evidence: row.detail,
        responsibleArea: orderArea,
        conclusionEffect: conclusionEffectForSeverity(severity),
        detectedAt,
        salesOrderItemId: item.salesOrderItemId,
      });
    }
  }

  return rows;
}

export function filterSalesOrderFlowDetailInconsistencyRows(
  rows: SalesOrderFlowDetailInconsistencyRow[],
  filters: {
    salesOrderItemId?: string | null;
    severity?: string | null;
  }
): SalesOrderFlowDetailInconsistencyRow[] {
  const itemId = filters.salesOrderItemId?.trim() || null;
  const severity = filters.severity?.trim().toUpperCase() || null;
  return rows.filter((row) => {
    if (itemId && row.salesOrderItemId !== itemId) return false;
    if (severity && row.severity !== severity) return false;
    return true;
  });
}

export { SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES };

export type SalesOrderFlowManagementUiCapabilities = {
  canUpdateManually: boolean;
  canChangePriority: boolean;
  canAssignResponsible: boolean;
  canManageBlocking: boolean;
};

export type SalesOrderFlowDetailNavigationCapabilities = {
  canOpenSalesOrder: boolean;
  canOpenProductionOrders: boolean;
  canOpenOutputDocuments: boolean;
  canOpenPortfolioAudit360: boolean;
  canExecuteRecompute: boolean;
};

export type SalesOrderFlowDetailHeaderLink = {
  id:
    | "sales_order"
    | "production_orders"
    | "output_documents"
    | "portfolio_audit_360";
  label: string;
  href: string;
  testId: string;
};

/**
 * Links oficiais do header do drawer — só rotas com permissão.
 * NF-e fica nas evidências; o atalho de auditoria cobre a visão 360°.
 */
export function resolveSalesOrderFlowDetailNavigationCapabilities(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  canViewModule?: (moduleId: string) => boolean;
}): SalesOrderFlowDetailNavigationCapabilities {
  const can = check.canPerformAction;
  return {
    canOpenSalesOrder: Boolean(
      can?.("commercial.sales_orders", "view") ||
        check.canViewModule?.("sales-orders")
    ),
    canOpenProductionOrders: Boolean(
      can?.("operations.production_orders", "view")
    ),
    canOpenOutputDocuments: Boolean(
      can?.("commercial.output_documents", "view")
    ),
    canOpenPortfolioAudit360: Boolean(
      can?.("finance.portfolio_reconciliation", "view") ||
        check.canViewModule?.("portfolio-reconciliation")
    ),
    canExecuteRecompute: Boolean(
      can?.("commercial.sales_orders.flow_rebuild", "execute")
    ),
  };
}

export function resolveSalesOrderFlowDetailHeaderLinks(
  payload: Pick<
    SalesOrderFlowDetailPayload,
    "officialLinks" | "productionVisible" | "fiscalVisible"
  >,
  capabilities: SalesOrderFlowDetailNavigationCapabilities
): SalesOrderFlowDetailHeaderLink[] {
  const links: SalesOrderFlowDetailHeaderLink[] = [];
  if (capabilities.canOpenSalesOrder) {
    links.push({
      id: "sales_order",
      label: "Pedido de Venda",
      href: payload.officialLinks.salesOrder,
      testId: "sales-order-flow-detail-open-sales-order",
    });
  }
  if (capabilities.canOpenProductionOrders && payload.productionVisible) {
    links.push({
      id: "production_orders",
      label: "Ordens de Produção",
      href: payload.officialLinks.productionOrders,
      testId: "sales-order-flow-detail-open-production-orders",
    });
  }
  if (capabilities.canOpenOutputDocuments && payload.fiscalVisible) {
    links.push({
      id: "output_documents",
      label: "Documentos de Saída",
      href: payload.officialLinks.outputDocuments,
      testId: "sales-order-flow-detail-open-output-documents",
    });
  }
  if (capabilities.canOpenPortfolioAudit360) {
    links.push({
      id: "portfolio_audit_360",
      label: "Auditoria 360°",
      href: payload.officialLinks.portfolioAudit360,
      testId: "sales-order-flow-detail-open-audit-360",
    });
  }
  return links;
}

export function classifySalesOrderFlowRecomputeError(error: unknown): {
  kind: "access_denied" | "not_found" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para recomputar este pedido.",
      };
    }
    if (error.status === 404) {
      return {
        kind: "not_found",
        message: error.message || "Pedido não encontrado para recomputação.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Não foi possível atualizar o pedido.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Não foi possível atualizar o pedido.",
  };
}

export const SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "COMERCIAL", label: "Comercial" },
  { value: "PCP_PRODUCAO", label: "PCP / Produção" },
  { value: "EXPEDICAO_FATURAMENTO", label: "Expedição / Faturamento" },
  { value: "FISCAL", label: "Fiscal" },
  { value: "TI", label: "TI" },
  { value: "NENHUMA", label: "Nenhuma" },
];

export function resolveSalesOrderFlowManagementUiCapabilities(
  canPerformAction: (resourceKey: string, action: string) => boolean
): SalesOrderFlowManagementUiCapabilities {
  const canUpdateManually = canPerformAction(
    "commercial.sales_orders.flow_management",
    "manage"
  );
  return {
    canUpdateManually,
    canChangePriority:
      canUpdateManually &&
      canPerformAction(
        "commercial.sales_orders.flow_management.priority",
        "manage"
      ),
    canAssignResponsible:
      canUpdateManually &&
      canPerformAction(
        "commercial.sales_orders.flow_management.responsibility",
        "manage"
      ),
    canManageBlocking:
      canUpdateManually &&
      canPerformAction(
        "commercial.sales_orders.flow_management.blocking",
        "manage"
      ),
  };
}

export function classifySalesOrderFlowManagementError(error: unknown): {
  kind: "conflict" | "validation" | "access_denied" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 409 || error.code === "MANAGEMENT_UPDATE_CONFLICT") {
      return {
        kind: "conflict",
        message:
          error.message ||
          "A gestão foi alterada por outro usuário. Recarregamos os dados.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para alterar a gestão deste pedido.",
      };
    }
    if (error.status === 400) {
      return {
        kind: "validation",
        message: error.message || "Dados de gestão inválidos.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao salvar a gestão do pedido.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao salvar a gestão do pedido.",
  };
}

export type SalesOrderFlowManagementFormState = {
  priority: string;
  responsibleUserId: string;
  responsibleName: string;
  responsibleArea: string;
  isBlocked: boolean;
  blockReason: string;
  expectedResolutionAt: string;
  internalNote: string;
};

export function salesOrderFlowManagementToFormState(
  management: SalesOrderFlowDetailPayload["management"]
): SalesOrderFlowManagementFormState {
  const iso = management?.expectedResolutionAt ?? null;
  const dateOnly =
    iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "";
  return {
    priority: management?.priority?.trim() || "NORMAL",
    responsibleUserId: management?.responsibleUserId ?? "",
    responsibleName: management?.responsibleName ?? "",
    responsibleArea: management?.responsibleArea ?? "",
    isBlocked: management?.isBlocked === true,
    blockReason: management?.blockReason ?? "",
    expectedResolutionAt: dateOnly,
    internalNote: management?.internalNote ?? "",
  };
}

export function buildSalesOrderFlowManagementPatchBody(input: {
  expectedUpdatedAt: string | null;
  baseline: SalesOrderFlowManagementFormState;
  draft: SalesOrderFlowManagementFormState;
  capabilities: SalesOrderFlowManagementUiCapabilities;
}): {
  body: {
    expectedUpdatedAt: string | null;
    priority?: string;
    responsibleUserId?: string | null;
    responsibleArea?: string | null;
    isBlocked?: boolean;
    blockReason?: string | null;
    expectedResolutionAt?: string | null;
    internalNote?: string | null;
  };
  validationError: string | null;
} {
  const { baseline, draft, capabilities } = input;
  const body: {
    expectedUpdatedAt: string | null;
    priority?: string;
    responsibleUserId?: string | null;
    responsibleArea?: string | null;
    isBlocked?: boolean;
    blockReason?: string | null;
    expectedResolutionAt?: string | null;
    internalNote?: string | null;
  } = { expectedUpdatedAt: input.expectedUpdatedAt };

  if (capabilities.canChangePriority && draft.priority !== baseline.priority) {
    body.priority = draft.priority;
  }
  if (capabilities.canAssignResponsible) {
    if (draft.responsibleUserId !== baseline.responsibleUserId) {
      body.responsibleUserId = draft.responsibleUserId.trim() || null;
    }
    if (draft.responsibleArea.trim() !== baseline.responsibleArea.trim()) {
      body.responsibleArea = draft.responsibleArea.trim() || null;
    }
  }
  if (capabilities.canManageBlocking) {
    if (draft.isBlocked !== baseline.isBlocked) {
      body.isBlocked = draft.isBlocked;
      if (draft.isBlocked) {
        body.blockReason = draft.blockReason.trim() || null;
        body.expectedResolutionAt = draft.expectedResolutionAt.trim()
          ? `${draft.expectedResolutionAt.trim()}T12:00:00.000Z`
          : null;
      }
    } else if (draft.isBlocked) {
      if (draft.blockReason.trim() !== baseline.blockReason.trim()) {
        body.blockReason = draft.blockReason.trim() || null;
      }
      if (
        draft.expectedResolutionAt.trim() !==
        baseline.expectedResolutionAt.trim()
      ) {
        body.expectedResolutionAt = draft.expectedResolutionAt.trim()
          ? `${draft.expectedResolutionAt.trim()}T12:00:00.000Z`
          : null;
      }
    }
  }
  if (
    capabilities.canUpdateManually &&
    draft.internalNote.trim() !== baseline.internalNote.trim()
  ) {
    body.internalNote = draft.internalNote.trim() || null;
  }

  const mutableKeys = Object.keys(body).filter(
    (key) => key !== "expectedUpdatedAt"
  );
  if (mutableKeys.length === 0) {
    return {
      body,
      validationError: "Nenhuma alteração para salvar.",
    };
  }
  if (body.isBlocked === true && !draft.blockReason.trim()) {
    return {
      body,
      validationError: "Informe o motivo do bloqueio.",
    };
  }
  if (
    draft.isBlocked &&
    body.blockReason !== undefined &&
    !String(body.blockReason ?? "").trim()
  ) {
    return {
      body,
      validationError: "Informe o motivo do bloqueio.",
    };
  }

  return { body, validationError: null };
}

export function filterSalesOrderFlowManagementAreaOptions(
  query: string
): Array<{ value: string; label: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return [...SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS];
  return SALES_ORDER_FLOW_MANAGEMENT_AREA_OPTIONS.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      option.value.toLowerCase().includes(q)
  );
}
