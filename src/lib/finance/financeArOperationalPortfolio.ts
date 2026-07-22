/**
 * Carteira AR operacional compartilhada (FIN-02 portfólio + FIN-08 no Fluxo de Caixa).
 *
 * Fonte única para Contas a Receber (grade) e Fluxo de Caixa:
 * saneamento gerencial + FIN-02 (pré-NF omitido quando o Pedido já tem CR com NF;
 * pré-NF obsoleto omitido quando o Nomus recria a mesma parcela com novo vencimento).
 * Com contexto FIN-05, Fluxo de Caixa e Títulos usam FIN-08 (`financeCashFlowEffectiveAr.ts`).
 */

import {
  filterFinanceArManagementReportRows,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { classifyFinanceArReceivableOrigin } from "@/src/lib/financeAccountsReceivableDeduplication.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";

export function normalizeFinanceArOrderCodeKey(
  code: string | null | undefined
): string {
  return (code ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Extrai hint de Pedido (PD…) de search/documento/descrição. */
export function extractFinanceArOrderCodeHint(
  ...parts: Array<string | null | undefined>
): string | null {
  for (const part of parts) {
    const raw = (part ?? "").trim();
    if (!raw) continue;
    const m = raw.match(/\bPD\s*[-/]?\s*\d+\b/i);
    if (m) return m[0]!.replace(/\s+/g, " ").toUpperCase().replace(/PD\s*/, "PD ");
  }
  return null;
}

/**
 * Chave de parcela a partir da descrição Nomus ("Parcela 1 de 1", "1/3", "Parc 2/4").
 * Null quando a descrição não identifica a posição — não colapsa multi-parcela sem rótulo.
 */
export function extractFinanceArInstallmentKey(
  description: string | null | undefined
): string | null {
  if (!description) return null;
  const match = /(\d{1,3})\s*(?:\/|\s+de\s+)\s*(\d{1,3})/i.exec(description);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total < 1 ||
    current < 1 ||
    current > total
  ) {
    return null;
  }
  return `${current}/${total}`;
}

/** Vínculo Nomus NF → Pedido (SalesOrderNfeLink). */
export type FinanceArNfeOrderLink = {
  sourceInvoiceId: number;
  orderCode: string;
  salesOrderId: string;
};

/** Resolve Pedido na descrição ou pelo mapa NF→Pedido. */
export function buildFinanceArOrderCodeResolverWithNfeLinks<
  T extends Pick<FinanceArDashboardRow, "description" | "sourceInvoiceId">,
>(rows: readonly T[], links: readonly FinanceArNfeOrderLink[]) {
  const byInvoiceId = new Map<number, FinanceArNfeOrderLink>();
  for (const link of links) {
    if (link.sourceInvoiceId > 0) byInvoiceId.set(link.sourceInvoiceId, link);
  }
  return (row: T): string | null => {
    const hint = extractFinanceArOrderCodeHint(row.description);
    if (hint) return hint;
    const invoiceId = row.sourceInvoiceId;
    if (invoiceId == null || invoiceId <= 0) return null;
    return byInvoiceId.get(invoiceId)?.orderCode ?? null;
  };
}

/**
 * Remove pré-NF do Pedido quando já existe CR com NF no mesmo vencimento civil.
 * Mantém parcelas ainda não materializadas (ex.: parcela 3 do PD 02719).
 */
export function suppressPreNfReplacedByRealCrOnSameOrder<T extends PreNfSuppressRow>(
  rows: T[],
  options?: Pick<SuppressInferiorPreNfNomusArOptions, "resolveOrderCode">
): T[] {
  const resolve =
    options?.resolveOrderCode ??
    ((row: T) => extractFinanceArOrderCodeHint(row.description));

  const realCrDueByOrder = new Map<string, Set<string>>();
  for (const row of rows) {
    if (classifyFinanceArReceivableOrigin(row) !== "WITH_NFE") continue;
    const orderCode = resolve(row);
    if (!orderCode) continue;
    const orderKey = normalizeFinanceArOrderCodeKey(orderCode);
    if (!orderKey) continue;
    const dueKey = civilDueKey(row.dueDate);
    if (!dueKey) continue;
    const dueSet = realCrDueByOrder.get(orderKey) ?? new Set<string>();
    dueSet.add(dueKey);
    realCrDueByOrder.set(orderKey, dueSet);
  }

  if (realCrDueByOrder.size === 0) return rows;

  return rows.filter((row) => {
    if (classifyFinanceArReceivableOrigin(row) !== "WITHOUT_NFE") return true;
    const orderCode = resolve(row);
    if (!orderCode) return true;
    const orderKey = normalizeFinanceArOrderCodeKey(orderCode);
    if (!orderKey) return true;
    const dueKey = civilDueKey(row.dueDate);
    if (!dueKey) return true;
    const realDates = realCrDueByOrder.get(orderKey);
    if (!realDates) return true;
    return !realDates.has(dueKey);
  });
}

export type SuppressInferiorPreNfNomusArOptions = {
  /**
   * Pedidos que já têm CR superior (ex.: schedule.realReceivables),
   * mesmo sem WITH_NFE no lote atual.
   */
  superiorOrderCodes?: Iterable<string>;
  /** Resolve Pedido do título; default = hint na descrição. */
  resolveOrderCode?: (
    row: Pick<FinanceArDashboardRow, "description" | "externalId">
  ) => string | null;
};

type PreNfSuppressRow = Pick<
  FinanceArDashboardRow,
  | "externalId"
  | "description"
  | "sourceInvoiceId"
  | "sourceInvoiceNumber"
  | "balanceReceivable"
  | "dueDate"
  | "amountReceivable"
>;

function civilDueKey(dueDate: Date | null | undefined): string {
  if (!dueDate || Number.isNaN(dueDate.getTime())) return "";
  const y = dueDate.getFullYear();
  const m = String(dueDate.getMonth() + 1).padStart(2, "0");
  const d = String(dueDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function roundAmountKey(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/**
 * Omit pré-NF aberto obsoleto após o Nomus recriar a parcela (novo vencimento):
 * - Preferência: mesmo Pedido + mesma parcela (N/M) → maior externalId
 * - Fallback sem rótulo de parcela: mesmo Pedido + mesmo valor (±R$1) + vencimentos distintos
 *   → maior externalId (ex.: descrição só "Pedido PD … — Depósito")
 *
 * Ex.: PD 02607 — 18102 (30/09) e 18198 (10/10), ambos "Parcela 1 de 1" → só 18198.
 */
export function suppressObsoleteOpenPreNfNomusArRows<T extends PreNfSuppressRow>(
  rows: T[],
  options?: Pick<SuppressInferiorPreNfNomusArOptions, "resolveOrderCode">
): T[] {
  const resolve =
    options?.resolveOrderCode ??
    ((row: T) => extractFinanceArOrderCodeHint(row.description));

  const winners = new Map<string, number>();
  const groupByExternalId = new Map<number, string>();
  const dueKeysByGroup = new Map<string, Set<string>>();

  for (const row of rows) {
    if (classifyFinanceArReceivableOrigin(row) !== "WITHOUT_NFE") continue;
    if (!(row.balanceReceivable > 0)) continue;
    const orderCode = resolve(row);
    if (!orderCode) continue;
    const orderKey = normalizeFinanceArOrderCodeKey(orderCode);
    if (!orderKey) continue;

    const installmentKey = extractFinanceArInstallmentKey(row.description);
    const groupKey = installmentKey
      ? `${orderKey}|inst:${installmentKey}`
      : `${orderKey}|amt:${roundAmountKey(row.amountReceivable)}`;

    groupByExternalId.set(row.externalId, groupKey);
    const dueSet = dueKeysByGroup.get(groupKey) ?? new Set<string>();
    const dueKey = civilDueKey(row.dueDate);
    if (dueKey) dueSet.add(dueKey);
    dueKeysByGroup.set(groupKey, dueSet);

    const prev = winners.get(groupKey);
    if (prev == null || row.externalId > prev) {
      winners.set(groupKey, row.externalId);
    }
  }

  // Fallback por valor: só colapsa quando há vencimentos distintos no grupo
  // (evita apagar multi-parcela igual no mesmo dia — raro — e exige reemissão).
  for (const [groupKey, dueSet] of dueKeysByGroup) {
    if (groupKey.includes("|inst:")) continue;
    if (dueSet.size < 2) {
      winners.delete(groupKey);
      for (const [externalId, key] of groupByExternalId) {
        if (key === groupKey) groupByExternalId.delete(externalId);
      }
    }
  }

  if (winners.size === 0) return rows;

  return rows.filter((row) => {
    const groupKey = groupByExternalId.get(row.externalId);
    if (!groupKey) return true;
    const winner = winners.get(groupKey);
    if (winner == null) return true;
    return winner === row.externalId;
  });
}

/**
 * FIN-02 portfólio:
 * 1) se o Pedido já tem CR com NF, remove CR WITHOUT_NFE do mesmo Pedido;
 * 2) se o Nomus recriou a mesma parcela pré-NF (novo vencimento), mantém só o título mais recente.
 * Títulos sem hint de Pedido permanecem.
 */
export function suppressInferiorPreNfNomusArRows<T extends PreNfSuppressRow>(
  rows: T[],
  options?: SuppressInferiorPreNfNomusArOptions
): T[] {
  const resolve =
    options?.resolveOrderCode ??
    ((row: T) => extractFinanceArOrderCodeHint(row.description));

  const superior = new Set<string>();
  for (const code of options?.superiorOrderCodes ?? []) {
    const key = normalizeFinanceArOrderCodeKey(code);
    if (key) superior.add(key);
  }

  const orderKeyByExternalId = new Map<number, string>();
  for (const row of rows) {
    const code = resolve(row);
    if (!code) continue;
    const key = normalizeFinanceArOrderCodeKey(code);
    if (!key) continue;
    orderKeyByExternalId.set(row.externalId, key);
    if (classifyFinanceArReceivableOrigin(row) === "WITH_NFE") {
      superior.add(key);
    }
  }

  const afterNf =
    superior.size === 0
      ? rows
      : rows.filter((row) => {
          const key = orderKeyByExternalId.get(row.externalId);
          if (!key || !superior.has(key)) return true;
          return classifyFinanceArReceivableOrigin(row) !== "WITHOUT_NFE";
        });

  return suppressObsoleteOpenPreNfNomusArRows(afterNf, { resolveOrderCode: resolve });
}

/**
 * Base operacional AR: management report + suppress pré-NF inferior.
 * Usar em Fluxo de Caixa e Contas a Receber (grade sem drill de Pedido).
 */
export function filterFinanceArOperationalPortfolioRows(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardRow[] {
  return suppressInferiorPreNfNomusArRows(
    filterFinanceArManagementReportRows(rows, filters, referenceDate, syncCutoff)
  );
}
