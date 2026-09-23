/**
 * Agregação por cliente da Recuperação do Dinheiro Investido.
 *
 * Não lê banco e não recalcula capital, imposto, recebimento ou custo.
 * Parte do snapshot oficial por pedido (`buildSalesOrderInvestedCapitalRecoverySnapshot`)
 * e só soma. O ganho realizado de cada pedido já está no snapshot
 * (MAX(recebido − capital, 0)); aqui ele é somado, nunca refeito como
 * recebido do cliente − capital do cliente.
 *
 * Centavos: cada pedido já chega arredondado. A soma do cliente e o resumo
 * usam o mesmo acumulador inteiro de centavos, então a soma dos clientes
 * fecha com o resumo sem residual de float.
 */
import type { SalesOrderInvestedCapitalRecoverySnapshot } from "./salesOrderInvestedCapitalRecoverySnapshot.js";

export const INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_KEY = "__unidentified__";
export const INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_NAME = "Cliente não identificado";

const TOP_CUSTOMERS = 10;

export type InvestedCapitalRecoveryCustomerMoney = {
  orders: number;
  insufficientDataOrders: number;
  sold: number;
  invoiced: number;
  industrialCost: number | null;
  taxes: number | null;
  investedCapital: number | null;
  received: number;
  recoveredCapital: number | null;
  capitalAtRisk: number | null;
  realizedGain: number | null;
  potentialResult: number | null;
  /** capital recuperado / capital investido × 100. Null sem capital. */
  recoveredPercent: number | null;
  /** saldo econômico atual / faturado × 100. Null sem faturamento ou sem capital. */
  economicMarginPercent: number | null;
};

export type InvestedCapitalRecoveryCustomerRow = InvestedCapitalRecoveryCustomerMoney & {
  customerId: string | null;
  customerKey: string;
  customerName: string;
  unidentified: boolean;
};

export type InvestedCapitalRecoveryCustomerChartPoint = {
  customerKey: string;
  customerName: string;
  amount: number;
};

export type InvestedCapitalRecoveryByCustomerSummary = InvestedCapitalRecoveryCustomerMoney & {
  customers: number;
  invoicedCustomers: number;
};

export type InvestedCapitalRecoveryByCustomerResult = {
  summary: InvestedCapitalRecoveryByCustomerSummary;
  customers: InvestedCapitalRecoveryCustomerRow[];
  charts: {
    topInvoiced: InvestedCapitalRecoveryCustomerChartPoint[];
    topRealizedGain: InvestedCapitalRecoveryCustomerChartPoint[];
    topCapitalAtRisk: InvestedCapitalRecoveryCustomerChartPoint[];
  };
};

type CentsBucket = {
  orders: number;
  insufficientDataOrders: number;
  sold: number;
  invoiced: number;
  industrialCost: number;
  taxes: number;
  investedCapital: number;
  received: number;
  recoveredCapital: number;
  capitalAtRisk: number;
  realizedGain: number;
  potentialResult: number;
  withCapital: number;
};

function emptyBucket(): CentsBucket {
  return {
    orders: 0,
    insufficientDataOrders: 0,
    sold: 0,
    invoiced: 0,
    industrialCost: 0,
    taxes: 0,
    investedCapital: 0,
    received: 0,
    recoveredCapital: 0,
    capitalAtRisk: 0,
    realizedGain: 0,
    potentialResult: 0,
    withCapital: 0,
  };
}

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function addOrder(bucket: CentsBucket, order: SalesOrderInvestedCapitalRecoverySnapshot): void {
  bucket.orders += 1;
  bucket.sold += toCents(order.saleValue);
  bucket.invoiced += toCents(order.invoicedValue);
  bucket.received += toCents(order.actualReceived);
  if (order.investedCapital == null) {
    bucket.insufficientDataOrders += 1;
    return;
  }
  bucket.withCapital += 1;
  bucket.investedCapital += toCents(order.investedCapital);
  bucket.industrialCost += toCents(order.industrialCost ?? 0);
  bucket.taxes += toCents(order.totalTaxes ?? 0);
  bucket.recoveredCapital += toCents(order.capitalRecovered ?? 0);
  bucket.capitalAtRisk += toCents(order.moneyOnStreet ?? 0);
  bucket.realizedGain += toCents(order.realizedGain ?? 0);
  bucket.potentialResult += toCents(order.potentialResult ?? 0);
}

function percent(numeratorCents: number, denominatorCents: number): number | null {
  if (denominatorCents <= 0) return null;
  return Math.round((numeratorCents / denominatorCents) * 10000) / 100;
}

function moneyFromBucket(bucket: CentsBucket): InvestedCapitalRecoveryCustomerMoney {
  const hasCapital = bucket.withCapital > 0;
  const invoiced = fromCents(bucket.invoiced);
  const potentialResult = hasCapital ? fromCents(bucket.potentialResult) : null;
  return {
    orders: bucket.orders,
    insufficientDataOrders: bucket.insufficientDataOrders,
    sold: fromCents(bucket.sold),
    invoiced,
    industrialCost: hasCapital ? fromCents(bucket.industrialCost) : null,
    taxes: hasCapital ? fromCents(bucket.taxes) : null,
    investedCapital: hasCapital ? fromCents(bucket.investedCapital) : null,
    received: fromCents(bucket.received),
    recoveredCapital: hasCapital ? fromCents(bucket.recoveredCapital) : null,
    capitalAtRisk: hasCapital ? fromCents(bucket.capitalAtRisk) : null,
    realizedGain: hasCapital ? fromCents(bucket.realizedGain) : null,
    potentialResult,
    recoveredPercent: hasCapital ? percent(bucket.recoveredCapital, bucket.investedCapital) : null,
    economicMarginPercent:
      hasCapital && bucket.invoiced > 0 ? percent(bucket.potentialResult, bucket.invoiced) : null,
  };
}

function customerKeyOf(order: SalesOrderInvestedCapitalRecoverySnapshot): string {
  const id = order.customerId?.trim();
  return id ? id : INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_KEY;
}

function topBy(
  customers: readonly InvestedCapitalRecoveryCustomerRow[],
  pick: (row: InvestedCapitalRecoveryCustomerRow) => number | null,
  onlyPositive: boolean
): InvestedCapitalRecoveryCustomerChartPoint[] {
  return customers
    .map((row) => ({ row, amount: pick(row) ?? 0 }))
    .filter((item) => (onlyPositive ? item.amount > 0 : true))
    .sort((a, b) => b.amount - a.amount || a.row.customerName.localeCompare(b.row.customerName, "pt-BR"))
    .slice(0, TOP_CUSTOMERS)
    .map((item) => ({
      customerKey: item.row.customerKey,
      customerName: item.row.customerName,
      amount: item.amount,
    }));
}

export function aggregateInvestedCapitalRecoveryByCustomer(
  orders: readonly SalesOrderInvestedCapitalRecoverySnapshot[]
): InvestedCapitalRecoveryByCustomerResult {
  const groups = new Map<
    string,
    { bucket: CentsBucket; customerId: string | null; customerName: string; unidentified: boolean }
  >();

  for (const order of orders) {
    const key = customerKeyOf(order);
    const unidentified = key === INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        bucket: emptyBucket(),
        customerId: unidentified ? null : key,
        customerName: unidentified
          ? INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_NAME
          : order.customerName?.trim() || INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_NAME,
        unidentified,
      };
      groups.set(key, group);
    } else if (!unidentified && !group.customerName.trim()) {
      group.customerName = order.customerName?.trim() || group.customerName;
    }
    addOrder(group.bucket, order);
  }

  const customers = [...groups.entries()]
    .map(([customerKey, group]) => ({
      customerKey,
      customerId: group.customerId,
      customerName: group.customerName,
      unidentified: group.unidentified,
      ...moneyFromBucket(group.bucket),
    }))
    .sort((a, b) => b.invoiced - a.invoiced || a.customerName.localeCompare(b.customerName, "pt-BR"));

  const total = emptyBucket();
  for (const order of orders) addOrder(total, order);
  const summaryMoney = moneyFromBucket(total);

  return {
    summary: {
      ...summaryMoney,
      customers: customers.length,
      invoicedCustomers: customers.filter((row) => row.invoiced > 0).length,
    },
    customers,
    charts: {
      topInvoiced: topBy(customers, (row) => row.invoiced, true),
      topRealizedGain: topBy(customers, (row) => row.realizedGain, true),
      topCapitalAtRisk: topBy(customers, (row) => row.capitalAtRisk, true),
    },
  };
}

/** Soma os campos monetários exibidos. Null de cliente sem capital conta como 0. */
export function sumInvestedCapitalRecoveryCustomerMoney(
  customers: readonly InvestedCapitalRecoveryCustomerMoney[]
): InvestedCapitalRecoveryCustomerMoney {
  const bucket = emptyBucket();
  for (const row of customers) {
    bucket.orders += row.orders;
    bucket.insufficientDataOrders += row.insufficientDataOrders;
    bucket.sold += toCents(row.sold);
    bucket.invoiced += toCents(row.invoiced);
    bucket.received += toCents(row.received);
    if (row.investedCapital == null) continue;
    bucket.withCapital += 1;
    bucket.industrialCost += toCents(row.industrialCost ?? 0);
    bucket.taxes += toCents(row.taxes ?? 0);
    bucket.investedCapital += toCents(row.investedCapital);
    bucket.recoveredCapital += toCents(row.recoveredCapital ?? 0);
    bucket.capitalAtRisk += toCents(row.capitalAtRisk ?? 0);
    bucket.realizedGain += toCents(row.realizedGain ?? 0);
    bucket.potentialResult += toCents(row.potentialResult ?? 0);
  }
  return moneyFromBucket(bucket);
}
