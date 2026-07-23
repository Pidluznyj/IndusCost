/**
 * KAN-LINK-02 — Contrato canônico de evidências operacionais do Fluxo de Pedidos.
 *
 * Representa vínculos PV ↔ item ↔ OP ↔ DS ↔ NF com origem, confiança e precedência.
 * Não classifica estágio do Kanban (motor permanece em salesOrderItemFlowEngine).
 *
 * Norma: docs/audits/kanban-operational-linkage-current-state.md (§13) + esta API.
 */

/** Tipos de origem do vínculo (precedência documentada em LINK_PRECEDENCE_RANK). */
export const SALES_ORDER_OPERATIONAL_LINK_SOURCE_TYPES = [
  "DIRECT_EXTERNAL_ID",
  "DIRECT_ORDER_REFERENCE",
  "DIRECT_ORDER_ITEM_REFERENCE",
  "SALES_ORDER_NFE_LINK",
  "OUTPUT_DOCUMENT_REFERENCE",
  "NFE_REFERENCE",
  "PRODUCTION_ORDER_REFERENCE",
  "PRODUCTION_LABEL_REFERENCE",
  "DESCRIPTION_HINT",
  "UNRESOLVED",
  "AMBIGUOUS",
] as const;

export type SalesOrderOperationalLinkSourceType =
  (typeof SALES_ORDER_OPERATIONAL_LINK_SOURCE_TYPES)[number];

/**
 * Precedência: menor rank = maior força.
 * 1 ID oficial → … → hint → sem vínculo / ambíguo.
 * Direto sempre prevalece sobre hint.
 */
export const SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK: Record<
  SalesOrderOperationalLinkSourceType,
  number
> = {
  DIRECT_EXTERNAL_ID: 1,
  DIRECT_ORDER_REFERENCE: 2,
  DIRECT_ORDER_ITEM_REFERENCE: 2,
  SALES_ORDER_NFE_LINK: 3,
  OUTPUT_DOCUMENT_REFERENCE: 4,
  NFE_REFERENCE: 4,
  PRODUCTION_ORDER_REFERENCE: 5,
  PRODUCTION_LABEL_REFERENCE: 6,
  DESCRIPTION_HINT: 6,
  UNRESOLVED: 99,
  AMBIGUOUS: 99,
};

export type SalesOrderOperationalLinkConfidence =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "NONE";

export type SalesOrderOperationalSourceSystem =
  | "NOMUS"
  | "INDUSCOST"
  | "DERIVED"
  | "UNKNOWN";

/** Validade documental (somente VALID avança cobertura do Kanban). */
export const SALES_ORDER_OPERATIONAL_OUTPUT_DOCUMENT_VALIDITIES = [
  "VALID",
  "CANCELLED",
  "RETURN",
  "TRANSFER",
  "WITHOUT_NFE",
  "PROCESSING",
  "UNKNOWN",
] as const;

export type SalesOrderOperationalOutputDocumentValidity =
  (typeof SALES_ORDER_OPERATIONAL_OUTPUT_DOCUMENT_VALIDITIES)[number];

/** Validade fiscal (somente AUTHORIZED avança faturamento/envio proxy). */
export const SALES_ORDER_OPERATIONAL_NFE_VALIDITIES = [
  "AUTHORIZED",
  "CANCELLED",
  "REJECTED",
  "VOIDED",
  "UNKNOWN",
] as const;

export type SalesOrderOperationalNfeValidity =
  (typeof SALES_ORDER_OPERATIONAL_NFE_VALIDITIES)[number];

export type SalesOrderOperationalLinkEdge = {
  sourceType: SalesOrderOperationalLinkSourceType;
  sourceSystem: SalesOrderOperationalSourceSystem;
  sourceRecordId: string | null;
  sourceExternalId: number | string | null;
  targetRecordId: string | null;
  targetExternalId: number | string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  productionOrderId: string | null;
  outputDocumentId: string | null;
  nfeId: string | null;
  confidence: SalesOrderOperationalLinkConfidence;
  reason: string;
  warnings: string[];
  sourceUpdatedAt: string | null;
  syncedAt: string | null;
  /** Quantidade atribuída a este vínculo (quando aplicável). */
  quantity: number | null;
};

export type SalesOrderOperationalObligation = {
  salesOrderItemId: string;
  orderedQuantity: number;
  activeObligationQuantity: number;
  cutQuantity: number;
  canceledQuantity: number;
  fulfilledQuantity: number | null;
};

export type SalesOrderOperationalProductionCoverage = {
  salesOrderItemId: string;
  productionOrderId: string | null;
  productionOrderExternalId: number | null;
  linkedQuantity: number;
  link: SalesOrderOperationalLinkEdge;
  advancesKanban: boolean;
};

export type SalesOrderOperationalDocumentCoverage = {
  salesOrderItemId: string;
  outputDocumentId: string | null;
  outputDocumentExternalId: number | null;
  nfeExternalId: number | null;
  quantity: number;
  validity: SalesOrderOperationalOutputDocumentValidity;
  link: SalesOrderOperationalLinkEdge;
  advancesKanban: boolean;
};

export type SalesOrderOperationalNfeCoverage = {
  salesOrderItemId: string;
  nfeId: string | null;
  nfeExternalId: number | null;
  quantity: number;
  validity: SalesOrderOperationalNfeValidity;
  hasDocument: boolean;
  link: SalesOrderOperationalLinkEdge;
  advancesKanban: boolean;
};

export type SalesOrderOperationalShipmentCoverage = {
  salesOrderItemId: string;
  quantity: number;
  evidence: "NFE_PROXY" | "EXPLICIT_SHIP_DATE" | "NONE";
  advancesKanban: boolean;
  warnings: string[];
};

/** Nível de cobertura quantitativa (KAN-LINK-06). */
export const SALES_ORDER_OPERATIONAL_COVERAGE_LEVELS = [
  "NONE",
  "PARTIAL",
  "SUFFICIENT",
  "NOT_REQUIRED",
  "EXCESS",
] as const;

export type SalesOrderOperationalCoverageLevel =
  (typeof SALES_ORDER_OPERATIONAL_COVERAGE_LEVELS)[number];

/** Qualidade dos vínculos do item (KAN-LINK-06). */
export const SALES_ORDER_OPERATIONAL_ITEM_LINK_STATUSES = [
  "RESOLVED",
  "PARTIAL",
  "ORDER_LEVEL_ONLY",
  "AMBIGUOUS",
  "UNRESOLVED",
  "NOT_REQUIRED",
] as const;

export type SalesOrderOperationalItemLinkStatus =
  (typeof SALES_ORDER_OPERATIONAL_ITEM_LINK_STATUSES)[number];

/**
 * Estágio reconciliado do item — evidência posterior prevalece sobre
 * ausência de elo intermediário (KAN-LINK-06).
 */
export const SALES_ORDER_OPERATIONAL_ITEM_COVERAGE_STATUSES = [
  "OPEN",
  "AWAITING_PRODUCTION",
  "IN_PRODUCTION",
  "DOCUMENTED",
  "INVOICED",
  "SHIPPED",
  "FULFILLED_WITHOUT_PRODUCTION",
  "CANCELED",
  "INCONSISTENT",
] as const;

export type SalesOrderOperationalItemCoverageStatus =
  (typeof SALES_ORDER_OPERATIONAL_ITEM_COVERAGE_STATUSES)[number];

export type SalesOrderOperationalTimelineEventKind =
  | "ORDER"
  | "PRODUCTION_ORDER"
  | "OUTPUT_DOCUMENT"
  | "NFE"
  | "SHIPMENT"
  | "CUT"
  | "CANCEL"
  | "RETURN";

export type SalesOrderOperationalTimelineEvent = {
  at: string | null;
  kind: SalesOrderOperationalTimelineEventKind;
  label: string;
  quantity: number | null;
  /** false = histórico / não operacional (cancelado, estorno, devolução). */
  operational: boolean;
  sourceType: SalesOrderOperationalLinkSourceType | null;
  entityId: string | null;
  entityExternalId: number | string | null;
};

export type SalesOrderOperationalUnitConversionStatus =
  | "NATIVE"
  | "CONVERTED"
  | "INCONSISTENT"
  | "UNKNOWN";

export type SalesOrderOperationalUnitConversion = {
  officialUnitCode: string | null;
  status: SalesOrderOperationalUnitConversionStatus;
  detail: string | null;
};

/**
 * Reconciliação operacional por item (KAN-LINK-06).
 * Não exige cadeia artificial; evidência posterior não é apagada por
 * ausência de OP/DS intermediário.
 */
export type SalesOrderOperationalItemReconciliation = {
  salesOrderItemId: string;
  linkStatus: SalesOrderOperationalItemLinkStatus;
  coverageStatus: SalesOrderOperationalItemCoverageStatus;
  activeObligation: number;
  fulfilledQuantity: number;
  remainingFulfillment: number;
  productionOrderQuantity: number;
  productionCoverage: SalesOrderOperationalCoverageLevel;
  documentedQuantity: number;
  documentedCoverage: SalesOrderOperationalCoverageLevel;
  invoicedQuantity: number;
  invoicedCoverage: SalesOrderOperationalCoverageLevel;
  shippedQuantity: number;
  shippedCoverage: SalesOrderOperationalCoverageLevel;
  /**
   * Cobertura de cadeia DS∪NF sem dupla contagem
   * (pares DS↔NF contam uma vez).
   */
  chainCoveredQuantity: number;
  sourceSummary: string[];
  warnings: string[];
  unresolvedEvidence: Array<{ code: string; detail: string }>;
  operationalEvidenceTimeline: SalesOrderOperationalTimelineEvent[];
  unitConversion: SalesOrderOperationalUnitConversion;
};

export type SalesOrderOperationalOrderReconciliation = {
  contractVersion: "sales-order-operational-reconciliation/v1";
  salesOrderId: string;
  orderCode: string | null;
  externalSalesOrderId: number | null;
  items: SalesOrderOperationalItemReconciliation[];
  warnings: string[];
};

export type SalesOrderOperationalItemEvidence = {
  salesOrderItemId: string;
  obligation: SalesOrderOperationalObligation;
  production: SalesOrderOperationalProductionCoverage[];
  documents: SalesOrderOperationalDocumentCoverage[];
  nfes: SalesOrderOperationalNfeCoverage[];
  shipment: SalesOrderOperationalShipmentCoverage;
  /** Totais que avançam o Kanban (somente evidências válidas). */
  coverage: {
    productionOrderQuantity: number;
    documentedQuantity: number;
    invoicedQuantity: number;
    shippedQuantity: number;
  };
  inconsistencies: Array<{ code: string; detail: string }>;
  links: SalesOrderOperationalLinkEdge[];
  /** Diagnóstico reconciliado (KAN-LINK-06). */
  reconciliation: SalesOrderOperationalItemReconciliation;
};

export type SalesOrderOperationalEvidenceGraph = {
  contractVersion: "sales-order-operational-evidence/v1";
  salesOrderId: string;
  orderCode: string | null;
  externalSalesOrderId: number | null;
  items: SalesOrderOperationalItemEvidence[];
  /** Arestas no nível do pedido (ex.: SalesOrderNfeLink sem item). */
  orderLinks: SalesOrderOperationalLinkEdge[];
  warnings: string[];
  /** Reconciliação agregada do pedido (KAN-LINK-06). */
  reconciliation: SalesOrderOperationalOrderReconciliation;
};

/** Sinais de auditoria — nunca prova automática de vínculo. */
export type SalesOrderOperationalAuditAlertKind =
  | "SAME_CUSTOMER"
  | "SAME_VALUE"
  | "SAME_PRODUCT"
  | "SAME_DATE"
  | "SAME_QUANTITY"
  | "TEMPORAL_PROXIMITY";

export type SalesOrderOperationalAuditAlert = {
  kind: SalesOrderOperationalAuditAlertKind;
  detail: string;
  /** Sempre false — alerta não prova vínculo. */
  provesLink: false;
};

export function rankOperationalLinkSourceType(
  sourceType: SalesOrderOperationalLinkSourceType
): number {
  return SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK[sourceType];
}

export function isOperationalLinkStrongerThan(
  a: SalesOrderOperationalLinkSourceType,
  b: SalesOrderOperationalLinkSourceType
): boolean {
  return rankOperationalLinkSourceType(a) < rankOperationalLinkSourceType(b);
}

export function canOperationalLinkAdvanceKanban(
  sourceType: SalesOrderOperationalLinkSourceType
): boolean {
  return (
    sourceType !== "UNRESOLVED" &&
    sourceType !== "AMBIGUOUS" &&
    sourceType !== "DESCRIPTION_HINT" &&
    sourceType !== "PRODUCTION_LABEL_REFERENCE"
  );
}

export function confidenceForOperationalLinkSourceType(
  sourceType: SalesOrderOperationalLinkSourceType
): SalesOrderOperationalLinkConfidence {
  switch (sourceType) {
    case "DIRECT_EXTERNAL_ID":
    case "DIRECT_ORDER_REFERENCE":
    case "DIRECT_ORDER_ITEM_REFERENCE":
    case "SALES_ORDER_NFE_LINK":
    case "PRODUCTION_ORDER_REFERENCE":
      return "HIGH";
    case "OUTPUT_DOCUMENT_REFERENCE":
    case "NFE_REFERENCE":
      return "MEDIUM";
    case "PRODUCTION_LABEL_REFERENCE":
    case "DESCRIPTION_HINT":
      return "LOW";
    case "UNRESOLVED":
    case "AMBIGUOUS":
      return "NONE";
  }
}

/**
 * Escolhe o vínculo vencedor por precedência; empate → maior confiança, depois qty.
 * Hint nunca vence vínculo direto.
 */
export function pickPreferredOperationalLink(
  links: readonly SalesOrderOperationalLinkEdge[]
): SalesOrderOperationalLinkEdge | null {
  if (links.length === 0) return null;
  const confidenceRank: Record<SalesOrderOperationalLinkConfidence, number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
    NONE: 3,
  };
  return [...links].sort((a, b) => {
    const byType =
      rankOperationalLinkSourceType(a.sourceType) -
      rankOperationalLinkSourceType(b.sourceType);
    if (byType !== 0) return byType;
    const byConf =
      confidenceRank[a.confidence] - confidenceRank[b.confidence];
    if (byConf !== 0) return byConf;
    return (b.quantity ?? 0) - (a.quantity ?? 0);
  })[0]!;
}

export function classifyOutputDocumentValidity(input: {
  isCancelled?: boolean | null;
  statusRaw?: string | null;
  tipoDocumentoEstoque?: string | null;
  idNfe?: number | null;
  processing?: boolean | null;
}): SalesOrderOperationalOutputDocumentValidity {
  if (input.isCancelled === true) return "CANCELLED";
  const raw = (input.statusRaw ?? "").toLowerCase();
  const tipo = (input.tipoDocumentoEstoque ?? "").toLowerCase();
  if (raw.includes("cancel") || tipo.includes("cancel")) return "CANCELLED";
  if (
    tipo.includes("devolu") ||
    tipo.includes("return") ||
    raw.includes("devolu")
  ) {
    return "RETURN";
  }
  if (tipo.includes("transf") || raw.includes("transf")) return "TRANSFER";
  if (input.processing === true || raw.includes("process")) return "PROCESSING";
  if (input.idNfe == null) return "WITHOUT_NFE";
  // emitido / autorizado / ativo (status operacional Nomus não-cancelado)
  if (
    raw === "" ||
    raw.includes("emit") ||
    raw.includes("autoriz") ||
    raw.includes("ativo") ||
    raw.includes("active")
  ) {
    return "VALID";
  }
  if (raw) return "UNKNOWN";
  return "VALID";
}

export function classifyNfeValidity(input: {
  statusNormalized?: string | null;
  isCanceled?: boolean | null;
  isValidForBilling?: boolean | null;
  statusRaw?: number | string | null;
}): SalesOrderOperationalNfeValidity {
  if (input.isCanceled === true) return "CANCELLED";
  const normalized = (input.statusNormalized ?? "").toUpperCase();
  if (normalized === "CANCELED" || normalized === "CANCELLED") {
    return "CANCELLED";
  }
  if (normalized === "DENIED") return "REJECTED";
  if (normalized === "VOIDED") return "VOIDED";
  if (normalized === "AUTHORIZED" || input.isValidForBilling === true) {
    return "AUTHORIZED";
  }
  if (input.statusRaw === 4) return "AUTHORIZED";
  if (input.statusRaw === 7) return "CANCELLED";
  if (input.statusRaw === 3) return "REJECTED";
  if (input.statusRaw === 5) return "VOIDED";
  return "UNKNOWN";
}

export function outputDocumentValidityAdvancesKanban(
  validity: SalesOrderOperationalOutputDocumentValidity
): boolean {
  return validity === "VALID" || validity === "WITHOUT_NFE";
}

export function nfeValidityAdvancesKanban(
  validity: SalesOrderOperationalNfeValidity
): boolean {
  return validity === "AUTHORIZED";
}

/** Alerta de auditoria — provesLink sempre false (proibição YAGNI). */
export function buildOperationalAuditAlert(
  kind: SalesOrderOperationalAuditAlertKind,
  detail: string
): SalesOrderOperationalAuditAlert {
  return { kind, detail, provesLink: false };
}

/**
 * Cobertura quantitativa contra um alvo (obrigação / residual).
 * EXCESS quando covered > target (histórico preservado; não apaga evidência).
 */
export function assessOperationalCoverageLevel(input: {
  coveredQuantity: number;
  targetQuantity: number;
  required?: boolean;
}): SalesOrderOperationalCoverageLevel {
  const covered = Math.max(0, input.coveredQuantity);
  const target = Math.max(0, input.targetQuantity);
  if (input.required === false || target <= 1e-9) return "NOT_REQUIRED";
  if (covered <= 1e-9) return "NONE";
  if (covered + 1e-9 < target) return "PARTIAL";
  if (covered > target + 1e-9) return "EXCESS";
  return "SUFFICIENT";
}
