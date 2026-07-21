/**
 * Carteira AR operacional compartilhada (Fase 1).
 *
 * Fonte única para Contas a Receber (grade) e Fluxo de Caixa:
 * saneamento gerencial + FIN-02 (pré-NF omitido quando o Pedido já tem CR com NF).
 *
 * Não injeta DOCUMENT_AWAITING_CR / ORDER_*_FORECAST (Fase 2).
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

/**
 * FIN-02 portfólio: se o Pedido já tem CR com NF, remove CR WITHOUT_NFE do mesmo Pedido.
 * Títulos sem hint de Pedido permanecem.
 */
export function suppressInferiorPreNfNomusArRows<
  T extends Pick<
    FinanceArDashboardRow,
    "externalId" | "description" | "sourceInvoiceId" | "sourceInvoiceNumber"
  >,
>(rows: T[], options?: SuppressInferiorPreNfNomusArOptions): T[] {
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

  if (superior.size === 0) return rows;

  return rows.filter((row) => {
    const key = orderKeyByExternalId.get(row.externalId);
    if (!key || !superior.has(key)) return true;
    return classifyFinanceArReceivableOrigin(row) !== "WITHOUT_NFE";
  });
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
