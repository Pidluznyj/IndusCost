/**
 * Orquestrador do DRE Gerencial Mensal.
 * Sempre consulta motores oficiais — não recalcula elegibilidade NF-e nem alocação AP.
 */

import { prisma } from "@/src/lib/prisma.js";
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
import { calculateSalesOrderMarginsForOrders } from "@/src/lib/salesOrderMarginService.server.js";
import {
  queryFiscalNfesForDreCmv,
  queryMonthlyFiscalNfeDeductions,
} from "@/src/lib/financeDreNfeQueries.server.js";
import {
  bucketCostCenterSpendByDreRole,
  createEmptyMonthlySeries,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import {
  allocateOrderCmvToNfeMonths,
  buildFinanceDreLines,
  emptyDreSeries,
  financeDreMonthLabels,
  roundDreMoney,
} from "@/src/lib/financeDreMath.js";
import {
  FINANCE_DRE_OFFICIAL_SOURCES,
  type FinanceDreCompany,
  type FinanceDreCostCenterBreakdownRow,
  type FinanceDreFilters,
  type FinanceDreReport,
} from "@/src/lib/financeDreTypes.js";

export class FinanceDreParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceDreParseError";
  }
}

const ROLE_LABELS: Record<DreCostCenterRole, string> = {
  logistics: "Logística / Fretes",
  packaging: "Embalagens",
  payroll: "Folha",
  benefits: "Benefícios",
  assembly: "Montagem",
  labor: "Mão de obra",
  tax: "Imposto",
  raw_material: "Matéria-prima",
  admin: "Administrativo",
};

export function parseFinanceDreQuery(
  query: Record<string, unknown>,
  referenceNow: Date = new Date()
): FinanceDreFilters {
  const nowYear = referenceNow.getFullYear();
  const nowMonth = referenceNow.getMonth() + 1;

  const yearRaw = Number.parseInt(String(query.year ?? nowYear), 10);
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear;

  const monthRaw = Number.parseInt(String(query.month ?? nowMonth), 10);
  const highlightMonth =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : nowMonth;

  const company = parseFinanceExecutiveReportCompany(query.company) as FinanceDreCompany;

  return {
    year,
    highlightMonth,
    company,
    dateBase: "emissao",
  };
}

function companyLabel(company: FinanceDreCompany): string {
  switch (company) {
    case "lazarios":
      return "Lazarios";
    case "koppetel":
      return "Koppetel";
    case "sm":
      return "SM";
    default:
      return "Todas as empresas";
  }
}

async function loadMonthlyCmvFromOfficialMargin(
  year: number,
  emitterCnpjDigits?: string
): Promise<{ cmv: number[]; unlinkedCount: number; unlinkedRevenue: number }> {
  const nfes = await queryFiscalNfesForDreCmv(year, "emissao", emitterCnpjDigits);
  if (nfes.length === 0) {
    return { cmv: emptyDreSeries(), unlinkedCount: 0, unlinkedRevenue: 0 };
  }

  const externalIds = [...new Set(nfes.map((n) => n.nfeExternalId))];
  const links = await prisma.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: externalIds } },
    select: { salesOrderId: true, nfeExternalId: true },
  });

  const orderIdByNfeExternal = new Map<number, string>();
  for (const link of links) {
    if (!orderIdByNfeExternal.has(link.nfeExternalId)) {
      orderIdByNfeExternal.set(link.nfeExternalId, link.salesOrderId);
    }
  }

  let unlinkedCount = 0;
  let unlinkedRevenue = 0;
  const nfesByOrder = new Map<string, Array<{ month: number; valorLiquido: number }>>();

  for (const nfe of nfes) {
    const orderId = orderIdByNfeExternal.get(nfe.nfeExternalId);
    if (!orderId) {
      unlinkedCount += 1;
      unlinkedRevenue += nfe.valorLiquido;
      continue;
    }
    const list = nfesByOrder.get(orderId) ?? [];
    list.push({ month: nfe.month, valorLiquido: nfe.valorLiquido });
    nfesByOrder.set(orderId, list);
  }

  const orderIds = [...nfesByOrder.keys()];
  if (orderIds.length === 0) {
    return {
      cmv: emptyDreSeries(),
      unlinkedCount,
      unlinkedRevenue: roundDreMoney(unlinkedRevenue),
    };
  }

  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      proposalId: true,
      issueDate: true,
      nomusRawResponse: true,
      items: {
        select: {
          id: true,
          productId: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          negotiatedPrice: true,
          totalNetValue: true,
          unitCost: true,
          nomusIsCanceled: true,
          nomusIsStale: true,
          nomusIsCut: true,
          nomusItemStatusNormalized: true,
        },
      },
    },
  });

  const marginByOrder = await calculateSalesOrderMarginsForOrders(prisma, orders);
  const cmv = createEmptyMonthlySeries();

  for (const order of orders) {
    const margin = marginByOrder.get(order.id);
    const totalCost = margin?.marginSummary?.totalCost ?? 0;
    const orderNetRevenue = margin?.marginSummary?.netRevenue ?? 0;
    const orderNfes = nfesByOrder.get(order.id) ?? [];
    const allocated = allocateOrderCmvToNfeMonths({
      orderTotalCost: Number(totalCost) || 0,
      orderNetRevenue: Number(orderNetRevenue) || 0,
      nfes: orderNfes,
    });
    for (let i = 0; i < 12; i += 1) {
      cmv[i] += allocated[i] ?? 0;
    }
  }

  return {
    cmv: cmv.map(roundDreMoney),
    unlinkedCount,
    unlinkedRevenue: roundDreMoney(unlinkedRevenue),
  };
}

function sumSeriesSafeLocal(a: number[], b: number[]): number[] {
  return Array.from({ length: 12 }, (_, i) => roundDreMoney((a[i] ?? 0) + (b[i] ?? 0)));
}

export async function buildFinanceDreReport(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date()
): Promise<FinanceDreReport> {
  const filters = parseFinanceDreQuery(query, referenceNow);
  const emitterCnpj = mapExecutiveReportCompanyToEmitterCnpj(filters.company);
  const companyName = mapExecutiveReportCompanyToFilter(filters.company);

  const [revenueMap, deductions, ccDashboard, cmvBundle] = await Promise.all([
    queryMonthlyFiscalNfe(filters.year, "emissao", emitterCnpj),
    queryMonthlyFiscalNfeDeductions(filters.year, "emissao", emitterCnpj),
    buildFinanceCostCenterDashboardDefault(
      buildExecutiveReportCostCenterDashboardFilters({
        year: filters.year,
        month: null,
        companyName,
      }),
      referenceNow
    ),
    loadMonthlyCmvFromOfficialMargin(filters.year, emitterCnpj),
  ]);

  const receitaBruta = emptyDreSeries();
  for (const [month, total] of revenueMap.entries()) {
    if (month >= 1 && month <= 12) receitaBruta[month - 1] = roundDreMoney(total);
  }

  const { buckets: ccBuckets, roleRows } = bucketCostCenterSpendByDreRole(
    ccDashboard.monthlySeries.byCostCenter.map((row) => ({
      month: row.month,
      year: row.year,
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      amount: row.amount,
    })),
    filters.year,
    ccDashboard.monthlySeries.totals.map((row) => ({
      month: row.month,
      year: row.year,
      unclassifiedAmount: row.unclassifiedAmount,
    })),
    filters.highlightMonth
  );

  const despesasAdmin = sumSeriesSafeLocal(ccBuckets.admin, ccBuckets.unclassified);

  const costCenterBreakdown: FinanceDreCostCenterBreakdownRow[] = roleRows.map((row) => ({
    costCenterId: row.costCenterId,
    code: row.code,
    name: row.name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    highlightAmount: row.highlightAmount,
    ytdAmount: row.ytdAmount,
  }));

  const { lines, kpis, qualityAlerts } = buildFinanceDreLines({
    highlightMonth: filters.highlightMonth,
    receitaBruta,
    cofins: deductions.cofins,
    icms: deductions.icms,
    icmsSt: deductions.icmsSt,
    ipi: deductions.ipi,
    pis: deductions.pis,
    devolucoes: deductions.devolucoes,
    cmv: cmvBundle.cmv,
    fretes: ccBuckets.logistics,
    embalagens: ccBuckets.packaging,
    despesasAdmin,
    despesasPessoal: ccBuckets.personnel,
    impostosCc: ccBuckets.tax,
    materiaPrimaCc: ccBuckets.rawMaterial,
    unclassifiedCcAmount: ccBuckets.unclassified,
    quality: {
      unlinkedNfeCount: cmvBundle.unlinkedCount,
      unlinkedNfeRevenue: cmvBundle.unlinkedRevenue,
      taxSummaryGapCount: deductions.taxSummaryGapCount,
    },
  });

  const monthName = financeDreMonthLabels()[filters.highlightMonth - 1] ?? String(filters.highlightMonth);

  return {
    schemaVersion: 1,
    title: "DRE Gerencial Mensal",
    subtitle: `${companyLabel(filters.company)} · ${monthName}/${filters.year} · competência emissão NF-e`,
    disclaimer:
      "Demonstrativo gerencial para o conselho. Não substitui o DRE contábil. Receita = NF-e emitida; despesas via centros de custo; CMV pela margem oficial da parcela faturada no mês da nota.",
    generatedAt: new Date().toISOString(),
    filters,
    companyLabel: companyLabel(filters.company),
    monthLabels: financeDreMonthLabels(),
    kpis,
    lines,
    costCenterBreakdown,
    qualityAlerts,
    sources: FINANCE_DRE_OFFICIAL_SOURCES,
  };
}
