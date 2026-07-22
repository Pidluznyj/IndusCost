/**
 * Carga server-side de contextos FIN-05 para o Fluxo de Caixa.
 */

import type { PrismaClient } from "@prisma/client";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import { loadFinanceArEffectiveOrderContextsForPortfolio } from "./financeAccountsReceivableEffectiveTitles.server.js";

export type FinanceCashFlowArLoadBundle = {
  arRows: FinanceCashFlowArRow[];
  orderContexts: FinanceArEffectiveOrderContext[];
};

export async function loadFinanceCashFlowArOrderContexts(
  prisma: PrismaClient,
  arRows: FinanceCashFlowArRow[],
  referenceDate: Date = new Date()
): Promise<FinanceArEffectiveOrderContext[]> {
  return loadFinanceArEffectiveOrderContextsForPortfolio(
    prisma,
    arRows,
    referenceDate
  );
}

export async function enrichFinanceCashFlowArLoadBundle(
  prisma: PrismaClient,
  arRows: FinanceCashFlowArRow[],
  referenceDate: Date = new Date()
): Promise<FinanceCashFlowArLoadBundle> {
  const orderContexts = await loadFinanceCashFlowArOrderContexts(
    prisma,
    arRows,
    referenceDate
  );
  return { arRows, orderContexts };
}
