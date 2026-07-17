/**
 * FIN-06 — Detalhe do Pedido: agenda financeira via motor canônico FIN-05.
 *
 * Puro (sem Prisma). Converte `OrderFullAuditPayload` → input FIN-05 →
 * `SalesOrderDetailFinancial` com campos separados (CR / Documento / residual /
 * substituída / corte / cancelado / não resolvido / cobertura).
 */

import type {
  OrderFullAuditPayload,
  OrderFullAuditPlannedReceivable,
  OrderFullAuditReceivable,
} from "@/src/lib/finance/orderFullAuditClient.js";
import {
  buildSalesOrderEffectiveFinancialSchedule,
  type BuildSalesOrderEffectiveFinancialScheduleInput,
  type EffectiveScheduleDocumentEntry,
  type EffectiveScheduleOrderInstallment,
  type SalesOrderEffectiveFinancialSchedule,
} from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import type { ComputeSalesOrderItemFinancialAmountsInput } from "@/src/lib/finance/salesOrderItemFinancialAmounts.js";
import type {
  SalesOrderDetailFinancial,
  SalesOrderDetailOriginalForecastHistoryRow,
  SalesOrderDetailOriginalForecastHistoryStatus,
} from "./salesOrderDetailClient.js";

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function decimalToNumber(value: { toFixed(dp: number): string }): number {
  return round2(Number(value.toFixed(2)));
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function classifyResidualStatus(
  dueDateIso: string | null,
  referenceDate: Date
): OrderFullAuditPlannedReceivable["statusLabel"] {
  if (!dueDateIso) return "Não informado";
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return "Não informado";
  const dueT = startOfLocalDay(due).getTime();
  const todayT = startOfLocalDay(referenceDate).getTime();
  if (dueT < todayT) return "Vencido";
  if (dueT === todayT) return "Vence hoje";
  return "A vencer";
}

function buildItemInputs(
  audit: OrderFullAuditPayload
): ComputeSalesOrderItemFinancialAmountsInput[] {
  return audit.items.map((item) => {
    const documentAllocations = (audit.stockDocumentItems ?? [])
      .filter((di) => di.linkedSalesOrderItemId === item.salesOrderItemId)
      .map((di) => ({
        allocationKey: `${di.stockDocumentItemId}:${item.salesOrderItemId}`,
        allocatedByOrderPrice: String(
          di.allocatedValue ??
            (di.quantityUsedForOrder != null && di.orderUnitPrice != null
              ? di.quantityUsedForOrder * di.orderUnitPrice
              : di.totalValue ?? 0)
        ),
        allocatedByDocumentPrice: String(di.totalValue ?? di.allocatedValue ?? 0),
        isValid: true,
      }));

    const crAllocations = (item.linkedReceivableExternalIds ?? []).map((externalId) => {
      const cr = audit.receivables.find((r) => r.receivableExternalId === externalId);
      return {
        allocationKey: `cr:${externalId}:${item.salesOrderItemId}`,
        amountReceivable: String(cr?.amountReceivable ?? 0),
        amountReceived: String(cr?.amountReceived ?? 0),
        balanceReceivable: String(cr?.balanceReceivable ?? 0),
      };
    });

    const plannedNet =
      item.totalNetValue ??
      item.activeValue ??
      (item.quantity != null && item.unitPrice != null
        ? item.quantity * item.unitPrice
        : 0);

    return {
      salesOrderItemId: item.salesOrderItemId,
      plannedNetValue: String(round2(plannedNet)),
      status: item.nomusItemStatusRaw,
      statusNormalized: item.nomusItemStatusNormalized,
      orderedQuantity: item.quantity,
      fulfilledQuantity: item.nomusQuantityFulfilled,
      nomusIsCut: item.nomusIsCut,
      nomusIsCanceled: item.nomusIsCanceled || item.nomusIsStale,
      documentAllocations,
      crAllocations,
    };
  });
}

/**
 * Parcelas originais a partir do audit (estrutura já materializada).
 * Valores originais — o motor FIN-05 redistribui o residual dos itens.
 */
function buildOriginalInstallments(audit: OrderFullAuditPayload) {
  const byNum = new Map<
    number,
    { installmentNumber: number; dueDate: string | null; amount: string }
  >();
  for (const p of audit.plannedReceivables ?? []) {
    if (byNum.has(p.installmentNumber)) continue;
    const amount = p.originalExpectedAmount ?? p.expectedAmount;
    if (!(amount > 0)) continue;
    byNum.set(p.installmentNumber, {
      installmentNumber: p.installmentNumber,
      dueDate: p.dueDate,
      amount: String(round2(amount)),
    });
  }
  return [...byNum.values()].sort((a, b) => a.installmentNumber - b.installmentNumber);
}

function buildDocumentInputs(audit: OrderFullAuditPayload) {
  return (audit.stockDocuments ?? [])
    .filter((doc) => (doc.allocatedValue ?? 0) > 0.009)
    .map((doc) => ({
      documentKey: `doc:${doc.stockDocumentExternalId}`,
      sourceInvoiceId: doc.idNfe ?? null,
      isValid: true,
      allocatedByOrderPrice: String(round2(doc.allocatedValue)),
      // Condição documental comprovada ainda não está no stage — awaiting.
      provenInstallments: null as null,
    }));
}

export function buildEffectiveScheduleInputFromAudit(
  audit: OrderFullAuditPayload,
  referenceDate: Date = new Date()
): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? audit.salesOrder.orderCode ?? "",
    items: buildItemInputs(audit),
    originalInstallments: buildOriginalInstallments(audit),
    realReceivables: (audit.receivables ?? []).map((r) => ({
      externalId: r.receivableExternalId,
      sourceInvoiceId: r.sourceInvoiceId,
      dueDate: r.dueDate,
      amountReceivable: String(r.amountReceivable ?? 0),
      amountReceived: String(r.amountReceived ?? 0),
      balanceReceivable: String(r.balanceReceivable ?? 0),
    })),
    documents: buildDocumentInputs(audit),
    referenceDate,
  };
}

function mapActiveResidualToPlanned(
  schedule: SalesOrderEffectiveFinancialSchedule,
  referenceDate: Date
): OrderFullAuditPlannedReceivable[] {
  const total = schedule.activeOrderResidualSchedule.length;
  return schedule.activeOrderResidualSchedule.map((line) => {
    const amount = decimalToNumber(line.residualAmount);
    const statusLabel = classifyResidualStatus(line.dueDate, referenceDate);
    return {
      key: `effective-residual:${schedule.orderCode}:${line.installmentNumber}:${line.dueDate ?? "no-date"}`,
      orderCode: schedule.orderCode,
      salesOrderId: schedule.salesOrderId,
      installmentNumber: line.installmentNumber,
      totalInstallments: total,
      reference: `Pedido ${schedule.orderCode} - Parcela ${line.installmentNumber} de ${total} (residual)`,
      dueDate: line.dueDate,
      originalExpectedAmount: decimalToNumber(line.originalAmount),
      expectedAmount: amount,
      openAmount: amount,
      statusLabel,
      paymentConditionLabel: "Condição do Pedido (residual efetivo)",
      paymentMethodLabel: null,
      origin: "Pedido de Venda / residual efetivo (FIN-05)",
      note: "Previsão residual ativa — datas originais do Pedido; itens ainda ativos.",
      replacedByRealCr: false,
      replacedByReceivableExternalId: null,
      replacedBySource: null,
      entryKind: "RESIDUAL_ORDER_PLAN",
    };
  });
}

function buildOriginalForecastHistory(
  schedule: SalesOrderEffectiveFinancialSchedule
): SalesOrderDetailOriginalForecastHistoryRow[] {
  const residualByNum = new Map(
    schedule.activeOrderResidualSchedule.map((l) => [
      l.installmentNumber,
      l,
    ] as const)
  );
  const supersededByNum = new Map(
    schedule.supersededOrderSchedule.map((l) => [l.installmentNumber, l] as const)
  );
  const installmentNumbers = [
    ...new Set([
      ...schedule.activeOrderResidualSchedule.map((l) => l.installmentNumber),
      ...schedule.supersededOrderSchedule.map((l) => l.installmentNumber),
    ]),
  ].sort((a, b) => a - b);

  const totalInstallments = Math.max(installmentNumbers.length, 1);
  const rows: SalesOrderDetailOriginalForecastHistoryRow[] = [];

  for (const num of installmentNumbers) {
    const residualLine = residualByNum.get(num);
    const supersededLine = supersededByNum.get(num);
    const originalAmount = decimalToNumber(
      residualLine?.originalAmount ?? supersededLine?.originalAmount ?? 0
    );
    const residualAmount = decimalToNumber(residualLine?.residualAmount ?? 0);
    const substitutedAmount = round2(Math.max(0, originalAmount - residualAmount));
    const dueDate = residualLine?.dueDate ?? supersededLine?.dueDate ?? null;

    // Histórico só inclui parcelas tocadas por substituição/cobertura.
    if (substitutedAmount <= 0.009) continue;

    let status: SalesOrderDetailOriginalForecastHistoryStatus = "Substituída";
    if (residualAmount > 0.009) status = "Parcialmente substituída";

    rows.push({
      key: `history-installment:${schedule.orderCode}:${num}`,
      kind: "installment",
      installmentNumber: num,
      totalInstallments,
      dueDate,
      originalAmount,
      residualAmount,
      substitutedAmount,
      status,
      note:
        status === "Parcialmente substituída"
          ? `Parcela residual ${formatHistoryMoney(residualAmount)}; substituída ${formatHistoryMoney(substitutedAmount)}.`
          : "Parcela original substituída por CR/Documento.",
    });
  }

  const cutAmount = decimalToNumber(schedule.cutAmount);
  if (cutAmount > 0.009) {
    rows.push({
      key: `history-cut:${schedule.orderCode}`,
      kind: "cut_summary",
      installmentNumber: null,
      totalInstallments: null,
      dueDate: null,
      originalAmount: cutAmount,
      residualAmount: 0,
      substitutedAmount: 0,
      status: "Encerrada por corte",
      note: "Valor encerrado por atendimento com corte — não é saldo financeiro.",
    });
  }

  const canceledAmount = decimalToNumber(schedule.canceledAmount);
  if (canceledAmount > 0.009) {
    rows.push({
      key: `history-canceled:${schedule.orderCode}`,
      kind: "canceled_summary",
      installmentNumber: null,
      totalInstallments: null,
      dueDate: null,
      originalAmount: canceledAmount,
      residualAmount: 0,
      substitutedAmount: 0,
      status: "Cancelada",
      note: "Valor de itens cancelados — residual zero.",
    });
  }

  return rows;
}

function formatHistoryMoney(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mapSupersededToPlanned(
  schedule: SalesOrderEffectiveFinancialSchedule,
  history: SalesOrderDetailOriginalForecastHistoryRow[]
): OrderFullAuditPlannedReceivable[] {
  const statusByNum = new Map(
    history
      .filter((h) => h.kind === "installment" && h.installmentNumber != null)
      .map((h) => [h.installmentNumber!, h.status] as const)
  );
  const total = Math.max(
    schedule.supersededOrderSchedule.length,
    schedule.activeOrderResidualSchedule.length,
    1
  );
  return schedule.supersededOrderSchedule.map((line) => {
    const historyStatus = statusByNum.get(line.installmentNumber) ?? "Substituída";
    const statusLabel =
      historyStatus === "Parcialmente substituída"
        ? ("Parcialmente substituída" as const)
        : ("Substituída" as const);
    return {
      key: `effective-superseded:${schedule.orderCode}:${line.installmentNumber}`,
      orderCode: schedule.orderCode,
      salesOrderId: schedule.salesOrderId,
      installmentNumber: line.installmentNumber,
      totalInstallments: total,
      reference: `Pedido ${schedule.orderCode} - Parcela ${line.installmentNumber} (substituída)`,
      dueDate: line.dueDate,
      originalExpectedAmount: decimalToNumber(line.originalAmount),
      expectedAmount: decimalToNumber(line.originalAmount),
      openAmount: 0,
      // Nunca "Vencido" — substituída/cortada não gera alerta de vencimento.
      statusLabel,
      paymentConditionLabel: "Condição do Pedido (substituída)",
      paymentMethodLabel: null,
      origin: "Pedido de Venda / substituída (FIN-05)",
      note: "Previsão original substituída por CR/Documento — evidência histórica.",
      replacedByRealCr: true,
      replacedByReceivableExternalId: null,
      replacedBySource:
        schedule.coverageSummary.coveredByRealReceivables.gt(0)
          ? "REAL_RECEIVABLE"
          : schedule.coverageSummary.coveredByDocumentsWithoutCr.gt(0)
            ? "OUTPUT_DOCUMENT"
            : "VALUE_COVERAGE",
      entryKind: "SUPERSEDED_ORDER_PLAN" as const,
    };
  });
}

function computeEffectiveNextDueDate(
  realReceivables: OrderFullAuditReceivable[],
  documentSchedule: EffectiveScheduleDocumentEntry[],
  activeResidual: EffectiveScheduleOrderInstallment[]
): string | null {
  const dates: string[] = [];

  for (const cr of realReceivables) {
    const open = cr.balanceReceivable ?? 0;
    if (open > 0.009 && cr.dueDate) dates.push(cr.dueDate);
  }

  for (const doc of documentSchedule) {
    if (doc.kind !== "DOCUMENT_SCHEDULE") continue;
    for (const inst of doc.installments) {
      if (inst.dueDate && decimalToNumber(inst.amount) > 0.009) {
        dates.push(inst.dueDate);
      }
    }
  }

  for (const line of activeResidual) {
    if (line.dueDate && decimalToNumber(line.residualAmount) > 0.009) {
      dates.push(line.dueDate);
    }
  }

  if (dates.length === 0) return null;
  return dates.sort((a, b) => a.localeCompare(b))[0] ?? null;
}

function mapDocumentScheduleForClient(
  entries: EffectiveScheduleDocumentEntry[]
): SalesOrderDetailFinancial["documentSchedule"] {
  return entries.map((doc) => {
    if (doc.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") {
      return {
        kind: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE" as const,
        documentKey: doc.documentKey,
        sourceInvoiceId: doc.sourceInvoiceId,
        allocatedByOrderPrice: decimalToNumber(doc.allocatedByOrderPrice),
        dueDate: null,
        installments: [] as Array<{
          installmentNumber: number;
          dueDate: string | null;
          amount: number;
        }>,
      };
    }
    return {
      kind: "DOCUMENT_SCHEDULE" as const,
      documentKey: doc.documentKey,
      sourceInvoiceId: doc.sourceInvoiceId,
      allocatedByOrderPrice: decimalToNumber(doc.allocatedByOrderPrice),
      installments: doc.installments.map((i) => ({
        installmentNumber: i.installmentNumber,
        dueDate: i.dueDate,
        amount: decimalToNumber(i.amount),
      })),
    };
  });
}

/**
 * Projeta o resultado FIN-05 no contrato do Detalhe do Pedido.
 */
export function mapEffectiveScheduleToDetailFinancial(
  schedule: SalesOrderEffectiveFinancialSchedule,
  auditReceivables: OrderFullAuditReceivable[],
  auditReceipts: OrderFullAuditPayload["receipts"],
  auditTotals: OrderFullAuditPayload["receivablesTotal"],
  referenceDate: Date = new Date()
): SalesOrderDetailFinancial {
  const plannedReceivables = mapActiveResidualToPlanned(schedule, referenceDate);
  const originalForecastHistory = buildOriginalForecastHistory(schedule);
  const supersededPlannedReceivables = mapSupersededToPlanned(
    schedule,
    originalForecastHistory
  );

  const activeResidualTotal = decimalToNumber(
    schedule.coverageSummary.activeOrderResidualTotal
  );
  const coveredCr = decimalToNumber(schedule.coverageSummary.coveredByRealReceivables);
  const coveredDoc = decimalToNumber(
    schedule.coverageSummary.coveredByDocumentsWithoutCr
  );
  const cutAmount = decimalToNumber(schedule.cutAmount);
  const canceledAmount = decimalToNumber(schedule.canceledAmount);
  const unresolvedAmount = decimalToNumber(schedule.unresolvedAmount);
  const plannedNetTotal = decimalToNumber(schedule.coverageSummary.plannedNetTotal);
  const supersededTotal = decimalToNumber(
    schedule.coverageSummary.supersededOrderTotal
  );

  const overdueResidual = plannedReceivables.filter((p) => p.statusLabel === "Vencido");
  const overdueExpected = round2(
    overdueResidual.reduce((s, p) => s + p.openAmount, 0)
  );

  const documentSchedule = mapDocumentScheduleForClient(schedule.documentSchedule);
  const effectiveNextDueDate = computeEffectiveNextDueDate(
    auditReceivables,
    schedule.documentSchedule,
    schedule.activeOrderResidualSchedule
  );

  const fullySuperseded =
    activeResidualTotal <= 0.009 &&
    (coveredCr > 0.009 || coveredDoc > 0.009) &&
    plannedNetTotal > 0.009;
  const partiallySuperseded =
    activeResidualTotal > 0.009 && (coveredCr > 0.009 || coveredDoc > 0.009);

  return {
    engine: "salesOrderEffectiveFinancialSchedule",
    realReceivables: auditReceivables,
    documentSchedule,
    plannedReceivables,
    supersededPlannedReceivables,
    originalForecastHistory,
    receipts: auditReceipts,
    totals: auditTotals,
    cutAmount,
    canceledAmount,
    unresolvedAmount,
    coverageSummary: {
      plannedNetTotal,
      itemActiveResidualTotal: decimalToNumber(
        schedule.coverageSummary.itemActiveResidualTotal
      ),
      coveredByRealReceivables: coveredCr,
      coveredByDocumentsWithoutCr: coveredDoc,
      documentAwaitingAmount: decimalToNumber(
        schedule.coverageSummary.documentAwaitingAmount
      ),
      activeOrderResidualTotal: activeResidualTotal,
      supersededOrderTotal: supersededTotal,
      cutAmount,
      canceledAmount,
      unresolvedAmount,
      realOrDocumentAgendaTotal: round2(coveredCr + coveredDoc),
      precedenceSource: schedule.coverageSummary.precedenceSource,
    },
    plannedTotals: {
      totalCount: plannedReceivables.length + supersededPlannedReceivables.length,
      totalExpected: plannedNetTotal,
      applicableExpected: activeResidualTotal,
      openExpected: activeResidualTotal,
      overdueExpected,
      overdueCount: overdueResidual.length,
      nextDueDate:
        plannedReceivables
          .map((p) => p.dueDate)
          .filter((d): d is string => Boolean(d))
          .sort((a, b) => a.localeCompare(b))[0] ?? null,
      replacedCount: supersededPlannedReceivables.length,
      replacedAmount: supersededTotal,
      coveredByRealReceivables: coveredCr,
      coveredByDocumentsWithoutRealReceivable: coveredDoc,
      remainingPlannedValue: activeResidualTotal,
      fullySuperseded,
      partiallySuperseded,
      precedenceSource: schedule.coverageSummary.precedenceSource,
    },
    effectiveNextDueDate,
    effectiveAlerts: schedule.alerts.map((a) => ({
      code: a.code,
      severity: a.severity,
      message: a.message,
      documentKey: a.documentKey,
      salesOrderItemId: a.salesOrderItemId,
      installmentNumber: a.installmentNumber,
    })),
  };
}

/** Pipeline oficial: audit → FIN-05 → DTO financeiro do detalhe. */
export function buildSalesOrderDetailFinancialFromAudit(
  audit: OrderFullAuditPayload,
  referenceDate: Date = new Date()
): SalesOrderDetailFinancial {
  const input = buildEffectiveScheduleInputFromAudit(audit, referenceDate);
  const schedule = buildSalesOrderEffectiveFinancialSchedule(input);
  return mapEffectiveScheduleToDetailFinancial(
    schedule,
    audit.receivables,
    audit.receipts,
    audit.receivablesTotal,
    referenceDate
  );
}
