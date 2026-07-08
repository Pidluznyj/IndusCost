/**
 * Parcelas financeiras oficiais do Pedido de Venda Nomus (condição de pagamento).
 * Fonte: nomusRawResponse — não usar Proposal nem soma de itens.
 */
import { canonicalNomusOrderCodeKey } from "./salesOrderNomusSync.server.js";

export type NomusSalesOrderFinancialParcel = {
  installmentNumber: number;
  dueDate: Date | null;
  amount: number;
};

export type NomusSalesOrderFinancialSummary = {
  financialTotal: number | null;
  parcels: NomusSalesOrderFinancialParcel[];
};

const INSTALLMENT_ARRAY_KEYS = [
  "parcelas",
  "condicaoPagamentoParcelas",
  "parcelasCondicaoPagamento",
  "titulosFinanceiros",
  "financeiroParcelas",
] as const;

const FINANCIAL_TOTAL_KEYS = [
  "valorTotalFinanceiro",
  "valorFinanceiroTotal",
  "valorTotalCondicaoPagamento",
  "valorTotalFinanceiroPedido",
] as const;

const NESTED_PAYMENT_KEYS = [
  "condicaoPagamento",
  "condicoesPagamento",
  "informacoesAdicionais",
  "informacoesAdicionaisPedido",
  "dadosFinanceiros",
] as const;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function readFinancialTotal(obj: JsonObject | null): number | null {
  if (!obj) return null;
  for (const key of FINANCIAL_TOTAL_KEYS) {
    const amount = roundMoney(toMoney(obj[key]));
    if (amount > 0) return amount;
  }
  return null;
}

function extractParcelsFromArray(arr: unknown[]): NomusSalesOrderFinancialParcel[] {
  const installments: NomusSalesOrderFinancialParcel[] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const row = asObject(arr[i]);
    if (!row) continue;
    const amount = roundMoney(
      toMoney(row.valor ?? row.valorParcela ?? row.valorReceber ?? row.amount)
    );
    if (amount <= 0) continue;
    installments.push({
      installmentNumber: toInt(row.numeroParcela ?? row.parcela ?? row.numero) ?? i + 1,
      dueDate:
        parseDate(row.dataVencimento ?? row.vencimento ?? row.dueDate) ??
        parseDate(row.data) ??
        null,
      amount,
    });
  }
  return installments;
}

function collectParcelArrays(obj: JsonObject): unknown[][] {
  const arrays: unknown[][] = [];
  for (const key of INSTALLMENT_ARRAY_KEYS) {
    const arr = obj[key];
    if (Array.isArray(arr) && arr.length > 0) arrays.push(arr);
  }
  for (const nestedKey of NESTED_PAYMENT_KEYS) {
    const nested = asObject(obj[nestedKey]);
    if (!nested) continue;
    for (const key of INSTALLMENT_ARRAY_KEYS) {
      const arr = nested[key];
      if (Array.isArray(arr) && arr.length > 0) arrays.push(arr);
    }
  }
  return arrays;
}

/** Extrai parcelas e total financeiro do payload Nomus do pedido. */
export function extractNomusSalesOrderFinancialSummary(
  raw: unknown
): NomusSalesOrderFinancialSummary {
  const root = asObject(raw);
  if (!root) return { financialTotal: null, parcels: [] };

  let financialTotal = readFinancialTotal(root);
  for (const nestedKey of NESTED_PAYMENT_KEYS) {
    if (financialTotal != null) break;
    financialTotal = readFinancialTotal(asObject(root[nestedKey]));
  }

  for (const arr of collectParcelArrays(root)) {
    const parcels = extractParcelsFromArray(arr);
    if (parcels.length > 0) {
      const parcelSum = roundMoney(parcels.reduce((sum, p) => sum + p.amount, 0));
      return {
        financialTotal: financialTotal ?? (parcelSum > 0 ? parcelSum : null),
        parcels,
      };
    }
  }

  return { financialTotal, parcels: [] };
}

export function findNomusSalesOrderFinancialParcel(
  summary: NomusSalesOrderFinancialSummary,
  installmentNumber: number,
  dueDate?: Date | null
): NomusSalesOrderFinancialParcel | null {
  const byNumber = summary.parcels.filter((p) => p.installmentNumber === installmentNumber);
  if (byNumber.length === 0) return null;
  if (!dueDate) return byNumber[0] ?? null;

  const target = startOfDay(dueDate).getTime();
  let best: NomusSalesOrderFinancialParcel | null = null;
  let bestDelta = Number.MAX_SAFE_INTEGER;
  for (const parcel of byNumber) {
    if (!parcel.dueDate) continue;
    const delta = Math.abs(startOfDay(parcel.dueDate).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = parcel;
    }
  }
  if (best && bestDelta <= 3 * 24 * 60 * 60 * 1000) return best;
  return byNumber.length === 1 ? byNumber[0]! : best;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function orderCodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = canonicalNomusOrderCodeKey(a);
  const kb = canonicalNomusOrderCodeKey(b);
  return ka != null && kb != null && ka === kb;
}
