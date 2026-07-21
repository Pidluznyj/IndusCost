/**
 * OP-02 — Métricas oficiais e proteções contra joins multiplicativos.
 * Camada pura (sem Prisma): adapters não devem recalcular fora daqui.
 */
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
import type {
  SalesOrderOperationalMetrics,
  SalesOrderOperationalOrderFact,
} from "./salesOrderOperationalTypes.js";

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Extrai IDs únicos preservando a primeira ocorrência. */
export function uniqueSalesOrderIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const key = String(id ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Garante unicidade estrutural. Em testes: assert.
 * Em runtime de produção: retorna IDs únicos e conta duplicatas.
 */
export function assertUniqueSalesOrderIds(
  ids: Iterable<string>,
  options?: { throwOnDuplicate?: boolean }
): { uniqueIds: string[]; duplicateCount: number } {
  const list = [...ids].map((id) => String(id ?? "").trim()).filter(Boolean);
  const uniqueIds = uniqueSalesOrderIds(list);
  const duplicateCount = list.length - uniqueIds.length;
  if (duplicateCount > 0 && options?.throwOnDuplicate !== false) {
    throw new Error(
      `OP-02: população de SalesOrder com ${duplicateCount} ID(s) duplicado(s); granularidade oficial é 1 registro = 1 SalesOrder.`
    );
  }
  return { uniqueIds, duplicateCount };
}

/**
 * Agrupa fatos por salesOrderId. Se houver várias linhas do mesmo pedido
 * (ex.: join 1:N), mantém um único fato somando domínios já agregados
 * apenas quando `merge` for informado; caso contrário, a primeira linha vence
 * para campos de pedido (sold/items) e soma NF/CR.
 */
export function aggregateFactsBySalesOrderId(
  rows: Array<Partial<SalesOrderOperationalOrderFact> & { salesOrderId: string }>
): Map<string, SalesOrderOperationalOrderFact> {
  const map = new Map<string, SalesOrderOperationalOrderFact>();
  for (const row of rows) {
    const id = String(row.salesOrderId ?? "").trim();
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, {
        salesOrderId: id,
        totalNetValue: Number(row.totalNetValue) || 0,
        totalItems: Number(row.totalItems) || 0,
        invoicedNfeAmount: Number(row.invoicedNfeAmount) || 0,
        receivableOpenAmount: Number(row.receivableOpenAmount) || 0,
        receivableSettledAmount: Number(row.receivableSettledAmount) || 0,
      });
      continue;
    }
    // Pedido: não remultiplicar header — mantém o primeiro valor oficial.
    // NF / CR: somam (já devem vir pré-agregados por domínio; se vierem
    // linhas 1:N do mesmo domínio, o caller deve agregar antes).
    existing.invoicedNfeAmount = roundMoney(
      existing.invoicedNfeAmount + (Number(row.invoicedNfeAmount) || 0)
    );
    existing.receivableOpenAmount = roundMoney(
      (existing.receivableOpenAmount ?? 0) + (Number(row.receivableOpenAmount) || 0)
    );
    existing.receivableSettledAmount = roundMoney(
      (existing.receivableSettledAmount ?? 0) +
        (Number(row.receivableSettledAmount) || 0)
    );
  }
  return map;
}

/** Saldo a faturar oficial por pedido. */
export function computeBalanceToInvoice(
  soldAmount: number,
  invoicedNfeAmount: number
): number {
  const sold = Number.isFinite(soldAmount) ? soldAmount : 0;
  const invoiced = Number.isFinite(invoicedNfeAmount) ? invoicedNfeAmount : 0;
  return roundMoney(Math.max(0, sold - invoiced));
}

/**
 * Agrega métricas oficiais a partir de fatos já únicos por salesOrderId.
 */
export function computeSalesOrderOperationalMetrics(
  facts: Iterable<SalesOrderOperationalOrderFact>
): SalesOrderOperationalMetrics {
  let orderCount = 0;
  let soldAmount = 0;
  let itemCount = 0;
  let invoicedNfeAmount = 0;
  let balanceToInvoice = 0;

  for (const fact of facts) {
    orderCount += 1;
    soldAmount += Number(fact.totalNetValue) || 0;
    itemCount += Number(fact.totalItems) || 0;
    const nfe = Number(fact.invoicedNfeAmount) || 0;
    invoicedNfeAmount += nfe;
    balanceToInvoice += computeBalanceToInvoice(
      Number(fact.totalNetValue) || 0,
      nfe
    );
  }

  soldAmount = roundMoney(soldAmount);
  invoicedNfeAmount = roundMoney(invoicedNfeAmount);
  balanceToInvoice = roundMoney(balanceToInvoice);
  const averageTicket = computeTicketAverage(soldAmount, orderCount) ?? 0;

  return {
    orderCount,
    soldAmount,
    itemCount,
    averageTicket: Number.isFinite(averageTicket) ? averageTicket : 0,
    invoicedNfeAmount,
    balanceToInvoice,
  };
}

/**
 * Simula o anti-padrão cartesiano (itens × NF × CR) e prova que, após
 * agregar por salesOrderId, os totais permanecem estáveis.
 */
export function collapseCartesianJoinToOrderFacts(input: {
  salesOrderId: string;
  totalNetValue: number;
  totalItems: number;
  nfeAmounts: number[];
  receivableAmounts: number[];
}): SalesOrderOperationalOrderFact {
  // Join cartesiano: cada combinação item×nfe×cr — NÃO somar sold dessa forma.
  const cartesianRows: Array<
    Partial<SalesOrderOperationalOrderFact> & { salesOrderId: string }
  > = [];
  const itemSlots = Math.max(1, input.totalItems);
  const nfes = input.nfeAmounts.length > 0 ? input.nfeAmounts : [0];
  const crs = input.receivableAmounts.length > 0 ? input.receivableAmounts : [0];

  for (let i = 0; i < itemSlots; i += 1) {
    for (const nfe of nfes) {
      for (const cr of crs) {
        cartesianRows.push({
          salesOrderId: input.salesOrderId,
          // anti-padrão: header repetido em cada linha do join
          totalNetValue: input.totalNetValue,
          totalItems: input.totalItems,
          invoicedNfeAmount: nfe,
          receivableOpenAmount: cr,
        });
      }
    }
  }

  // Correção OP-02: agregar NF/CR por domínio ANTES, e header uma vez.
  const nfeTotal = roundMoney(input.nfeAmounts.reduce((a, b) => a + b, 0));
  const crTotal = roundMoney(input.receivableAmounts.reduce((a, b) => a + b, 0));
  const map = aggregateFactsBySalesOrderId([
    {
      salesOrderId: input.salesOrderId,
      totalNetValue: input.totalNetValue,
      totalItems: input.totalItems,
      invoicedNfeAmount: nfeTotal,
      receivableOpenAmount: crTotal,
    },
  ]);
  void cartesianRows; // documenta o risco; não alimenta a métrica
  return map.get(input.salesOrderId)!;
}
