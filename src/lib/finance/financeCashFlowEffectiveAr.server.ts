/**
 * Carga server-side de contextos FIN-05 e vínculos NF→Pedido para Fluxo de Caixa.
 */

import type { PrismaClient } from "@prisma/client";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import type { CashFlowProjectionMode } from "./cashFlowLightProjectionFlag.js";
import {
  loadFinanceArEffectiveOrderContexts,
  loadFinanceArEffectiveOrderContextsForPortfolio,
  mergeFinanceArEffectiveOrderContexts,
  resolveFinanceArNfeOrderLinksFromRows,
} from "./financeAccountsReceivableEffectiveTitles.server.js";
import { measureDevPerfPhase } from "@/src/lib/devPerfBaseline.server.js";

export type FinanceCashFlowArEnrichInput = {
  customerName?: string | null;
  personCnpj?: string | null;
  /**
   * Fonte da projeção dos pedidos. Default `"legacy"`: só os três endpoints
   * do Fluxo de Caixa passam `"light"`, e só com a flag ligada. Relatório
   * executivo e tesouraria não informam este campo e seguem no caminho antigo.
   */
  projectionMode?: CashFlowProjectionMode;
};

export type FinanceCashFlowArLoadBundle = {
  arRows: FinanceCashFlowArRow[];
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
};

export async function loadFinanceCashFlowArOrderContexts(
  prisma: PrismaClient,
  arRows: FinanceCashFlowArRow[],
  referenceDate: Date = new Date(),
  projectionMode: CashFlowProjectionMode = "legacy"
): Promise<FinanceArEffectiveOrderContext[]> {
  return loadFinanceArEffectiveOrderContextsForPortfolio(
    prisma,
    arRows,
    referenceDate,
    undefined,
    projectionMode
  );
}

export async function enrichFinanceCashFlowArLoadBundle(
  prisma: PrismaClient,
  arRows: FinanceCashFlowArRow[],
  referenceDate: Date = new Date(),
  enrichInput?: FinanceCashFlowArEnrichInput
): Promise<FinanceCashFlowArLoadBundle> {
  const projectionMode: CashFlowProjectionMode =
    enrichInput?.projectionMode ?? "legacy";
  const [customerContexts, portfolioContexts, nfeOrderLinks] = await measureDevPerfPhase(
    "orderProjection",
    () =>
      Promise.all([
        loadFinanceArEffectiveOrderContexts(
          prisma,
          {
            customerName: enrichInput?.customerName,
            customerPersonId: null,
            document: enrichInput?.personCnpj,
          },
          referenceDate,
          projectionMode
        ),
        loadFinanceCashFlowArOrderContexts(
          prisma,
          arRows,
          referenceDate,
          projectionMode
        ),
        resolveFinanceArNfeOrderLinksFromRows(prisma, arRows),
      ])
  );
  const orderContexts = mergeFinanceArEffectiveOrderContexts(
    customerContexts,
    portfolioContexts
  );
  return { arRows, orderContexts, nfeOrderLinks };
}
