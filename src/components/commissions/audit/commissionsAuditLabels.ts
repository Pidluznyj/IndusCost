import type { CommissionsAuditItem } from "@/src/components/commissions/commissionsTypes";

export const COMMISSION_AUDIT_SEVERITY_OPTIONS = [
  { value: "CRITICAL", label: "Crítica" },
  { value: "WARNING", label: "Atenção" },
  { value: "INFO", label: "Informativa" },
] as const;

export const COMMISSION_AUDIT_TYPE_OPTIONS = [
  { value: "ORDER_WITHOUT_SELLER", label: "Pedido sem vendedor" },
  { value: "ORDER_WITHOUT_REPRESENTATIVE", label: "Pedido sem representante" },
  { value: "NO_COMMISSION_RULE", label: "Sem regra de comissão" },
  { value: "ORDER_WITHOUT_NFE", label: "Pedido sem NF-e" },
  { value: "NFE_WITHOUT_OUTPUT_DOCUMENT", label: "NF-e sem documento de saída" },
  { value: "NFE_WITHOUT_RECEIVABLE", label: "NF-e sem conta a receber" },
  { value: "OUTPUT_DOCUMENT_WITHOUT_ORDER_MATCH", label: "Doc. saída sem pedido" },
  { value: "RECEIVABLE_WITHOUT_NFE", label: "CR sem NF-e" },
  { value: "CANCELLED_NFE_WITH_ACTIVE_COMMISSION", label: "NF-e cancelada c/ comissão ativa" },
  { value: "RECEIVED_WITHOUT_RELEASE", label: "Recebido sem liberação" },
  { value: "PAID_WITHOUT_RELEASE", label: "Pago sem liberação" },
  { value: "DIVERGENT_AMOUNT", label: "Valor divergente" },
  { value: "MANUAL_REVIEW_REQUIRED", label: "Revisão manual" },
  { value: "NO_COMMERCIAL_PRICE_TABLE", label: "Sem tabela comercial" },
  { value: "BELOW_MINIMUM_COMMERCIAL_TABLE_PRICE", label: "Preço abaixo do Atacado" },
  { value: "MISSING_OFFICIAL_PRODUCT_COST", label: "Sem custo oficial IndusCost" },
  { value: "INVALID_COMMERCIAL_PRICE_RANGE", label: "Faixas comerciais inconsistentes" },
  { value: "NO_COMMISSION_TABLE_RATE", label: "Tabela sem % de comissão" },
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  COMMISSION_AUDIT_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Crítica",
  WARNING: "Atenção",
  INFO: "Informativa",
};

const METADATA_LABELS: Record<string, string> = {
  orderCode: "Pedido",
  nfeNumber: "NF-e",
  nfeExternalId: "ID externo NF-e",
  customerName: "Cliente",
  commissionPersonId: "Pessoa comissionada (ID)",
  commissionPersonName: "Pessoa comissionada",
  commissionAmount: "Valor comissão",
  amount: "Valor",
  involvedAmount: "Valor envolvido",
  beneficiaryType: "Beneficiário",
  receivableId: "Conta a receber",
  localOrderId: "Pedido local (ID)",
  commissionRecordId: "Registro de comissão (ID)",
  ruleId: "Regra (ID)",
  nomusOrderId: "Pedido Nomus",
  soldUnitPrice: "Preço unitário vendido",
  tierCode: "Faixa comercial",
  tierName: "Nome da faixa",
  referenceSalePrice: "Preço de referência da faixa",
  missingCodes: "Tabelas ausentes",
};

export function formatAuditSeverity(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

export function formatAuditType(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function auditSeverityClassName(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-100 text-red-800 ring-red-200";
    case "WARNING":
      return "bg-amber-100 text-amber-900 ring-amber-200";
    case "INFO":
    default:
      return "bg-sky-100 text-sky-900 ring-sky-200";
  }
}

export function auditTypeClassName(type: string): string {
  switch (type) {
    case "NO_COMMISSION_RULE":
    case "ORDER_WITHOUT_SELLER":
    case "ORDER_WITHOUT_REPRESENTATIVE":
      return "bg-violet-50 text-violet-900";
    case "NFE_WITHOUT_OUTPUT_DOCUMENT":
    case "NFE_WITHOUT_RECEIVABLE":
    case "ORDER_WITHOUT_NFE":
      return "bg-orange-50 text-orange-900";
    case "DIVERGENT_AMOUNT":
    case "CANCELLED_NFE_WITH_ACTIVE_COMMISSION":
    case "PAID_WITHOUT_RELEASE":
    case "RECEIVED_WITHOUT_RELEASE":
      return "bg-red-50 text-red-900";
    case "MANUAL_REVIEW_REQUIRED":
      return "bg-yellow-50 text-yellow-900";
    default:
      return "bg-gray-50 text-gray-800";
  }
}

export function auditRowClassName(item: CommissionsAuditItem): string {
  if (item.resolved) return "opacity-70";
  if (item.severity === "CRITICAL") return "bg-red-50/70 border-l-4 border-l-red-500";
  if (item.severity === "WARNING") return "bg-amber-50/50 border-l-4 border-l-amber-400";
  return "border-l-4 border-l-transparent";
}

export function formatAuditStatus(resolved: boolean): string {
  return resolved ? "Resolvida" : "Aberta";
}

export function formatAuditMetadataEntries(metadataJson: unknown): Array<{ key: string; label: string; value: string }> {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const entries: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, raw] of Object.entries(metadataJson as Record<string, unknown>)) {
    if (raw == null || raw === "") continue;
    let value: string;
    if (typeof raw === "object") {
      value = JSON.stringify(raw, null, 2);
    } else {
      value = String(raw);
    }
    entries.push({
      key,
      label: METADATA_LABELS[key] ?? key,
      value,
    });
  }
  return entries;
}

export function formatEntityLabel(entityType: string, entityId: string | null): string {
  if (!entityId) return entityType;
  return `${entityType} · ${entityId.slice(0, 8)}…`;
}
