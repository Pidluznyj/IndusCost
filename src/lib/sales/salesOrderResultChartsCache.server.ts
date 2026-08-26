/**
 * Cache dos gráficos da listagem Comercial > Pedidos de Venda — lado servidor.
 *
 * O endpoint `/api/sales-orders/results` roda o motor oficial de margem sobre
 * TODOS os pedidos do ano (e do anterior, para o YoY) a cada chamada — é o
 * que deixava os gráficos lentos. Aqui o resultado dos DOIS gráficos é
 * materializado por ano em `SalesOrderResultChartsCache`:
 *
 * - leitura: instantânea (uma linha por ano);
 * - miss: computa uma única vez, grava e devolve;
 * - botão Atualizar da tela: `computeAndStoreSalesOrderResultChartsCache`;
 * - automático: `refreshSalesOrderResultChartsCacheAfterNomusSync` roda ao
 *   fim do sync de pedidos do Nomus (soft-fail, nunca derruba o sync).
 *
 * A página "Resultado dos Pedidos" com filtros continua no motor ao vivo —
 * este cache serve APENAS os gráficos da listagem, que só dependem do ano.
 */

import type { PrismaClient } from "@prisma/client";
import { buildSalesOrderResultDashboard } from "@/src/lib/salesOrderResultEngine.server.js";
import type {
  SalesOrderResultMonthlyRow,
  SalesOrderResultMonthlySalesComparisonRow,
} from "@/src/lib/salesOrderResultTypes.js";
import {
  resolveSalesOrderResultChartsCacheTargetYears,
  type SalesOrderResultChartsCachePayload,
} from "./salesOrderResultChartsCache.js";

export type SalesOrderResultChartsCacheDb = Pick<
  PrismaClient,
  "salesOrderResultChartsCache" | "salesOrder"
>;

export type ComputeSalesOrderResultChartsCacheDeps = {
  buildDashboard?: typeof buildSalesOrderResultDashboard;
  now?: () => Date;
};

/** Lê o cache do ano; `null` quando o ano nunca foi computado. */
export async function getSalesOrderResultChartsCache(
  db: SalesOrderResultChartsCacheDb,
  year: number
): Promise<SalesOrderResultChartsCachePayload | null> {
  const row = await db.salesOrderResultChartsCache.findUnique({
    where: { year },
  });
  if (!row) return null;
  return {
    year: row.year,
    monthlySalesComparison:
      row.monthlySalesComparisonJson as unknown as SalesOrderResultMonthlySalesComparisonRow[],
    monthlyCommercialMargin:
      row.monthlyCommercialMarginJson as unknown as SalesOrderResultMonthlyRow[],
    computedAt: row.computedAt.toISOString(),
    computeDurationMs: row.computeDurationMs,
  };
}

/**
 * Roda o motor oficial UMA vez para o ano (sem nenhum outro filtro — mesma
 * chamada que os gráficos faziam) e grava o resultado. Devolve o payload novo.
 */
export async function computeAndStoreSalesOrderResultChartsCache(
  db: SalesOrderResultChartsCacheDb,
  year: number,
  deps: ComputeSalesOrderResultChartsCacheDeps = {}
): Promise<SalesOrderResultChartsCachePayload> {
  const buildDashboard = deps.buildDashboard ?? buildSalesOrderResultDashboard;
  const nowFn = deps.now ?? (() => new Date());

  const startedAt = nowFn();
  const dashboard = await buildDashboard(db as PrismaClient, {
    year: String(year),
  });
  const computedAt = nowFn();
  const computeDurationMs = computedAt.getTime() - startedAt.getTime();

  const monthlySalesComparison = dashboard.monthlySalesComparison ?? [];
  const monthlyCommercialMargin = dashboard.monthlyCommercialMargin ?? [];

  await db.salesOrderResultChartsCache.upsert({
    where: { year },
    create: {
      year,
      monthlySalesComparisonJson: monthlySalesComparison as never,
      monthlyCommercialMarginJson: monthlyCommercialMargin as never,
      computedAt,
      computeDurationMs,
    },
    update: {
      monthlySalesComparisonJson: monthlySalesComparison as never,
      monthlyCommercialMarginJson: monthlyCommercialMargin as never,
      computedAt,
      computeDurationMs,
    },
  });

  return {
    year,
    monthlySalesComparison,
    monthlyCommercialMargin,
    computedAt: computedAt.toISOString(),
    computeDurationMs,
  };
}

export type SalesOrderResultChartsCacheAfterSyncResult = {
  skipped: boolean;
  skipReason?: string;
  yearsRefreshed: number[];
  errors: Array<{ year: number; message: string }>;
  durationMs: number;
};

/**
 * Hook pós-sync de pedidos do Nomus (mesmo padrão soft-fail dos demais
 * hooks do `nomusSalesOrdersSyncV1`): recalcula os anos de cache tocados
 * pelos pedidos afetados. NUNCA propaga erro para o sync chamador.
 */
export async function refreshSalesOrderResultChartsCacheAfterNomusSync(
  db: SalesOrderResultChartsCacheDb,
  input: { salesOrderIds: readonly string[] },
  deps: ComputeSalesOrderResultChartsCacheDeps = {}
): Promise<SalesOrderResultChartsCacheAfterSyncResult> {
  const nowFn = deps.now ?? (() => new Date());
  const startedAt = nowFn();
  const result: SalesOrderResultChartsCacheAfterSyncResult = {
    skipped: false,
    yearsRefreshed: [],
    errors: [],
    durationMs: 0,
  };

  try {
    const ids = [...new Set(input.salesOrderIds)].filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (ids.length === 0) {
      result.skipped = true;
      result.skipReason = "no_affected_orders";
      return result;
    }

    const orders = await db.salesOrder.findMany({
      where: { id: { in: ids } },
      select: { issueDate: true },
    });
    const issueYears = orders
      .map((o) => o.issueDate?.getFullYear())
      .filter((y): y is number => typeof y === "number" && Number.isFinite(y));

    const currentYear = nowFn().getFullYear();
    const targetYears = resolveSalesOrderResultChartsCacheTargetYears(
      issueYears,
      currentYear + 1
    );
    if (targetYears.length === 0) {
      result.skipped = true;
      result.skipReason = "no_target_years";
      return result;
    }

    // Só recomputa anos que alguém já consultou (linha existente) ou o ano
    // corrente — nunca cria trabalho para anos que a tela nunca pediu.
    const existing = await db.salesOrderResultChartsCache.findMany({
      where: { year: { in: targetYears } },
      select: { year: true },
    });
    const existingYears = new Set(existing.map((r) => r.year));
    const yearsToRefresh = targetYears.filter(
      (year) => existingYears.has(year) || year === currentYear
    );
    if (yearsToRefresh.length === 0) {
      result.skipped = true;
      result.skipReason = "no_cached_years";
      return result;
    }

    for (const year of yearsToRefresh) {
      try {
        await computeAndStoreSalesOrderResultChartsCache(db, year, deps);
        result.yearsRefreshed.push(year);
      } catch (error) {
        result.errors.push({
          year,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  } catch (error) {
    // Soft-fail total: o sync de pedidos permanece válido.
    result.errors.push({
      year: -1,
      message: error instanceof Error ? error.message : String(error),
    });
    return result;
  } finally {
    result.durationMs = nowFn().getTime() - startedAt.getTime();
  }
}

export function formatSalesOrderResultChartsCacheAfterSyncLog(
  result: SalesOrderResultChartsCacheAfterSyncResult
): string {
  if (result.skipped) {
    return `charts-cache pós-sync: skipped (${result.skipReason ?? "?"})`;
  }
  const errors = result.errors.length
    ? ` errors=${JSON.stringify(result.errors)}`
    : "";
  return `charts-cache pós-sync: anos=[${result.yearsRefreshed.join(", ")}] duration=${result.durationMs}ms${errors}`;
}
