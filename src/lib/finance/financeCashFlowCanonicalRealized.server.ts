/**
 * Conjuntos canônicos de linhas AR/AP do Fluxo de Caixa para um ano civil —
 * exatamente os MESMOS conjuntos que alimentam a "Linha do tempo mensal"
 * (`buildExecutiveMonthlyTimeline` → `sumOfficialArReceivedBySettlementInPeriod`
 * / `sumOfficialApPaidInPaymentPeriod`), expostos como LINHAS para que outras
 * telas (ex.: Tesouraria > Caixa) agreguem por dia sem reimplementar regra.
 *
 * Pipeline replicado 1:1 do endpoint /api/finance/cash-flow/dashboard com os
 * filtros padrão da página (viewMode "projected", status "all", ano):
 *   1. carga AR via `loadFinanceArTitlesSourceBundle` (ano por vencimento);
 *   2. carga AP via `buildCashFlowApPrismaWhere` + select do Fluxo;
 *   3. `filterArRowsForYtdReceived` / `filterApRowsForCashFlowExecutiveTimeline`
 *      (base saneada da timeline executiva);
 *   4. o refiltro interno das somas oficiais
 *      (`filterFinanceArManagementReportRows` / `filterFinanceApRows`).
 *
 * Somar `amountReceived` por settlementDate (AR) e `realizedAmount` por
 * `resolveFinanceApEffectivePaymentDate` (AP) sobre estes conjuntos reproduz,
 * por construção, os números "Recebido"/"Pago" daquela tela — qualquer mês,
 * mesmo particionado por dia.
 */

import type { PrismaClient } from "@prisma/client";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  parseFinanceCashFlowDashboardFilters,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import { buildCashFlowApPrismaWhere } from "@/src/lib/financeCashFlowRowFilters.js";
import {
  loadFinanceArTitlesSourceBundle,
} from "@/src/lib/finance/financeArEffectiveTitlesSource.server.js";
import {
  resolveNomusApReportSyncCutoffFromPrisma,
  type NomusApReportSyncCutoff,
} from "@/src/lib/financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import {
  buildYtdDashboardFilters,
  filterArRowsForYtdReceived,
} from "@/src/lib/financeCashFlowExecutiveYtd.js";
import { filterApRowsForCashFlowExecutiveTimeline } from "@/src/lib/financeCashFlowExecutiveSummary.js";
import { filterFinanceArManagementReportRows } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { filterFinanceApRows } from "@/src/lib/financeAccountsPayableDashboard.js";
import type { FinanceArEffectiveOrderContext } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";

export type FinanceCashFlowCanonicalRealizedYearSets = {
  year: number;
  /**
   * Linhas AR após TODOS os filtros da soma canônica de "Recebido" —
   * somar `amountReceived` por `settlementDate` == coluna da timeline mensal.
   */
  arReceivedRows: FinanceCashFlowArRow[];
  /**
   * Linhas AP após TODOS os filtros da soma canônica de "Pago" — somar
   * `resolveFinanceApRealizedAmount` por `resolveFinanceApEffectivePaymentDate`
   * (cancelados fora) == coluna da timeline mensal.
   */
  apPaidRows: FinanceCashFlowApRow[];
};

export type FinanceCashFlowCanonicalRealizedYearInput = {
  year: number;
  referenceDate: Date;
  arRows: FinanceCashFlowArRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
  apRows: FinanceCashFlowApRow[];
  apSyncCutoff: NomusApReportSyncCutoff | null;
};

/** Parte pura do pipeline (passos 3–4) — testável sem banco. */
export function deriveFinanceCashFlowCanonicalRealizedYearSets(
  input: FinanceCashFlowCanonicalRealizedYearInput
): FinanceCashFlowCanonicalRealizedYearSets {
  const filters = parseFinanceCashFlowDashboardFilters({
    year: String(input.year),
  });
  const ytdFilters = buildYtdDashboardFilters(filters, input.referenceDate);

  const arYtd = filterArRowsForYtdReceived(
    input.arRows,
    ytdFilters,
    input.referenceDate,
    input.arSyncCutoff,
    {
      orderContexts: input.orderContexts,
      nfeOrderLinks: input.nfeOrderLinks,
    }
  );
  const apYtd = filterApRowsForCashFlowExecutiveTimeline(
    input.apRows,
    ytdFilters,
    input.referenceDate,
    input.apSyncCutoff
  );

  const arReceivedRows = filterFinanceArManagementReportRows(
    arYtd,
    toArLoadFilters(ytdFilters),
    input.referenceDate,
    input.arSyncCutoff
  ) as FinanceCashFlowArRow[];
  const apPaidRows = filterFinanceApRows(
    apYtd,
    toApLoadFilters(ytdFilters),
    input.referenceDate,
    input.apSyncCutoff
  ) as FinanceCashFlowApRow[];

  return { year: input.year, arReceivedRows, apPaidRows };
}

export type FinanceCashFlowCanonicalRealizedPreloadedAr = {
  arRows: FinanceCashFlowArRow[];
  syncCutoff: NomusArReportSyncCutoff | null;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks: FinanceArNfeOrderLink[];
};

/**
 * Carga + derivação para um ano. `preloadedAr` evita repetir a carga pesada de
 * AR quando o chamador já a fez com os MESMOS filtros canônicos
 * (`{ status: "all", year }` — ex.: o board da Caixa).
 */
export async function loadFinanceCashFlowCanonicalRealizedYearSets(
  prisma: PrismaClient,
  year: number,
  referenceDate: Date,
  preloadedAr?: FinanceCashFlowCanonicalRealizedPreloadedAr
): Promise<FinanceCashFlowCanonicalRealizedYearSets> {
  const filters = parseFinanceCashFlowDashboardFilters({ year: String(year) });
  const apFilters = toApLoadFilters(filters);

  const [arSource, apSyncCutoff] = await Promise.all([
    preloadedAr ??
      loadFinanceArTitlesSourceBundle(
        prisma,
        toArLoadFilters(filters),
        referenceDate,
        {
          customerName: filters.customerName,
          personCnpj: filters.personCnpj,
        }
      ),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);

  const apWhere = buildCashFlowApPrismaWhere(
    filters,
    apFilters,
    referenceDate,
    apSyncCutoff
  );
  const apRows = (
    await prisma.nomusAccountsPayable.findMany({
      where: apWhere,
      select: FINANCE_CASH_FLOW_AP_SELECT,
      orderBy: { dueDate: "asc" },
    })
  ).map(mapPrismaRowToFinanceCashFlowApRow);

  return deriveFinanceCashFlowCanonicalRealizedYearSets({
    year,
    referenceDate,
    arRows: arSource.arRows,
    arSyncCutoff: arSource.syncCutoff,
    orderContexts: arSource.orderContexts,
    nfeOrderLinks: arSource.nfeOrderLinks,
    apRows,
    apSyncCutoff,
  });
}
