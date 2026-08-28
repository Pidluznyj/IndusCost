/**
 * Metas (OKR) — Metric Providers CANÔNICOS (P2).
 *
 * Um provider liga uma métrica de Metas ao MOTOR OFICIAL do domínio dono do
 * número — nunca a uma fórmula paralela:
 *
 *  - NFE_FISCAL_BILLING → Financeiro > Faturamento: `queryFiscalNfeInPeriod`
 *    (predicado oficial `fiscalNfeWhereSql`: NF-e status 4 Autorizada, venda
 *    de mercado, MARKET_REVENUE, valor líquido; competência = data de
 *    emissão, a MESMA regra do BI fiscal e da DRE).
 *  - SALES_ORDERS_OFFICIAL → Comercial > Pedidos de Venda: agregado sobre a
 *    POPULAÇÃO oficial `buildSalesOrderListWhere` (exclui cancelados e
 *    MISSING_CONFIRMED operacional) + exclusão do grupo econômico, como nos
 *    domínios oficiais (executivo/DRE). Valor de PEDIDO, nunca de NF-e.
 *
 * O generic rule engine curado continua existindo como "medição
 * personalizada" — providers cobrem apenas conceitos com dono oficial.
 * Providers são explícitos e tipados (sem reflection); `deps` injetável
 * existe SÓ para teste — o default é sempre a função oficial.
 */

import type { PrismaClient } from "@prisma/client";
import { queryFiscalNfeInPeriod } from "@/src/lib/financeBillingNfeDashboard.js";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import type { GoalTrackingTypeValue, GoalDomainValue } from "./goalContracts.js";
import { listGoalSeriesMonths } from "./goalSeries.js";

export type GoalMetricProviderKey = "NFE_FISCAL_BILLING" | "SALES_ORDERS_OFFICIAL";

export type GoalMetricProviderWindow = {
  /** YYYY-MM-DD inclusivo. */
  startCivilDate: string;
  /** YYYY-MM-DD inclusivo. */
  endCivilDate: string;
};

/** Mesmo formato dos buckets do motor genérico (goalRuleEngine). */
export type GoalMetricProviderMonthlyBucket = {
  month: string;
  sum: string;
  rowCount: number;
  valueCount: number;
};

export type GoalMetricProvider = {
  key: GoalMetricProviderKey;
  label: string;
  domain: GoalDomainValue;
  unit: string;
  suggestedTrackingType: GoalTrackingTypeValue;
  /** Fonte oficial em texto leigo — exibida na UI ("Fonte: …"). */
  sourceLabel: string;
  /** De onde o número vem, em uma frase (sem tabela/coluna/SQL). */
  sourceDescription: string;
  capabilities: {
    monthlySeries: boolean;
    /** Recorte por pessoa (quota split) — nenhum provider suporta ainda. */
    employeeSlice: boolean;
    /** Filtros personalizados — providers medem a regra oficial fechada. */
    customFilters: boolean;
  };
  execute(prisma: PrismaClient, window: GoalMetricProviderWindow): Promise<string>;
  executeMonthly(
    prisma: PrismaClient,
    window: GoalMetricProviderWindow
  ): Promise<GoalMetricProviderMonthlyBucket[]>;
};

/** Dependências injetáveis SÓ para teste — default = funções oficiais. */
export type GoalMetricProviderDeps = {
  queryFiscalNfeInPeriod: typeof queryFiscalNfeInPeriod;
};

/** Data civil → limites de dia LOCAIS, como os dashboards oficiais recortam. */
function civilDayStart(civilDate: string): Date {
  const [y, m, d] = civilDate.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function civilDayEnd(civilDate: string): Date {
  const [y, m, d] = civilDate.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Meses civis da janela com os limites APARADOS pela própria janela. */
function monthWindowsWithin(
  window: GoalMetricProviderWindow
): Array<{ month: string; startCivilDate: string; endCivilDate: string }> {
  const months = listGoalSeriesMonths(window.startCivilDate, window.endCivilDate);
  return months.map((month) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const pad = (n: number) => String(n).padStart(2, "0");
    const monthStart = `${y}-${pad(m)}-01`;
    const monthEnd = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
    return {
      month,
      startCivilDate: monthStart < window.startCivilDate ? window.startCivilDate : monthStart,
      endCivilDate: monthEnd > window.endCivilDate ? window.endCivilDate : monthEnd,
    };
  });
}

function decimalString(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "0";
}

/**
 * Registro central — providers explícitos e tipados. `createGoalMetric
 * ProviderRegistry(fakeDeps)` só em teste; produção usa o singleton abaixo.
 */
export function createGoalMetricProviderRegistry(
  deps: GoalMetricProviderDeps = { queryFiscalNfeInPeriod }
): ReadonlyMap<GoalMetricProviderKey, GoalMetricProvider> {
  const nfeFiscalBilling: GoalMetricProvider = {
    key: "NFE_FISCAL_BILLING",
    label: "Faturamento (Notas Fiscais)",
    domain: "FINANCEIRO",
    unit: "R$",
    suggestedTrackingType: "INCREASE",
    sourceLabel: "Financeiro > Faturamento (NF-e)",
    sourceDescription:
      "Valor líquido das NF-e de venda autorizadas — a mesma regra da tela de Faturamento do Financeiro (competência pela data de emissão).",
    capabilities: { monthlySeries: true, employeeSlice: false, customFilters: false },
    async execute(_prisma, window) {
      const { net } = await deps.queryFiscalNfeInPeriod(
        civilDayStart(window.startCivilDate),
        civilDayEnd(window.endCivilDate),
        "emissao"
      );
      return decimalString(net ?? 0);
    },
    async executeMonthly(_prisma, window) {
      // Série mensal pela MESMA função oficial, mês a mês (limites aparados
      // pela janela do indicador) — nenhuma fórmula própria.
      const out: GoalMetricProviderMonthlyBucket[] = [];
      for (const slice of monthWindowsWithin(window)) {
        const { net, count } = await deps.queryFiscalNfeInPeriod(
          civilDayStart(slice.startCivilDate),
          civilDayEnd(slice.endCivilDate),
          "emissao"
        );
        out.push({
          month: slice.month,
          sum: decimalString(net ?? 0),
          rowCount: count ?? 0,
          valueCount: count ?? 0,
        });
      }
      return out;
    },
  };

  const salesOrdersOfficial: GoalMetricProvider = {
    key: "SALES_ORDERS_OFFICIAL",
    label: "Pedidos de Venda (regra oficial)",
    domain: "COMERCIAL",
    unit: "R$",
    suggestedTrackingType: "INCREASE",
    sourceLabel: "Comercial > Pedidos de Venda",
    sourceDescription:
      "Valor líquido dos pedidos pela mesma população da listagem do Comercial (sem cancelados e sem empresas do grupo econômico). Valor de PEDIDO, não de nota fiscal.",
    capabilities: { monthlySeries: true, employeeSlice: false, customFilters: false },
    async execute(prisma, window) {
      const agg = await prisma.salesOrder.aggregate({
        where: buildSalesOrderListWhere(
          {
            startDate: civilDayStart(window.startCivilDate),
            endDate: civilDayEnd(window.endCivilDate),
          },
          { excludeEconomicGroupCustomers: true }
        ),
        _sum: { totalNetValue: true },
      });
      return decimalString(agg._sum.totalNetValue ?? 0);
    },
    async executeMonthly(prisma, window) {
      const out: GoalMetricProviderMonthlyBucket[] = [];
      for (const slice of monthWindowsWithin(window)) {
        const agg = await prisma.salesOrder.aggregate({
          where: buildSalesOrderListWhere(
            {
              startDate: civilDayStart(slice.startCivilDate),
              endDate: civilDayEnd(slice.endCivilDate),
            },
            { excludeEconomicGroupCustomers: true }
          ),
          _sum: { totalNetValue: true },
          _count: { _all: true },
        });
        out.push({
          month: slice.month,
          sum: decimalString(agg._sum.totalNetValue ?? 0),
          rowCount: agg._count?._all ?? 0,
          valueCount: agg._count?._all ?? 0,
        });
      }
      return out;
    },
  };

  return new Map<GoalMetricProviderKey, GoalMetricProvider>([
    [nfeFiscalBilling.key, nfeFiscalBilling],
    [salesOrdersOfficial.key, salesOrdersOfficial],
  ]);
}

/** Registro de produção (funções oficiais). */
export const GOAL_METRIC_PROVIDER_REGISTRY = createGoalMetricProviderRegistry();

export function findGoalMetricProvider(
  key: string | null | undefined,
  registry: ReadonlyMap<GoalMetricProviderKey, GoalMetricProvider> = GOAL_METRIC_PROVIDER_REGISTRY
): GoalMetricProvider | null {
  if (!key) return null;
  return registry.get(key as GoalMetricProviderKey) ?? null;
}
