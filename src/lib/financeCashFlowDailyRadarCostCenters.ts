/**
 * Agrega centros de custo do escopo atual do drill-down do Fluxo de Caixa
 * (aba Financeiro → Financeiro / Radar Diário).
 *
 * Regras oficiais:
 * - Fonte de saídas: mesmos títulos de Contas a Pagar que aparecem no drill-down
 *   (mesmo período/dia/faixa personalizada/busca).
 * - Eixo de data: **vencimento oficial** (`SalesOrder`/`NomusAccountsPayable.dueDate`
 *   → `DailyRadarPayableRow.dataUsadaNoFluxo`), consistente com a regra oficial
 *   documentada em `docs/finance/cash-flow.md`.
 * - Classificação: alocações `AccountsPayableCostCenterAllocation` (mesma tabela
 *   usada pela tela Centro de Custo → Centro de Custo).
 * - Item sem alocação real, ou com alocação parcial, entra no bucket "Sem centro
 *   de custo" (auditoria).
 * - Contas a Receber **não** entram — a tela é read-only, analítica, sem alterar
 *   Fluxo de Caixa oficial, AP oficial, AR oficial, Presidencial ou Comissões.
 */

import type { DailyRadarPayableRow } from "./financeCashFlowDailyRadar.js";

export const CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID = "__UNCLASSIFIED__";
export const CASH_FLOW_COST_CENTER_UNCLASSIFIED_LABEL = "Sem centro de custo";
const AMOUNT_TOLERANCE = 0.01;

export type CashFlowCostCenterAllocationInput = {
  accountsPayableExternalId: number;
  costCenterId: string;
  /** Valor absoluto em R$ da alocação. Quando `null`, calcular por `percentage`. */
  amount: number | null;
  /** 0–100. Usado quando `amount` é nulo. */
  percentage: number;
};

export type CashFlowCostCenterMetaInput = {
  id: string;
  code: string;
  name: string;
  status: string | null;
};

export type CashFlowCostCenterSummaryItem = {
  costCenterId: string;
  code: string | null;
  name: string;
  amount: number;
  titlesCount: number;
  sharePercentage: number;
  status: string | null;
  unclassified: boolean;
};

export type CashFlowCostCenterSummary = {
  items: CashFlowCostCenterSummaryItem[];
  totalAmount: number;
  totalTitles: number;
  totalTitlesWithAllocation: number;
  unclassifiedAmount: number;
  unclassifiedTitles: number;
  scope: {
    /** `range` (faixa completa) ou `day` (dia clicado). */
    level: "range" | "day" | "custom" | null;
    rangeKey: string | null;
    rangeLabel: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    /** Dia clicado quando `level === "day"`. */
    day: string | null;
    search: string | null;
  };
};

export type CashFlowCostCenterTitleDetail = {
  accountsPayableExternalId: number;
  supplier: string | null;
  company: string | null;
  description: string | null;
  document: string | null;
  dueDate: string | null;
  amount: number;
  status: string | null;
  paymentMethod: string | null;
};

export type BuildCashFlowCostCenterSummaryInput = {
  payables: readonly DailyRadarPayableRow[];
  allocations: readonly CashFlowCostCenterAllocationInput[];
  costCenters: readonly CashFlowCostCenterMetaInput[];
  scope: CashFlowCostCenterSummary["scope"];
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function safePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const pct = (part / total) * 100;
  return Math.round(pct * 100) / 100;
}

/** Extrai o `externalId` numérico do id do DailyRadarPayableRow (`ap-<n>`). */
export function extractPayableExternalId(rowId: string): number | null {
  const m = /^ap-(-?\d+)$/.exec(rowId);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function buildCashFlowCostCenterSummary(
  input: BuildCashFlowCostCenterSummaryInput
): CashFlowCostCenterSummary {
  const ccById = new Map(input.costCenters.map((cc) => [cc.id, cc]));
  const allocationsByPayable = new Map<number, CashFlowCostCenterAllocationInput[]>();
  for (const alloc of input.allocations) {
    const list = allocationsByPayable.get(alloc.accountsPayableExternalId) ?? [];
    list.push(alloc);
    allocationsByPayable.set(alloc.accountsPayableExternalId, list);
  }

  const bucket = new Map<
    string,
    { amount: number; titlesCount: number; meta: CashFlowCostCenterMetaInput | null }
  >();
  const seenPayableIdsPerBucket = new Map<string, Set<number>>();

  let totalAmount = 0;
  let totalTitles = 0;
  let totalTitlesWithAllocation = 0;
  let unclassifiedAmount = 0;
  let unclassifiedTitles = 0;

  const trackPayableInBucket = (bucketId: string, payableId: number): void => {
    const set = seenPayableIdsPerBucket.get(bucketId) ?? new Set<number>();
    if (set.has(payableId)) {
      seenPayableIdsPerBucket.set(bucketId, set);
      return;
    }
    set.add(payableId);
    seenPayableIdsPerBucket.set(bucketId, set);
    const cur = bucket.get(bucketId);
    if (cur) cur.titlesCount += 1;
  };

  for (const row of input.payables) {
    const externalId = extractPayableExternalId(row.id);
    const rowAmount = Number.isFinite(row.amount) ? row.amount : 0;
    totalAmount += rowAmount;
    totalTitles += 1;

    if (externalId == null) {
      // Linha sem chave AP externa — cai em "Sem centro de custo" (auditoria).
      const cur = bucket.get(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID) ?? {
        amount: 0,
        titlesCount: 0,
        meta: null,
      };
      cur.amount += rowAmount;
      bucket.set(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, cur);
      trackPayableInBucket(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, -1);
      unclassifiedAmount += rowAmount;
      unclassifiedTitles += 1;
      continue;
    }

    const allocs = allocationsByPayable.get(externalId) ?? [];
    if (allocs.length === 0) {
      const cur = bucket.get(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID) ?? {
        amount: 0,
        titlesCount: 0,
        meta: null,
      };
      cur.amount += rowAmount;
      bucket.set(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, cur);
      trackPayableInBucket(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, externalId);
      unclassifiedAmount += rowAmount;
      unclassifiedTitles += 1;
      continue;
    }

    let allocatedForRow = 0;
    for (const alloc of allocs) {
      const meta = ccById.get(alloc.costCenterId) ?? null;
      const bucketId = alloc.costCenterId;
      const cur = bucket.get(bucketId) ?? {
        amount: 0,
        titlesCount: 0,
        meta,
      };
      cur.meta = cur.meta ?? meta;
      const allocAmount = Number.isFinite(alloc.amount)
        ? (alloc.amount as number)
        : (rowAmount * (Number.isFinite(alloc.percentage) ? alloc.percentage : 0)) /
          100;
      const safeAlloc = Math.max(0, Math.min(rowAmount, allocAmount));
      cur.amount += safeAlloc;
      allocatedForRow += safeAlloc;
      bucket.set(bucketId, cur);
      trackPayableInBucket(bucketId, externalId);
    }
    totalTitlesWithAllocation += 1;

    const gap = rowAmount - allocatedForRow;
    if (gap > AMOUNT_TOLERANCE) {
      const cur = bucket.get(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID) ?? {
        amount: 0,
        titlesCount: 0,
        meta: null,
      };
      cur.amount += gap;
      bucket.set(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, cur);
      trackPayableInBucket(CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID, externalId);
      unclassifiedAmount += gap;
      // Não contamos como "unclassifiedTitles" já contado quando 0 alocações.
    }
  }

  totalAmount = roundMoney(totalAmount);
  unclassifiedAmount = roundMoney(unclassifiedAmount);

  const items: CashFlowCostCenterSummaryItem[] = [...bucket.entries()].map(
    ([bucketId, agg]) => {
      const isUnclassified = bucketId === CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID;
      const amount = roundMoney(agg.amount);
      return {
        costCenterId: bucketId,
        code: isUnclassified ? null : agg.meta?.code ?? null,
        name: isUnclassified
          ? CASH_FLOW_COST_CENTER_UNCLASSIFIED_LABEL
          : agg.meta?.name ?? `Centro ${agg.meta?.code ?? bucketId.slice(0, 8)}`,
        amount,
        titlesCount: agg.titlesCount,
        sharePercentage: safePercent(amount, totalAmount),
        status: isUnclassified ? null : agg.meta?.status ?? null,
        unclassified: isUnclassified,
      };
    }
  );

  items.sort((a, b) => {
    if (a.unclassified && !b.unclassified) return 1;
    if (!a.unclassified && b.unclassified) return -1;
    return b.amount - a.amount;
  });

  return {
    items,
    totalAmount,
    totalTitles,
    totalTitlesWithAllocation,
    unclassifiedAmount,
    unclassifiedTitles,
    scope: input.scope,
  };
}

/** Lista títulos AP que caem num bucket específico (para o drawer de detalhe). */
export function filterCashFlowCostCenterTitles(input: {
  payables: readonly DailyRadarPayableRow[];
  allocations: readonly CashFlowCostCenterAllocationInput[];
  costCenterId: string;
}): CashFlowCostCenterTitleDetail[] {
  const isUnclassifiedBucket = input.costCenterId === CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID;
  const allocationsByPayable = new Map<number, CashFlowCostCenterAllocationInput[]>();
  for (const alloc of input.allocations) {
    const list = allocationsByPayable.get(alloc.accountsPayableExternalId) ?? [];
    list.push(alloc);
    allocationsByPayable.set(alloc.accountsPayableExternalId, list);
  }

  const details: CashFlowCostCenterTitleDetail[] = [];
  for (const row of input.payables) {
    const externalId = extractPayableExternalId(row.id);
    if (externalId == null) {
      if (isUnclassifiedBucket) {
        details.push(toTitleDetail(row, -1));
      }
      continue;
    }
    const allocs = allocationsByPayable.get(externalId) ?? [];
    if (isUnclassifiedBucket) {
      if (allocs.length === 0) {
        details.push(toTitleDetail(row, externalId));
        continue;
      }
      const allocated = allocs.reduce(
        (sum, a) =>
          sum +
          (Number.isFinite(a.amount)
            ? (a.amount as number)
            : (row.amount * (Number.isFinite(a.percentage) ? a.percentage : 0)) / 100),
        0
      );
      if (row.amount - allocated > AMOUNT_TOLERANCE) {
        details.push(toTitleDetail(row, externalId));
      }
      continue;
    }
    if (allocs.some((a) => a.costCenterId === input.costCenterId)) {
      details.push(toTitleDetail(row, externalId));
    }
  }
  return details;
}

function toTitleDetail(
  row: DailyRadarPayableRow,
  externalId: number
): CashFlowCostCenterTitleDetail {
  return {
    accountsPayableExternalId: externalId,
    supplier: row.supplier,
    company: row.company,
    description: row.description,
    document: row.document,
    dueDate: row.vencimentoOficial ?? row.dueDate ?? null,
    amount: row.amount,
    status: row.status,
    paymentMethod: row.paymentMethod,
  };
}
