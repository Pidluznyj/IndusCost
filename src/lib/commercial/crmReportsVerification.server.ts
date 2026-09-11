/**
 * Conferência read-only: CRM > Relatórios × Pedidos de Venda (oficial).
 *
 * CLI: scripts/verify-crm-reports-vs-sales-orders.ts. SOMENTE LEITURA — só
 * `findMany`/`groupBy`; nada é escrito, migrado ou cacheado.
 *
 * Lado OFICIAL: `buildSalesOrderListWhere(…, { excludeEconomicGroupCustomers: true })`
 * — a população da tela Pedidos de Venda — com o recorte de emissão da
 * própria tela (Emissão de 00:00 / até 23:59:59.999, dia local) e agregado
 * NO BANCO (`groupBy` count/sum/max). Não reaproveita a agregação em memória
 * do relatório.
 *
 * Lado RELATÓRIO: `runCrmReportsAnalysis` — o pipeline do
 * POST /api/crm/reports/operational — com escopo global e o mesmo
 * arredondamento de apresentação do DTO.
 *
 * Critérios (negócio), por cliente do universo do relatório:
 *   quantidade → delta 0 (pedidos 60d / 12m)
 *   dinheiro   → delta R$ 0,00 (valor 60d / 12m)
 *   data       → igual (última compra)
 * Cliente elegível (ativo, fora do grupo) com pedido oficial e ausente do
 * relatório também é divergência. Cliente INATIVO é exclusão de regra (aviso).
 */

import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import {
  createPrismaCrmReportsDataSource,
  runCrmReportsAnalysis,
  type CrmReportsDataSource,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";
import {
  roundCrmReportsMoney,
  type CrmReportsCustomerFacts,
} from "@/src/lib/commercial/crmReportsOperationalCore.js";
import { toBusinessDate } from "@/src/lib/commercial/crmRepurchaseEngine.js";
import type {
  CrmReportsNormalizedFilters,
  CrmReportsWindows,
} from "@/src/lib/commercial/crmReportsTypes.js";

export const CRM_REPORTS_VERIFICATION_INDICATORS = {
  orders60d: "pedidos 60d",
  purchaseValue60d: "valor 60d",
  lastPurchaseDate: "última compra",
  orders12m: "pedidos 12m",
  purchaseValue12m: "valor 12m",
} as const;

export type CrmReportsVerificationKind = "count" | "money" | "date";

export type CrmReportsVerificationRow = {
  customerId: string;
  customerName: string;
  indicator: string;
  kind: CrmReportsVerificationKind;
  pv: number | string | null;
  crm: number | string | null;
  delta: number | string;
  status: "OK" | "DIVERGENTE";
};

export type CrmReportsVerificationTotal = {
  indicator: string;
  kind: "count" | "money";
  pv: number;
  crm: number;
  delta: number;
  status: "OK" | "DIVERGENTE";
};

export type CrmReportsVerificationResult = {
  summary: {
    asOf: string;
    windows: CrmReportsWindows;
    customersCompared: number;
    ordersLoadedByReport: number;
    comparisons: number;
    divergentComparisons: number;
    divergentTotals: number;
    approved: boolean;
  };
  totals: CrmReportsVerificationTotal[];
  rows: CrmReportsVerificationRow[];
  divergences: CrmReportsVerificationRow[];
  inactiveOutsideUniverse: Array<{ id: string; companyName: string }>;
  warnings: string[];
};

type OfficialAgg = { orders: number; value: number };

type VerificationPrisma = Pick<PrismaClient, "salesOrder" | "customer">;

/** Escopo global sintético: conferência de homologação, sem recorte de carteira. */
export const CRM_REPORTS_VERIFIER_SCOPE: CrmCommercialAccessScope = {
  canViewCommercialGeneral: true,
  canViewAllSellers: true,
  canViewOwnSellerData: true,
  dataScope: "global",
  sellerLocked: false,
  externalSellerId: null,
  responsible: null,
  sellerIdentityKey: null,
  sellerLinked: true,
  blockedReason: null,
  blockedMessage: null,
};

function startOfBusinessDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfBusinessDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

const toCents = (value: number) => Math.round(roundCrmReportsMoney(value) * 100);

/** Lado OFICIAL — construtor da tela Pedidos de Venda + agregação no banco. */
async function readOfficialSide(
  prisma: VerificationPrisma,
  windows: CrmReportsWindows,
  customerIds: readonly string[]
) {
  // `groupBy` tem inferência recursiva pesada; handle tipado (mesmo padrão do cockpit).
  const groupSalesOrders = prisma.salesOrder.groupBy as unknown as (
    args: Record<string, unknown>
  ) => Promise<Array<Record<string, any>>>;

  const endDate = endOfBusinessDay(windows.today);
  const where = (startDate: Date | null) => {
    const official = buildSalesOrderListWhere({ startDate, endDate }, { excludeEconomicGroupCustomers: true });
    return customerIds.length > 0 ? { AND: [official, { customerId: { in: [...customerIds] } }] } : official;
  };

  const [agg60, agg12, aggLast] = await Promise.all([
    groupSalesOrders({
      by: ["customerId"],
      where: where(startOfBusinessDay(windows.recent60d.from)),
      _count: { _all: true },
      _sum: { totalNetValue: true },
    }),
    groupSalesOrders({
      by: ["customerId"],
      where: where(startOfBusinessDay(windows.rolling12m.from)),
      _count: { _all: true },
      _sum: { totalNetValue: true },
    }),
    groupSalesOrders({ by: ["customerId"], where: where(null), _max: { issueDate: true } }),
  ]);

  const toAgg = (rows: Array<Record<string, any>>) =>
    new Map<string, OfficialAgg>(
      rows.map((row) => [
        String(row.customerId),
        { orders: Number(row._count._all), value: decimalToNumber(row._sum.totalNetValue) ?? 0 },
      ])
    );
  return {
    recent60d: toAgg(agg60),
    rolling12m: toAgg(agg12),
    lastPurchase: new Map<string, string | null>(
      aggLast.map((row) => [String(row.customerId), toBusinessDate(row._max.issueDate ?? null)])
    ),
  };
}

function compareCustomer(
  facts: CrmReportsCustomerFacts,
  official: Awaited<ReturnType<typeof readOfficialSide>>
): CrmReportsVerificationRow[] {
  const customerId = facts.customer.id;
  const customerName = facts.customer.companyName;
  const o60 = official.recent60d.get(customerId) ?? { orders: 0, value: 0 };
  const o12 = official.rolling12m.get(customerId) ?? { orders: 0, value: 0 };
  const oLast = official.lastPurchase.get(customerId) ?? null;
  const base = { customerId, customerName };

  const count = (indicator: string, pv: number, crm: number): CrmReportsVerificationRow => {
    const delta = crm - pv;
    return { ...base, indicator, kind: "count", pv, crm, delta, status: delta === 0 ? "OK" : "DIVERGENTE" };
  };
  const money = (indicator: string, pv: number, crm: number): CrmReportsVerificationRow => {
    const delta = (toCents(crm) - toCents(pv)) / 100;
    return {
      ...base,
      indicator,
      kind: "money",
      pv: roundCrmReportsMoney(pv),
      crm: roundCrmReportsMoney(crm),
      delta,
      status: delta === 0 ? "OK" : "DIVERGENTE",
    };
  };
  const date = (indicator: string, pv: string | null, crm: string | null): CrmReportsVerificationRow => ({
    ...base,
    indicator,
    kind: "date",
    pv,
    crm,
    delta: pv === crm ? "=" : "≠",
    status: pv === crm ? "OK" : "DIVERGENTE",
  });

  const I = CRM_REPORTS_VERIFICATION_INDICATORS;
  return [
    count(I.orders60d, o60.orders, facts.orders60d),
    money(I.purchaseValue60d, o60.value, facts.purchaseValue60d),
    date(I.lastPurchaseDate, oLast, facts.lastPurchaseDate),
    count(I.orders12m, o12.orders, facts.orders12m),
    money(I.purchaseValue12m, o12.value, facts.purchaseValue12m),
  ];
}

export async function verifyCrmReportsAgainstSalesOrders(
  prisma: VerificationPrisma,
  options: {
    now: Date;
    customerIds?: readonly string[];
    /** Teste: lado relatório alternativo. Default = fonte Prisma do endpoint. */
    dataSource?: CrmReportsDataSource;
  }
): Promise<CrmReportsVerificationResult> {
  const customerIds = [...new Set(options.customerIds ?? [])];
  const filters: CrmReportsNormalizedFilters = {
    customerIds: [],
    commercialOwner: null,
    lastOrderSeller: null,
    cities: [],
    states: [],
    customerSelection:
      customerIds.length > 0 ? { mode: "ONLY", customerIds } : { mode: "ALL", customerIds: [] },
  };
  const report = await runCrmReportsAnalysis(
    options.dataSource ?? createPrismaCrmReportsDataSource(prisma as PrismaClient),
    CRM_REPORTS_VERIFIER_SCOPE,
    filters,
    { now: options.now }
  );
  const windows = report.analysis.windows;
  const official = await readOfficialSide(prisma, windows, customerIds);

  const rows: CrmReportsVerificationRow[] = [];
  for (const facts of report.analysis.analyzed) rows.push(...compareCustomer(facts, official));

  // Totais do universo do relatório × oficial restrito aos MESMOS clientes.
  const inUniverse = new Set(report.analysis.analyzed.map((f) => f.customer.id));
  const sumOfficial = (map: Map<string, OfficialAgg>) => {
    let orders = 0;
    let cents = 0;
    for (const [id, agg] of map) {
      if (!inUniverse.has(id)) continue;
      orders += agg.orders;
      cents += toCents(agg.value);
    }
    return { orders, value: cents / 100 };
  };
  const sumReport = (pick: (f: CrmReportsCustomerFacts) => OfficialAgg) => {
    let orders = 0;
    let cents = 0;
    for (const facts of report.analysis.analyzed) {
      const v = pick(facts);
      orders += v.orders;
      cents += toCents(v.value);
    }
    return { orders, value: cents / 100 };
  };
  const pv60 = sumOfficial(official.recent60d);
  const crm60 = sumReport((f) => ({ orders: f.orders60d, value: f.purchaseValue60d }));
  const pv12 = sumOfficial(official.rolling12m);
  const crm12 = sumReport((f) => ({ orders: f.orders12m, value: f.purchaseValue12m }));
  const totals: CrmReportsVerificationTotal[] = [
    { indicator: "Σ pedidos 60d", kind: "count" as const, pv: pv60.orders, crm: crm60.orders },
    { indicator: "Σ valor 60d", kind: "money" as const, pv: pv60.value, crm: crm60.value },
    { indicator: "Σ pedidos 12m", kind: "count" as const, pv: pv12.orders, crm: crm12.orders },
    { indicator: "Σ valor 12m", kind: "money" as const, pv: pv12.value, crm: crm12.value },
  ].map((t) => {
    const delta = t.kind === "money" ? (toCents(t.crm) - toCents(t.pv)) / 100 : t.crm - t.pv;
    return { ...t, delta, status: delta === 0 ? "OK" : "DIVERGENTE" };
  });

  // Pedido oficial de cliente fora do universo: INATIVO = regra (aviso);
  // elegível ausente = divergência.
  const outsideIds = [...official.lastPurchase.keys()].filter((id) => !inUniverse.has(id));
  const outsideCustomers = outsideIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: outsideIds } },
        select: { id: true, companyName: true, status: true },
      })
    : [];
  const inactiveOutside = outsideCustomers.filter((c) => c.status === "INACTIVE");
  for (const customer of outsideCustomers.filter((c) => c.status !== "INACTIVE")) {
    rows.push({
      customerId: customer.id,
      customerName: customer.companyName,
      indicator: "cliente no universo",
      kind: "count",
      pv: 1,
      crm: 0,
      delta: -1,
      status: "DIVERGENTE",
    });
  }

  const divergences = rows.filter((r) => r.status === "DIVERGENTE");
  const divergentTotals = totals.filter((t) => t.status === "DIVERGENTE");
  const warnings: string[] = [];
  if (inactiveOutside.length > 0) {
    warnings.push(
      `${inactiveOutside.length} cliente(s) INATIVO(s) com Pedido de Venda oficial ficam fora do relatório por regra (cliente elegível = ativo).`
    );
  }
  if (report.analysis.futureDatedOrdersIgnored > 0) {
    warnings.push(
      `${report.analysis.futureDatedOrdersIgnored} pedido(s) com emissão depois de ${windows.today} fora das janelas nos dois lados.`
    );
  }

  return {
    summary: {
      asOf: report.now.toISOString(),
      windows,
      customersCompared: report.analysis.analyzed.length,
      ordersLoadedByReport: report.ordersLoaded,
      comparisons: rows.length,
      divergentComparisons: divergences.length,
      divergentTotals: divergentTotals.length,
      approved: divergences.length === 0 && divergentTotals.length === 0,
    },
    totals,
    rows,
    divergences,
    inactiveOutsideUniverse: inactiveOutside.map((c) => ({ id: c.id, companyName: c.companyName })),
    warnings,
  };
}
