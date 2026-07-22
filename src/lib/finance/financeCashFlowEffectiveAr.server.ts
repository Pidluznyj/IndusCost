/**
 * Carga server-side de contextos FIN-05 e vínculos NF→Pedido para Fluxo de Caixa.
 */

import type { PrismaClient } from "@prisma/client";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import {
  loadFinanceArEffectiveOrderContextsForPortfolio,
  resolveFinanceArNfeOrderLinksFromRows,
} from "./financeAccountsReceivableEffectiveTitles.server.js";

export type FinanceCashFlowArLoadBundle = {
  arRows: FinanceCashFlowArRow[];
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
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
  const [orderContexts, nfeOrderLinks] = await Promise.all([
    loadFinanceCashFlowArOrderContexts(prisma, arRows, referenceDate),
    resolveFinanceArNfeOrderLinksFromRows(prisma, arRows),
  ]);
  return { arRows, orderContexts, nfeOrderLinks };
}
