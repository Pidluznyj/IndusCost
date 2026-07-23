/**
 * OP-78 — Contrato puro do auditor read-only do Fluxo de Pedidos.
 * Sem I/O, sem Prisma, sem Nomus.
 */

import { Prisma } from "@prisma/client";
import {
  normalizeSalesOrderAuditCode,
  salesOrderAuditCodeCandidates,
  sanitizeSalesOrderTaxesDatabaseUrl,
  type SanitizedDatabaseTarget,
} from "@/src/lib/sales-orders/salesOrderTaxesAudit.js";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_LABELS,
  SALES_ORDER_FLOW_STAGE_LABELS,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
} from "./salesOrderFlowCatalog.js";

export const SALES_ORDER_FLOW_PRODUCTION_AUDIT_LOG_PREFIX =
  "[audit:sales-order:flow]";

export type SalesOrderFlowProductionAuditArgs = {
  order: string;
  jsonOutput: string | null;
  markdownOutput: string | null;
};

export function parseSalesOrderFlowProductionAuditArgs(
  argv: readonly string[]
): SalesOrderFlowProductionAuditArgs {
  let order: string | null = null;
  let jsonOutput: string | null = null;
  let markdownOutput: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--order=")) {
      if (order != null) {
        throw new Error("--order deve ser informado uma única vez.");
      }
      order = normalizeSalesOrderAuditCode(arg.slice("--order=".length));
      continue;
    }
    if (arg.startsWith("--json-output=")) {
      jsonOutput = arg.slice("--json-output=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--markdown-output=")) {
      markdownOutput = arg.slice("--markdown-output=".length).trim() || null;
      continue;
    }
    if (arg === "--apply" || arg.startsWith("--apply=")) {
      throw new Error(
        "auditoria é somente leitura; --apply não é permitido."
      );
    }
    throw new Error(`argumento desconhecido: ${arg}`);
  }

  if (!order) {
    throw new Error(
      '--order é obrigatório; exemplo: --order="PD 02596" ou --order=PD02596.'
    );
  }

  return { order, jsonOutput, markdownOutput };
}

export {
  salesOrderAuditCodeCandidates,
  sanitizeSalesOrderTaxesDatabaseUrl,
  type SanitizedDatabaseTarget,
};

export function resolveSalesOrderFlowProductionAuditExitCode(
  outcome: "ok" | "order_not_found" | "technical_error"
): number {
  return outcome === "technical_error" ? 1 : 0;
}

/** Serializa Prisma.Decimal e datas para JSON-safe. */
export function serializeSalesOrderFlowAuditJsonValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(serializeSalesOrderFlowAuditJsonValue);
  }
  if (typeof value === "object") {
    const maybeDecimal = value as {
      toFixed?: (dp: number) => string;
      d?: unknown[];
    };
    if (
      typeof maybeDecimal.toFixed === "function" &&
      Array.isArray(maybeDecimal.d)
    ) {
      try {
        return maybeDecimal.toFixed(2);
      } catch {
        /* fall through */
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeSalesOrderFlowAuditJsonValue(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function stringifySalesOrderFlowProductionAuditReport(
  report: SalesOrderFlowProductionAuditReport
): string {
  return JSON.stringify(serializeSalesOrderFlowAuditJsonValue(report), null, 2);
}

export type SalesOrderFlowProductionAuditItemRow = {
  salesOrderItemId: string;
  sku: string | null;
  productName: string | null;
  releaseStatus: string | null;
  fulfillmentClassification: string;
  requiresProduction: boolean | null;
  productionRequirement: string;
  orderedQuantity: string;
  fulfilledQuantity: string | null;
  activeRemainingQuantity: string | null;
  activeObligationQuantity: string;
  remainingFulfillmentQuantity: string;
  shipTargetQuantity: string;
  productionOrderQuantity: string;
  producedQuantity: string | null;
  documentedQuantity: string;
  invoicedQuantity: string;
  shippedQuantity: string;
  cutQuantity: string;
  canceledQuantity: string;
  fulfilledWithoutProduction: boolean;
  calculatedStage: SalesOrderFlowStage;
  calculatedStageLabel: string;
  stageReason: string;
  nextAction: string;
  responsibleArea: string;
  progress: {
    productionOrder: string;
    produced: string | null;
    documented: string;
    invoiced: string;
    shipped: string;
  };
  productionOrderLinks: Array<{
    productionOrderExternalId: number | null;
    linkedQuantity: string | null;
    isCurrent: boolean;
  }>;
  inconsistencies: Array<{
    code: string;
    label: string;
    severity: string;
    detail: string;
  }>;
  persistedSnapshot: {
    present: boolean;
    currentStage: string | null;
    fingerprint: string | null;
    stageMatchesCalculated: boolean | null;
    fingerprintMatchesCalculated: boolean | null;
  };
};

export type SalesOrderFlowProductionAuditReport = {
  ok: true;
  mode: "READ_ONLY";
  generatedAt: string;
  requestedOrder: string;
  orderFound: boolean;
  status: "ok" | "unavailable" | "with_divergences" | "with_inconsistencies";
  exactUnavailableReason: string | null;
  guarantees: {
    databaseWrites: false;
    nomusCalls: false;
    passwordExposed: false;
    decimalSerializedAsString: true;
  };
  order: {
    salesOrderId: string;
    orderCode: string;
    status: string | null;
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    customerName: string | null;
    sellerName: string | null;
    companyIssuer: string | null;
  } | null;
  releaseSummary: {
    pendingItems: number;
    releasedOrBeyondItems: number;
    canceledItems: number;
  } | null;
  consolidated: {
    calculatedStage: SalesOrderFlowStage | null;
    calculatedStageLabel: string | null;
    bottleneckItemId: string | null;
    bottleneckStage: string | null;
    nextAction: string | null;
    responsibleArea: string | null;
    progress: {
      productionOrder: string | null;
      produced: string | null;
      documented: string | null;
      invoiced: string | null;
      shipped: string | null;
    } | null;
    dates: {
      promisedDeliveryAt: string | null;
      firstShippedAt: string | null;
      lastShippedAt: string | null;
      completedAt: string | null;
      isOverdue: boolean | null;
    } | null;
  } | null;
  items: SalesOrderFlowProductionAuditItemRow[];
  productionOrders: Array<{
    id: string;
    externalId: number;
    status: string | null;
    plannedQuantity: string | null;
    producedQuantity: string | null;
    productCode: string | null;
  }>;
  stockDocuments: Array<{
    id: string;
    externalId: number;
    idNfe: number | null;
    documentNumber: string | null;
    statusRaw: string | null;
    isCancelled: boolean;
    dataDocumento: string | null;
  }>;
  nfes: Array<{
    externalId: number;
    numero: string | null;
    status: string | null;
    isCanceled: boolean;
    isValidForBilling: boolean;
  }>;
  /**
   * Visibilidade dos vínculos canônicos Pedido → OP → DS → NF para o Kanban.
   * Contagens vindas do pack OP-49 (mesma evidência do motor).
   */
  canonicalLinks: {
    salesOrderNfeLinkCount: number;
    validNfeCount: number;
    canceledNfeCount: number;
    stockDocumentCount: number;
    stockDocumentWithNfeCount: number;
    stockDocumentItemCount: number;
    o2cAllocationCount: number;
    productionLinkCount: number;
    productionLinkCurrentCount: number;
    productionOrderCount: number;
    itemsWithDocumentCoverage: number;
    itemsWithNfeCoverage: number;
    itemsWithProductionLink: number;
    itemsTotal: number;
    linksVisibleToKanban: boolean;
    summary: string;
  } | null;
  persistedOrderSnapshot: {
    present: boolean;
    currentStage: string | null;
    fingerprint: string | null;
    computationVersion: string | null;
    computedAt: string | null;
    nextAction: string | null;
    bottleneckSalesOrderItemId: string | null;
  } | null;
  divergence: {
    hasDivergence: boolean;
    planReason: "first_run" | "fingerprint_match" | "fingerprint_changed" | null;
    orderStageMatches: boolean | null;
    orderFingerprintMatches: boolean | null;
    itemStageMismatches: Array<{
      salesOrderItemId: string;
      calculated: string;
      persisted: string | null;
    }>;
    itemFingerprintMismatches: string[];
    calculatedOrderFingerprint: string | null;
    persistedOrderFingerprint: string | null;
  };
  events: Array<{
    id: string;
    eventType: string;
    fromStage: string | null;
    toStage: string | null;
    salesOrderItemId: string | null;
    occurredAt: string;
    dedupeKey: string;
  }>;
  management: {
    present: boolean;
    priority: string | null;
    responsibleName: string | null;
    responsibleArea: string | null;
    isBlocked: boolean | null;
    blockReason: string | null;
    expectedResolutionAt: string | null;
    internalNote: string | null;
    updatedAt: string | null;
  } | null;
  inconsistencies: Array<{
    code: string;
    label: string;
    severity: string;
    detail: string;
    scope: "ORDER" | "ITEM";
    salesOrderItemId: string | null;
  }>;
};

function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  if (stage in SALES_ORDER_FLOW_STAGE_LABELS) {
    return SALES_ORDER_FLOW_STAGE_LABELS[stage as SalesOrderFlowStage];
  }
  return stage;
}

function inconsistencyLabel(code: string): string {
  if (code in SALES_ORDER_FLOW_INCONSISTENCY_LABELS) {
    return SALES_ORDER_FLOW_INCONSISTENCY_LABELS[
      code as SalesOrderFlowInconsistencyCode
    ];
  }
  return code;
}

export function buildUnavailableSalesOrderFlowProductionAuditReport(input: {
  requestedOrder: string;
  generatedAt?: Date;
}): SalesOrderFlowProductionAuditReport {
  return {
    ok: true,
    mode: "READ_ONLY",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    requestedOrder: input.requestedOrder,
    orderFound: false,
    status: "unavailable",
    exactUnavailableReason: `Pedido não encontrado localmente para "${input.requestedOrder}".`,
    guarantees: {
      databaseWrites: false,
      nomusCalls: false,
      passwordExposed: false,
      decimalSerializedAsString: true,
    },
    order: null,
    releaseSummary: null,
    consolidated: null,
    items: [],
    productionOrders: [],
    stockDocuments: [],
    nfes: [],
    canonicalLinks: null,
    persistedOrderSnapshot: null,
    divergence: {
      hasDivergence: false,
      planReason: null,
      orderStageMatches: null,
      orderFingerprintMatches: null,
      itemStageMismatches: [],
      itemFingerprintMismatches: [],
      calculatedOrderFingerprint: null,
      persistedOrderFingerprint: null,
    },
    events: [],
    management: null,
    inconsistencies: [],
  };
}

function decStr(value: Prisma.Decimal | null | undefined): string | null {
  if (value == null) return null;
  return value.toFixed(2);
}

export function formatSalesOrderFlowProductionAuditMarkdown(
  report: SalesOrderFlowProductionAuditReport
): string {
  const lines: string[] = [];
  lines.push(`# Auditoria Fluxo de Pedidos — ${report.requestedOrder}`);
  lines.push("");
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Modo: \`${report.mode}\``);
  lines.push(`- Status: \`${report.status}\``);
  lines.push(`- Pedido encontrado: ${report.orderFound ? "sim" : "não"}`);
  if (report.exactUnavailableReason) {
    lines.push(`- Motivo: ${report.exactUnavailableReason}`);
  }
  lines.push("");
  lines.push("## Garantias");
  lines.push("");
  lines.push("- Somente leitura (`databaseWrites=false`)");
  lines.push("- Sem Nomus HTTP (`nomusCalls=false`)");
  lines.push("- Senha não exposta (`passwordExposed=false`)");
  lines.push("- Decimal serializado como string");
  lines.push("");

  if (!report.orderFound || !report.order) {
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Pedido");
  lines.push("");
  lines.push(`- Código: **${report.order.orderCode}**`);
  lines.push(`- Id: \`${report.order.salesOrderId}\``);
  lines.push(`- Status: ${report.order.status ?? "—"}`);
  lines.push(`- Cliente: ${report.order.customerName ?? "—"}`);
  lines.push(`- Vendedor: ${report.order.sellerName ?? "—"}`);
  lines.push(`- Empresa: ${report.order.companyIssuer ?? "—"}`);
  lines.push(`- Emissão: ${report.order.issueDate ?? "—"}`);
  lines.push(`- Entrega prometida: ${report.order.expectedDeliveryDate ?? "—"}`);
  lines.push("");

  if (report.releaseSummary) {
    lines.push("## Liberação");
    lines.push("");
    lines.push(`- Itens pendentes: ${report.releaseSummary.pendingItems}`);
    lines.push(
      `- Itens liberados ou além: ${report.releaseSummary.releasedOrBeyondItems}`
    );
    lines.push(`- Itens cancelados: ${report.releaseSummary.canceledItems}`);
    lines.push("");
  }

  if (report.canonicalLinks) {
    const links = report.canonicalLinks;
    lines.push("## Vínculos canônicos (Pedido → OP → DS → NF)");
    lines.push("");
    lines.push(`- Visíveis ao Kanban: **${links.linksVisibleToKanban ? "sim" : "não"}**`);
    lines.push(`- Resumo: ${links.summary}`);
    lines.push(`- SalesOrderNfeLink: ${links.salesOrderNfeLinkCount}`);
    lines.push(
      `- NF-e válidas / canceladas: ${links.validNfeCount} / ${links.canceledNfeCount}`
    );
    lines.push(
      `- Documentos de saída: ${links.stockDocumentCount} (${links.stockDocumentWithNfeCount} com idNfe)`
    );
    lines.push(`- Linhas de DS: ${links.stockDocumentItemCount}`);
    lines.push(`- Alocações O2C: ${links.o2cAllocationCount}`);
    lines.push(
      `- Vínculos OP: ${links.productionLinkCount} (${links.productionLinkCurrentCount} atuais) · OPs: ${links.productionOrderCount}`
    );
    lines.push(
      `- Itens com cobertura Doc / NF / OP: ${links.itemsWithDocumentCoverage} / ${links.itemsWithNfeCoverage} / ${links.itemsWithProductionLink} (de ${links.itemsTotal})`
    );
    lines.push("");
  }

  if (report.consolidated) {
    lines.push("## Etapa consolidada");
    lines.push("");
    lines.push(
      `- Calculada: **${report.consolidated.calculatedStageLabel ?? "—"}** (\`${report.consolidated.calculatedStage ?? "—"}\`)`
    );
    lines.push(
      `- Gargalo: ${report.consolidated.bottleneckItemId ?? "—"} / ${report.consolidated.bottleneckStage ?? "—"}`
    );
    lines.push(`- Próxima ação: ${report.consolidated.nextAction ?? "—"}`);
    lines.push(`- Área: ${report.consolidated.responsibleArea ?? "—"}`);
    if (report.consolidated.progress) {
      lines.push(
        `- Progressos: OP ${report.consolidated.progress.productionOrder ?? "—"} · Prod ${report.consolidated.progress.produced ?? "—"} · Doc ${report.consolidated.progress.documented ?? "—"} · NF ${report.consolidated.progress.invoiced ?? "—"} · Env ${report.consolidated.progress.shipped ?? "—"}`
      );
    }
    if (report.consolidated.dates) {
      lines.push(
        `- Datas: prometida ${report.consolidated.dates.promisedDeliveryAt ?? "—"} · 1º envio ${report.consolidated.dates.firstShippedAt ?? "—"} · último ${report.consolidated.dates.lastShippedAt ?? "—"} · concluído ${report.consolidated.dates.completedAt ?? "—"} · atrasado ${report.consolidated.dates.isOverdue ? "sim" : "não"}`
      );
    }
    lines.push("");
  }

  lines.push("## Divergência cálculo × snapshot");
  lines.push("");
  lines.push(
    `- Há divergência: **${report.divergence.hasDivergence ? "sim" : "não"}**`
  );
  lines.push(`- Plano recompute: \`${report.divergence.planReason ?? "—"}\``);
  lines.push(
    `- Estágio pedido coincide: ${report.divergence.orderStageMatches == null ? "—" : report.divergence.orderStageMatches ? "sim" : "não"}`
  );
  lines.push(
    `- Fingerprint pedido coincide: ${report.divergence.orderFingerprintMatches == null ? "—" : report.divergence.orderFingerprintMatches ? "sim" : "não"}`
  );
  if (report.divergence.itemStageMismatches.length > 0) {
    lines.push("- Itens com estágio divergente:");
    for (const row of report.divergence.itemStageMismatches) {
      lines.push(
        `  - \`${row.salesOrderItemId}\`: calc \`${row.calculated}\` × snap \`${row.persisted ?? "—"}\``
      );
    }
  }
  lines.push("");

  if (report.persistedOrderSnapshot) {
    lines.push("## Snapshot persistido (pedido)");
    lines.push("");
    lines.push(
      `- Presente: ${report.persistedOrderSnapshot.present ? "sim" : "não"}`
    );
    lines.push(
      `- Estágio: \`${report.persistedOrderSnapshot.currentStage ?? "—"}\``
    );
    lines.push(
      `- Fingerprint: \`${report.persistedOrderSnapshot.fingerprint ?? "—"}\``
    );
    lines.push(
      `- Versão: \`${report.persistedOrderSnapshot.computationVersion ?? "—"}\``
    );
    lines.push(
      `- Computado em: ${report.persistedOrderSnapshot.computedAt ?? "—"}`
    );
    lines.push("");
  }

  lines.push("## Itens");
  lines.push("");
  for (const item of report.items) {
    lines.push(
      `### ${item.sku ?? item.salesOrderItemId} — ${item.calculatedStageLabel}`
    );
    lines.push("");
    lines.push(`- Id: \`${item.salesOrderItemId}\``);
    lines.push(`- Liberação/status: ${item.releaseStatus ?? "—"}`);
    lines.push(`- Atendimento: ${item.fulfillmentClassification}`);
    lines.push(
      `- Produção necessária: ${item.requiresProduction == null ? "desconhecida" : item.requiresProduction ? "sim" : "não"} (${item.productionRequirement})`
    );
    lines.push(
      `- Qtdes: pedida ${item.orderedQuantity} · atendida ${item.fulfilledQuantity ?? "—"} · alvo ${item.shipTargetQuantity} · OP ${item.productionOrderQuantity} · prod ${item.producedQuantity ?? "—"} · doc ${item.documentedQuantity} · NF ${item.invoicedQuantity} · env ${item.shippedQuantity}`
    );
    lines.push(`- Próxima ação: ${item.nextAction}`);
    lines.push(
      `- Snapshot item: ${item.persistedSnapshot.present ? "sim" : "não"} · estágio ok ${item.persistedSnapshot.stageMatchesCalculated == null ? "—" : item.persistedSnapshot.stageMatchesCalculated ? "sim" : "não"}`
    );
    lines.push("");
  }

  lines.push("## OPs");
  lines.push("");
  if (report.productionOrders.length === 0) {
    lines.push("_Nenhuma OP vinculada._");
  } else {
    for (const op of report.productionOrders) {
      lines.push(
        `- Ext ${op.externalId}: status ${op.status ?? "—"} · planejada ${op.plannedQuantity ?? "—"} · produzida ${op.producedQuantity ?? "—"} · SKU ${op.productCode ?? "—"}`
      );
    }
  }
  lines.push("");

  lines.push("## Documentos");
  lines.push("");
  if (report.stockDocuments.length === 0) {
    lines.push("_Nenhum documento._");
  } else {
    for (const doc of report.stockDocuments) {
      lines.push(
        `- Ext ${doc.externalId}: nº ${doc.documentNumber ?? "—"} · NF ${doc.idNfe ?? "—"} · status ${doc.statusRaw ?? "—"} · cancelado ${doc.isCancelled ? "sim" : "não"}`
      );
    }
  }
  lines.push("");

  lines.push("## NF-es");
  lines.push("");
  if (report.nfes.length === 0) {
    lines.push("_Nenhuma NF-e._");
  } else {
    for (const nfe of report.nfes) {
      lines.push(
        `- Ext ${nfe.externalId}: nº ${nfe.numero ?? "—"} · status ${nfe.status ?? "—"} · válida ${nfe.isValidForBilling ? "sim" : "não"} · cancelada ${nfe.isCanceled ? "sim" : "não"}`
      );
    }
  }
  lines.push("");

  lines.push("## Management");
  lines.push("");
  if (!report.management?.present) {
    lines.push("_Sem overlay de gestão._");
  } else {
    lines.push(`- Prioridade: ${report.management.priority ?? "—"}`);
    lines.push(`- Responsável: ${report.management.responsibleName ?? "—"}`);
    lines.push(`- Área: ${report.management.responsibleArea ?? "—"}`);
    lines.push(
      `- Bloqueado: ${report.management.isBlocked ? "sim" : "não"}${report.management.blockReason ? ` (${report.management.blockReason})` : ""}`
    );
    lines.push(
      `- Resolução esperada: ${report.management.expectedResolutionAt ?? "—"}`
    );
    lines.push(`- Nota: ${report.management.internalNote ?? "—"}`);
  }
  lines.push("");

  lines.push("## Eventos (últimos)");
  lines.push("");
  if (report.events.length === 0) {
    lines.push("_Nenhum evento._");
  } else {
    for (const event of report.events.slice(0, 30)) {
      lines.push(
        `- ${event.occurredAt} · \`${event.eventType}\` · ${event.fromStage ?? "∅"} → ${event.toStage ?? "∅"}`
      );
    }
  }
  lines.push("");

  lines.push("## Inconsistências");
  lines.push("");
  if (report.inconsistencies.length === 0) {
    lines.push("_Nenhuma._");
  } else {
    for (const row of report.inconsistencies) {
      lines.push(
        `- [${row.severity}] \`${row.code}\` (${row.label}) — ${row.detail}${row.salesOrderItemId ? ` · item ${row.salesOrderItemId}` : ""}`
      );
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export const SALES_ORDER_FLOW_PRODUCTION_AUDIT_FORBIDDEN_PATTERNS = [
  /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\$executeRaw(?:Unsafe)?\s*[(`]/,
  /\$queryRawUnsafe\s*\(/,
  /\$transaction\s*[(`]/,
  /\b(?:fetchNomus|nomusFetch|callNomus|syncNomus|NomusApiClient|nomusRequest)\b/,
  /\brecomputeSalesOrderFlow\s*\(/,
  /\brunSalesOrderFlowRebuild\s*\(/,
] as const;

export function scanSalesOrderFlowProductionAuditSource(
  source: string
): Array<{ pattern: string; index: number }> {
  // Strip comments, string literals and regex literals so the forbidden-pattern
  // catalogue itself is not reported as a hit when scanning this module.
  const withoutCommentsAndLiterals = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, '""')
    .replace(/\/(?:\\\/|[^/\n])+\/[gimsuy]*/g, "");
  const violations: Array<{ pattern: string; index: number }> = [];
  for (const pattern of SALES_ORDER_FLOW_PRODUCTION_AUDIT_FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(withoutCommentsAndLiterals);
    if (match) {
      violations.push({ pattern: pattern.source, index: match.index });
    }
  }
  return violations;
}

export {
  stageLabel,
  inconsistencyLabel,
  decStr,
};
