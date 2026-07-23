/**
 * KAN-LINK-03 — Contrato puro da auditoria read-only de vínculos operacionais.
 * Sem I/O, sem Prisma write, sem Nomus HTTP.
 */

import { Prisma } from "@prisma/client";
import {
  normalizeSalesOrderAuditCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
  salesOrderAuditCodeCandidates,
} from "@/src/lib/sales-orders/salesOrderTaxesAudit.js";
import type { SalesOrderOperationalLinkSourceType } from "./salesOrderOperationalEvidenceContract.js";

export const SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_LOG_PREFIX =
  "[audit:sales-order:operational-links]";

export const SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_DEFAULT_OUTPUT_DIR =
  process.platform === "win32"
    ? "tmp-audits/operational-links"
    : "/var/backups/induscost/audits";

export type SalesOrderOperationalLinkageAuditMode =
  | "ORDER"
  | "ACTIVE"
  | "ALL";

export type SalesOrderOperationalLinkageAuditCliArgs = {
  mode: SalesOrderOperationalLinkageAuditMode;
  order: string | null;
  limit: number | null;
  outputDir: string | null;
  emitJson: boolean;
  emitMarkdown: boolean;
};

export type LinkageObservationKind =
  | "CONFIRMED_LINK"
  | "AMBIGUOUS_LINK"
  | "CANDIDATE_UNUSED"
  | "MISSING_FIELD"
  | "NORMALIZATION_FAILURE"
  | "DATA_INCONSISTENCY";

export type MassLinkageFindingKind =
  | "DS_VALID_NOT_RECOGNIZED"
  | "NFE_VALID_WITHOUT_LINK"
  | "OP_WITHOUT_LINK"
  | "SNAPSHOT_WAITING_DS_DESPITE_DOCS"
  | "SNAPSHOT_WAITING_OP_DESPITE_LATER"
  | "DOC_LINKED_ORDER_LEVEL_ONLY"
  | "DOCUMENTED_QTY_EXCEEDS_OBLIGATION"
  | "AMBIGUOUS_LINKS"
  | "ORPHAN_LINKS"
  | "DUPLICATE_EXTERNAL_IDS"
  | "INVALID_UUID_FIELD";

export type LinkageObservation = {
  kind: LinkageObservationKind;
  code: string;
  detail: string;
  salesOrderItemId: string | null;
  entityType: "ORDER" | "ITEM" | "OP" | "DS" | "NFE" | "LINK" | "SNAPSHOT";
  entityId: string | null;
  sourceType: SalesOrderOperationalLinkSourceType | null;
};

export type OperationalLinkageItemReport = {
  salesOrderItemId: string;
  sequence: string | null;
  sku: string | null;
  productName: string | null;
  externalProductId: number | null;
  orderedQuantity: string;
  cutQuantity: string;
  canceledQuantity: string;
  fulfilledQuantity: string | null;
  activeObligationQuantity: string;
  operationalBalance: string;
  documentedQuantity: string;
  invoicedQuantity: string;
  shippedQuantity: string;
  productionCoveredQuantity: string;
  calculatedStage: string | null;
  persistedStage: string | null;
  productionLinks: Array<{
    productionOrderExternalId: number | null;
    linkedQuantity: string | null;
    isCurrent: boolean;
    sourceType: SalesOrderOperationalLinkSourceType;
    usedByKanban: boolean;
  }>;
  documents: Array<{
    stockDocumentExternalId: number | null;
    quantity: string;
    sourceType: SalesOrderOperationalLinkSourceType;
    usedByKanban: boolean;
    nfeExternalId: number | null;
  }>;
  nfes: Array<{
    nfeExternalId: number;
    quantity: string;
    status: string | null;
    sourceType: SalesOrderOperationalLinkSourceType;
    usedByKanban: boolean;
  }>;
};

export type OperationalLinkageOrderReport = {
  orderFound: boolean;
  requestedOrder: string | null;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderCodeNormalized: string | null;
  status: string | null;
  totalNetValue: string | null;
  items: OperationalLinkageItemReport[];
  candidateProductionOrders: Array<{
    productionOrderExternalId: number;
    linkedQuantity: string | null;
    isCurrent: boolean;
    salesOrderItemId: string | null;
    sourceType: SalesOrderOperationalLinkSourceType;
    usedByKanban: boolean;
  }>;
  linkedProductionOrders: Array<{
    productionOrderExternalId: number;
    linkedQuantity: string | null;
    salesOrderItemId: string | null;
    sourceType: SalesOrderOperationalLinkSourceType;
  }>;
  candidateDocuments: Array<{
    stockDocumentExternalId: number;
    documentNumber: string | null;
    idNfe: number | null;
    isCancelled: boolean;
    totalValue: string | null;
    statusRaw: string | null;
    discoveryPath: string;
    usedByKanban: boolean;
    sourceType: SalesOrderOperationalLinkSourceType | null;
    lines: Array<{
      stockDocumentItemId: string;
      externalProductId: number | null;
      quantity: string;
      matchedSalesOrderItemId: string | null;
      matchReason: string | null;
    }>;
  }>;
  linkedDocuments: Array<{
    stockDocumentExternalId: number;
    idNfe: number | null;
    sourceType: SalesOrderOperationalLinkSourceType;
  }>;
  salesOrderNfeLinks: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeSerie: string | null;
    nfeStatus: number | null;
    nomusNfeId: string | null;
  }>;
  nfes: Array<{
    nfeExternalId: number;
    numero: string | null;
    serie: string | null;
    statusNormalized: string | null;
    isCanceled: boolean;
    isValidForBilling: boolean;
    usedByKanban: boolean;
    hasSalesOrderNfeLink: boolean;
  }>;
  shipmentEvidence: {
    evidence: "NFE_PROXY" | "EXPLICIT_SHIP_DATE" | "NONE";
    invoicedQuantity: string;
  };
  calculatedStage: string | null;
  persistedStage: string | null;
  fingerprint: {
    calculated: string | null;
    persisted: string | null;
    matches: boolean | null;
  };
  observations: LinkageObservation[];
  warnings: string[];
  criticalDivergenceCount: number;
};

export type MassLinkageFinding = {
  kind: MassLinkageFindingKind;
  salesOrderId: string;
  orderCode: string;
  detail: string;
  calculatedStage: string | null;
  persistedStage: string | null;
  critical: boolean;
};

export type SalesOrderOperationalLinkageAuditReport = {
  ok: true;
  mode: "READ_ONLY";
  auditMode: SalesOrderOperationalLinkageAuditMode;
  generatedAt: string;
  guarantees: {
    databaseWrites: false;
    nomusCalls: false;
    passwordExposed: false;
    writesOnlyAuditOutputFiles: true;
  };
  filters: {
    order: string | null;
    limit: number | null;
    outputDir: string | null;
    emitJson: boolean;
    emitMarkdown: boolean;
  };
  orderReport: OperationalLinkageOrderReport | null;
  mass: {
    ordersScanned: number;
    criticalCount: number;
    findings: MassLinkageFinding[];
    countsByKind: Record<MassLinkageFindingKind, number>;
  } | null;
  summary: string;
};

export {
  normalizeSalesOrderAuditCode,
  salesOrderAuditCodeCandidates,
  sanitizeSalesOrderTaxesDatabaseUrl,
};

export function parseSalesOrderOperationalLinkageAuditArgs(
  argv: readonly string[]
): SalesOrderOperationalLinkageAuditCliArgs {
  let order: string | null = null;
  let active = false;
  let all = false;
  let limit: number | null = null;
  let outputDir: string | null = null;
  let emitJson = false;
  let emitMarkdown = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      throw new Error("HELP");
    }
    if (arg === "--apply" || arg.startsWith("--apply=")) {
      throw new Error("auditoria é somente leitura; --apply não é permitido.");
    }
    if (arg === "--active") {
      active = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--json") {
      emitJson = true;
      continue;
    }
    if (arg === "--markdown" || arg === "--md") {
      emitMarkdown = true;
      continue;
    }
    if (arg.startsWith("--order=")) {
      if (order != null) {
        throw new Error("--order deve ser informado uma única vez.");
      }
      order = normalizeSalesOrderAuditCode(arg.slice("--order=".length));
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(n) || n < 1) {
        throw new Error("--limit deve ser >= 1.");
      }
      limit = Math.floor(n);
      continue;
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (!value) throw new Error("--output não pode ser vazio.");
      if (value.includes("docs/generated")) {
        throw new Error(
          "--output não pode apontar para docs/generated (use pasta ignorada ou fora do repo)."
        );
      }
      outputDir = value;
      continue;
    }
    throw new Error(`argumento desconhecido: ${arg}`);
  }

  const modeCount = Number(order != null) + Number(active) + Number(all);
  if (modeCount === 0) {
    throw new Error(
      'informe --order="PD 02757", --active ou --all.'
    );
  }
  if (modeCount > 1) {
    throw new Error("use apenas um de: --order, --active, --all.");
  }

  const mode: SalesOrderOperationalLinkageAuditMode = order
    ? "ORDER"
    : active
      ? "ACTIVE"
      : "ALL";

  return {
    mode,
    order,
    limit,
    outputDir,
    emitJson,
    emitMarkdown,
  };
}

export function printSalesOrderOperationalLinkageAuditHelp(): string {
  return [
    "Uso: npm run audit:sales-order:operational-links -- [opções]",
    "",
    '  --order="PD 02757"   Auditoria de um pedido',
    "  --active             Pedidos operacionais (Kanban, sem SHIPPED_COMPLETED)",
    "  --all                Todos os candidatos de rebuild",
    "  --limit=N            Limite defensivo (massa)",
    "  --output=DIR         Grava arquivos somente se --json/--markdown",
    "  --json               Emite JSON (stdout se sem --output)",
    "  --markdown | --md    Emite Markdown (stdout se sem --output)",
    "",
    "Somente leitura. Não chama Nomus. Não grava no banco.",
    "Sem --output: imprime no terminal e não cria arquivo.",
    `Sugestão local: --output=${SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_DEFAULT_OUTPUT_DIR}`,
  ].join("\n");
}

export function resolveSalesOrderOperationalLinkageAuditExitCode(input: {
  technicalError?: boolean;
  criticalDivergenceCount: number;
}): number {
  if (input.technicalError) return 2;
  if (input.criticalDivergenceCount > 0) return 1;
  return 0;
}

export function emptyMassCounts(): Record<MassLinkageFindingKind, number> {
  return {
    DS_VALID_NOT_RECOGNIZED: 0,
    NFE_VALID_WITHOUT_LINK: 0,
    OP_WITHOUT_LINK: 0,
    SNAPSHOT_WAITING_DS_DESPITE_DOCS: 0,
    SNAPSHOT_WAITING_OP_DESPITE_LATER: 0,
    DOC_LINKED_ORDER_LEVEL_ONLY: 0,
    DOCUMENTED_QTY_EXCEEDS_OBLIGATION: 0,
    AMBIGUOUS_LINKS: 0,
    ORPHAN_LINKS: 0,
    DUPLICATE_EXTERNAL_IDS: 0,
    INVALID_UUID_FIELD: 0,
  };
}

export function isCriticalMassFindingKind(kind: MassLinkageFindingKind): boolean {
  return (
    kind === "DS_VALID_NOT_RECOGNIZED" ||
    kind === "NFE_VALID_WITHOUT_LINK" ||
    kind === "SNAPSHOT_WAITING_DS_DESPITE_DOCS" ||
    kind === "SNAPSHOT_WAITING_OP_DESPITE_LATER" ||
    kind === "ORPHAN_LINKS" ||
    kind === "INVALID_UUID_FIELD"
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuidCandidate(value: string | null | undefined): boolean {
  if (value == null) return false;
  const t = value.trim();
  if (!t) return false;
  return t.includes("-") && t.length >= 32 && t.length <= 40;
}

export function isValidUuid(value: string | null | undefined): boolean {
  if (value == null) return false;
  return UUID_RE.test(value.trim());
}

export function decStr(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "object" && value !== null && "toFixed" in value) {
    try {
      return (value as { toFixed: (n: number) => string }).toFixed(2);
    } catch {
      /* fall through */
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

export function qtyNum(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type BuildOrderOperationalLinkageInput = {
  requestedOrder: string | null;
  order: {
    salesOrderId: string;
    orderCode: string;
    externalSalesOrderId: number | null;
    status: string | null;
    totalNetValue: unknown;
  } | null;
  items: Array<{
    salesOrderItemId: string;
    sequence: string | null;
    sku: string | null;
    productName: string | null;
    externalProductId: number | null;
    orderedQuantity: unknown;
    cutQuantity: unknown;
    canceledQuantity: unknown;
    fulfilledQuantity: unknown;
    activeObligationQuantity: unknown;
    documentedQuantity: unknown;
    invoicedQuantity: unknown;
    shippedQuantity: unknown;
    productionCoveredQuantity: unknown;
    calculatedStage: string | null;
    persistedStage: string | null;
    productionLinks: OperationalLinkageItemReport["productionLinks"];
    documents: OperationalLinkageItemReport["documents"];
    nfes: OperationalLinkageItemReport["nfes"];
  }>;
  candidateProductionOrders: OperationalLinkageOrderReport["candidateProductionOrders"];
  candidateDocuments: OperationalLinkageOrderReport["candidateDocuments"];
  salesOrderNfeLinks: OperationalLinkageOrderReport["salesOrderNfeLinks"];
  nfes: OperationalLinkageOrderReport["nfes"];
  calculatedStage: string | null;
  persistedStage: string | null;
  calculatedFingerprint: string | null;
  persistedFingerprint: string | null;
  extraObservations?: LinkageObservation[];
  extraWarnings?: string[];
};

function observation(
  partial: Omit<LinkageObservation, "kind"> & { kind: LinkageObservationKind }
): LinkageObservation {
  return partial;
}

/**
 * Monta o relatório de um pedido a partir de fatia já carregada (puro).
 */
export function buildOrderOperationalLinkageReport(
  input: BuildOrderOperationalLinkageInput
): OperationalLinkageOrderReport {
  const observations: LinkageObservation[] = [...(input.extraObservations ?? [])];
  const warnings: string[] = [...(input.extraWarnings ?? [])];

  if (!input.order) {
    return {
      orderFound: false,
      requestedOrder: input.requestedOrder,
      salesOrderId: null,
      externalSalesOrderId: null,
      orderCode: null,
      orderCodeNormalized: input.requestedOrder,
      status: null,
      totalNetValue: null,
      items: [],
      candidateProductionOrders: [],
      linkedProductionOrders: [],
      candidateDocuments: [],
      linkedDocuments: [],
      salesOrderNfeLinks: [],
      nfes: [],
      shipmentEvidence: { evidence: "NONE", invoicedQuantity: "0.00" },
      calculatedStage: null,
      persistedStage: null,
      fingerprint: { calculated: null, persisted: null, matches: null },
      observations: [
        observation({
          kind: "MISSING_FIELD",
          code: "ORDER_NOT_FOUND",
          detail: `Pedido não encontrado para "${input.requestedOrder ?? ""}".`,
          salesOrderItemId: null,
          entityType: "ORDER",
          entityId: null,
          sourceType: "UNRESOLVED",
        }),
      ],
      warnings,
      criticalDivergenceCount: 0,
    };
  }

  const items: OperationalLinkageItemReport[] = input.items.map((item) => {
    const ordered = qtyNum(item.orderedQuantity);
    const cut = qtyNum(item.cutQuantity);
    const canceled = qtyNum(item.canceledQuantity);
    const fulfilled = item.fulfilledQuantity == null ? null : qtyNum(item.fulfilledQuantity);
    const active = qtyNum(item.activeObligationQuantity);
    const documented = qtyNum(item.documentedQuantity);
    const balance = Math.max(0, active - documented);

    if (documented > active + 1e-9 && active > 0) {
      observations.push(
        observation({
          kind: "DATA_INCONSISTENCY",
          code: "DOCUMENTED_QTY_EXCEEDS_OBLIGATION",
          detail: `Item ${item.sequence ?? item.salesOrderItemId}: documentado ${documented} > obrigação ${active}.`,
          salesOrderItemId: item.salesOrderItemId,
          entityType: "ITEM",
          entityId: item.salesOrderItemId,
          sourceType: null,
        })
      );
    }

    for (const doc of item.documents) {
      if (doc.usedByKanban) {
        observations.push(
          observation({
            kind: "CONFIRMED_LINK",
            code: "ITEM_DOCUMENT_LINK",
            detail: `DS ${doc.stockDocumentExternalId} → item (${doc.sourceType}).`,
            salesOrderItemId: item.salesOrderItemId,
            entityType: "DS",
            entityId: doc.stockDocumentExternalId != null
              ? String(doc.stockDocumentExternalId)
              : null,
            sourceType: doc.sourceType,
          })
        );
      }
    }

    return {
      salesOrderItemId: item.salesOrderItemId,
      sequence: item.sequence,
      sku: item.sku,
      productName: item.productName,
      externalProductId: item.externalProductId,
      orderedQuantity: decStr(ordered) ?? "0.00",
      cutQuantity: decStr(cut) ?? "0.00",
      canceledQuantity: decStr(canceled) ?? "0.00",
      fulfilledQuantity: fulfilled == null ? null : (decStr(fulfilled) ?? "0.00"),
      activeObligationQuantity: decStr(active) ?? "0.00",
      operationalBalance: decStr(balance) ?? "0.00",
      documentedQuantity: decStr(documented) ?? "0.00",
      invoicedQuantity: decStr(item.invoicedQuantity) ?? "0.00",
      shippedQuantity: decStr(item.shippedQuantity) ?? "0.00",
      productionCoveredQuantity: decStr(item.productionCoveredQuantity) ?? "0.00",
      calculatedStage: item.calculatedStage,
      persistedStage: item.persistedStage,
      productionLinks: item.productionLinks,
      documents: item.documents,
      nfes: item.nfes,
    };
  });

  const linkedDocuments = input.candidateDocuments
    .filter((d) => d.usedByKanban)
    .map((d) => ({
      stockDocumentExternalId: d.stockDocumentExternalId,
      idNfe: d.idNfe,
      sourceType: d.sourceType ?? ("OUTPUT_DOCUMENT_REFERENCE" as const),
    }));

  for (const doc of input.candidateDocuments) {
    if (!doc.usedByKanban) {
      observations.push(
        observation({
          kind: "CANDIDATE_UNUSED",
          code: "DS_CANDIDATE_NOT_IN_KANBAN",
          detail: `DS ${doc.stockDocumentExternalId} candidato (${doc.discoveryPath}) não visível ao Kanban.`,
          salesOrderItemId: null,
          entityType: "DS",
          entityId: String(doc.stockDocumentExternalId),
          sourceType: doc.sourceType,
        })
      );
    }
    if (!doc.isCancelled && doc.idNfe != null && !doc.usedByKanban) {
      observations.push(
        observation({
          kind: "DATA_INCONSISTENCY",
          code: "DS_VALID_NOT_RECOGNIZED",
          detail: `DS válido ${doc.stockDocumentExternalId} com idNfe=${doc.idNfe} não reconhecido no pack.`,
          salesOrderItemId: null,
          entityType: "DS",
          entityId: String(doc.stockDocumentExternalId),
          sourceType: doc.sourceType,
        })
      );
    }
    const linesWithoutItem = doc.lines.filter((l) => l.matchedSalesOrderItemId == null);
    if (doc.usedByKanban && linesWithoutItem.length === doc.lines.length && doc.lines.length > 0) {
      observations.push(
        observation({
          kind: "MISSING_FIELD",
          code: "DOC_LINKED_ORDER_LEVEL_ONLY",
          detail: `DS ${doc.stockDocumentExternalId} ligado ao pedido sem match de item.`,
          salesOrderItemId: null,
          entityType: "DS",
          entityId: String(doc.stockDocumentExternalId),
          sourceType: doc.sourceType,
        })
      );
    }
  }

  for (const nfe of input.nfes) {
    if (nfe.isValidForBilling && !nfe.isCanceled && !nfe.hasSalesOrderNfeLink) {
      observations.push(
        observation({
          kind: "DATA_INCONSISTENCY",
          code: "NFE_VALID_WITHOUT_LINK",
          detail: `NF ${nfe.nfeExternalId} válida sem SalesOrderNfeLink.`,
          salesOrderItemId: null,
          entityType: "NFE",
          entityId: String(nfe.nfeExternalId),
          sourceType: "NFE_REFERENCE",
        })
      );
    }
  }

  for (const link of input.salesOrderNfeLinks) {
    if (link.nomusNfeId && looksLikeUuidCandidate(link.nomusNfeId) && !isValidUuid(link.nomusNfeId)) {
      observations.push(
        observation({
          kind: "NORMALIZATION_FAILURE",
          code: "INVALID_UUID_FIELD",
          detail: `SalesOrderNfeLink.nomusNfeId inválido: ${link.nomusNfeId}`,
          salesOrderItemId: null,
          entityType: "LINK",
          entityId: link.id,
          sourceType: "SALES_ORDER_NFE_LINK",
        })
      );
    }
  }

  if (
    input.persistedStage === "WAITING_OUTPUT_DOCUMENT" &&
    items.some((i) => qtyNum(i.documentedQuantity) > 0)
  ) {
    observations.push(
      observation({
        kind: "DATA_INCONSISTENCY",
        code: "SNAPSHOT_WAITING_DS_DESPITE_DOCS",
        detail: "Snapshot aguarda DS apesar de cobertura documental calculada.",
        salesOrderItemId: null,
        entityType: "SNAPSHOT",
        entityId: input.order.salesOrderId,
        sourceType: null,
      })
    );
  }

  if (
    input.persistedStage === "WAITING_PRODUCTION_ORDER" &&
    (items.some((i) => qtyNum(i.documentedQuantity) > 0) ||
      items.some((i) => qtyNum(i.invoicedQuantity) > 0) ||
      input.calculatedStage !== "WAITING_PRODUCTION_ORDER")
  ) {
    observations.push(
      observation({
        kind: "DATA_INCONSISTENCY",
        code: "SNAPSHOT_WAITING_OP_DESPITE_LATER",
        detail: "Snapshot aguarda OP apesar de cobertura posterior / estágio calculado avançado.",
        salesOrderItemId: null,
        entityType: "SNAPSHOT",
        entityId: input.order.salesOrderId,
        sourceType: null,
      })
    );
  }

  const invoicedTotal = items.reduce((s, i) => s + qtyNum(i.invoicedQuantity), 0);
  const criticalCodes = new Set([
    "DS_VALID_NOT_RECOGNIZED",
    "NFE_VALID_WITHOUT_LINK",
    "SNAPSHOT_WAITING_DS_DESPITE_DOCS",
    "SNAPSHOT_WAITING_OP_DESPITE_LATER",
    "INVALID_UUID_FIELD",
    "ORPHAN_LINKS",
  ]);
  const criticalDivergenceCount = observations.filter((o) =>
    criticalCodes.has(o.code)
  ).length;

  const fpMatches =
    input.calculatedFingerprint != null && input.persistedFingerprint != null
      ? input.calculatedFingerprint === input.persistedFingerprint
      : null;

  return {
    orderFound: true,
    requestedOrder: input.requestedOrder,
    salesOrderId: input.order.salesOrderId,
    externalSalesOrderId: input.order.externalSalesOrderId,
    orderCode: input.order.orderCode,
    orderCodeNormalized: (() => {
      try {
        return normalizeSalesOrderAuditCode(input.order!.orderCode);
      } catch {
        return input.order!.orderCode.trim().toUpperCase().replace(/\s+/g, "");
      }
    })(),
    status: input.order.status,
    totalNetValue: decStr(input.order.totalNetValue),
    items,
    candidateProductionOrders: input.candidateProductionOrders,
    linkedProductionOrders: input.candidateProductionOrders
      .filter((p) => p.usedByKanban)
      .map((p) => ({
        productionOrderExternalId: p.productionOrderExternalId,
        linkedQuantity: p.linkedQuantity,
        salesOrderItemId: p.salesOrderItemId,
        sourceType: p.sourceType,
      })),
    candidateDocuments: input.candidateDocuments,
    linkedDocuments,
    salesOrderNfeLinks: input.salesOrderNfeLinks,
    nfes: input.nfes,
    shipmentEvidence: {
      evidence: invoicedTotal > 0 ? "NFE_PROXY" : "NONE",
      invoicedQuantity: decStr(invoicedTotal) ?? "0.00",
    },
    calculatedStage: input.calculatedStage,
    persistedStage: input.persistedStage,
    fingerprint: {
      calculated: input.calculatedFingerprint,
      persisted: input.persistedFingerprint,
      matches: fpMatches,
    },
    observations,
    warnings,
    criticalDivergenceCount,
  };
}

export function classifyMassLinkageFindings(input: {
  salesOrderId: string;
  orderCode: string;
  calculatedStage: string | null;
  persistedStage: string | null;
  hasValidDocumentInPack: boolean;
  hasValidNfeInPack: boolean;
  hasSalesOrderNfeLink: boolean;
  hasValidNfeCandidateWithoutLink: boolean;
  hasUnusedValidDocumentCandidate: boolean;
  hasCurrentProductionLink: boolean;
  hasProductionCandidateWithoutLink: boolean;
  documentedExceedsObligation: boolean;
  documentOrderLevelOnly: boolean;
  ambiguousLinkCount: number;
  orphanLinkCount: number;
  duplicateExternalIdCount: number;
  invalidUuidCount: number;
}): MassLinkageFinding[] {
  const out: MassLinkageFinding[] = [];
  const base = {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    calculatedStage: input.calculatedStage,
    persistedStage: input.persistedStage,
  };

  if (input.hasUnusedValidDocumentCandidate) {
    out.push({
      ...base,
      kind: "DS_VALID_NOT_RECOGNIZED",
      detail: "DS válido candidato fora do pack do Kanban.",
      critical: true,
    });
  }
  if (input.hasValidNfeCandidateWithoutLink || (!input.hasSalesOrderNfeLink && input.hasValidNfeInPack)) {
    out.push({
      ...base,
      kind: "NFE_VALID_WITHOUT_LINK",
      detail: "NF válida sem SalesOrderNfeLink (ou candidato sem vínculo).",
      critical: true,
    });
  }
  if (input.hasProductionCandidateWithoutLink && !input.hasCurrentProductionLink) {
    out.push({
      ...base,
      kind: "OP_WITHOUT_LINK",
      detail: "OP candidata sem vínculo corrente ao pedido.",
      critical: false,
    });
  }
  if (
    input.persistedStage === "WAITING_OUTPUT_DOCUMENT" &&
    input.hasValidDocumentInPack
  ) {
    out.push({
      ...base,
      kind: "SNAPSHOT_WAITING_DS_DESPITE_DOCS",
      detail: "Snapshot aguarda DS com cobertura documental no pack.",
      critical: true,
    });
  }
  if (
    input.persistedStage === "WAITING_PRODUCTION_ORDER" &&
    (input.hasValidDocumentInPack || input.hasValidNfeInPack)
  ) {
    out.push({
      ...base,
      kind: "SNAPSHOT_WAITING_OP_DESPITE_LATER",
      detail: "Snapshot aguarda OP com cobertura documental/fiscal.",
      critical: true,
    });
  }
  if (input.documentOrderLevelOnly) {
    out.push({
      ...base,
      kind: "DOC_LINKED_ORDER_LEVEL_ONLY",
      detail: "Documento ligado só no nível do pedido.",
      critical: false,
    });
  }
  if (input.documentedExceedsObligation) {
    out.push({
      ...base,
      kind: "DOCUMENTED_QTY_EXCEEDS_OBLIGATION",
      detail: "Quantidade documentada > obrigação ativa.",
      critical: false,
    });
  }
  if (input.ambiguousLinkCount > 0) {
    out.push({
      ...base,
      kind: "AMBIGUOUS_LINKS",
      detail: `${input.ambiguousLinkCount} vínculo(s) ambíguo(s).`,
      critical: false,
    });
  }
  if (input.orphanLinkCount > 0) {
    out.push({
      ...base,
      kind: "ORPHAN_LINKS",
      detail: `${input.orphanLinkCount} link(s) órfão(s).`,
      critical: true,
    });
  }
  if (input.duplicateExternalIdCount > 0) {
    out.push({
      ...base,
      kind: "DUPLICATE_EXTERNAL_IDS",
      detail: `${input.duplicateExternalIdCount} ID(s) externo(s) duplicado(s).`,
      critical: false,
    });
  }
  if (input.invalidUuidCount > 0) {
    out.push({
      ...base,
      kind: "INVALID_UUID_FIELD",
      detail: `${input.invalidUuidCount} campo(s) UUID inválido(s).`,
      critical: true,
    });
  }
  return out;
}

export function buildMassAuditSummary(input: {
  ordersScanned: number;
  criticalCount: number;
  countsByKind: Record<MassLinkageFindingKind, number>;
}): string {
  return `Escaneados=${input.ordersScanned}; críticos=${input.criticalCount}; DS_não_reconhecido=${input.countsByKind.DS_VALID_NOT_RECOGNIZED}; snap_DS=${input.countsByKind.SNAPSHOT_WAITING_DS_DESPITE_DOCS}; snap_OP=${input.countsByKind.SNAPSHOT_WAITING_OP_DESPITE_LATER}; NF_sem_link=${input.countsByKind.NFE_VALID_WITHOUT_LINK}`;
}

export function serializeOperationalLinkageAuditJsonValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(serializeOperationalLinkageAuditJsonValue);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeOperationalLinkageAuditJsonValue(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function stringifyOperationalLinkageAuditReport(
  report: SalesOrderOperationalLinkageAuditReport
): string {
  return `${JSON.stringify(serializeOperationalLinkageAuditJsonValue(report), null, 2)}\n`;
}

export function formatOperationalLinkageAuditMarkdown(
  report: SalesOrderOperationalLinkageAuditReport
): string {
  const lines: string[] = [];
  lines.push("# Auditoria de vínculos operacionais (KAN-LINK-03)");
  lines.push("");
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Modo: \`${report.auditMode}\` · READ_ONLY`);
  lines.push(`- Resumo: ${report.summary}`);
  lines.push("");
  lines.push("## Garantias");
  lines.push("");
  lines.push("- `databaseWrites=false`");
  lines.push("- `nomusCalls=false`");
  lines.push("- `passwordExposed=false`");
  lines.push("- Arquivos só com `--output` + `--json`/`--markdown`");
  lines.push("");

  if (report.orderReport) {
    const o = report.orderReport;
    lines.push("## Pedido");
    lines.push("");
    if (!o.orderFound) {
      lines.push(`Pedido **não encontrado** (\`${o.requestedOrder ?? ""}\`).`);
      lines.push("");
    } else {
      lines.push(`1. Pedido: **${o.orderCode}**`);
      lines.push(`2. ID interno: \`${o.salesOrderId}\``);
      lines.push(`3. ID externo: ${o.externalSalesOrderId ?? "—"}`);
      lines.push(`4. Código normalizado: \`${o.orderCodeNormalized}\``);
      lines.push(`5. Status: ${o.status ?? "—"}`);
      lines.push(`28. Estágio calculado: ${o.calculatedStage ?? "—"}`);
      lines.push(`29. Estágio persistido: ${o.persistedStage ?? "—"}`);
      lines.push(
        `32. Fingerprint: calc=${o.fingerprint.calculated ?? "—"} · snap=${o.fingerprint.persisted ?? "—"} · match=${o.fingerprint.matches}`
      );
      lines.push(`Valor líquido: ${o.totalNetValue ?? "—"}`);
      lines.push("");
      lines.push("### Itens");
      lines.push("");
      for (const item of o.items) {
        lines.push(
          `- **${item.sequence ?? "?"}** \`${item.salesOrderItemId}\` · ped=${item.orderedQuantity} corte=${item.cutQuantity} canc=${item.canceledQuantity} atend=${item.fulfilledQuantity ?? "—"} obrigação=${item.activeObligationQuantity} saldo=${item.operationalBalance} doc=${item.documentedQuantity} fat=${item.invoicedQuantity} · calc=${item.calculatedStage ?? "—"} snap=${item.persistedStage ?? "—"}`
        );
      }
      lines.push("");
      lines.push("### Documentos candidatos");
      lines.push("");
      if (o.candidateDocuments.length === 0) {
        lines.push("_Nenhum._");
      } else {
        for (const d of o.candidateDocuments) {
          lines.push(
            `- DS ${d.stockDocumentExternalId} (num=${d.documentNumber ?? "—"}) idNfe=${d.idNfe ?? "—"} used=${d.usedByKanban} path=${d.discoveryPath} cancel=${d.isCancelled}`
          );
          for (const line of d.lines) {
            lines.push(
              `  - linha ${line.stockDocumentItemId} prod=${line.externalProductId ?? "—"} qty=${line.quantity} item=${line.matchedSalesOrderItemId ?? "—"} (${line.matchReason ?? "—"})`
            );
          }
        }
      }
      lines.push("");
      lines.push("### SalesOrderNfeLink / NF-e");
      lines.push("");
      for (const link of o.salesOrderNfeLinks) {
        lines.push(
          `- link ${link.id} nfeExternalId=${link.nfeExternalId} num=${link.nfeNumber ?? "—"}/${link.nfeSerie ?? "—"}`
        );
      }
      for (const nfe of o.nfes) {
        lines.push(
          `- NF ${nfe.nfeExternalId} ${nfe.numero ?? "—"}/${nfe.serie ?? "—"} status=${nfe.statusNormalized ?? "—"} valid=${nfe.isValidForBilling} link=${nfe.hasSalesOrderNfeLink} kanban=${nfe.usedByKanban}`
        );
      }
      lines.push("");
      lines.push("### Observações (separadas)");
      lines.push("");
      const byKind = new Map<LinkageObservationKind, LinkageObservation[]>();
      for (const obs of o.observations) {
        const list = byKind.get(obs.kind) ?? [];
        list.push(obs);
        byKind.set(obs.kind, list);
      }
      for (const kind of [
        "CONFIRMED_LINK",
        "AMBIGUOUS_LINK",
        "CANDIDATE_UNUSED",
        "MISSING_FIELD",
        "NORMALIZATION_FAILURE",
        "DATA_INCONSISTENCY",
      ] as const) {
        lines.push(`#### ${kind}`);
        const list = byKind.get(kind) ?? [];
        if (list.length === 0) lines.push("_Nenhuma._");
        else {
          for (const obs of list) {
            lines.push(`- \`${obs.code}\` — ${obs.detail}`);
          }
        }
        lines.push("");
      }
    }
  }

  if (report.mass) {
    lines.push("## Auditoria em massa");
    lines.push("");
    lines.push(`- Pedidos: ${report.mass.ordersScanned}`);
    lines.push(`- Críticos: ${report.mass.criticalCount}`);
    lines.push("");
    for (const [kind, count] of Object.entries(report.mass.countsByKind)) {
      if (count > 0) lines.push(`- ${kind}: ${count}`);
    }
    lines.push("");
    for (const f of report.mass.findings.slice(0, 80)) {
      lines.push(
        `- ${f.critical ? "**CRÍTICO**" : "info"} \`${f.kind}\` ${f.orderCode} — ${f.detail}`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export const SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_FORBIDDEN_PATTERNS = [
  /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\$executeRaw(?:Unsafe)?\s*[(`]/,
  /\$queryRawUnsafe\s*\(/,
  /\$transaction\s*[(`]/,
  /\b(?:fetchNomus|nomusFetch|callNomus|syncNomus|NomusApiClient|nomusRequest)\b/,
  /\brecomputeSalesOrderFlow\s*\(/,
  /\brunSalesOrderFlowRebuild\s*\(/,
] as const;

export function scanSalesOrderOperationalLinkageAuditSource(
  source: string
): Array<{ pattern: string; index: number }> {
  const withoutCommentsAndLiterals = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, '""')
    .replace(/\/(?:\\\/|[^/\n])+\/[gimsuy]*/g, "");
  const violations: Array<{ pattern: string; index: number }> = [];
  for (const pattern of SALES_ORDER_OPERATIONAL_LINKAGE_AUDIT_FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(withoutCommentsAndLiterals);
    if (match) {
      violations.push({ pattern: pattern.source, index: match.index });
    }
  }
  return violations;
}

/** Resolve caminhos de arquivo quando --output + formato explícito. */
export function resolveOperationalLinkageAuditOutputFiles(input: {
  outputDir: string | null;
  emitJson: boolean;
  emitMarkdown: boolean;
  stamp: string;
}): { jsonPath: string | null; markdownPath: string | null; writeFiles: boolean } {
  if (!input.emitJson && !input.emitMarkdown) {
    return { jsonPath: null, markdownPath: null, writeFiles: false };
  }
  if (!input.outputDir) {
    return { jsonPath: null, markdownPath: null, writeFiles: false };
  }
  const base = input.outputDir.replace(/[\\/]+$/, "");
  return {
    jsonPath: input.emitJson
      ? `${base}/operational-linkage-audit-${input.stamp}.json`
      : null,
    markdownPath: input.emitMarkdown
      ? `${base}/operational-linkage-audit-${input.stamp}.md`
      : null,
    writeFiles: true,
  };
}
