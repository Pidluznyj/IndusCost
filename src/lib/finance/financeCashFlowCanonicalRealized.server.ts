/**
 * Conjuntos canônicos de linhas AR/AP do Fluxo de Caixa para um ano civil —
 * exatamente os MESMOS conjuntos que alimentam a "Linha do tempo mensal"
 * (`buildExecutiveMonthlyTimeline` → `sumOfficialArReceivedBySettlementInPeriod`
 * / `sumOfficialApPaidInPaymentPeriod`), expostos como LINHAS para que outras
 * telas (ex.: Tesouraria > Caixa) agreguem por dia sem reimplementar regra.
 *
 * Pipeline replicado 1:1 do endpoint /api/finance/cash-flow/dashboard com os
 * filtros padrão da página (viewMode "projected", status "all", ano):
 *   1. carga AR via `loadFinanceArTitlesSourceBundle` — vencimento no ano OU
 *      baixa no ano (`resolveCashFlowArSettlementLoadWindow`), porque o
 *      realizado é alocado por data de baixa;
 *   2. carga AP via `buildCashFlowApPrismaWhere` + select do Fluxo;
 *   3. `filterArRowsForYtdReceived` (AR) e `toFinanceApPaymentScopeFilters` (AP);
 *      (base saneada do realizado — sem recorte por vencimento);

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
  resolveCashFlowArSettlementLoadWindow,
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
import {
  filterFinanceArManagementReportRows,
  toFinanceArSettlementScopeFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { filterFinanceApRows, toFinanceApPaymentScopeFilters } from "@/src/lib/financeAccountsPayableDashboard.js";
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

  // Mesmo refiltro da timeline (`buildExecutiveMonthlyTimeline`): a população do
  // realizado não pode ser recortada por vencimento, senão a baixa de um título
  // vencido em outro ano some — e os conjuntos deixariam de reproduzir a tela.
  const arReceivedRows = filterFinanceArManagementReportRows(
    arYtd,
    toFinanceArSettlementScopeFilters(toArLoadFilters(ytdFilters)),
    input.referenceDate,
    input.arSyncCutoff
  ) as FinanceCashFlowArRow[];
  const apPaidRows = filterFinanceApRows(
    input.apRows,
    toFinanceApPaymentScopeFilters(toApLoadFilters(ytdFilters)),
    input.referenceDate,
    input.apSyncCutoff
  ) as FinanceCashFlowApRow[];

  return { year: input.year, arReceivedRows, apPaidRows };
}

/**
 * Carga + derivação para um ano.
 *
 * A carga AR é sempre feita aqui, com a janela de baixa do ano
 * (`resolveCashFlowArSettlementLoadWindow`) — a mesma que a rota do Fluxo usa.
 * O parâmetro `preloadedAr` foi removido de propósito: o board da Caixa carrega
 * AR só por vencimento (a carteira aberta dele não pode receber as linhas extras
 * da janela de baixa), então reusar aquela carga aqui devolveria uma população
 * menor que a da tela e quebraria de novo o contrato de paridade.
 */
export async function loadFinanceCashFlowCanonicalRealizedYearSets(
  prisma: PrismaClient,
  year: number,
  referenceDate: Date
): Promise<FinanceCashFlowCanonicalRealizedYearSets> {
  const filters = parseFinanceCashFlowDashboardFilters({ year: String(year) });
  const apFilters = toApLoadFilters(filters);

  const [arSource, apSyncCutoff] = await Promise.all([
    loadFinanceArTitlesSourceBundle(
      prisma,
      toArLoadFilters(filters),
      referenceDate,
      {
        customerName: filters.customerName,
        personCnpj: filters.personCnpj,
      },
      { settlementWindow: resolveCashFlowArSettlementLoadWindow(filters) }
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
