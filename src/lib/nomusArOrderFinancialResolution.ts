/**
 * Resolve valores financeiros oficiais de títulos CR gerados a partir de Pedidos Nomus.
 * Quando valorReceber do Nomus diverge da parcela do pedido, usa a parcela (valor financeiro oficial).
 */
import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  extractNomusSalesOrderFinancialSummary,
  findNomusSalesOrderFinancialParcel,
  orderCodesMatch,
  type NomusSalesOrderFinancialParcel,
  type NomusSalesOrderFinancialSummary,
} from "./nomusSalesOrderFinancialParcels.js";
import { canonicalNomusOrderCodeKey } from "./salesOrderNomusSync.server.js";

export const AR_ORDER_PARCEL_DESCRIPTION_RE =
  /pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)/i;

export type FinanceArFinancialAmountSource = "nomus_cr" | "sales_order_parcel";

export type ParsedArSalesOrderParcelRef = {
  orderCode: string;
  installmentNumber: number;
};

export type SalesOrderFinancialContext = {
  orderCode: string;
  orderId: string;
  summary: NomusSalesOrderFinancialSummary;
};

export type ArOrderFinancialResolution = {
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  financialAmountSource: FinanceArFinancialAmountSource;
  nomusAmountReceivable: number;
  linkedOrderCode: string | null;
  orderFinancialDivergence: boolean;
  orderFinancialDivergenceDelta: number;
};

const DIVERGENCE_TOLERANCE = 0.01;

export function parseSalesOrderParcelFromArDescription(
  description: string | null | undefined
): ParsedArSalesOrderParcelRef | null {
  if (!description?.trim()) return null;
  const match = description.trim().match(AR_ORDER_PARCEL_DESCRIPTION_RE);
  if (!match) return null;
  const orderNumber = Number.parseInt(match[1]!, 10);
  const installmentNumber = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(orderNumber) || !Number.isFinite(installmentNumber)) return null;
  return {
    orderCode: `PD ${String(orderNumber).padStart(5, "0")}`,
    installmentNumber,
  };
}

export function isOrderGeneratedArDescription(description: string | null | undefined): boolean {
  return parseSalesOrderParcelFromArDescription(description) != null;
}

function scaleArAmountsToParcelNominal(input: {
  nomusAmountReceivable: number;
  nomusAmountReceived: number;
  nomusBalanceReceivable: number;
  parcelNominal: number;
}): Pick<ArOrderFinancialResolution, "amountReceivable" | "amountReceived" | "balanceReceivable"> {
  const { nomusAmountReceivable, nomusAmountReceived, nomusBalanceReceivable, parcelNominal } =
    input;
  if (
    nomusAmountReceivable <= 0 ||
    Math.abs(nomusAmountReceivable - parcelNominal) <= DIVERGENCE_TOLERANCE
  ) {
    return {
      amountReceivable: nomusAmountReceivable,
      amountReceived: nomusAmountReceived,
      balanceReceivable: nomusBalanceReceivable,
    };
  }
  const ratio = parcelNominal / nomusAmountReceivable;
  const amountReceivable = roundMoney(parcelNominal);
  const amountReceived = roundMoney(nomusAmountReceived * ratio);
  const balanceReceivable = Math.max(0, roundMoney(amountReceivable - amountReceived));
  return { amountReceivable, amountReceived, balanceReceivable };
}

export function resolveArOrderFinancialAmounts(input: {
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  description: string | null | undefined;
  dueDate: Date | null;
  parcel: NomusSalesOrderFinancialParcel | null;
  linkedOrderCode: string | null;
}): ArOrderFinancialResolution {
  const nomusAmountReceivable = roundMoney(input.amountReceivable);
  const base: ArOrderFinancialResolution = {
    amountReceivable: nomusAmountReceivable,
    amountReceived: roundMoney(input.amountReceived),
    balanceReceivable: roundMoney(input.balanceReceivable),
    financialAmountSource: "nomus_cr",
    nomusAmountReceivable,
    linkedOrderCode: input.linkedOrderCode,
    orderFinancialDivergence: false,
    orderFinancialDivergenceDelta: 0,
  };

  if (!input.parcel || input.parcel.amount <= 0) return base;
  if (!isOrderGeneratedArDescription(input.description) && !input.linkedOrderCode) return base;

  const delta = roundMoney(nomusAmountReceivable - input.parcel.amount);
  if (Math.abs(delta) <= DIVERGENCE_TOLERANCE) return base;

  const scaled = scaleArAmountsToParcelNominal({
    nomusAmountReceivable,
    nomusAmountReceived: input.amountReceived,
    nomusBalanceReceivable: input.balanceReceivable,
    parcelNominal: input.parcel.amount,
  });

  return {
    ...scaled,
    financialAmountSource: "sales_order_parcel",
    nomusAmountReceivable,
    linkedOrderCode: input.linkedOrderCode,
    orderFinancialDivergence: true,
    orderFinancialDivergenceDelta: delta,
  };
}

export function applyArOrderFinancialResolution(
  row: FinanceArDashboardRow,
  context: SalesOrderFinancialContext | null,
  parsed: ParsedArSalesOrderParcelRef | null
): FinanceArDashboardRow {
  if (!context && !parsed) return row;

  let parcel: NomusSalesOrderFinancialParcel | null = null;
  let linkedOrderCode: string | null = null;

  if (parsed && context && orderCodesMatch(parsed.orderCode, context.orderCode)) {
    linkedOrderCode = context.orderCode;
    parcel = findNomusSalesOrderFinancialParcel(
      context.summary,
      parsed.installmentNumber,
      row.dueDate
    );
  } else if (context && parsed == null && context.summary.parcels.length === 1) {
    linkedOrderCode = context.orderCode;
    parcel = context.summary.parcels[0] ?? null;
  }

  const resolution = resolveArOrderFinancialAmounts({
    amountReceivable: row.amountReceivable,
    amountReceived: row.amountReceived,
    balanceReceivable: row.balanceReceivable,
    description: row.description,
    dueDate: row.dueDate,
    parcel,
    linkedOrderCode,
  });

  if (!resolution.orderFinancialDivergence) return row;

  return {
    ...row,
    amountReceivable: resolution.amountReceivable,
    amountReceived: resolution.amountReceived,
    balanceReceivable: resolution.balanceReceivable,
    financialAmountSource: resolution.financialAmountSource,
    nomusAmountReceivable: resolution.nomusAmountReceivable,
    linkedOrderCode: resolution.linkedOrderCode,
    orderFinancialDivergence: resolution.orderFinancialDivergence,
    orderFinancialDivergenceDelta: resolution.orderFinancialDivergenceDelta,
  };
}

export function buildSalesOrderFinancialContext(
  orderCode: string,
  orderId: string,
  nomusRawResponse: unknown
): SalesOrderFinancialContext {
  return {
    orderCode,
    orderId,
    summary: extractNomusSalesOrderFinancialSummary(nomusRawResponse),
  };
}

export function indexSalesOrderFinancialContexts(
  orders: Array<{ id: string; orderCode: string; nomusRawResponse: unknown }>
): Map<string, SalesOrderFinancialContext> {
  const map = new Map<string, SalesOrderFinancialContext>();
  for (const order of orders) {
    const ctx = buildSalesOrderFinancialContext(order.orderCode, order.id, order.nomusRawResponse);
    const key = canonicalNomusOrderCodeKey(order.orderCode);
    if (key) map.set(key, ctx);
  }
  return map;
}

export type ArOrderFinancialAuditRow = {
  externalId: number;
  description: string | null;
  orderCode: string | null;
  installmentNumber: number | null;
  nomusAmountReceivable: number;
  parcelAmount: number | null;
  delta: number;
  dueDate: string | null;
};

export function auditArOrderFinancialDivergence(input: {
  externalId: number;
  description: string | null;
  dueDate: Date | null;
  amountReceivable: number;
  context: SalesOrderFinancialContext | null;
  parsed: ParsedArSalesOrderParcelRef | null;
}): ArOrderFinancialAuditRow | null {
  if (!input.context || !input.parsed) return null;
  if (!orderCodesMatch(input.parsed.orderCode, input.context.orderCode)) return null;
  const parcel = findNomusSalesOrderFinancialParcel(
    input.context.summary,
    input.parsed.installmentNumber,
    input.dueDate
  );
  if (!parcel) return null;
  const delta = roundMoney(input.amountReceivable - parcel.amount);
  if (Math.abs(delta) <= DIVERGENCE_TOLERANCE) return null;
  return {
    externalId: input.externalId,
    description: input.description,
    orderCode: input.parsed.orderCode,
    installmentNumber: input.parsed.installmentNumber,
    nomusAmountReceivable: roundMoney(input.amountReceivable),
    parcelAmount: parcel.amount,
    delta,
    dueDate: input.dueDate?.toISOString() ?? null,
  };
}
