/**
 * Carga server-side de contextos FIN-05 e vínculos NF→Pedido para Fluxo de Caixa.
 */

import type { PrismaClient } from "@prisma/client";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import {
  loadFinanceArEffectiveOrderContexts,
  loadFinanceArEffectiveOrderContextsForPortfolio,
  mergeFinanceArEffectiveOrderContexts,
  resolveFinanceArNfeOrderLinksFromRows,
} from "./financeAccountsReceivableEffectiveTitles.server.js";

export type FinanceCashFlowArEnrichInput = {
  customerName?: string | null;
  personCnpj?: string | null;
};

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
  referenceDate: Date = new Date(),
  enrichInput?: FinanceCashFlowArEnrichInput
): Promise<FinanceCashFlowArLoadBundle> {
  const [customerContexts, portfolioContexts, nfeOrderLinks] = await Promise.all([
    loadFinanceArEffectiveOrderContexts(
      prisma,
      {
        customerName: enrichInput?.customerName,
        customerPersonId: null,
        document: enrichInput?.personCnpj,
      },
      referenceDate
    ),
    loadFinanceCashFlowArOrderContexts(prisma, arRows, referenceDate),
    resolveFinanceArNfeOrderLinksFromRows(prisma, arRows),
  ]);
  const orderContexts = mergeFinanceArEffectiveOrderContexts(
    customerContexts,
    portfolioContexts
  );
  return { arRows, orderContexts, nfeOrderLinks };
}
