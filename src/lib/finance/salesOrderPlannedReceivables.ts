/**
 * Recebíveis planejados (forecast) do Pedido de Venda.
 *
 * Motor único de previsão para telas oficiais (Fluxo de Caixa, Auditoria 360º,
 * Detalhe do Pedido). Reutiliza `resolveSalesOrderListPaymentSummary`.
 *
 * Precedência operacional (cobertura por valor, sem dupla contagem):
 *   CR real ≥ Documento de Saída válido ≥ previsão do Pedido.
 *
 * A previsão só permanece ativa no saldo não coberto. Parcelas originais
 * substituídas ficam no payload para auditoria (`replacedByRealCr`), sem
 * status operacional "Vencido".
 *
 * Frontend-safe: não importa Prisma.
 */
import {
  resolveSalesOrderListPaymentSummary,
  SALES_ORDER_PAYMENT_SOURCE_AR,
  SALES_ORDER_PAYMENT_SOURCE_FORECAST,
  SALES_ORDER_PAYMENT_NOT_INFORMED,
  type SalesOrderListPaymentLine,
  type SalesOrderListReceivableInput,
} from "../salesOrderListPaymentSchedule.js";
import { roundOrderMoney } from "../sales/orderFiscalFinancialMetrics.js";

export type SalesOrderPlannedStatusLabel =
  | "A vencer"
  | "Vence hoje"
  | "Vencido"
  | "Não informado"
  | "Substituída"
  | "Parcialmente substituída";

export type SalesOrderPlannedSupersessionSource =
  | "REAL_RECEIVABLE"
  | "OUTPUT_DOCUMENT"
  | "VALUE_COVERAGE"
  | null;

/** Uma parcela planejada — espelha o layout esperado pela aba Financeiro. */
export type SalesOrderPlannedReceivable = {
  key: string;
  orderCode: string;
  salesOrderId: string;
  installmentNumber: number;
  totalInstallments: number;
  reference: string;
  dueDate: string | null;
  /** Valor original da condição do pedido (sempre preservado). */
  originalExpectedAmount: number;
  /** Valor operacional da linha (residual ativo ou original se intacta/substituída). */
  expectedAmount: number;
  openAmount: number;
  statusLabel: SalesOrderPlannedStatusLabel;
  paymentConditionLabel: string;
  paymentMethodLabel: string | null;
  origin: string;
  note: string;
  /**
   * true = não compõe agenda operacional (total aberto / vencido / alertas).
   * Mantém o nome histórico por compatibilidade com consumidores.
   */
  replacedByRealCr: boolean;
  replacedByReceivableExternalId: number | null;
  replacedBySource: SalesOrderPlannedSupersessionSource;
  /** ACTIVE_ORDER_PLAN | SUPERSEDED_ORDER_PLAN | RESIDUAL_ORDER_PLAN */
  entryKind: "ACTIVE_ORDER_PLAN" | "SUPERSEDED_ORDER_PLAN" | "RESIDUAL_ORDER_PLAN";
};

export type SalesOrderPlannedReceivablesTotal = {
  totalCount: number;
  totalExpected: number;
  applicableExpected: number;
  openExpected: number;
  overdueExpected: number;
  overdueCount: number;
  dueTodayExpected: number;
  dueTodayCount: number;
  upcomingCount: number;
  nextDueDate: string | null;
  replacedCount: number;
  replacedAmount: number;
  netPlannedOpen: number;
  /** Cobertura agregada usada na precedência. */
  coveredByRealReceivables: number;
  coveredByDocumentsWithoutRealReceivable: number;
  remainingPlannedValue: number;
  fullySuperseded: boolean;
  partiallySuperseded: boolean;
  precedenceSource: "REAL_RECEIVABLE" | "OUTPUT_DOCUMENT" | "ORDER_PLAN" | "MIXED";
};

export type BuildSalesOrderPlannedReceivablesInput = {
  salesOrderId: string;
  orderCode: string;
  issueDate: Date;
  totalActiveValue: number;
  paymentTerms: string | null;
  paymentMethod: string | null;
  nomusRawResponse: unknown;
  realReceivables: SalesOrderListReceivableInput[];
  nfeDocuments?: string[];
  referenceDate?: Date;
  /**
   * Valor alocado ao pedido por Documentos de Saída válidos (não cancelados).
   * Usado só na proporção ainda não representada por CR real.
   */
  validDocumentAllocatedValue?: number;
};

export type SalesOrderFinancialCoverage = {
  orderActiveValue: number;
  coveredByRealReceivables: number;
  coveredByDocumentsWithoutRealReceivable: number;
  remainingPlannedValue: number;
  fullySuperseded: boolean;
  partiallySuperseded: boolean;
  precedenceSource: SalesOrderPlannedReceivablesTotal["precedenceSource"];
};

const MONEY_TOLERANCE = 0.01;

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function classifyPlannedStatus(
  dueDate: Date | null,
  referenceDate: Date
): Exclude<SalesOrderPlannedStatusLabel, "Substituída" | "Parcialmente substituída"> {
  if (!dueDate) return "Não informado";
  const due = startOfLocalDay(dueDate).getTime();
  const today = startOfLocalDay(referenceDate).getTime();
  if (due < today) return "Vencido";
  if (due === today) return "Vence hoje";
  return "A vencer";
}

function buildReferenceLabel(input: {
  orderCode: string;
  installmentNumber: number;
  totalInstallments: number;
}): string {
  const total = Math.max(1, input.totalInstallments);
  return `Pedido ${input.orderCode} - Parcela ${input.installmentNumber} de ${total}`;
}

function nearlyEqualAmount(a: number, b: number, tolerance = MONEY_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

function nearlyEqualDate(a: Date | null, b: Date | null, toleranceDays = 3): boolean {
  if (!a || !b) return false;
  const diffMs = Math.abs(startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime());
  return diffMs <= toleranceDays * 24 * 60 * 60 * 1000;
}

function findCoveringRealCr(
  planned: SalesOrderListPaymentLine,
  realReceivables: SalesOrderListReceivableInput[],
  consumedRealIds: Set<number>
): SalesOrderListReceivableInput | null {
  const expectedAmount = planned.amount;
  if (expectedAmount <= MONEY_TOLERANCE) return null;

  const strong = realReceivables.find(
    (real) =>
      !consumedRealIds.has(real.externalId) &&
      real.amountReceivable > MONEY_TOLERANCE &&
      nearlyEqualAmount(real.amountReceivable, expectedAmount) &&
      nearlyEqualDate(real.dueDate, planned.dueDate)
  );
  if (strong) return strong;

  const sameValueList = realReceivables
    .filter(
      (real) =>
        !consumedRealIds.has(real.externalId) &&
        real.amountReceivable > MONEY_TOLERANCE &&
        nearlyEqualAmount(real.amountReceivable, expectedAmount)
    )
    .sort((a, b) => {
      const da = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const target = planned.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return Math.abs(da - target) - Math.abs(db - target);
    });
  return sameValueList[0] ?? null;
}

/**
 * Cobertura financeira oficial do pedido (CR > Documento > Pedido).
 * Evita somar CR + Documento do mesmo faturamento.
 */
export function computeSalesOrderFinancialCoverage(input: {
  orderActiveValue: number;
  realReceivableTotal: number;
  validDocumentAllocatedValue?: number;
}): SalesOrderFinancialCoverage {
  const orderActiveValue = roundOrderMoney(Math.max(0, input.orderActiveValue));
  const coveredByRealReceivables = roundOrderMoney(
    Math.min(orderActiveValue, Math.max(0, input.realReceivableTotal))
  );
  const docAllocated = roundOrderMoney(
    Math.max(0, input.validDocumentAllocatedValue ?? 0)
  );
  // Documento só cobre o que o CR ainda não cobriu (max evita dupla contagem).
  const coveredByDominant = roundOrderMoney(
    Math.min(orderActiveValue, Math.max(coveredByRealReceivables, docAllocated))
  );
  const coveredByDocumentsWithoutRealReceivable = roundOrderMoney(
    Math.max(0, coveredByDominant - coveredByRealReceivables)
  );
  const remainingPlannedValue = roundOrderMoney(
    Math.max(0, orderActiveValue - coveredByDominant)
  );
  const fullySuperseded =
    orderActiveValue > MONEY_TOLERANCE && remainingPlannedValue <= MONEY_TOLERANCE;
  const partiallySuperseded =
    coveredByDominant > MONEY_TOLERANCE && remainingPlannedValue > MONEY_TOLERANCE;

  let precedenceSource: SalesOrderFinancialCoverage["precedenceSource"] = "ORDER_PLAN";
  if (coveredByRealReceivables > MONEY_TOLERANCE && coveredByDocumentsWithoutRealReceivable > MONEY_TOLERANCE) {
    precedenceSource = "MIXED";
  } else if (coveredByRealReceivables > MONEY_TOLERANCE) {
    precedenceSource = "REAL_RECEIVABLE";
  } else if (coveredByDocumentsWithoutRealReceivable > MONEY_TOLERANCE) {
    precedenceSource = "OUTPUT_DOCUMENT";
  }

  return {
    orderActiveValue,
    coveredByRealReceivables,
    coveredByDocumentsWithoutRealReceivable,
    remainingPlannedValue,
    fullySuperseded,
    partiallySuperseded,
    precedenceSource,
  };
}

/**
 * Distribui saldo residual nas parcelas originais (datas preservadas).
 * Arredondamento oficial + diferença de centavos na última parcela.
 */
export function allocateResidualPlannedAmounts(
  originalAmounts: readonly number[],
  residualTotal: number
): number[] {
  const residual = roundOrderMoney(Math.max(0, residualTotal));
  if (originalAmounts.length === 0) return [];
  if (residual <= MONEY_TOLERANCE) {
    return originalAmounts.map(() => 0);
  }
  const baseTotal = originalAmounts.reduce((s, n) => s + Math.max(0, n), 0);
  if (baseTotal <= MONEY_TOLERANCE) {
    // Sem base: concentra tudo na última.
    const out = originalAmounts.map(() => 0);
    out[out.length - 1] = residual;
    return out;
  }
  const scaled = originalAmounts.map((amount) =>
    roundOrderMoney((Math.max(0, amount) / baseTotal) * residual)
  );
  const sumScaled = roundOrderMoney(scaled.reduce((s, n) => s + n, 0));
  const diff = roundOrderMoney(residual - sumScaled);
  if (Math.abs(diff) >= 0.005) {
    scaled[scaled.length - 1] = roundOrderMoney(scaled[scaled.length - 1]! + diff);
  }
  return scaled;
}

/**
 * Constrói recebíveis planejados oficiais do Pedido de Venda.
 */
export function buildSalesOrderPlannedReceivables(
  input: BuildSalesOrderPlannedReceivablesInput
): {
  planned: SalesOrderPlannedReceivable[];
  totals: SalesOrderPlannedReceivablesTotal;
  source: string;
  coverage: SalesOrderFinancialCoverage;
} {
  const referenceDate = input.referenceDate ?? new Date();
  const orderActive = roundOrderMoney(Math.max(0, input.totalActiveValue));
  const realReceivableTotal = roundOrderMoney(
    input.realReceivables.reduce((s, r) => s + Math.max(0, r.amountReceivable), 0)
  );
  const coverage = computeSalesOrderFinancialCoverage({
    orderActiveValue: orderActive,
    realReceivableTotal,
    validDocumentAllocatedValue: input.validDocumentAllocatedValue,
  });

  const summary = resolveSalesOrderListPaymentSummary({
    paymentTerms: input.paymentTerms,
    paymentMethod: input.paymentMethod,
    issueDate: input.issueDate,
    totalNetValue: input.totalActiveValue,
    nomusRawResponse: input.nomusRawResponse,
    nfeDocuments: input.nfeDocuments ?? [],
    receivables: [],
    referenceDate,
  });

  const rawLines = summary.lines.filter((line) => line.amount > MONEY_TOLERANCE);

  if (rawLines.length === 0) {
    return {
      planned: [],
      totals: emptyTotals(coverage),
      source:
        input.realReceivables.length > 0
          ? SALES_ORDER_PAYMENT_SOURCE_AR
          : SALES_ORDER_PAYMENT_NOT_INFORMED,
      coverage,
    };
  }

  const totalInstallments = rawLines.length;
  const consumedRealIds = new Set<number>();
  const installmentMatched = new Map<number, SalesOrderListReceivableInput>();

  rawLines.forEach((line, index) => {
    const covering = findCoveringRealCr(line, input.realReceivables, consumedRealIds);
    if (covering) {
      consumedRealIds.add(covering.externalId);
      installmentMatched.set(index, covering);
    }
  });

  const originalAmounts = rawLines.map((l) => roundOrderMoney(l.amount));
  const originalSum = roundOrderMoney(originalAmounts.reduce((s, n) => s + n, 0));

  // Valor ainda coberto após matches parcela-a-parcela (cobertura agregada).
  const matchedAmount = roundOrderMoney(
    [...installmentMatched.keys()].reduce((s, idx) => s + (originalAmounts[idx] ?? 0), 0)
  );
  const dominantCoverage = roundOrderMoney(
    coverage.coveredByRealReceivables + coverage.coveredByDocumentsWithoutRealReceivable
  );
  const valueCoverageLeft = roundOrderMoney(
    Math.max(0, Math.min(originalSum, dominantCoverage) - matchedAmount)
  );

  const unmatchedIndexes = rawLines
    .map((_, idx) => idx)
    .filter((idx) => !installmentMatched.has(idx));
  const unmatchedOriginalSum = roundOrderMoney(
    unmatchedIndexes.reduce((s, idx) => s + (originalAmounts[idx] ?? 0), 0)
  );

  let residualForUnmatched = roundOrderMoney(
    Math.max(0, unmatchedOriginalSum - valueCoverageLeft)
  );
  // Se cobertura dominante zera o pedido, residual global prevalece.
  if (coverage.fullySuperseded) {
    residualForUnmatched = 0;
  } else if (coverage.partiallySuperseded) {
    // Residual operacional limitado ao saldo do pedido não coberto.
    residualForUnmatched = roundOrderMoney(
      Math.min(residualForUnmatched, coverage.remainingPlannedValue)
    );
  }

  const unmatchedOriginalAmounts = unmatchedIndexes.map((idx) => originalAmounts[idx] ?? 0);
  const residualAmounts = allocateResidualPlannedAmounts(
    unmatchedOriginalAmounts,
    residualForUnmatched
  );

  const planned: SalesOrderPlannedReceivable[] = [];
  const paymentConditionLabel = summary.paymentConditionLabel;
  const paymentMethodLabel = input.paymentMethod?.trim() || null;

  const supersessionSource = (): SalesOrderPlannedSupersessionSource => {
    if (coverage.coveredByRealReceivables > MONEY_TOLERANCE) return "REAL_RECEIVABLE";
    if (coverage.coveredByDocumentsWithoutRealReceivable > MONEY_TOLERANCE) {
      return "OUTPUT_DOCUMENT";
    }
    if (dominantCoverage > MONEY_TOLERANCE) return "VALUE_COVERAGE";
    return null;
  };

  rawLines.forEach((line, index) => {
    const installmentNumber = index + 1;
    const dueIso = toIso(line.dueDate);
    const originalAmount = originalAmounts[index] ?? roundOrderMoney(line.amount);
    const installmentCover = installmentMatched.get(index) ?? null;
    const reference = buildReferenceLabel({
      orderCode: input.orderCode,
      installmentNumber,
      totalInstallments,
    });
    const key = `${input.orderCode}:${installmentNumber}:${dueIso ?? "no-date"}:${originalAmount.toFixed(2)}`;

    if (installmentCover) {
      planned.push({
        key,
        orderCode: input.orderCode,
        salesOrderId: input.salesOrderId,
        installmentNumber,
        totalInstallments,
        reference,
        dueDate: dueIso,
        originalExpectedAmount: originalAmount,
        expectedAmount: originalAmount,
        openAmount: 0,
        statusLabel: "Substituída",
        paymentConditionLabel,
        paymentMethodLabel,
        origin: "Pedido de Venda / Condição de pagamento",
        note: "Substituído por CR real do Nomus (match parcela).",
        replacedByRealCr: true,
        replacedByReceivableExternalId: installmentCover.externalId,
        replacedBySource: "REAL_RECEIVABLE",
        entryKind: "SUPERSEDED_ORDER_PLAN",
      });
      return;
    }

    const unmatchedPos = unmatchedIndexes.indexOf(index);
    const residualAmount =
      unmatchedPos >= 0 ? residualAmounts[unmatchedPos] ?? 0 : originalAmount;
    const fullyReplaced =
      residualAmount <= MONEY_TOLERANCE &&
      (valueCoverageLeft > MONEY_TOLERANCE || coverage.fullySuperseded || dominantCoverage > MONEY_TOLERANCE);
    const partially =
      residualAmount > MONEY_TOLERANCE &&
      residualAmount + MONEY_TOLERANCE < originalAmount &&
      dominantCoverage > MONEY_TOLERANCE;

    if (fullyReplaced) {
      planned.push({
        key,
        orderCode: input.orderCode,
        salesOrderId: input.salesOrderId,
        installmentNumber,
        totalInstallments,
        reference,
        dueDate: dueIso,
        originalExpectedAmount: originalAmount,
        expectedAmount: originalAmount,
        openAmount: 0,
        statusLabel: "Substituída",
        paymentConditionLabel,
        paymentMethodLabel,
        origin: "Pedido de Venda / Condição de pagamento",
        note:
          coverage.coveredByRealReceivables > MONEY_TOLERANCE
            ? "Substituído por CR real (cobertura por valor do pedido)."
            : "Substituído por Documento de Saída válido (cobertura por valor).",
        replacedByRealCr: true,
        replacedByReceivableExternalId: null,
        replacedBySource: supersessionSource(),
        entryKind: "SUPERSEDED_ORDER_PLAN",
      });
      return;
    }

    if (partially) {
      // Histórico: linha original marcada como parcialmente substituída.
      planned.push({
        key: `${key}:original`,
        orderCode: input.orderCode,
        salesOrderId: input.salesOrderId,
        installmentNumber,
        totalInstallments,
        reference,
        dueDate: dueIso,
        originalExpectedAmount: originalAmount,
        expectedAmount: originalAmount,
        openAmount: 0,
        statusLabel: "Parcialmente substituída",
        paymentConditionLabel,
        paymentMethodLabel,
        origin: "Pedido de Venda / Condição de pagamento",
        note: `Previsão original parcialmente coberta. Residual ativo: ${residualAmount.toFixed(2)}.`,
        replacedByRealCr: true,
        replacedByReceivableExternalId: null,
        replacedBySource: supersessionSource(),
        entryKind: "SUPERSEDED_ORDER_PLAN",
      });
      // Residual ativo operacional.
      planned.push({
        key: `${key}:residual`,
        orderCode: input.orderCode,
        salesOrderId: input.salesOrderId,
        installmentNumber,
        totalInstallments,
        reference: `${reference} (residual)`,
        dueDate: dueIso,
        originalExpectedAmount: originalAmount,
        expectedAmount: residualAmount,
        openAmount: residualAmount,
        statusLabel: classifyPlannedStatus(line.dueDate, referenceDate),
        paymentConditionLabel,
        paymentMethodLabel,
        origin: "Pedido de Venda / Condição de pagamento",
        note: "Saldo residual da previsão do pedido ainda sem CR/Documento correspondente.",
        replacedByRealCr: false,
        replacedByReceivableExternalId: null,
        replacedBySource: null,
        entryKind: "RESIDUAL_ORDER_PLAN",
      });
      return;
    }

    // Previsão integralmente ativa.
    planned.push({
      key,
      orderCode: input.orderCode,
      salesOrderId: input.salesOrderId,
      installmentNumber,
      totalInstallments,
      reference,
      dueDate: dueIso,
      originalExpectedAmount: originalAmount,
      expectedAmount: originalAmount,
      openAmount: originalAmount,
      statusLabel: classifyPlannedStatus(line.dueDate, referenceDate),
      paymentConditionLabel,
      paymentMethodLabel,
      origin: "Pedido de Venda / Condição de pagamento",
      note: "Ainda sem NF/CR real — recebível previsto pela condição de pagamento.",
      replacedByRealCr: false,
      replacedByReceivableExternalId: null,
      replacedBySource: null,
      entryKind: "ACTIVE_ORDER_PLAN",
    });
  });

  return {
    planned,
    totals: summarizePlanned(planned, coverage),
    source: summary.paymentSourceLabel || SALES_ORDER_PAYMENT_SOURCE_FORECAST,
    coverage,
  };
}

function summarizePlanned(
  planned: readonly SalesOrderPlannedReceivable[],
  coverage: SalesOrderFinancialCoverage
): SalesOrderPlannedReceivablesTotal {
  let totalExpected = 0;
  let openExpected = 0;
  let overdueExpected = 0;
  let overdueCount = 0;
  let dueTodayExpected = 0;
  let dueTodayCount = 0;
  let upcomingCount = 0;
  let replacedCount = 0;
  let replacedAmount = 0;
  let nextDueDate: string | null = null;

  for (const p of planned) {
    if (p.replacedByRealCr) {
      replacedCount += 1;
      replacedAmount += p.originalExpectedAmount;
      // Totais de evidência usam valor original nas linhas históricas.
      totalExpected += p.originalExpectedAmount;
      continue;
    }
    totalExpected += p.expectedAmount;
    openExpected += p.openAmount;
    if (p.statusLabel === "Vencido") {
      overdueExpected += p.openAmount;
      overdueCount += 1;
    } else if (p.statusLabel === "Vence hoje") {
      dueTodayExpected += p.openAmount;
      dueTodayCount += 1;
    } else if (p.statusLabel === "A vencer") {
      upcomingCount += 1;
    }
    if (p.dueDate) {
      if (!nextDueDate || p.dueDate < nextDueDate) nextDueDate = p.dueDate;
    }
  }

  // totalExpected de evidência: preferir soma das originais únicas (sem double-count residual+original).
  const originalKeys = new Set<string>();
  let originalsSum = 0;
  for (const p of planned) {
    const baseKey = p.key.replace(/:(original|residual)$/, "");
    if (originalKeys.has(baseKey)) continue;
    originalKeys.add(baseKey);
    originalsSum += p.originalExpectedAmount;
  }
  totalExpected = originalsSum;

  return {
    totalCount: planned.filter((p) => !p.key.endsWith(":residual")).length,
    totalExpected: roundOrderMoney(totalExpected),
    applicableExpected: roundOrderMoney(openExpected),
    openExpected: roundOrderMoney(openExpected),
    overdueExpected: roundOrderMoney(overdueExpected),
    overdueCount,
    dueTodayExpected: roundOrderMoney(dueTodayExpected),
    dueTodayCount,
    upcomingCount,
    nextDueDate,
    replacedCount,
    replacedAmount: roundOrderMoney(replacedAmount),
    netPlannedOpen: roundOrderMoney(openExpected),
    coveredByRealReceivables: coverage.coveredByRealReceivables,
    coveredByDocumentsWithoutRealReceivable:
      coverage.coveredByDocumentsWithoutRealReceivable,
    remainingPlannedValue: coverage.remainingPlannedValue,
    fullySuperseded: coverage.fullySuperseded,
    partiallySuperseded: coverage.partiallySuperseded,
    precedenceSource: coverage.precedenceSource,
  };
}

function emptyTotals(
  coverage: SalesOrderFinancialCoverage
): SalesOrderPlannedReceivablesTotal {
  return {
    totalCount: 0,
    totalExpected: 0,
    applicableExpected: 0,
    openExpected: 0,
    overdueExpected: 0,
    overdueCount: 0,
    dueTodayExpected: 0,
    dueTodayCount: 0,
    upcomingCount: 0,
    nextDueDate: null,
    replacedCount: 0,
    replacedAmount: 0,
    netPlannedOpen: 0,
    coveredByRealReceivables: coverage.coveredByRealReceivables,
    coveredByDocumentsWithoutRealReceivable:
      coverage.coveredByDocumentsWithoutRealReceivable,
    remainingPlannedValue: coverage.remainingPlannedValue,
    fullySuperseded: coverage.fullySuperseded,
    partiallySuperseded: coverage.partiallySuperseded,
    precedenceSource: coverage.precedenceSource,
  };
}
