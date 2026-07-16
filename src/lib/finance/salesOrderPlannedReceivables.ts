/**
 * Recebíveis planejados (forecast) do Pedido de Venda.
 *
 * Motor único de previsão para telas oficiais (Fluxo de Caixa, Auditoria 360º).
 * Reutiliza `resolveSalesOrderListPaymentSummary` — a mesma função que já produz
 * a coluna "Cronograma de pagamento" na tela Comercial > Pedidos de Venda.
 *
 * Regra: só emite planejado quando **não** houver CR real coberto para a
 * parcela (dueDate + valor). CR real do Nomus sempre prevalece.
 *
 * Frontend-safe: não importa Prisma. Recebe entradas já normalizadas.
 */
import {
  resolveSalesOrderListPaymentSummary,
  SALES_ORDER_PAYMENT_SOURCE_AR,
  SALES_ORDER_PAYMENT_SOURCE_FORECAST,
  SALES_ORDER_PAYMENT_NOT_INFORMED,
  type SalesOrderListPaymentLine,
  type SalesOrderListReceivableInput,
} from "../salesOrderListPaymentSchedule.js";

/** Uma parcela planejada — espelha o layout esperado pela aba Financeiro. */
export type SalesOrderPlannedReceivable = {
  /** Chave estável — `orderCode:parcela:vencimento:valor` (mesmo pedido → mesma chave). */
  key: string;
  orderCode: string;
  salesOrderId: string;
  installmentNumber: number;
  totalInstallments: number;
  /** Referência amigável usada em listagens: "Pedido PD 02740 - Parcela 1 de 1". */
  reference: string;
  /** Data prevista de vencimento (ISO). */
  dueDate: string | null;
  /** Valor previsto da parcela (positivo). */
  expectedAmount: number;
  /** Saldo previsto em aberto (== expectedAmount até que exista CR real). */
  openAmount: number;
  /** Rótulo de status: A vencer / Vence hoje / Vencido / Não informado. */
  statusLabel: "A vencer" | "Vence hoje" | "Vencido" | "Não informado";
  /** Rótulo da condição de pagamento (mesmo do grid Comercial). */
  paymentConditionLabel: string;
  /** Rótulo do meio de pagamento (mesmo do grid Comercial). */
  paymentMethodLabel: string | null;
  /** Origem do dado — sempre "Pedido de Venda / Condição de pagamento". */
  origin: string;
  /** Observação estruturada para PDFs/auditoria. */
  note: string;
  /** Se true, foi substituído por CR real (planned continua listado como replaced). */
  replacedByRealCr: boolean;
  /** ID externo do CR real que substituiu esta parcela (quando `replacedByRealCr`). */
  replacedByReceivableExternalId: number | null;
};

export type SalesOrderPlannedReceivablesTotal = {
  totalCount: number;
  /** Soma de todas as parcelas planejadas (inclui substituídas — evidência). */
  totalExpected: number;
  /**
   * Planejado ainda aplicável ao total financeiro
   * (= totalExpected − replacedAmount).
   */
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
};

export type BuildSalesOrderPlannedReceivablesInput = {
  salesOrderId: string;
  orderCode: string;
  issueDate: Date;
  totalActiveValue: number;
  paymentTerms: string | null;
  paymentMethod: string | null;
  nomusRawResponse: unknown;
  /** CR real do pedido (mesmo shape usado pelo cash-flow/forecast). */
  realReceivables: SalesOrderListReceivableInput[];
  /** Números de NF vinculados ao pedido — repassados para o resolvedor de condição. */
  nfeDocuments?: string[];
  /** Data de referência para status (default: agora). */
  referenceDate?: Date;
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
): SalesOrderPlannedReceivable["statusLabel"] {
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

/**
 * Detecta CR real que "cobre" a mesma parcela planejada.
 * Critérios (progressivos, mais forte primeiro):
 *   1. Valor (± MONEY_TOLERANCE) + vencimento (± 3 dias).
 *   2. Só valor + inexistência de outra parcela real do mesmo valor.
 */
function findCoveringRealCr(
  planned: SalesOrderListPaymentLine,
  realReceivables: SalesOrderListReceivableInput[],
  consumedRealIds: Set<number>
): SalesOrderListReceivableInput | null {
  const expectedAmount = planned.amount;
  if (expectedAmount <= MONEY_TOLERANCE) return null;

  // 1) valor + vencimento próximos
  const strong = realReceivables.find(
    (real) =>
      !consumedRealIds.has(real.externalId) &&
      real.amountReceivable > MONEY_TOLERANCE &&
      nearlyEqualAmount(real.amountReceivable, expectedAmount) &&
      nearlyEqualDate(real.dueDate, planned.dueDate)
  );
  if (strong) return strong;

  // 2) só valor (fallback), preferência para o mais próximo em data
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
 * Constrói recebíveis planejados oficiais do Pedido de Venda.
 *
 * Retorno:
 *   - `planned`: array com todas as parcelas planejadas (inclui as substituídas
 *     por CR real, marcadas com `replacedByRealCr=true`).
 *   - `totals`: agregação para KPI cards.
 *   - `source`: origem detectada pelo resolvedor (AR, FORECAST, NÃO INFORMADO).
 */
export function buildSalesOrderPlannedReceivables(
  input: BuildSalesOrderPlannedReceivablesInput
): {
  planned: SalesOrderPlannedReceivable[];
  totals: SalesOrderPlannedReceivablesTotal;
  source: string;
} {
  const referenceDate = input.referenceDate ?? new Date();

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

  // Descartamos linhas sem valor útil ou sem qualquer sinal de parcelamento.
  const rawLines = summary.lines.filter(
    (line) => line.amount > MONEY_TOLERANCE
  );

  // Quando não há linhas planejadas úteis e há CR real, o forecast fica vazio.
  if (rawLines.length === 0) {
    return {
      planned: [],
      totals: emptyTotals(),
      source:
        input.realReceivables.length > 0
          ? SALES_ORDER_PAYMENT_SOURCE_AR
          : SALES_ORDER_PAYMENT_NOT_INFORMED,
    };
  }

  const totalInstallments = rawLines.length;
  const consumedRealIds = new Set<number>();
  const planned: SalesOrderPlannedReceivable[] = [];

  rawLines.forEach((line, index) => {
    const installmentNumber = index + 1;
    const dueIso = toIso(line.dueDate);
    const covering = findCoveringRealCr(line, input.realReceivables, consumedRealIds);
    const replaced = covering !== null;
    if (covering) consumedRealIds.add(covering.externalId);

    const reference = buildReferenceLabel({
      orderCode: input.orderCode,
      installmentNumber,
      totalInstallments,
    });

    const statusLabel = replaced
      ? "A vencer"
      : classifyPlannedStatus(line.dueDate, referenceDate);
    const key = `${input.orderCode}:${installmentNumber}:${dueIso ?? "no-date"}:${line.amount.toFixed(2)}`;

    planned.push({
      key,
      orderCode: input.orderCode,
      salesOrderId: input.salesOrderId,
      installmentNumber,
      totalInstallments,
      reference,
      dueDate: dueIso,
      expectedAmount: roundMoney(line.amount),
      openAmount: replaced ? 0 : roundMoney(line.amount),
      statusLabel,
      paymentConditionLabel: summary.paymentConditionLabel,
      paymentMethodLabel: input.paymentMethod?.trim() || null,
      origin: "Pedido de Venda / Condição de pagamento",
      note: replaced
        ? "Substituído por CR real do Nomus (dedup automático)."
        : "Ainda sem NF/CR real — recebível previsto pela condição de pagamento.",
      replacedByRealCr: replaced,
      replacedByReceivableExternalId: covering?.externalId ?? null,
    });
  });

  return {
    planned,
    totals: summarizePlanned(planned),
    source: summary.paymentSourceLabel || SALES_ORDER_PAYMENT_SOURCE_FORECAST,
  };
}

function summarizePlanned(
  planned: readonly SalesOrderPlannedReceivable[]
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
    totalExpected += p.expectedAmount;
    if (p.replacedByRealCr) {
      replacedCount += 1;
      replacedAmount += p.expectedAmount;
      continue;
    }
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

  return {
    totalCount: planned.length,
    totalExpected: roundMoney(totalExpected),
    applicableExpected: roundMoney(Math.max(0, totalExpected - replacedAmount)),
    openExpected: roundMoney(openExpected),
    overdueExpected: roundMoney(overdueExpected),
    overdueCount,
    dueTodayExpected: roundMoney(dueTodayExpected),
    dueTodayCount,
    upcomingCount,
    nextDueDate,
    replacedCount,
    replacedAmount: roundMoney(replacedAmount),
    netPlannedOpen: roundMoney(openExpected),
  };
}

function emptyTotals(): SalesOrderPlannedReceivablesTotal {
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
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
