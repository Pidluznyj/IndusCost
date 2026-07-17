/**
 * FIN-10 — contrato puro da auditoria read-only da agenda efetiva do Pedido.
 * Sem I/O, sem Prisma, sem Nomus.
 */

import { Prisma } from "@prisma/client";
import {
  normalizeSalesOrderAuditCode,
  salesOrderAuditCodeCandidates,
  sanitizeSalesOrderTaxesDatabaseUrl,
  type SanitizedDatabaseTarget,
} from "@/src/lib/sales-orders/salesOrderTaxesAudit.js";
import type { OrderFullAuditPayload } from "./orderFullAuditClient.js";
import type { SalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import type { ProjectEffectiveScheduleForAuditResult } from "./effectiveScheduleAuditProjection.js";

export const EFFECTIVE_SCHEDULE_AUDIT_LOG_PREFIX =
  "[audit:sales-order:effective-schedule]";

export type EffectiveScheduleAuditArgs = {
  order: string;
  jsonOutput: string | null;
  markdownOutput: string | null;
};

export function parseEffectiveScheduleAuditArgs(
  argv: readonly string[]
): EffectiveScheduleAuditArgs {
  let order: string | null = null;
  let jsonOutput: string | null = null;
  let markdownOutput: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--order=")) {
      if (order != null) throw new Error("--order deve ser informado uma única vez.");
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

export function resolveEffectiveScheduleAuditExitCode(
  outcome: "ok" | "order_not_found" | "technical_error"
): number {
  return outcome === "technical_error" ? 1 : 0;
}

/** Serializa Prisma.Decimal e valores com toFixed para string JSON-safe. */
export function serializeAuditJsonValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeAuditJsonValue);
  if (typeof value === "object") {
    const maybeDecimal = value as { toFixed?: (dp: number) => string; d?: unknown[] };
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
      out[k] = serializeAuditJsonValue(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function stringifyEffectiveScheduleAuditReport(
  report: EffectiveSalesOrderScheduleAuditReport
): string {
  return JSON.stringify(serializeAuditJsonValue(report), null, 2);
}

export type EffectiveScheduleAuditInconsistency = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type EffectiveSalesOrderScheduleAuditReport = {
  ok: true;
  mode: "READ_ONLY";
  generatedAt: string;
  requestedOrder: string;
  orderFound: boolean;
  status: "ok" | "unavailable" | "with_inconsistencies";
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
    paymentTerms: string | null;
    paymentMethod: string | null;
    issueDate: string | null;
    totalNetValue: number | null;
  } | null;
  originalInstallments: Array<{
    installmentNumber: number;
    dueDate: string | null;
    amount: string;
  }>;
  items: Array<{
    salesOrderItemId: string;
    itemSequence: string | null;
    productCode: string | null;
    statusRaw: string | null;
    statusNormalized: string | null;
    classification: string | null;
    orderedQuantity: number | null;
    fulfilledQuantity: number | null;
    plannedNetValue: string | null;
    coveredByDocuments: string | null;
    coveredByCr: string | null;
    cutAmount: string | null;
    activeResidual: string | null;
    unresolvedResidual: string | null;
  }>;
  stockDocuments: Array<{
    stockDocumentExternalId: number;
    idNfe: number | null;
    allocatedValue: number;
    status: string | null;
    linkedItemIds: string[];
  }>;
  documentAllocationsByItem: Array<{
    salesOrderItemId: string;
    stockDocumentExternalId: number;
    allocatedValue: number | null;
  }>;
  coverage: {
    plannedNetTotal: string;
    coveredByRealReceivables: string;
    coveredByDocumentsWithoutCr: string;
    cutAmount: string;
    canceledAmount: string;
    activeOrderResidualTotal: string;
    unresolvedAmount: string;
    supersededOrderTotal: string;
  } | null;
  nfes: Array<{
    nfeExternalId: number;
    numero: string | null;
    isCanceled: boolean;
    allocatedValueToOrder: number;
  }>;
  realReceivables: Array<{
    externalId: number;
    sourceInvoiceId: number | null;
    dueDate: string | null;
    amountReceivable: string;
    amountReceived: string;
    balanceReceivable: string;
  }>;
  effectiveAgenda: {
    realReceivables: Array<{
      externalId: number;
      dueDate: string | null;
      amountReceivable: string;
      balanceReceivable: string;
    }>;
    documentSchedule: unknown[];
    activeOrderResidualSchedule: Array<{
      installmentNumber: number;
      dueDate: string | null;
      originalAmount: string;
      residualAmount: string;
    }>;
  } | null;
  supersededOrderSchedule: Array<{
    installmentNumber: number;
    dueDate: string | null;
    originalAmount: string;
  }>;
  alerts: Array<{
    code: string;
    severity: string;
    message: string;
  }>;
  consumerAlerts: Array<{
    code: string;
    severity: string;
    title: string;
    description: string;
  }>;
  inconsistencies: EffectiveScheduleAuditInconsistency[];
  source: string | null;
};

function decimalStr(value: { toFixed(dp: number): string } | null | undefined): string {
  if (value == null) return "0.00";
  return value.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function detectEffectiveScheduleInconsistencies(input: {
  schedule: SalesOrderEffectiveFinancialSchedule;
  consumerAlertCodes: string[];
}): EffectiveScheduleAuditInconsistency[] {
  const out: EffectiveScheduleAuditInconsistency[] = [];
  const { schedule } = input;

  if (schedule.cutAmount.gt(0) && schedule.coverageSummary.activeOrderResidualTotal.gt(0)) {
    // Corte com residual pode ser parcial em outros itens — só alerta se único item cortado e residual > 0
    // Heurística: cut > 0 e residual inclui valor de corte (não determinístico). Info leve.
  }

  const invoiceWithCr = new Set(
    schedule.realReceivables
      .map((r) => r.sourceInvoiceId)
      .filter((id): id is number => id != null)
  );
  for (const doc of schedule.documentSchedule) {
    if (doc.sourceInvoiceId != null && invoiceWithCr.has(doc.sourceInvoiceId)) {
      out.push({
        code: "DOCUMENT_AND_CR_SAME_INVOICE_IN_AGENDA",
        severity: "error",
        message: `Documento ${doc.documentKey} e CR da NF ${doc.sourceInvoiceId} coexistindo na agenda efetiva.`,
      });
    }
  }

  for (const line of schedule.activeOrderResidualSchedule) {
    if (schedule.cutAmount.gt(0) === false) break;
  }

  const activeNums = new Set(
    schedule.activeOrderResidualSchedule.map((l) => l.installmentNumber)
  );
  for (const line of schedule.supersededOrderSchedule) {
    if (!activeNums.has(line.installmentNumber)) continue;
    const active = schedule.activeOrderResidualSchedule.find(
      (a) => a.installmentNumber === line.installmentNumber
    );
    if (
      active &&
      active.residualAmount.add(line.originalAmount.sub(active.residualAmount)).gt(
        line.originalAmount.add(new Prisma.Decimal("0.02"))
      )
    ) {
      out.push({
        code: "INSTALLMENT_DOUBLE_COUNT_RISK",
        severity: "warning",
        message: `Parcela ${line.installmentNumber}: risco de contagem dupla residual+substituída.`,
      });
    }
  }

  for (const doc of schedule.documentSchedule) {
    if (doc.kind !== "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") continue;
    if (doc.dueDate != null) {
      out.push({
        code: "AWAITING_DOC_HAS_ORDER_DUE_DATE",
        severity: "error",
        message: `Documento aguardando ${doc.documentKey} não deve reutilizar data do Pedido.`,
      });
    }
  }

  const hasUnknownItem = schedule.itemAmounts.some(
    (i) => i.unresolvedResidual.gt(0) || i.evidence.classificationPendingAlert
  );
  if (
    hasUnknownItem &&
    !input.consumerAlertCodes.includes("ITEM_CLASSIFICATION_PENDING") &&
    !schedule.alerts.some((a) => a.code === "ITEM_CLASSIFICATION_PENDING")
  ) {
    out.push({
      code: "UNKNOWN_WITHOUT_CLASSIFICATION_ALERT",
      severity: "error",
      message:
        "Há residual provisório (UNKNOWN) sem alerta ITEM_CLASSIFICATION_PENDING.",
    });
  }

  if (
    schedule.cutAmount.gt(0) &&
    schedule.activeOrderResidualSchedule.some((l) => l.residualAmount.gt(0)) &&
    schedule.itemAmounts.every((i) => i.cutAmount.gt(0) && i.activeResidual.lte(0)) ===
      false
  ) {
    // ok — mix cut + residual em itens diferentes
  }

  // Residual ativo não deve incluir corte.
  const cut = schedule.cutAmount;
  if (cut.gt(0)) {
    for (const item of schedule.itemAmounts) {
      if (item.cutAmount.gt(0) && item.activeResidual.gt(0)) {
        out.push({
          code: "CUT_ITEM_WITH_ACTIVE_RESIDUAL",
          severity: "error",
          message: `Item ${item.salesOrderItemId}: corte com residual ativo (política: residual zero no corte).`,
        });
      }
    }
  }

  return out;
}

export function buildEffectiveSalesOrderScheduleAuditReport(input: {
  requestedOrder: string;
  audit: OrderFullAuditPayload | null;
  projection: ProjectEffectiveScheduleForAuditResult | null;
  generatedAt?: Date;
}): EffectiveSalesOrderScheduleAuditReport {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const guarantees = {
    databaseWrites: false as const,
    nomusCalls: false as const,
    passwordExposed: false as const,
    decimalSerializedAsString: true as const,
  };

  if (!input.audit || !input.projection) {
    return {
      ok: true,
      mode: "READ_ONLY",
      generatedAt,
      requestedOrder: input.requestedOrder,
      orderFound: false,
      status: "unavailable",
      exactUnavailableReason: `Pedido ${input.requestedOrder} não localizado no banco local (stage Prisma).`,
      guarantees,
      order: null,
      originalInstallments: [],
      items: [],
      stockDocuments: [],
      documentAllocationsByItem: [],
      coverage: null,
      nfes: [],
      realReceivables: [],
      effectiveAgenda: null,
      supersededOrderSchedule: [],
      alerts: [],
      consumerAlerts: [],
      inconsistencies: [],
      source: null,
    };
  }

  const { audit, projection } = input;
  const schedule = projection.schedule;
  const consumerAlerts = projection.effectiveAlerts.map((a) => ({
    code: a.code,
    severity: a.severity,
    title: a.code,
    description: a.message,
  }));

  // Prefer consumer alerts from projection.effectiveAlerts; also include schedule.alerts
  const alertRows = [
    ...schedule.alerts.map((a) => ({
      code: a.code,
      severity: a.severity,
      message: a.message,
    })),
  ];

  const itemAmountById = new Map(
    schedule.itemAmounts.map((i) => [i.salesOrderItemId, i] as const)
  );

  const documentAllocationsByItem: EffectiveSalesOrderScheduleAuditReport["documentAllocationsByItem"] =
    [];
  for (const di of audit.stockDocumentItems ?? []) {
    if (!di.linkedSalesOrderItemId) continue;
    documentAllocationsByItem.push({
      salesOrderItemId: di.linkedSalesOrderItemId,
      stockDocumentExternalId: di.stockDocumentExternalId,
      allocatedValue:
        di.allocatedValue != null ? round2(di.allocatedValue) : null,
    });
  }

  const inconsistencies = detectEffectiveScheduleInconsistencies({
    schedule,
    consumerAlertCodes: alertRows.map((a) => a.code),
  });

  const origByNum = new Map<
    number,
    { installmentNumber: number; dueDate: string | null; amount: string }
  >();
  for (const l of schedule.supersededOrderSchedule) {
    origByNum.set(l.installmentNumber, {
      installmentNumber: l.installmentNumber,
      dueDate: l.dueDate,
      amount: decimalStr(l.originalAmount),
    });
  }
  for (const l of schedule.activeOrderResidualSchedule) {
    origByNum.set(l.installmentNumber, {
      installmentNumber: l.installmentNumber,
      dueDate: l.dueDate,
      amount: decimalStr(l.originalAmount),
    });
  }

  return {
    ok: true,
    mode: "READ_ONLY",
    generatedAt,
    requestedOrder: input.requestedOrder,
    orderFound: true,
    status: inconsistencies.some((i) => i.severity === "error")
      ? "with_inconsistencies"
      : "ok",
    exactUnavailableReason: null,
    guarantees,
    order: {
      salesOrderId: audit.salesOrderId,
      orderCode: audit.orderCode ?? audit.salesOrder.orderCode ?? input.requestedOrder,
      paymentTerms: audit.salesOrder.paymentTerms ?? null,
      paymentMethod: audit.salesOrder.paymentMethod ?? null,
      issueDate: audit.salesOrder.issueDate ?? null,
      totalNetValue: audit.summary?.activeOrderValue ?? null,
    },
    originalInstallments: [...origByNum.values()].sort(
      (a, b) => a.installmentNumber - b.installmentNumber
    ),
    items: audit.items.map((item) => {
      const amounts = itemAmountById.get(item.salesOrderItemId);
      return {
        salesOrderItemId: item.salesOrderItemId,
        itemSequence: item.itemSequence,
        productCode: item.productCode,
        statusRaw: item.nomusItemStatusRaw,
        statusNormalized: item.nomusItemStatusNormalized,
        classification: amounts?.classification ?? null,
        orderedQuantity: item.quantity,
        fulfilledQuantity: item.nomusQuantityFulfilled,
        plannedNetValue: amounts ? decimalStr(amounts.plannedNetValue) : null,
        coveredByDocuments: amounts
          ? decimalStr(amounts.coveredByValidDocuments)
          : null,
        coveredByCr: amounts ? decimalStr(amounts.crReceivableRaw) : null,
        cutAmount: amounts ? decimalStr(amounts.cutAmount) : null,
        activeResidual: amounts ? decimalStr(amounts.activeResidual) : null,
        unresolvedResidual: amounts
          ? decimalStr(amounts.unresolvedResidual)
          : null,
      };
    }),
    stockDocuments: (audit.stockDocuments ?? []).map((doc) => ({
      stockDocumentExternalId: doc.stockDocumentExternalId,
      idNfe: doc.idNfe,
      allocatedValue: round2(doc.allocatedValue ?? 0),
      status: doc.status,
      linkedItemIds: (audit.stockDocumentItems ?? [])
        .filter(
          (di) =>
            di.stockDocumentExternalId === doc.stockDocumentExternalId &&
            di.linkedSalesOrderItemId
        )
        .map((di) => di.linkedSalesOrderItemId!),
    })),
    documentAllocationsByItem,
    coverage: {
      plannedNetTotal: decimalStr(schedule.coverageSummary.plannedNetTotal),
      coveredByRealReceivables: decimalStr(
        schedule.coverageSummary.coveredByRealReceivables
      ),
      coveredByDocumentsWithoutCr: decimalStr(
        schedule.coverageSummary.coveredByDocumentsWithoutCr
      ),
      cutAmount: decimalStr(schedule.cutAmount),
      canceledAmount: decimalStr(schedule.canceledAmount),
      activeOrderResidualTotal: decimalStr(
        schedule.coverageSummary.activeOrderResidualTotal
      ),
      unresolvedAmount: decimalStr(schedule.unresolvedAmount),
      supersededOrderTotal: decimalStr(
        schedule.coverageSummary.supersededOrderTotal
      ),
    },
    nfes: (audit.nfes ?? []).map((nfe) => ({
      nfeExternalId: nfe.nfeExternalId,
      numero: nfe.numero ?? null,
      isCanceled: Boolean(nfe.isCanceled),
      allocatedValueToOrder: round2(nfe.allocatedValueToOrder ?? 0),
    })),
    realReceivables: schedule.realReceivables.map((cr) => ({
      externalId: cr.externalId,
      sourceInvoiceId: cr.sourceInvoiceId,
      dueDate: cr.dueDate,
      amountReceivable: decimalStr(cr.amountReceivable),
      amountReceived: decimalStr(cr.amountReceived),
      balanceReceivable: decimalStr(cr.balanceReceivable),
    })),
    effectiveAgenda: {
      realReceivables: schedule.realReceivables.map((cr) => ({
        externalId: cr.externalId,
        dueDate: cr.dueDate,
        amountReceivable: decimalStr(cr.amountReceivable),
        balanceReceivable: decimalStr(cr.balanceReceivable),
      })),
      documentSchedule: serializeAuditJsonValue(schedule.documentSchedule) as unknown[],
      activeOrderResidualSchedule: schedule.activeOrderResidualSchedule.map(
        (l) => ({
          installmentNumber: l.installmentNumber,
          dueDate: l.dueDate,
          originalAmount: decimalStr(l.originalAmount),
          residualAmount: decimalStr(l.residualAmount),
        })
      ),
    },
    supersededOrderSchedule: schedule.supersededOrderSchedule.map((l) => ({
      installmentNumber: l.installmentNumber,
      dueDate: l.dueDate,
      originalAmount: decimalStr(l.originalAmount),
    })),
    alerts: alertRows,
    consumerAlerts,
    inconsistencies,
    source: projection.source,
  };
}

export function formatEffectiveScheduleAuditMarkdown(
  report: EffectiveSalesOrderScheduleAuditReport
): string {
  const lines: string[] = [];
  lines.push("# Auditoria — Agenda financeira efetiva do Pedido");
  lines.push("");
  lines.push(`- **Gerado em:** ${report.generatedAt}`);
  lines.push(`- **Pedido solicitado:** ${report.requestedOrder}`);
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Modo:** ${report.mode}`);
  lines.push(
    `- **Garantias:** writes=${report.guarantees.databaseWrites} nomus=${report.guarantees.nomusCalls} senhaExposta=${report.guarantees.passwordExposed}`
  );
  lines.push("");

  if (!report.orderFound || !report.order) {
    lines.push("## Pedido não encontrado");
    lines.push("");
    lines.push(report.exactUnavailableReason ?? "Indisponível.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Pedido");
  lines.push("");
  lines.push(`| Campo | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Código | ${report.order.orderCode} |`);
  lines.push(`| Id | ${report.order.salesOrderId} |`);
  lines.push(`| Condição | ${report.order.paymentTerms ?? "—"} |`);
  lines.push(`| Método | ${report.order.paymentMethod ?? "—"} |`);
  lines.push(`| Emissão | ${report.order.issueDate ?? "—"} |`);
  lines.push(`| Valor ativo | ${report.order.totalNetValue ?? "—"} |`);
  lines.push("");

  lines.push("## Parcelas originais");
  lines.push("");
  if (report.originalInstallments.length === 0) {
    lines.push("_Nenhuma parcela original materializada._");
  } else {
    lines.push("| # | Vencimento | Valor |");
    lines.push("|---:|---|---:|");
    for (const p of report.originalInstallments) {
      lines.push(
        `| ${p.installmentNumber} | ${p.dueDate ?? "—"} | ${p.amount} |`
      );
    }
  }
  lines.push("");

  lines.push("## Itens");
  lines.push("");
  lines.push(
    "| Seq | SKU | Status | Classificação | Pedida | Atendida | Coberto Doc | Coberto CR | Corte | Residual |"
  );
  lines.push("|---|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const item of report.items) {
    lines.push(
      `| ${item.itemSequence ?? "—"} | ${item.productCode ?? "—"} | ${item.statusNormalized ?? item.statusRaw ?? "—"} | ${item.classification ?? "—"} | ${item.orderedQuantity ?? "—"} | ${item.fulfilledQuantity ?? "—"} | ${item.coveredByDocuments ?? "—"} | ${item.coveredByCr ?? "—"} | ${item.cutAmount ?? "—"} | ${item.activeResidual ?? "—"} |`
    );
  }
  lines.push("");

  lines.push("## Documentos de Saída");
  lines.push("");
  if (report.stockDocuments.length === 0) {
    lines.push("_Nenhum documento._");
  } else {
    lines.push("| ExternalId | NF | Alocado | Status | Itens |");
    lines.push("|---:|---:|---:|---|---|");
    for (const d of report.stockDocuments) {
      lines.push(
        `| ${d.stockDocumentExternalId} | ${d.idNfe ?? "—"} | ${d.allocatedValue} | ${d.status ?? "—"} | ${d.linkedItemIds.join(", ") || "—"} |`
      );
    }
  }
  lines.push("");

  lines.push("## Alocação por item");
  lines.push("");
  if (report.documentAllocationsByItem.length === 0) {
    lines.push("_Sem alocações item×documento._");
  } else {
    lines.push("| Item | Documento | Alocado |");
    lines.push("|---|---:|---:|");
    for (const a of report.documentAllocationsByItem) {
      lines.push(
        `| ${a.salesOrderItemId} | ${a.stockDocumentExternalId} | ${a.allocatedValue ?? "—"} |`
      );
    }
  }
  lines.push("");

  if (report.coverage) {
    lines.push("## Cobertura");
    lines.push("");
    lines.push(`| Métrica | Valor |`);
    lines.push(`|---|---:|`);
    lines.push(`| Planejado líquido | ${report.coverage.plannedNetTotal} |`);
    lines.push(`| Coberto por CR | ${report.coverage.coveredByRealReceivables} |`);
    lines.push(
      `| Coberto por Documento (sem CR) | ${report.coverage.coveredByDocumentsWithoutCr} |`
    );
    lines.push(`| Cortado | ${report.coverage.cutAmount} |`);
    lines.push(`| Cancelado | ${report.coverage.canceledAmount} |`);
    lines.push(`| Residual ativo | ${report.coverage.activeOrderResidualTotal} |`);
    lines.push(`| Não resolvido | ${report.coverage.unresolvedAmount} |`);
    lines.push(`| Substituído | ${report.coverage.supersededOrderTotal} |`);
    lines.push("");
  }

  lines.push("## NF-es");
  lines.push("");
  if (report.nfes.length === 0) {
    lines.push("_Nenhuma NF._");
  } else {
    lines.push("| ExternalId | Número | Cancelada | Alocado |");
    lines.push("|---:|---|---|---:|");
    for (const n of report.nfes) {
      lines.push(
        `| ${n.nfeExternalId} | ${n.numero ?? "—"} | ${n.isCanceled ? "sim" : "não"} | ${n.allocatedValueToOrder} |`
      );
    }
  }
  lines.push("");

  lines.push("## CRs (NomusAccountsReceivable)");
  lines.push("");
  if (report.realReceivables.length === 0) {
    lines.push("_Nenhum CR._");
  } else {
    lines.push("| ExternalId | NF | Vencimento | Original | Recebido | Aberto |");
    lines.push("|---:|---:|---|---:|---:|---:|");
    for (const cr of report.realReceivables) {
      lines.push(
        `| ${cr.externalId} | ${cr.sourceInvoiceId ?? "—"} | ${cr.dueDate ?? "—"} | ${cr.amountReceivable} | ${cr.amountReceived} | ${cr.balanceReceivable} |`
      );
    }
  }
  lines.push("");

  lines.push("## Agenda efetiva final");
  lines.push("");
  if (!report.effectiveAgenda) {
    lines.push("_Indisponível._");
  } else {
    lines.push("### CR real");
    lines.push("");
    for (const cr of report.effectiveAgenda.realReceivables) {
      lines.push(
        `- CR ${cr.externalId} · ${cr.dueDate ?? "sem data"} · aberto ${cr.balanceReceivable} / original ${cr.amountReceivable}`
      );
    }
    if (report.effectiveAgenda.realReceivables.length === 0) {
      lines.push("_Nenhum._");
    }
    lines.push("");
    lines.push("### Documento (sem CR)");
    lines.push("");
    lines.push("```json");
    lines.push(
      JSON.stringify(report.effectiveAgenda.documentSchedule, null, 2)
    );
    lines.push("```");
    lines.push("");
    lines.push("### Previsão residual ativa");
    lines.push("");
    if (report.effectiveAgenda.activeOrderResidualSchedule.length === 0) {
      lines.push("_Nenhuma._");
    } else {
      lines.push("| # | Vencimento | Original | Residual |");
      lines.push("|---:|---|---:|---:|");
      for (const l of report.effectiveAgenda.activeOrderResidualSchedule) {
        lines.push(
          `| ${l.installmentNumber} | ${l.dueDate ?? "—"} | ${l.originalAmount} | ${l.residualAmount} |`
        );
      }
    }
  }
  lines.push("");

  lines.push("## Agenda original substituída");
  lines.push("");
  if (report.supersededOrderSchedule.length === 0) {
    lines.push("_Nenhuma parcela substituída._");
  } else {
    lines.push("| # | Vencimento | Valor original |");
    lines.push("|---:|---|---:|");
    for (const l of report.supersededOrderSchedule) {
      lines.push(
        `| ${l.installmentNumber} | ${l.dueDate ?? "—"} | ${l.originalAmount} |`
      );
    }
  }
  lines.push("");

  lines.push("## Alertas");
  lines.push("");
  if (report.alerts.length === 0) {
    lines.push("_Nenhum alerta do motor._");
  } else {
    for (const a of report.alerts) {
      lines.push(`- **${a.code}** (${a.severity}): ${a.message}`);
    }
  }
  lines.push("");

  lines.push("## Inconsistências");
  lines.push("");
  if (report.inconsistencies.length === 0) {
    lines.push("_Nenhuma inconsistência detectada._");
  } else {
    for (const i of report.inconsistencies) {
      lines.push(`- **${i.code}** (${i.severity}): ${i.message}`);
    }
  }
  lines.push("");
  lines.push(`_Fonte: ${report.source ?? "—"}_`);
  lines.push("");

  return lines.join("\n");
}

export const EFFECTIVE_SCHEDULE_AUDIT_FORBIDDEN_PATTERNS = [
  /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\$executeRaw(?:Unsafe)?\s*[(`]/,
  /\$queryRawUnsafe\s*\(/,
  /\b(?:fetchNomus|nomusFetch|callNomus|syncNomus|NomusApiClient|nomusRequest)\b/,
] as const;

export function scanEffectiveScheduleAuditSource(source: string): string[] {
  const hits: string[] = [];
  for (const pattern of EFFECTIVE_SCHEDULE_AUDIT_FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) hits.push(String(pattern));
  }
  return hits;
}
