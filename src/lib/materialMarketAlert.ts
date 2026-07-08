/**
 * Alertas de inteligência de mercado — tipos, rótulos e serialização para API.
 */

export const MATERIAL_MARKET_ALERT_TYPE_VALUES = [
  "PRICE_UP_PCT",
  "PRICE_DOWN_PCT",
  "BREAK_MAX",
  "BREAK_MIN",
  "NO_RECENT_QUOTE",
  "SUPPLIER_ABOVE_AVG",
  "SAVINGS_OPPORTUNITY",
] as const;

export type MaterialMarketAlertType = (typeof MATERIAL_MARKET_ALERT_TYPE_VALUES)[number];

export const MATERIAL_MARKET_ALERT_STATUS_VALUES = ["OPEN", "READ", "RESOLVED"] as const;

export type MaterialMarketAlertStatus = (typeof MATERIAL_MARKET_ALERT_STATUS_VALUES)[number];

export const MATERIAL_MARKET_ALERT_SEVERITY_VALUES = ["INFO", "WARNING", "CRITICAL"] as const;

export type MaterialMarketAlertSeverity = (typeof MATERIAL_MARKET_ALERT_SEVERITY_VALUES)[number];

export const MATERIAL_MARKET_ALERT_TYPE_LABELS: Record<MaterialMarketAlertType, string> = {
  PRICE_UP_PCT: "Alta de preço",
  PRICE_DOWN_PCT: "Queda de preço",
  BREAK_MAX: "Novo máximo histórico",
  BREAK_MIN: "Novo mínimo histórico",
  NO_RECENT_QUOTE: "Sem cotação recente",
  SUPPLIER_ABOVE_AVG: "Fornecedor acima da média",
  SAVINGS_OPPORTUNITY: "Oportunidade de economia",
};

export const MATERIAL_MARKET_ALERT_STATUS_LABELS: Record<MaterialMarketAlertStatus, string> = {
  OPEN: "Aberto",
  READ: "Lido",
  RESOLVED: "Resolvido",
};

export const MATERIAL_MARKET_ALERT_SEVERITY_LABELS: Record<MaterialMarketAlertSeverity, string> = {
  INFO: "Informativo",
  WARNING: "Atenção",
  CRITICAL: "Crítico",
};

export type MaterialMarketAlertApiItem = {
  id: string;
  materialId: string;
  materialCode: string | null;
  materialDescription: string | null;
  alertType: MaterialMarketAlertType;
  alertTypeLabel: string;
  status: MaterialMarketAlertStatus;
  statusLabel: string;
  title: string;
  message: string;
  severity: MaterialMarketAlertSeverity;
  severityLabel: string;
  metadata: Record<string, unknown> | null;
  triggeredAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  readBy: string | null;
  resolvedBy: string | null;
  intelligencePath: string;
};

export type MaterialMarketAlertSourceRow = {
  id: string;
  materialId: string;
  alertType: string;
  status: string;
  title: string;
  message: string;
  severity: string;
  metadata?: unknown;
  triggeredAt: Date | string;
  readAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  readBy?: string | null;
  resolvedBy?: string | null;
  Material?: {
    code?: string;
    description?: string;
  } | null;
};

export function isMaterialMarketAlertType(value: unknown): value is MaterialMarketAlertType {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_ALERT_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function isMaterialMarketAlertStatus(value: unknown): value is MaterialMarketAlertStatus {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_ALERT_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isMaterialMarketAlertSeverity(value: unknown): value is MaterialMarketAlertSeverity {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_ALERT_SEVERITY_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketAlertStatusFilter(
  value: unknown
): MaterialMarketAlertStatus | "ALL" {
  if (value == null || value === "" || value === "ALL") return "ALL";
  return isMaterialMarketAlertStatus(value) ? value : "OPEN";
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function serializeMaterialMarketAlertForApi(
  row: MaterialMarketAlertSourceRow,
  options?: { intelligencePath?: string }
): MaterialMarketAlertApiItem {
  const alertType = isMaterialMarketAlertType(row.alertType) ? row.alertType : "PRICE_UP_PCT";
  const status = isMaterialMarketAlertStatus(row.status) ? row.status : "OPEN";
  const severity = isMaterialMarketAlertSeverity(row.severity) ? row.severity : "WARNING";
  const intelligencePath =
    options?.intelligencePath ?? `/materials/market-intelligence/${row.materialId}`;

  return {
    id: row.id,
    materialId: row.materialId,
    materialCode: row.Material?.code ?? null,
    materialDescription: row.Material?.description ?? null,
    alertType,
    alertTypeLabel: MATERIAL_MARKET_ALERT_TYPE_LABELS[alertType],
    status,
    statusLabel: MATERIAL_MARKET_ALERT_STATUS_LABELS[status],
    title: row.title,
    message: row.message,
    severity,
    severityLabel: MATERIAL_MARKET_ALERT_SEVERITY_LABELS[severity],
    metadata: normalizeMetadata(row.metadata),
    triggeredAt: toIso(row.triggeredAt) ?? new Date().toISOString(),
    readAt: toIso(row.readAt),
    resolvedAt: toIso(row.resolvedAt),
    readBy: row.readBy ?? null,
    resolvedBy: row.resolvedBy ?? null,
    intelligencePath,
  };
}

export function buildMaterialMarketAlertListResponse(
  rows: MaterialMarketAlertSourceRow[]
): { items: MaterialMarketAlertApiItem[]; total: number; openCount: number } {
  const items = rows.map((row) => serializeMaterialMarketAlertForApi(row));
  const openCount = items.filter((item) => item.status === "OPEN").length;
  return { items, total: items.length, openCount };
}

export function parseMaterialMarketAlertStatusPatch(
  body: unknown
):
  | { ok: true; status: "READ" | "RESOLVED" }
  | { ok: false; message: string } {
  const status =
    typeof body === "object" && body != null && "status" in body
      ? (body as { status?: unknown }).status
      : undefined;

  if (status === "READ" || status === "RESOLVED") {
    return { ok: true, status };
  }

  return {
    ok: false,
    message: 'Status inválido. Use "READ" ou "RESOLVED".',
  };
}

export function applyMaterialMarketAlertStatusUpdate(input: {
  currentStatus: MaterialMarketAlertStatus;
  targetStatus: "READ" | "RESOLVED";
  userId: string;
  now?: Date;
}): {
  status: MaterialMarketAlertStatus;
  readAt?: Date;
  readBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
} {
  const now = input.now ?? new Date();

  if (input.targetStatus === "READ") {
    return {
      status: "READ",
      readAt: now,
      readBy: input.userId,
    };
  }

  return {
    status: "RESOLVED",
    readAt: input.currentStatus === "OPEN" ? now : undefined,
    readBy: input.currentStatus === "OPEN" ? input.userId : undefined,
    resolvedAt: now,
    resolvedBy: input.userId,
  };
}
