/**
 * FIN-09 — Projeção da agenda FIN-05 para Auditoria 360° / alertas / consumidores.
 *
 * Substitui `buildSalesOrderPlannedReceivables` na montagem do audit:
 * residual ativo + histórico substituído, sem match por valor+vencimento.
 */

import { resolveSalesOrderListPaymentSummary } from "@/src/lib/salesOrderListPaymentSchedule.js";
import type {
  OrderFullAuditItem,
  OrderFullAuditPlannedReceivable,
  OrderFullAuditPlannedReceivablesTotal,
  OrderFullAuditReceivable,
  OrderFullAuditStockDocument,
} from "./orderFullAuditClient.js";
import {
  buildSalesOrderEffectiveFinancialSchedule,
  type BuildSalesOrderEffectiveFinancialScheduleInput,
  type EffectiveScheduleAlert,
  type SalesOrderEffectiveFinancialSchedule,
} from "./salesOrderEffectiveFinancialSchedule.js";
import type { ComputeSalesOrderItemFinancialAmountsInput } from "./salesOrderItemFinancialAmounts.js";
import {
  mapEffectiveScheduleToDetailFinancial,
} from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type ProjectEffectiveScheduleForAuditInput = {
  salesOrderId: string;
  orderCode: string;
  issueDate: Date | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  nomusRawResponse: unknown;
  totalActiveValue: number;
  items: OrderFullAuditItem[];
  receivables: OrderFullAuditReceivable[];
  stockDocuments: OrderFullAuditStockDocument[];
  nfeNumbers?: string[];
  referenceDate?: Date;
  /** Opcional — quando informado, prevalece sobre a condição do Pedido. */
  originalInstallments?: BuildSalesOrderEffectiveFinancialScheduleInput["originalInstallments"];
};

export type ProjectEffectiveScheduleForAuditResult = {
  plannedReceivables: OrderFullAuditPlannedReceivable[];
  plannedReceivablesTotal: OrderFullAuditPlannedReceivablesTotal;
  schedule: SalesOrderEffectiveFinancialSchedule;
  effectiveAlerts: EffectiveScheduleAlert[];
  source: string;
};

function buildItemInputs(
  items: OrderFullAuditItem[]
): ComputeSalesOrderItemFinancialAmountsInput[] {
  return items.map((item) => {
    const plannedNet =
      item.totalNetValue ??
      item.activeValue ??
      (item.quantity != null && item.unitPrice != null
        ? item.quantity * item.unitPrice
        : 0);

    const documentAllocations = (item.linkedStockDocumentExternalIds ?? []).map(
      (docId, idx) => ({
        allocationKey: `doc-link:${docId}:${item.salesOrderItemId}:${idx}`,
        allocatedByOrderPrice: String(0),
        isValid: true,
      })
    );

    // Preferência: alocações virão dos stockDocuments no input FIN-05 (nível pedido).
    // Mantém CR por item quando houver vínculo.
    const crAllocations = (item.linkedReceivableExternalIds ?? []).map(
      (externalId) => ({
        allocationKey: `cr:${externalId}:${item.salesOrderItemId}`,
        amountReceivable: "0",
        amountReceived: "0",
        balanceReceivable: "0",
      })
    );

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

function enrichItemInputsWithDocuments(
  items: ComputeSalesOrderItemFinancialAmountsInput[],
  stockDocuments: OrderFullAuditStockDocument[],
  auditItems: OrderFullAuditItem[]
): ComputeSalesOrderItemFinancialAmountsInput[] {
  // Distribui allocatedValue do doc nos itens ligados (proporcional ao activeValue).
  const byId = new Map(items.map((i) => [i.salesOrderItemId, { ...i }] as const));

  for (const doc of stockDocuments) {
    const allocated = round2(doc.allocatedValue ?? 0);
    if (allocated <= 0.009) continue;
    const st = (doc.status ?? "").toLowerCase();
    if (
      st.includes("cancel") ||
      st.includes("estorno") ||
      st.includes("anulado") ||
      st.includes("inutil")
    ) {
      continue;
    }

    const linked = auditItems.filter((it) =>
      (it.linkedStockDocumentExternalIds ?? []).includes(doc.stockDocumentExternalId)
    );
    const targets = linked.length > 0 ? linked : auditItems;
    const weights = targets.map((t) =>
      Math.max(0, t.activeValue ?? t.totalNetValue ?? 0)
    );
    const weightSum = weights.reduce((s, w) => s + w, 0);
    if (weightSum <= 0.009) {
      // Sem peso — atribui ao primeiro item ativo.
      const first = targets[0];
      if (!first) continue;
      const row = byId.get(first.salesOrderItemId);
      if (!row) continue;
      row.documentAllocations = [
        ...(row.documentAllocations ?? []),
        {
          allocationKey: `doc:${doc.stockDocumentExternalId}:${first.salesOrderItemId}`,
          allocatedByOrderPrice: String(allocated),
          isValid: true,
        },
      ];
      continue;
    }

    let remaining = allocated;
    targets.forEach((t, idx) => {
      const row = byId.get(t.salesOrderItemId);
      if (!row) return;
      const share =
        idx === targets.length - 1
          ? remaining
          : round2((allocated * (weights[idx] ?? 0)) / weightSum);
      remaining = round2(remaining - share);
      if (share <= 0.009) return;
      row.documentAllocations = [
        ...(row.documentAllocations ?? []),
        {
          allocationKey: `doc:${doc.stockDocumentExternalId}:${t.salesOrderItemId}`,
          allocatedByOrderPrice: String(share),
          isValid: true,
        },
      ];
    });
  }

  // CR por item: preenche valores reais dos receivables.
  // (os IDs já estão em crAllocations; valores vêm no nível do pedido no motor)
  return [...byId.values()];
}

function buildOriginalInstallmentsFromPaymentTerms(input: {
  paymentTerms: string | null;
  paymentMethod: string | null;
  issueDate: Date | null;
  totalActiveValue: number;
  nomusRawResponse: unknown;
  nfeNumbers?: string[];
  referenceDate: Date;
}): BuildSalesOrderEffectiveFinancialScheduleInput["originalInstallments"] {
  const summary = resolveSalesOrderListPaymentSummary({
    paymentTerms: input.paymentTerms,
    paymentMethod: input.paymentMethod,
    issueDate: input.issueDate,
    totalNetValue: input.totalActiveValue,
    nomusRawResponse: input.nomusRawResponse,
    nfeDocuments: input.nfeNumbers ?? [],
    receivables: [],
    referenceDate: input.referenceDate,
  });

  return summary.lines
    .filter((line) => line.amount > 0.009)
    .map((line, idx) => ({
      installmentNumber: idx + 1,
      dueDate: line.dueDate
        ? `${line.dueDate.getFullYear()}-${String(line.dueDate.getMonth() + 1).padStart(2, "0")}-${String(line.dueDate.getDate()).padStart(2, "0")}`
        : null,
      amount: String(round2(line.amount)),
    }));
}

function buildDocumentInputs(
  stockDocuments: OrderFullAuditStockDocument[]
): BuildSalesOrderEffectiveFinancialScheduleInput["documents"] {
  return stockDocuments
    .filter((doc) => (doc.allocatedValue ?? 0) > 0.009)
    .filter((doc) => {
      const st = (doc.status ?? "").toLowerCase();
      if (!st) return true;
      return !(
        st.includes("cancel") ||
        st.includes("estorno") ||
        st.includes("anulado") ||
        st.includes("inutil")
      );
    })
    .map((doc) => ({
      documentKey: `doc:${doc.stockDocumentExternalId}`,
      sourceInvoiceId: doc.idNfe ?? null,
      isValid: true as const,
      allocatedByOrderPrice: String(round2(doc.allocatedValue ?? 0)),
      documentDate: doc.dataDocumento ?? null,
      issuedAt: doc.dataMovimentacao ?? null,
      provenInstallments: null as null,
    }));
}

/**
 * Monta plannedReceivables/totals da Auditoria 360° a partir do motor FIN-05.
 */
export function projectEffectiveScheduleForOrderAudit(
  input: ProjectEffectiveScheduleForAuditInput
): ProjectEffectiveScheduleForAuditResult {
  const referenceDate = input.referenceDate ?? new Date();
  const baseItems = buildItemInputs(input.items);
  const items = enrichItemInputsWithDocuments(
    baseItems,
    input.stockDocuments,
    input.items
  );

  // CR no nível do pedido (motor deduz cobertura); preenche crAllocations com valores reais.
  const crById = new Map(
    input.receivables.map((r) => [r.receivableExternalId, r] as const)
  );
  for (const item of items) {
    item.crAllocations = (item.crAllocations ?? []).map((cr) => {
      const externalId = Number(String(cr.allocationKey).split(":")[1]);
      const real = crById.get(externalId);
      if (!real) return cr;
      return {
        allocationKey: cr.allocationKey,
        amountReceivable: String(real.amountReceivable ?? 0),
        amountReceived: String(real.amountReceived ?? 0),
        balanceReceivable: String(real.balanceReceivable ?? 0),
      };
    });
  }

  // Se itens não têm CR linkado, distribui cobertura CR no primeiro item (motor usa soma).
  const linkedCrIds = new Set(
    items.flatMap((i) =>
      (i.crAllocations ?? []).map((c) => Number(String(c.allocationKey).split(":")[1]))
    )
  );
  const unlinked = input.receivables.filter(
    (r) => !linkedCrIds.has(r.receivableExternalId)
  );
  if (unlinked.length > 0 && items.length > 0) {
    const first = items[0]!;
    first.crAllocations = [
      ...(first.crAllocations ?? []),
      ...unlinked.map((r) => ({
        allocationKey: `cr:${r.receivableExternalId}:${first.salesOrderItemId}`,
        amountReceivable: String(r.amountReceivable ?? 0),
        amountReceived: String(r.amountReceived ?? 0),
        balanceReceivable: String(r.balanceReceivable ?? 0),
      })),
    ];
  }

  // Documentos sem item link: já entram em documents[] do motor.
  const scheduleInput: BuildSalesOrderEffectiveFinancialScheduleInput = {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    items,
    originalInstallments:
      input.originalInstallments && input.originalInstallments.length > 0
        ? input.originalInstallments
        : buildOriginalInstallmentsFromPaymentTerms({
            paymentTerms: input.paymentTerms,
            paymentMethod: input.paymentMethod,
            issueDate: input.issueDate,
            totalActiveValue: input.totalActiveValue,
            nomusRawResponse: input.nomusRawResponse,
            nfeNumbers: input.nfeNumbers,
            referenceDate,
          }),
    realReceivables: input.receivables.map((r) => ({
      externalId: r.receivableExternalId,
      sourceInvoiceId: r.sourceInvoiceId,
      dueDate: r.dueDate,
      amountReceivable: String(r.amountReceivable ?? 0),
      amountReceived: String(r.amountReceived ?? 0),
      balanceReceivable: String(r.balanceReceivable ?? 0),
    })),
    documents: buildDocumentInputs(input.stockDocuments),
    referenceDate,
  };

  const schedule = buildSalesOrderEffectiveFinancialSchedule(scheduleInput);
  const financial = mapEffectiveScheduleToDetailFinancial(
    schedule,
    input.receivables,
    [],
    {
      totalAmount: round2(
        input.receivables.reduce((s, r) => s + (r.amountReceivable ?? 0), 0)
      ),
      openAmount: round2(
        input.receivables.reduce((s, r) => s + (r.balanceReceivable ?? 0), 0)
      ),
      receivedAmount: round2(
        input.receivables.reduce((s, r) => s + (r.amountReceived ?? 0), 0)
      ),
      overdueCount: 0,
      nextDueDate: null,
      maxAmount: 0,
      totalCount: input.receivables.length,
    },
    referenceDate
  );

  // Auditoria 360°: residual ativo + substituídas (histórico) — sem somar nas alertas de vencido.
  const plannedReceivables = [
    ...financial.plannedReceivables,
    ...financial.supersededPlannedReceivables,
  ];

  const plannedReceivablesTotal: OrderFullAuditPlannedReceivablesTotal = {
    totalCount: plannedReceivables.length,
    totalExpected: financial.plannedTotals.totalExpected,
    applicableExpected: financial.plannedTotals.applicableExpected,
    openExpected: financial.plannedTotals.openExpected,
    overdueExpected: financial.plannedTotals.overdueExpected,
    overdueCount: financial.plannedTotals.overdueCount,
    dueTodayExpected: 0,
    dueTodayCount: 0,
    upcomingCount: financial.plannedReceivables.filter(
      (p) => p.statusLabel === "A vencer" || p.statusLabel === "Vence hoje"
    ).length,
    nextDueDate: financial.plannedTotals.nextDueDate,
    replacedCount: financial.plannedTotals.replacedCount,
    replacedAmount: financial.plannedTotals.replacedAmount,
    netPlannedOpen: financial.plannedTotals.openExpected,
    coveredByRealReceivables: financial.plannedTotals.coveredByRealReceivables,
    coveredByDocumentsWithoutRealReceivable:
      financial.plannedTotals.coveredByDocumentsWithoutRealReceivable,
    remainingPlannedValue: financial.plannedTotals.remainingPlannedValue,
    fullySuperseded: financial.plannedTotals.fullySuperseded,
    partiallySuperseded: financial.plannedTotals.partiallySuperseded,
    precedenceSource: financial.plannedTotals.precedenceSource,
  };

  return {
    plannedReceivables,
    plannedReceivablesTotal,
    schedule,
    effectiveAlerts: schedule.alerts,
    source: "salesOrderEffectiveFinancialSchedule (FIN-05)",
  };
}

/** Códigos de alerta FIN-05 → contrato da Auditoria 360° / Detalhe. */
export type EffectiveScheduleConsumerAlert = {
  code: string;
  severity: "info" | "warning" | "critical" | "error";
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
  installmentNumber?: number;
  documentKey?: string;
  salesOrderItemId?: string;
};

/**
 * Materializa alertas financeiros a partir da agenda efetiva (regras FIN-02/FIN-09).
 * - Previsão substituída: não gera alerta de vencimento
 * - Corte: não gera alerta financeiro de aberto/vencido
 * - Residual vencido: alerta
 * - Documento aguardando: alerta de materialização
 * - UNKNOWN: alerta de classificação
 */
export function buildEffectiveScheduleConsumerAlerts(input: {
  schedule: SalesOrderEffectiveFinancialSchedule;
  plannedReceivables: OrderFullAuditPlannedReceivable[];
}): EffectiveScheduleConsumerAlert[] {
  const alerts: EffectiveScheduleConsumerAlert[] = [];
  const activeResidual = input.plannedReceivables.filter(
    (p) => !p.replacedByRealCr && p.entryKind === "RESIDUAL_ORDER_PLAN"
  );

  for (const planned of activeResidual) {
    const dueLabel = planned.dueDate ?? "sem vencimento";
    if (planned.statusLabel === "Vencido") {
      alerts.push({
        code: "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
        severity: "critical",
        title: "Previsão residual vencida sem cobertura",
        description: `${planned.reference} venceu em ${dueLabel} sem cobertura vigente (${formatMoneyShort(planned.openAmount)}).`,
        origin: "Agenda efetiva FIN-05 / residual do Pedido",
        action:
          "Confirmar emissão da NF e sync do Contas a Receber para regularizar o CR real.",
        financialImpact: round2(planned.openAmount),
        installmentNumber: planned.installmentNumber,
      });
    } else if (planned.openAmount > 0.009) {
      alerts.push({
        code: "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
        severity: "warning",
        title: "Pedido com previsão residual sem CR",
        description: `${planned.reference} previsto para ${dueLabel} — residual ativo sem CR (${formatMoneyShort(
          planned.openAmount
        )}).`,
        origin: "Agenda efetiva FIN-05 / residual do Pedido",
        action:
          "Emitir NF-e ou aguardar sincronismo do Contas a Receber para gerar CR real.",
        financialImpact: round2(planned.openAmount),
        installmentNumber: planned.installmentNumber,
      });
    }
  }

  const replaced = input.plannedReceivables.filter((p) => p.replacedByRealCr);
  if (replaced.length > 0) {
    alerts.push({
      code: "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
      severity: "info",
      title: "Previsão do Pedido substituída por evidência superior",
      description: `${replaced.length} parcela(s) da previsão original foram substituídas por CR/Documento (agenda efetiva FIN-05).`,
      origin: "Agenda efetiva FIN-05",
      action: "Nenhuma ação — CR/Documento prevalecem; previsão substituída não gera cobrança.",
      financialImpact: null,
    });
  }

  // Divergência de vencimento: CR real vs data original da parcela substituída.
  const originalDueDates = new Set(
    replaced.map((p) => p.dueDate).filter((d): d is string => Boolean(d))
  );
  const crDueDates = input.schedule.realReceivables
    .map((cr) => cr.dueDate)
    .filter((d): d is string => Boolean(d));
  const divergentCrDue = crDueDates.find((d) => !originalDueDates.has(d));
  if (divergentCrDue && originalDueDates.size > 0) {
    const sampleOriginal = [...originalDueDates][0]!;
    alerts.push({
      code: "PLANNED_VS_CR_DUE_DATE_DIVERGENCE",
      severity: "info",
      title: "Divergência de vencimento (previsão × CR)",
      description: `Previsão original (${sampleOriginal}) difere do CR vigente (${divergentCrDue}). Prevalece o vencimento do CR.`,
      origin: "Agenda efetiva FIN-05",
      action: "Usar vencimento do CR real para cobrança e fluxo.",
      financialImpact: null,
    });
  }

  for (const a of input.schedule.alerts) {
    if (a.code === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") {
      alerts.push({
        code: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE",
        severity: "warning",
        title: "Documento aguardando agenda/CR",
        description: a.message,
        origin: "Agenda efetiva FIN-05 / Documento de Saída",
        action:
          "Aguardar materialização do Contas a Receber ou condição documental comprovada — não usar datas do Pedido na parte coberta.",
        financialImpact: null,
        documentKey: a.documentKey,
      });
    }
    if (a.code === "ITEM_CLASSIFICATION_PENDING") {
      alerts.push({
        code: "ITEM_CLASSIFICATION_PENDING",
        severity: "warning",
        title: "Classificação financeira de item pendente",
        description: a.message,
        origin: "Agenda efetiva FIN-05 / status UNKNOWN",
        action:
          "Revisar status Nomus do item — residual provisório preservado; não zerar silenciosamente.",
        financialImpact: null,
        salesOrderItemId: a.salesOrderItemId,
      });
    }
    // ORDER_RESIDUAL_OVERDUE já coberto pelas linhas residual com status Vencido.
  }

  // Corte: nunca vira alerta de aberto/vencido financeiro (política FIN-02).
  // (ORDER_ITEM_CUT permanece informativo no buildAlerts de itens.)

  return alerts;
}

function formatMoneyShort(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
