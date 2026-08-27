/**
 * Orquestrador do DRE Gerencial Mensal.
 * Sempre consulta motores oficiais — não recalcula elegibilidade NF-e nem alocação AP.
 * CMV = item NF-e × custo vigente na data da nota (tabela de custo de produtos).
 * IRPJ/CSLL: provisão gerencial estimada (não grava tributos nem apuração fiscal).
 *
 * Este módulo carrega as SÉRIES BRUTAS das fontes (I/O caro em
 * `loadFinanceDreRawSourceSeries`); toda a matemática/montagem do relatório é
 * pura e vive em `financeDreReportBuilder` — compartilhada com o caminho de
 * snapshot anual materializado (`financeDreSnapshot.server`).
 */

import { queryMonthlyFiscalNfe } from "@/src/lib/financeBillingNfeDashboard.js";
import {
  buildFinanceCostCenterDashboardDefault,
} from "@/src/lib/financeCostCenterDashboard.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import {
  mapExecutiveReportCompanyToEmitterCnpj,
  mapExecutiveReportCompanyToFilter,
  parseFinanceExecutiveReportCompany,
} from "@/src/lib/financeExecutiveReportCompany.js";
import { queryMonthlyFiscalNfeDeductions } from "@/src/lib/financeDreNfeQueries.server.js";
import { loadMonthlyCmvFromNfeProductCosts } from "@/src/lib/financeDreCmvFromNfe.server.js";
import { loadDreCostCenterRoleMap } from "@/src/lib/financeDreCostCenterMapping.server.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildFinanceDreReportFromRawSources,
  FINANCE_DRE_LEGAL_ENTITY_COMPANIES,
  type FinanceDreRawSourceSeries,
} from "@/src/lib/financeDreReportBuilder.js";
import {
  emptyDreSeries,
  resolveFinanceDreAvailableThroughMonth,
  roundDreMoney,
} from "@/src/lib/financeDreMath.js";
import type {
  FinanceDreCompany,
  FinanceDreFilters,
  FinanceDreReport,
} from "@/src/lib/financeDreTypes.js";

export class FinanceDreParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceDreParseError";
  }
}

export function parseFinanceDreQuery(
  query: Record<string, unknown>,
  referenceNow: Date = new Date()
): FinanceDreFilters {
  const nowYear = referenceNow.getFullYear();
  const nowMonth = referenceNow.getMonth() + 1;

  const yearRaw = Number.parseInt(String(query.year ?? nowYear), 10);
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear;

  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(year, referenceNow);
  const monthRaw = Number.parseInt(String(query.month ?? nowMonth), 10);
  const requestedMonth =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : nowMonth;
  // Não destaca mês futuro: limita ao último mês com competência disponível.
  const highlightMonth =
    availableThroughMonth <= 0
      ? 1
      : Math.min(requestedMonth, availableThroughMonth);

  const company = parseFinanceExecutiveReportCompany(query.company) as FinanceDreCompany;

  return {
    year,
    highlightMonth,
    company,
    dateBase: "emissao",
  };
}

/**
 * Carrega as séries BRUTAS de 12 meses das fontes oficiais para (year, company).
 * É o custo pesado do DRE — e exatamente o que o snapshot anual materializa.
 * Nenhum clamp temporal nem bucketing por papel acontece aqui (read-time).
 */
export async function loadFinanceDreRawSourceSeries(
  year: number,
  company: FinanceDreCompany,
  referenceNow: Date = new Date()
): Promise<FinanceDreRawSourceSeries> {
  const emitterCnpj = mapExecutiveReportCompanyToEmitterCnpj(company);
  const companyName = mapExecutiveReportCompanyToFilter(company);

  const [revenueMap, deductions, ccDashboard, cmvBundle] = await Promise.all([
    queryMonthlyFiscalNfe(year, "emissao", emitterCnpj),
    queryMonthlyFiscalNfeDeductions(year, "emissao", emitterCnpj),
    buildFinanceCostCenterDashboardDefault(
      buildExecutiveReportCostCenterDashboardFilters({
        year,
        month: null,
        companyName,
      }),
      referenceNow
    ),
    loadMonthlyCmvFromNfeProductCosts(year, emitterCnpj),
  ]);

  const receitaBrutaByMonth = emptyDreSeries();
  for (const [month, total] of revenueMap.entries()) {
    if (month >= 1 && month <= 12) receitaBrutaByMonth[month - 1] = roundDreMoney(total);
  }

  // Agrega a série oficial mensal por CC em byMonth[12] (soma associativa —
  // idêntica à passada linha a linha para o bucket em read-time).
  const byCcKey = new Map<
    string,
    { costCenterId: string; code: string; name: string; byMonth: number[] }
  >();
  for (const row of ccDashboard.monthlySeries.byCostCenter) {
    if (row.year !== year) continue;
    if (row.month < 1 || row.month > 12) continue;
    const amount = Number.isFinite(row.amount) ? row.amount : 0;
    if (amount === 0) continue;
    const key = row.costCenterId || `${row.code}::${row.name}`;
    const current = byCcKey.get(key) ?? {
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      byMonth: emptyDreSeries(),
    };
    current.byMonth[row.month - 1] += amount;
    byCcKey.set(key, current);
  }

  const unclassifiedByMonth = emptyDreSeries();
  for (const row of ccDashboard.monthlySeries.totals) {
    if (row.year !== year) continue;
    if (row.month < 1 || row.month > 12) continue;
    unclassifiedByMonth[row.month - 1] += Number.isFinite(row.unclassifiedAmount)
      ? row.unclassifiedAmount
      : 0;
  }

  return {
    year,
    company,
    receitaBrutaByMonth,
    deductions: {
      cofins: deductions.cofins,
      icms: deductions.icms,
      icmsSt: deductions.icmsSt,
      ipi: deductions.ipi,
      pis: deductions.pis,
      devolucoes: deductions.devolucoes,
      taxSummaryGapCount: deductions.taxSummaryGapCount,
    },
    cmv: {
      cmvByMonth: cmvBundle.cmv,
      missingItemsRevenueByMonth: cmvBundle.missingItemsRevenueByMonth,
      missingProductRevenueByMonth: cmvBundle.missingProductRevenueByMonth,
      missingCostRevenueByMonth: cmvBundle.missingCostRevenueByMonth,
      missingItemsNfeCount: cmvBundle.missingItemsNfeCount,
      missingProductLineCount: cmvBundle.missingProductLineCount,
      missingCostLineCount: cmvBundle.missingCostLineCount,
      pricedLineCount: cmvBundle.pricedLineCount,
    },
    costCenters: {
      byCostCenter: [...byCcKey.values()],
      unclassifiedByMonth,
    },
  };
}

/**
 * Caminho LIVE (motores oficiais a cada chamada) — usado pelo cash-bridge,
 * drill-downs e como fallback/primeiro cômputo do snapshot.
 */
export async function buildFinanceDreReport(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date()
): Promise<FinanceDreReport> {
  const filters = parseFinanceDreQuery(query, referenceNow);
  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(
    filters.year,
    referenceNow
  );

  const [roleMap, consolidated, perEntity] = await Promise.all([
    loadDreCostCenterRoleMap(prisma),
    loadFinanceDreRawSourceSeries(filters.year, filters.company, referenceNow),
    filters.company === "all"
      ? Promise.all(
          FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((company) =>
            loadFinanceDreRawSourceSeries(filters.year, company, referenceNow)
          )
        )
      : Promise.resolve(null),
  ]);

  return buildFinanceDreReportFromRawSources({
    filters,
    availableThroughMonth,
    roleMap,
    consolidated,
    perEntity,
  });
}
