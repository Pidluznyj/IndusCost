/**
 * Trilha unificada de auditoria — Inteligência de Mercado.
 *
 * Alterações críticas que exigem motivo (`reason`):
 * - REJECTED — rejeição de cotação em aprovação
 * - SET_OFFICIAL — definir cotação como referência oficial
 * - CONFIG_CHANGED — alteração de limiares de alerta (material ou global)
 * - PRICE_CHANGED — quando a cotação é referência oficial (`isOfficialReference`)
 */

export const MATERIAL_MARKET_AUDIT_ENTITY_TYPES = [
  "QUOTE",
  "ALERT_CONFIG",
  "OFFICIAL_QUOTE",
  "APPROVAL",
  "GLOBAL_CONFIG",
  "PURCHASE_LINK",
] as const;

export type MaterialMarketAuditEntityType =
  (typeof MATERIAL_MARKET_AUDIT_ENTITY_TYPES)[number];

export const MATERIAL_MARKET_AUDIT_EVENT_TYPES = [
  "CREATED",
  "UPDATED",
  "PRICE_CHANGED",
  "SUPPLIER_CHANGED",
  "EXCHANGE_CHANGED",
  "STATUS_CHANGED",
  "APPROVED",
  "REJECTED",
  "SET_OFFICIAL",
  "REPLACED",
  "CONFIG_CHANGED",
  "SUBMITTED_FOR_APPROVAL",
  "MONITORING_CHANGED",
  "ALERT_STATUS_CHANGED",
  "PURCHASE_LINKED",
] as const;

export type MaterialMarketAuditEventType =
  (typeof MATERIAL_MARKET_AUDIT_EVENT_TYPES)[number];

export const MATERIAL_MARKET_AUDIT_ENTITY_LABELS: Record<
  MaterialMarketAuditEntityType,
  string
> = {
  QUOTE: "Cotação",
  ALERT_CONFIG: "Configuração de alertas",
  OFFICIAL_QUOTE: "Cotação oficial",
  APPROVAL: "Aprovação",
  GLOBAL_CONFIG: "Configuração global",
  PURCHASE_LINK: "Vínculo de compra",
};

export const MATERIAL_MARKET_AUDIT_EVENT_LABELS: Record<
  MaterialMarketAuditEventType,
  string
> = {
  CREATED: "Cotação criada",
  UPDATED: "Cotação atualizada",
  PRICE_CHANGED: "Preço alterado",
  SUPPLIER_CHANGED: "Fornecedor alterado",
  EXCHANGE_CHANGED: "Câmbio alterado",
  STATUS_CHANGED: "Status alterado",
  APPROVED: "Cotação aprovada",
  REJECTED: "Cotação rejeitada",
  SET_OFFICIAL: "Definida como oficial",
  REPLACED: "Cotação oficial substituída",
  CONFIG_CHANGED: "Configuração alterada",
  SUBMITTED_FOR_APPROVAL: "Enviada para aprovação",
  MONITORING_CHANGED: "Monitoramento alterado",
  ALERT_STATUS_CHANGED: "Status de alerta alterado",
  PURCHASE_LINKED: "Compra vinculada à cotação",
};

export type MaterialMarketAuditRecordInput = {
  materialId?: string | null;
  entityType: MaterialMarketAuditEntityType;
  entityId?: string | null;
  eventType: MaterialMarketAuditEventType;
  userId?: string | null;
  userName?: string | null;
  occurredAt?: Date | string;
  reason?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  metadata?: unknown;
  isOfficialQuote?: boolean;
};

export type MaterialMarketAuditValidationResult =
  | { ok: true }
  | { ok: false; code: "AUDIT_REASON_REQUIRED"; message: string; field: "reason" };

const REASON_REQUIRED_EVENT_TYPES = new Set<MaterialMarketAuditEventType>([
  "REJECTED",
  "SET_OFFICIAL",
  "CONFIG_CHANGED",
]);

export function auditEventRequiresReason(input: {
  eventType: MaterialMarketAuditEventType;
  isOfficialQuote?: boolean;
}): boolean {
  if (REASON_REQUIRED_EVENT_TYPES.has(input.eventType)) return true;
  if (input.eventType === "PRICE_CHANGED" && input.isOfficialQuote) return true;
  return false;
}

export function validateMaterialMarketAuditReason(
  input: MaterialMarketAuditRecordInput
): MaterialMarketAuditValidationResult {
  const requiresReason = auditEventRequiresReason({
    eventType: input.eventType,
    isOfficialQuote: input.isOfficialQuote,
  });
  if (!requiresReason) return { ok: true };

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      code: "AUDIT_REASON_REQUIRED",
      field: "reason",
      message: "Motivo é obrigatório para esta alteração.",
    };
  }

  return { ok: true };
}

export function buildMaterialMarketAuditEventData(input: MaterialMarketAuditRecordInput) {
  const validation = validateMaterialMarketAuditReason(input);
  if (validation.ok === false) {
    return { ok: false as const, ...validation };
  }

  return {
    ok: true as const,
    data: {
      materialId: input.materialId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      eventType: input.eventType,
      userId: input.userId ?? null,
      userName: input.userName?.trim() || null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      reason: input.reason?.trim() || null,
      beforeJson: input.beforeJson ?? undefined,
      afterJson: input.afterJson ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  };
}

export type MaterialMarketQuoteAuditSnapshot = {
  id: string;
  price?: number | string | null;
  netPrice?: number | string | null;
  currency?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  exchangeOrigin?: string | null;
  ptaxVenda?: number | string | null;
  isOfficialReference?: boolean;
};

function toComparable(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function detectMaterialMarketQuoteChangeEvents(input: {
  before: MaterialMarketQuoteAuditSnapshot;
  after: MaterialMarketQuoteAuditSnapshot;
}): MaterialMarketAuditEventType[] {
  const events: MaterialMarketAuditEventType[] = [];
  const { before, after } = input;

  const beforePrice = toNumberOrNull(before.netPrice ?? before.price);
  const afterPrice = toNumberOrNull(after.netPrice ?? after.price);
  if (beforePrice !== afterPrice) events.push("PRICE_CHANGED");

  if (
    toComparable(before.supplierId) !== toComparable(after.supplierId) ||
    toComparable(before.supplierName) !== toComparable(after.supplierName)
  ) {
    events.push("SUPPLIER_CHANGED");
  }

  if (
    toComparable(before.exchangeOrigin) !== toComparable(after.exchangeOrigin) ||
    toNumberOrNull(before.ptaxVenda) !== toNumberOrNull(after.ptaxVenda)
  ) {
    events.push("EXCHANGE_CHANGED");
  }

  if (toComparable(before.status) !== toComparable(after.status)) {
    events.push("STATUS_CHANGED");
  }

  if (events.length === 0) events.push("UPDATED");
  return events;
}

export function serializeQuoteAuditSnapshot(
  quote: MaterialMarketQuoteAuditSnapshot
): Record<string, unknown> {
  return {
    id: quote.id,
    price: toNumberOrNull(quote.price),
    netPrice: toNumberOrNull(quote.netPrice),
    currency: quote.currency ?? null,
    supplierId: quote.supplierId ?? null,
    supplierName: quote.supplierName ?? null,
    status: quote.status ?? null,
    exchangeOrigin: quote.exchangeOrigin ?? null,
    ptaxVenda: toNumberOrNull(quote.ptaxVenda),
    isOfficialReference: quote.isOfficialReference ?? false,
  };
}

export type MaterialMarketAuditApiItem = {
  id: string;
  materialId: string | null;
  entityType: MaterialMarketAuditEntityType;
  entityTypeLabel: string;
  entityId: string | null;
  eventType: MaterialMarketAuditEventType;
  eventTypeLabel: string;
  userId: string | null;
  userName: string | null;
  occurredAt: string;
  reason: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  details: string | null;
  legacySource?: "MaterialOfficialQuoteAudit" | "MaterialMarketAlertConfigAudit";
};

export type MaterialMarketAuditListSourceRow = {
  id: string;
  materialId?: string | null;
  entityType: string;
  entityId?: string | null;
  eventType: string;
  userId?: string | null;
  userName?: string | null;
  occurredAt: Date | string;
  reason?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  metadata?: unknown;
  legacySource?: "MaterialOfficialQuoteAudit" | "MaterialMarketAlertConfigAudit";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function formatAuditDetails(
  eventType: MaterialMarketAuditEventType,
  beforeJson: Record<string, unknown> | null,
  afterJson: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null
): string | null {
  if (eventType === "PRICE_CHANGED" && beforeJson && afterJson) {
    const before = beforeJson.netPrice ?? beforeJson.price;
    const after = afterJson.netPrice ?? afterJson.price;
    if (before != null && after != null) {
      return `Preço líquido: ${before} → ${after}`;
    }
  }
  if (eventType === "SUPPLIER_CHANGED" && beforeJson && afterJson) {
    const before = beforeJson.supplierName ?? beforeJson.supplierId ?? "—";
    const after = afterJson.supplierName ?? afterJson.supplierId ?? "—";
    return `Fornecedor: ${before} → ${after}`;
  }
  if (eventType === "CONFIG_CHANGED" && metadata?.summary) {
    return String(metadata.summary);
  }
  if (metadata?.message) return String(metadata.message);
  return null;
}

export function serializeMaterialMarketAuditEventForApi(
  row: MaterialMarketAuditListSourceRow
): MaterialMarketAuditApiItem {
  const entityType = MATERIAL_MARKET_AUDIT_ENTITY_TYPES.includes(
    row.entityType as MaterialMarketAuditEntityType
  )
    ? (row.entityType as MaterialMarketAuditEntityType)
    : "QUOTE";

  const eventType = MATERIAL_MARKET_AUDIT_EVENT_TYPES.includes(
    row.eventType as MaterialMarketAuditEventType
  )
    ? (row.eventType as MaterialMarketAuditEventType)
    : "UPDATED";

  const beforeJson = asRecord(row.beforeJson);
  const afterJson = asRecord(row.afterJson);
  const metadata = asRecord(row.metadata);

  return {
    id: row.id,
    materialId: row.materialId ?? null,
    entityType,
    entityTypeLabel: MATERIAL_MARKET_AUDIT_ENTITY_LABELS[entityType],
    entityId: row.entityId ?? null,
    eventType,
    eventTypeLabel: MATERIAL_MARKET_AUDIT_EVENT_LABELS[eventType],
    userId: row.userId ?? null,
    userName: row.userName ?? null,
    occurredAt: new Date(row.occurredAt).toISOString(),
    reason: row.reason?.trim() || null,
    beforeJson,
    afterJson,
    metadata,
    details: formatAuditDetails(eventType, beforeJson, afterJson, metadata),
    legacySource: row.legacySource,
  };
}

const OFFICIAL_ACTION_TO_EVENT: Record<string, MaterialMarketAuditEventType> = {
  SUBMITTED: "SUBMITTED_FOR_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SET_OFFICIAL: "SET_OFFICIAL",
  REPLACED: "REPLACED",
};

export function mapOfficialQuoteAuditToUnifiedEvent(row: {
  id: string;
  materialId: string;
  quoteId: string;
  action: string;
  previousQuoteId?: string | null;
  newQuoteId?: string | null;
  changedBy?: string | null;
  changedAt: Date | string;
  reason?: string | null;
  rejectionReason?: string | null;
}): MaterialMarketAuditApiItem {
  const eventType = OFFICIAL_ACTION_TO_EVENT[row.action] ?? "UPDATED";
  const entityType: MaterialMarketAuditEntityType =
    row.action === "SUBMITTED" || row.action === "APPROVED" || row.action === "REJECTED"
      ? "APPROVAL"
      : "OFFICIAL_QUOTE";

  return serializeMaterialMarketAuditEventForApi({
    id: `legacy-official-${row.id}`,
    materialId: row.materialId,
    entityType,
    entityId: row.quoteId,
    eventType,
    userId: row.changedBy ?? null,
    userName: null,
    occurredAt: row.changedAt,
    reason: row.rejectionReason?.trim() || row.reason?.trim() || null,
    beforeJson: row.previousQuoteId != null ? { quoteId: row.previousQuoteId } : null,
    afterJson: row.newQuoteId != null ? { quoteId: row.newQuoteId } : { quoteId: row.quoteId },
    metadata: { legacySource: "MaterialOfficialQuoteAudit", action: row.action },
    legacySource: "MaterialOfficialQuoteAudit",
  });
}

export function mapAlertConfigAuditToUnifiedEvent(row: {
  id: string;
  scope: string;
  materialId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  updatedBy?: string | null;
  createdAt: Date | string;
}): MaterialMarketAuditApiItem {
  const entityType: MaterialMarketAuditEntityType =
    row.scope === "GLOBAL" ? "GLOBAL_CONFIG" : "ALERT_CONFIG";

  return serializeMaterialMarketAuditEventForApi({
    id: `legacy-alert-config-${row.id}`,
    materialId: row.materialId ?? null,
    entityType,
    entityId: row.materialId ?? (row.scope === "GLOBAL" ? "GLOBAL" : null),
    eventType: "CONFIG_CHANGED",
    userId: row.updatedBy ?? null,
    userName: null,
    occurredAt: row.createdAt,
    reason: null,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    metadata: { legacySource: "MaterialMarketAlertConfigAudit", scope: row.scope },
    legacySource: "MaterialMarketAlertConfigAudit",
  });
}

export function mergeMaterialMarketAuditEvents(
  events: MaterialMarketAuditApiItem[]
): MaterialMarketAuditApiItem[] {
  return [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

export function buildMaterialMarketAuditListResponse(input: {
  items: MaterialMarketAuditApiItem[];
  total: number;
  limit: number;
  offset: number;
}) {
  return {
    items: input.items,
    total: input.total,
    limit: input.limit,
    offset: input.offset,
  };
}

export function parseMaterialMarketAuditListQuery(query: {
  limit?: unknown;
  offset?: unknown;
}): { limit: number; offset: number } {
  const limitRaw = Number(query.limit ?? 50);
  const offsetRaw = Number(query.offset ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  return { limit, offset };
}
