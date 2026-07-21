/**
 * FIN-05 — Motor único da agenda financeira efetiva do Pedido (puro).
 *
 * Precedência: CR real > condição comprovada do Documento > previsão residual do Pedido.
 * Política: `docs/finance/effective-schedule-policy.md` (FIN-02).
 * Itens: classificador FIN-03 + valores FIN-04.
 *
 * Sem I/O. Sem integração a telas.
 */

import { Prisma } from "@prisma/client";
import {
  computeSalesOrderItemFinancialAmounts,
  type ComputeSalesOrderItemFinancialAmountsInput,
  type SalesOrderItemFinancialAmounts,
} from "./salesOrderItemFinancialAmounts.js";
import {
  buildStagedDeliveryBlocks,
  resolveEffectiveScheduleMaterializationMode,
  resolveResidualPartsForMaterializationMode,
  sortOriginalPositions,
  type EffectiveScheduleMaterializationMode,
  type StagedDeliveryBlock,
} from "./salesOrderStagedDeliverySchedule.js";

const ZERO = new Prisma.Decimal(0);
const MONEY_DP = 2;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;
/** Tolerância monetária canônica (centavos) — residual e fechamento. */
export const EFFECTIVE_SCHEDULE_MONEY_TOLERANCE = new Prisma.Decimal("0.01");

export type { EffectiveScheduleMaterializationMode };

export type EffectiveScheduleAlertCode =
  | "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE"
  | "ITEM_CLASSIFICATION_PENDING"
  | "ORDER_RESIDUAL_OVERDUE"
  | "ORDER_RESIDUAL_WITHOUT_INSTALLMENTS"
  | "STAGED_RESIDUAL_WITHOUT_OPEN_POSITION"
  | "STAGED_INCONCLUSIVE_RESIDUAL"
  | "REAL_AR_EXCEEDS_ACTIVE_ORDER_VALUE"
  | "ACTIVE_ORDER_VALUE_UNAVAILABLE"
  | "ORIGINAL_INSTALLMENT_SCHEDULE_UNAVAILABLE";

export type EffectiveScheduleAlert = {
  code: EffectiveScheduleAlertCode;
  severity: "info" | "warning" | "error";
  message: string;
  documentKey?: string;
  salesOrderItemId?: string;
  installmentNumber?: number;
};

export type EffectiveScheduleRealReceivable = {
  key: string;
  externalId: number;
  sourceInvoiceId: number | null;
  dueDate: string | null;
  amountReceivable: Prisma.Decimal;
  amountReceived: Prisma.Decimal;
  balanceReceivable: Prisma.Decimal;
};

export type EffectiveScheduleDocumentInstallment = {
  installmentNumber: number;
  dueDate: string | null;
  amount: Prisma.Decimal;
};

/** Agenda documental ativa (com parcelas comprovadas) ou aguardando agenda/CR. */
export type EffectiveScheduleDocumentEntry =
  | {
      kind: "DOCUMENT_SCHEDULE";
      documentKey: string;
      sourceInvoiceId: number | null;
      allocatedByOrderPrice: Prisma.Decimal;
      installments: EffectiveScheduleDocumentInstallment[];
    }
  | {
      kind: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE";
      documentKey: string;
      sourceInvoiceId: number | null;
      allocatedByOrderPrice: Prisma.Decimal;
      /** Explicitamente sem datas do Pedido. */
      dueDate: null;
      installments: [];
    };

export type EffectiveScheduleOrderInstallment = {
  installmentNumber: number;
  /** Data original da condição do Pedido (preservada no residual). */
  dueDate: string | null;
  originalAmount: Prisma.Decimal;
  residualAmount: Prisma.Decimal;
  entryKind: "ACTIVE_ORDER_PLAN" | "SUPERSEDED_ORDER_PLAN";
};

export type EffectiveScheduleCoverageSummary = {
  plannedNetTotal: Prisma.Decimal;
  itemActiveResidualTotal: Prisma.Decimal;
  coveredByRealReceivables: Prisma.Decimal;
  coveredByDocumentsWithoutCr: Prisma.Decimal;
  documentAwaitingAmount: Prisma.Decimal;
  activeOrderResidualTotal: Prisma.Decimal;
  supersededOrderTotal: Prisma.Decimal;
  cutAmount: Prisma.Decimal;
  canceledAmount: Prisma.Decimal;
  unresolvedAmount: Prisma.Decimal;
  /** Residual ativo sem posição aberta após staged (FIN-13). */
  stagedResidualWithoutPosition: Prisma.Decimal;
  materializationMode: EffectiveScheduleMaterializationMode;
  precedenceSource:
    | "REAL_RECEIVABLE"
    | "OUTPUT_DOCUMENT"
    | "ORDER_PLAN"
    | "MIXED"
    | "NONE";
};

export type SalesOrderEffectiveFinancialSchedule = {
  salesOrderId: string;
  orderCode: string;
  realReceivables: EffectiveScheduleRealReceivable[];
  documentSchedule: EffectiveScheduleDocumentEntry[];
  activeOrderResidualSchedule: EffectiveScheduleOrderInstallment[];
  supersededOrderSchedule: EffectiveScheduleOrderInstallment[];
  cutAmount: Prisma.Decimal;
  canceledAmount: Prisma.Decimal;
  unresolvedAmount: Prisma.Decimal;
  coverageSummary: EffectiveScheduleCoverageSummary;
  alerts: EffectiveScheduleAlert[];
  itemAmounts: SalesOrderItemFinancialAmounts[];
  /** Blocos de entrega usados na ocupação de posições (FIN-13). */
  stagedDeliveryBlocks: StagedDeliveryBlock[];
  occupiedPositionIndexes: number[];
};

export type EffectiveScheduleOriginalInstallmentInput = {
  installmentNumber: number;
  dueDate: string | null;
  amount: Prisma.Decimal | string;
};

export type EffectiveScheduleRealReceivableInput = {
  externalId: number;
  sourceInvoiceId?: number | null;
  dueDate?: string | null;
  amountReceivable: Prisma.Decimal | string;
  amountReceived?: Prisma.Decimal | string | null;
  balanceReceivable?: Prisma.Decimal | string | null;
};

export type EffectiveScheduleDocumentInput = {
  documentKey: string;
  sourceInvoiceId?: number | null;
  isValid?: boolean;
  allocatedByOrderPrice: Prisma.Decimal | string;
  /** Data oficial do Documento de Saída (ordenação staged FIN-13). */
  documentDate?: string | null;
  /** Data de emissão/processamento (desempate staged). */
  issuedAt?: string | null;
  /**
   * Parcelas comprovadas localmente no Documento.
   * Vazio/ausente → DOCUMENT_AWAITING_FINANCIAL_SCHEDULE (sem datas do Pedido).
   */
  provenInstallments?: readonly EffectiveScheduleOriginalInstallmentInput[] | null;
};

export type BuildSalesOrderEffectiveFinancialScheduleInput = {
  salesOrderId: string;
  orderCode: string;
  items: readonly ComputeSalesOrderItemFinancialAmountsInput[];
  /** Parcelas originais da condição do Pedido (ordem e datas oficiais). */
  originalInstallments: readonly EffectiveScheduleOriginalInstallmentInput[];
  realReceivables?: readonly EffectiveScheduleRealReceivableInput[];
  documents?: readonly EffectiveScheduleDocumentInput[];
  referenceDate?: Date;
  /**
   * Agenda manual explícita do saldo (FIN-13).
   * Somente quando houver evidência tipada — nunca inferida por updatedAt.
   */
  manualResidualSchedule?: readonly EffectiveScheduleOriginalInstallmentInput[] | null;
};

function money(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (value == null || value === "") return ZERO;
  if (value instanceof Prisma.Decimal) {
    if (value.isNaN() || !value.isFinite()) return ZERO;
    return value.toDecimalPlaces(MONEY_DP, ROUND);
  }
  try {
    const d = new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite()) return ZERO;
    return d.toDecimalPlaces(MONEY_DP, ROUND);
  } catch {
    return ZERO;
  }
}

function maxMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.gte(b) ? a : b;
}

function minMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lte(b) ? a : b;
}

/** Residual ≤ tolerância de centavos → zero (nunca negativo / -0,00). */
function clampResidualToTolerance(value: Prisma.Decimal): Prisma.Decimal {
  if (value.lte(EFFECTIVE_SCHEDULE_MONEY_TOLERANCE)) return ZERO;
  return value.toDecimalPlaces(MONEY_DP, ROUND);
}

function residualNeedsLastInstallment(
  activeOrderValue: Prisma.Decimal,
  coveredByDefinitiveCr: Prisma.Decimal
): boolean {
  return clampResidualToTolerance(
    maxMoney(ZERO, activeOrderValue.sub(coveredByDefinitiveCr))
  ).gt(0);
}

/** OP-05: concentra o residual na última parcela original. */
function allocateResidualToLastOriginalInstallment(
  positionCount: number,
  residualTotal: Prisma.Decimal
): Prisma.Decimal[] {
  const parts = Array.from({ length: positionCount }, () => ZERO);
  if (positionCount <= 0 || residualTotal.lte(0)) return parts;
  parts[positionCount - 1] = residualTotal.toDecimalPlaces(MONEY_DP, ROUND);
  return parts;
}

/**
 * Distribui residual nas parcelas originais por peso.
 * Mantém quantidade/ordem; ajuste de centavos na última parcela; soma exata.
 */
export function allocateResidualToOriginalInstallments(
  originalAmounts: readonly Prisma.Decimal[],
  residualTotal: Prisma.Decimal | string
): Prisma.Decimal[] {
  const residual = money(residualTotal);
  if (originalAmounts.length === 0) return [];
  if (residual.lte(0)) return originalAmounts.map(() => ZERO);

  const weights = originalAmounts.map((a) => maxMoney(ZERO, money(a)));
  const weightSum = weights.reduce((s, w) => s.add(w), ZERO);
  if (weightSum.lte(0)) {
    const out = originalAmounts.map(() => ZERO);
    out[out.length - 1] = residual;
    return out;
  }

  const scaled: Prisma.Decimal[] = [];
  let allocated = ZERO;
  for (let i = 0; i < weights.length; i += 1) {
    const isLast = i === weights.length - 1;
    if (isLast) {
      scaled.push(residual.sub(allocated).toDecimalPlaces(MONEY_DP, ROUND));
    } else {
      const part = residual
        .mul(weights[i]!)
        .div(weightSum)
        .toDecimalPlaces(MONEY_DP, ROUND);
      scaled.push(part);
      allocated = allocated.add(part);
    }
  }
  return scaled;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isOverdue(dueDateIso: string | null, referenceDate: Date): boolean {
  if (!dueDateIso) return false;
  const due = new Date(dueDateIso);
  if (Number.isNaN(due.getTime())) return false;
  return startOfLocalDay(due).getTime() < startOfLocalDay(referenceDate).getTime();
}

function dedupeRealReceivables(
  rows: readonly EffectiveScheduleRealReceivableInput[]
): EffectiveScheduleRealReceivable[] {
  const seen = new Set<number>();
  const out: EffectiveScheduleRealReceivable[] = [];
  for (const row of rows) {
    if (seen.has(row.externalId)) continue;
    seen.add(row.externalId);
    out.push({
      key: `cr:${row.externalId}`,
      externalId: row.externalId,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      dueDate: row.dueDate ?? null,
      amountReceivable: money(row.amountReceivable),
      amountReceived: money(row.amountReceived ?? 0),
      balanceReceivable: money(
        row.balanceReceivable ??
          money(row.amountReceivable).sub(money(row.amountReceived ?? 0))
      ),
    });
  }
  return out;
}

function resolvePrecedenceSource(input: {
  cr: Prisma.Decimal;
  docWithoutCr: Prisma.Decimal;
  orderResidual: Prisma.Decimal;
}): EffectiveScheduleCoverageSummary["precedenceSource"] {
  const hasCr = input.cr.gt(0);
  const hasDoc = input.docWithoutCr.gt(0);
  const hasOrder = input.orderResidual.gt(0);
  const layers = [hasCr, hasDoc, hasOrder].filter(Boolean).length;
  if (layers >= 2) return "MIXED";
  if (hasCr) return "REAL_RECEIVABLE";
  if (hasDoc) return "OUTPUT_DOCUMENT";
  if (hasOrder) return "ORDER_PLAN";
  return "NONE";
}

/**
 * Monta a agenda financeira efetiva do Pedido.
 */
export function buildSalesOrderEffectiveFinancialSchedule(
  input: BuildSalesOrderEffectiveFinancialScheduleInput
): SalesOrderEffectiveFinancialSchedule {
  const referenceDate = input.referenceDate ?? new Date();
  const alerts: EffectiveScheduleAlert[] = [];

  const itemAmounts = input.items.map((item) =>
    computeSalesOrderItemFinancialAmounts(item)
  );

  let plannedNetTotal = ZERO;
  let cutAmount = ZERO;
  let canceledAmount = ZERO;
  let unresolvedAmount = ZERO;
  let itemActiveResidualTotal = ZERO;

  for (const item of itemAmounts) {
    plannedNetTotal = plannedNetTotal.add(item.plannedNetValue);
    cutAmount = cutAmount.add(item.cutAmount);
    canceledAmount = canceledAmount.add(item.canceledAmount);
    unresolvedAmount = unresolvedAmount.add(item.unresolvedResidual);
    itemActiveResidualTotal = itemActiveResidualTotal.add(item.activeResidual);
    if (item.evidence.classificationPendingAlert) {
      alerts.push({
        code: "ITEM_CLASSIFICATION_PENDING",
        severity: "warning",
        message:
          "Status de item desconhecido — residual provisório em unresolvedAmount; classificação pendente.",
        salesOrderItemId: item.salesOrderItemId,
      });
    }
  }
  plannedNetTotal = plannedNetTotal.toDecimalPlaces(MONEY_DP, ROUND);
  cutAmount = cutAmount.toDecimalPlaces(MONEY_DP, ROUND);
  canceledAmount = canceledAmount.toDecimalPlaces(MONEY_DP, ROUND);
  unresolvedAmount = unresolvedAmount.toDecimalPlaces(MONEY_DP, ROUND);
  itemActiveResidualTotal = itemActiveResidualTotal.toDecimalPlaces(MONEY_DP, ROUND);

  const realReceivables = dedupeRealReceivables(input.realReceivables ?? []);
  const coveredByRealReceivables = realReceivables
    .reduce((s, r) => s.add(r.amountReceivable), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);

  const invoiceIdsWithCr = new Set(
    realReceivables
      .map((r) => r.sourceInvoiceId)
      .filter((id): id is number => id != null)
  );

  const documentSchedule: EffectiveScheduleDocumentEntry[] = [];
  let coveredByDocumentsWithoutCr = ZERO;
  let documentAwaitingAmount = ZERO;

  for (const doc of input.documents ?? []) {
    if (doc.isValid === false) continue;
    const allocated = money(doc.allocatedByOrderPrice);
    if (allocated.lte(0)) continue;

    const invoiceId = doc.sourceInvoiceId ?? null;

    // CR da mesma NF substitui o Documento — não duplicar.
    if (invoiceId != null && invoiceIdsWithCr.has(invoiceId)) {
      continue;
    }

    const proven = (doc.provenInstallments ?? []).filter((p) => money(p.amount).gt(0));
    if (proven.length > 0) {
      documentSchedule.push({
        kind: "DOCUMENT_SCHEDULE",
        documentKey: doc.documentKey,
        sourceInvoiceId: invoiceId,
        allocatedByOrderPrice: allocated,
        installments: proven.map((p, idx) => ({
          installmentNumber: p.installmentNumber || idx + 1,
          dueDate: p.dueDate,
          amount: money(p.amount),
        })),
      });
      coveredByDocumentsWithoutCr = coveredByDocumentsWithoutCr.add(allocated);
    } else {
      documentSchedule.push({
        kind: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE",
        documentKey: doc.documentKey,
        sourceInvoiceId: invoiceId,
        allocatedByOrderPrice: allocated,
        dueDate: null,
        installments: [],
      });
      documentAwaitingAmount = documentAwaitingAmount.add(allocated);
      coveredByDocumentsWithoutCr = coveredByDocumentsWithoutCr.add(allocated);
      alerts.push({
        code: "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE",
        severity: "warning",
        message:
          "Documento cobre parte do pedido sem condição documental comprovada — aguardando agenda/CR; datas do Pedido não são reutilizadas na parte coberta.",
        documentKey: doc.documentKey,
      });
    }
  }
  coveredByDocumentsWithoutCr = coveredByDocumentsWithoutCr.toDecimalPlaces(
    MONEY_DP,
    ROUND
  );
  documentAwaitingAmount = documentAwaitingAmount.toDecimalPlaces(MONEY_DP, ROUND);

  const original = sortOriginalPositions(input.originalInstallments);

  const originalAmounts = original.map((l) => l.originalAmount);
  const originalSum = originalAmounts
    .reduce((s, a) => s.add(a), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);

  // CR definitivo = vínculo estrutural com NF (sourceInvoiceId).
  // Pré-NF (sem NF) não entra nesta cobertura — preserva PD 02740.
  const definitiveReceivables = realReceivables.filter(
    (r) => r.sourceInvoiceId != null
  );
  const hasDefinitiveCr = definitiveReceivables.length > 0;
  const coveredByDefinitiveCr = definitiveReceivables
    .reduce((s, r) => s.add(r.amountReceivable), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);

  // Valor ativo do pedido (mesma base: planejado − corte − cancelado).
  const activeOrderValue = maxMoney(
    ZERO,
    plannedNetTotal.sub(cutAmount).sub(canceledAmount)
  ).toDecimalPlaces(MONEY_DP, ROUND);

  const itemDocCoverageTotal = itemAmounts
    .reduce((s, item) => s.add(item.coveredByValidDocuments), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);
  const hasDocumentCoverage =
    itemDocCoverageTotal.gt(0) ||
    (input.documents ?? []).some(
      (d) => d.isValid !== false && money(d.allocatedByOrderPrice).gt(0)
    );

  const stagedDeliveryBlocks = buildStagedDeliveryBlocks({
    documents: input.documents,
    realReceivables: input.realReceivables,
  });

  const hasExplicitManual =
    (input.manualResidualSchedule?.filter((l) => money(l.amount).gt(0)).length ??
      0) > 0;

  let residualToSchedule: Prisma.Decimal;
  let materializationMode: EffectiveScheduleMaterializationMode;
  let residualParts: Prisma.Decimal[];
  let occupiedPositionIndexes: number[];
  let stagedResidualWithoutPosition = ZERO;

  if (hasDefinitiveCr) {
    // OP-05 / FIN-02 §CR definitivo:
    // residual = valor ativo − cobertura nominal dos CRs com NF − docs sem CR.
    // Uma única linha na última parcela original (não várias previsões intermediárias).
    if (input.items.length === 0 && plannedNetTotal.eq(0)) {
      alerts.push({
        code: "ACTIVE_ORDER_VALUE_UNAVAILABLE",
        severity: "warning",
        message:
          "Valor ativo do pedido indisponível — residual não inventado; CRs reais mantidos.",
      });
    }
    if (
      residualNeedsLastInstallment(activeOrderValue, coveredByDefinitiveCr) &&
      original.length === 0
    ) {
      alerts.push({
        code: "ORIGINAL_INSTALLMENT_SCHEDULE_UNAVAILABLE",
        severity: "warning",
        message:
          "Há residual após CR definitivo sem parcelas originais do Pedido para âncora.",
      });
    }
    if (
      coveredByDefinitiveCr.gt(
        activeOrderValue.add(EFFECTIVE_SCHEDULE_MONEY_TOLERANCE)
      )
    ) {
      alerts.push({
        code: "REAL_AR_EXCEEDS_ACTIVE_ORDER_VALUE",
        severity: "warning",
        message:
          "Cobertura nominal dos CRs definitivos excede o valor ativo do pedido — CRs mantidos; residual não negativo.",
      });
    }

    residualToSchedule = clampResidualToTolerance(
      maxMoney(
        ZERO,
        activeOrderValue
          .sub(coveredByDefinitiveCr)
          .sub(coveredByDocumentsWithoutCr)
      ).toDecimalPlaces(MONEY_DP, ROUND)
    );

    if (original.length === 0) {
      residualParts = [];
      occupiedPositionIndexes = [];
      stagedResidualWithoutPosition = residualToSchedule;
      materializationMode =
        residualToSchedule.gt(0) ? "INCONCLUSIVE" : "FULL_SUBSTITUTION";
    } else if (hasExplicitManual && input.manualResidualSchedule) {
      // Agenda manual explícita ainda prevalece sobre redistribuição automática.
      const byNumber = new Map(
        sortOriginalPositions(input.manualResidualSchedule).map((p) => [
          p.installmentNumber,
          p.originalAmount,
        ])
      );
      residualParts = original.map((p) => byNumber.get(p.installmentNumber) ?? ZERO);
      occupiedPositionIndexes = residualParts
        .map((amount, i) => (amount.lte(0) ? i : -1))
        .filter((i) => i >= 0);
      // Se manual não cobre posições com residual zero no início, marca ocupadas as zeradas.
      if (occupiedPositionIndexes.length === 0 && residualToSchedule.gt(0)) {
        occupiedPositionIndexes = residualParts
          .map((amount, i) => (amount.lte(0) ? i : -1))
          .filter((i) => i >= 0);
      }
      materializationMode = "STAGED_MANUAL";
    } else {
      residualParts = allocateResidualToLastOriginalInstallment(
        original.length,
        residualToSchedule
      );
      occupiedPositionIndexes =
        residualToSchedule.gt(0) && original.length > 1
          ? Array.from({ length: original.length - 1 }, (_, i) => i)
          : residualToSchedule.lte(0)
            ? Array.from({ length: original.length }, (_, i) => i)
            : [];
      materializationMode =
        residualToSchedule.gt(0) ? "PROPORTIONAL_FALLBACK" : "FULL_SUBSTITUTION";
    }
  } else {
    // Sem CR definitivo: FIN-04 + FIN-13 (pré-NF / só Documento / só previsão).
    // Com Documento, não abater CR pré-NF de novo. Sem Documento, CR pré-NF cobre.
    const crOnlyCoverage = !hasDocumentCoverage
      ? coveredByRealReceivables
      : ZERO;

    residualToSchedule = clampResidualToTolerance(
      maxMoney(ZERO, itemActiveResidualTotal.sub(crOnlyCoverage)).toDecimalPlaces(
        MONEY_DP,
        ROUND
      )
    );

    materializationMode = resolveEffectiveScheduleMaterializationMode({
      itemAmounts,
      deliveryBlockCount: stagedDeliveryBlocks.length,
      originalPositionCount: original.length,
      itemActiveResidualTotal: residualToSchedule,
      cutAmount,
      canceledAmount,
      unresolvedAmount,
      hasExplicitManualResidualSchedule: hasExplicitManual,
    });

    const manualResidualParts =
      hasExplicitManual && input.manualResidualSchedule
        ? (() => {
            const byNumber = new Map(
              sortOriginalPositions(input.manualResidualSchedule!).map((p) => [
                p.installmentNumber,
                p.originalAmount,
              ])
            );
            return original.map((p) => byNumber.get(p.installmentNumber) ?? ZERO);
          })()
        : null;

    const stagedAllocation = resolveResidualPartsForMaterializationMode({
      mode: materializationMode,
      positions: original,
      deliveryBlocks: stagedDeliveryBlocks,
      residualTotal: residualToSchedule,
      proportionalAllocator: allocateResidualToOriginalInstallments,
      manualResidualParts,
    });

    residualParts = stagedAllocation.residualParts;
    stagedResidualWithoutPosition = stagedAllocation.stagedResidualWithoutPosition;
    occupiedPositionIndexes = stagedAllocation.occupiedPositionIndexes;
  }

  if (residualToSchedule.gt(0) && original.length === 0) {
    alerts.push({
      code: "ORDER_RESIDUAL_WITHOUT_INSTALLMENTS",
      severity: "warning",
      message:
        "Há residual ativo de itens sem parcelas originais do Pedido para distribuir.",
    });
    stagedResidualWithoutPosition = residualToSchedule;
  }

  if (materializationMode === "INCONCLUSIVE" && residualToSchedule.gt(0)) {
    alerts.push({
      code: "STAGED_INCONCLUSIVE_RESIDUAL",
      severity: "warning",
      message:
        "Residual inconclusivo (status de item desconhecido) — não tratado como corte nem zerado silenciosamente.",
    });
  }

  if (stagedResidualWithoutPosition.gt(0)) {
    alerts.push({
      code: "STAGED_RESIDUAL_WITHOUT_OPEN_POSITION",
      severity: "error",
      message:
        "Há saldo comercial ativo sem posição planejada aberta após entregas parciais — exige revisão manual das condições do saldo.",
    });
  }

  // Residual sem posição entra em unresolved (não inventa vencimento).
  unresolvedAmount = unresolvedAmount
    .add(stagedResidualWithoutPosition)
    .toDecimalPlaces(MONEY_DP, ROUND);

  const activeOrderResidualSchedule: EffectiveScheduleOrderInstallment[] = [];
  const supersededOrderSchedule: EffectiveScheduleOrderInstallment[] = [];

  for (let i = 0; i < original.length; i += 1) {
    const line = original[i]!;
    const residualAmount = residualParts[i] ?? ZERO;
    if (residualAmount.gt(0)) {
      activeOrderResidualSchedule.push({
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        originalAmount: line.originalAmount,
        residualAmount,
        entryKind: "ACTIVE_ORDER_PLAN",
      });
      if (isOverdue(line.dueDate, referenceDate)) {
        alerts.push({
          code: "ORDER_RESIDUAL_OVERDUE",
          severity: "warning",
          message: "Parcela residual do Pedido vencida sem cobertura CR/Documento.",
          installmentNumber: line.installmentNumber,
        });
      }
    }

    const occupied = occupiedPositionIndexes.includes(i);
    const supersededAmount = maxMoney(
      ZERO,
      line.originalAmount.sub(residualAmount)
    ).toDecimalPlaces(MONEY_DP, ROUND);
    if (supersededAmount.gt(0) || occupied) {
      supersededOrderSchedule.push({
        installmentNumber: line.installmentNumber,
        dueDate: line.dueDate,
        originalAmount: line.originalAmount,
        residualAmount: ZERO,
        entryKind: "SUPERSEDED_ORDER_PLAN",
      });
    }
  }

  const activeOrderResidualTotal = activeOrderResidualSchedule
    .reduce((s, l) => s.add(l.residualAmount), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);

  // Guarda: residual colocado + sem posição = pool (centavos exatos).
  const placedPlusOrphan = activeOrderResidualTotal.add(stagedResidualWithoutPosition);
  if (!placedPlusOrphan.eq(residualToSchedule) && original.length > 0) {
    const drift = residualToSchedule.sub(placedPlusOrphan);
    if (!drift.eq(0) && activeOrderResidualSchedule.length > 0) {
      const last = activeOrderResidualSchedule[activeOrderResidualSchedule.length - 1]!;
      last.residualAmount = last.residualAmount.add(drift).toDecimalPlaces(MONEY_DP, ROUND);
    }
  }

  const finalActiveTotal = activeOrderResidualSchedule
    .reduce((s, l) => s.add(l.residualAmount), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);

  const supersededOrderTotal = maxMoney(
    ZERO,
    originalSum.sub(finalActiveTotal)
  ).toDecimalPlaces(MONEY_DP, ROUND);

  const coverageSummary: EffectiveScheduleCoverageSummary = {
    plannedNetTotal,
    itemActiveResidualTotal,
    coveredByRealReceivables: hasDefinitiveCr
      ? coveredByDefinitiveCr
      : coveredByRealReceivables,
    coveredByDocumentsWithoutCr,
    documentAwaitingAmount,
    activeOrderResidualTotal: finalActiveTotal,
    supersededOrderTotal,
    cutAmount,
    canceledAmount,
    unresolvedAmount,
    stagedResidualWithoutPosition,
    materializationMode,
    precedenceSource: resolvePrecedenceSource({
      cr: hasDefinitiveCr ? coveredByDefinitiveCr : coveredByRealReceivables,
      docWithoutCr: coveredByDocumentsWithoutCr,
      orderResidual: finalActiveTotal.add(unresolvedAmount),
    }),
  };

  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    realReceivables,
    documentSchedule,
    activeOrderResidualSchedule,
    supersededOrderSchedule,
    cutAmount,
    canceledAmount,
    unresolvedAmount,
    coverageSummary,
    alerts,
    itemAmounts,
    stagedDeliveryBlocks,
    occupiedPositionIndexes,
  };
}

/** Soma Decimal das parcelas residuais ativas (helper de teste/QA). */
export function sumActiveOrderResidual(
  schedule: readonly EffectiveScheduleOrderInstallment[]
): Prisma.Decimal {
  return schedule
    .reduce((s, l) => s.add(l.residualAmount), ZERO)
    .toDecimalPlaces(MONEY_DP, ROUND);
}
