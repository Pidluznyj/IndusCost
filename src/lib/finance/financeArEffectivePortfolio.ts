/**
 * Motor compartilhado — Contas a Receber (Títulos) e Fluxo de Caixa.
 *
 * Uma única regra operacional: portfolio gerencial → FIN-08 (com FIN-05) ou
 * suppress FIN-02 enriquecido por vínculo NF→Pedido quando a agenda não carrega.
 */

import type {
  FinanceArDashboardFilters,
  FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { deduplicateFinanceArRows } from "@/src/lib/financeAccountsReceivableDeduplication.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import {
  buildFinanceArEffectiveTitles,
  filterFinanceArEffectiveTitlesByDashboardFilters,
  mapFinanceArDashboardRowToEffectiveTitle,
  type FinanceArEffectiveOrderContext,
  type FinanceArEffectiveTitleListItem,
} from "./financeAccountsReceivableEffectiveTitles.js";
import {
  buildFinanceArOrderCodeResolverWithNfeLinks,
  filterFinanceArOperationalPortfolioRows,
  suppressInferiorPreNfNomusArRows,
  suppressObsoleteOpenPreNfNomusArRows,
  suppressPreNfReplacedByRealCrOnSameOrder,
  type FinanceArNfeOrderLink,
} from "./financeArOperationalPortfolio.js";

export type { FinanceArNfeOrderLink };

export type BuildFinanceArEffectivePortfolioInput = {
  /** Linhas Nomus (carteira gerencial já filtrada ou bruta + filters). */
  rows: FinanceArDashboardRow[];
  filters: FinanceArDashboardFilters;
  orderContexts?: FinanceArEffectiveOrderContext[];
  nfeOrderLinks?: FinanceArNfeOrderLink[];
  orderCode?: string | null;
  customerPersonId?: number | null;
  customerName?: string | null;
  customerCnpj?: string | null;
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
  /** Quando true, aplica filterFinanceArOperationalPortfolioRows antes do motor. */
  applyOperationalPortfolioFilter?: boolean;
};

/**
 * Agenda efetiva do portfólio AR — mesma regra da grade de Títulos (FIN-08).
 */
export function buildFinanceArEffectivePortfolioItems(
  input: BuildFinanceArEffectivePortfolioInput
): FinanceArEffectiveTitleListItem[] {
  const referenceDate = input.referenceDate ?? new Date();
  const contexts = input.orderContexts ?? [];
  const orderCode = input.orderCode?.trim() || null;
  const nfeOrderLinks = input.nfeOrderLinks ?? [];

  const nomusRows = input.applyOperationalPortfolioFilter !== false
    ? filterFinanceArOperationalPortfolioRows(
        input.rows,
        input.filters,
        referenceDate,
        input.syncCutoff
      )
    : input.rows;

  if (contexts.length > 0 || orderCode) {
    const effective = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts: contexts,
      nfeOrderLinks,
      orderCode,
      customerPersonId: input.customerPersonId,
      customerName: input.customerName,
      customerCnpj: input.customerCnpj,
      referenceDate,
    });
    if (orderCode && contexts.length === 0) {
      return [];
    }
    return filterFinanceArEffectiveTitlesByDashboardFilters(
      effective.items,
      input.filters,
      referenceDate
    );
  }

  const resolveOrderCode = buildFinanceArOrderCodeResolverWithNfeLinks(
    nomusRows,
    nfeOrderLinks
  );
  let operational = deduplicateFinanceArRows(nomusRows).rows;
  operational = suppressPreNfReplacedByRealCrOnSameOrder(operational, {
    resolveOrderCode,
  });
  if (nfeOrderLinks.length > 0) {
    // Com vínculo NF→Pedido: não remove todas as pré-NF do pedido — só as já
    // substituídas no mesmo vencimento; mantém residual (ex.: parcela 3 PD 02719).
    operational = suppressObsoleteOpenPreNfNomusArRows(operational, {
      resolveOrderCode,
    });
  } else {
    operational = suppressInferiorPreNfNomusArRows(operational, {
      resolveOrderCode,
    });
  }

  return operational.map((row) =>
    mapFinanceArDashboardRowToEffectiveTitle(row, referenceDate, null)
  );
}
