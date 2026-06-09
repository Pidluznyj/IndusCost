import { Prisma } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { prisma } from "@/src/lib/prisma.js";
import { billingMarketCustomerFilterSql } from "@/src/lib/billingMarketCustomerSql.js";
import {
  nfeProcessamentoDateSql,
  nomusNfesElementsSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";
import { endOfYear, startOfYear } from "@/src/lib/executiveDashboardWorkdays.js";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";

export type FinanceBillingMonthlyComparisonRow = {
  month: number;
  salesOrderTotal: number;
  nomusNfeTotal: number;
  difference: number;
  differencePercent: number | null;
};

export type FinanceBillingComparisonPayload = {
  year: number;
  generatedAt: string;
  note: string;
  dashboardSource: "SalesOrder.nomusRawResponse.nfes";
  nfeSource: "NomusNfe";
  months: FinanceBillingMonthlyComparisonRow[];
  yearTotalSalesOrder: number;
  yearTotalNomusNfe: number;
  yearDifference: number;
};

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const MARKET_CUSTOMER = billingMarketCustomerFilterSql("c");

async function queryMonthlySalesOrderMarket(year: number): Promise<Map<number, number>> {
  const fromYmd = toPgDateYmd(startOfYear(new Date(year, 0, 1)));
  const toYmd = toPgDateYmd(endOfYear(new Date(year, 0, 1)));
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM inv.invoice_date)::int AS month,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN LATERAL (
        SELECT MAX((${nfeProcessamentoDateSql()})) AS invoice_date
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON inv.invoice_date IS NOT NULL
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND inv.invoice_date >= ${fromYmd}::date
        AND inv.invoice_date <= ${toYmd}::date
      GROUP BY 1
      ORDER BY 1
    `
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.month, decimalToNumber(row.total) ?? 0);
  }
  return map;
}

async function queryMonthlyNomusNfeMarket(year: number): Promise<Map<number, number>> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM COALESCE("xmlDhEmi", "dataProcessamento"))::int AS month,
        COALESCE(SUM("valorLiquido"), 0) AS total
      FROM "NomusNfe"
      WHERE "isMarketSale" = true
        AND ("status" IS NULL OR "status" != ${NOMUS_NFE_STATUS_CANCELLED})
        AND COALESCE("xmlDhEmi", "dataProcessamento") >= ${from}
        AND COALESCE("xmlDhEmi", "dataProcessamento") <= ${to}
      GROUP BY 1
      ORDER BY 1
    `
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.month, decimalToNumber(row.total) ?? 0);
  }
  return map;
}

function parseYear(value: unknown): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  return new Date().getFullYear();
}

export async function buildFinanceBillingNfeComparison(
  yearInput: unknown
): Promise<FinanceBillingComparisonPayload> {
  const year = parseYear(yearInput);
  const [salesOrderMap, nfeMap] = await Promise.all([
    queryMonthlySalesOrderMarket(year),
    queryMonthlyNomusNfeMarket(year),
  ]);

  const months: FinanceBillingMonthlyComparisonRow[] = [];
  let yearTotalSalesOrder = 0;
  let yearTotalNomusNfe = 0;

  for (let month = 1; month <= 12; month += 1) {
    const salesOrderTotal = salesOrderMap.get(month) ?? 0;
    const nomusNfeTotal = nfeMap.get(month) ?? 0;
    const difference = nomusNfeTotal - salesOrderTotal;
    const differencePercent =
      salesOrderTotal !== 0 ? (difference / salesOrderTotal) * 100 : null;
    yearTotalSalesOrder += salesOrderTotal;
    yearTotalNomusNfe += nomusNfeTotal;
    months.push({
      month,
      salesOrderTotal,
      nomusNfeTotal,
      difference,
      differencePercent,
    });
  }

  return {
    year,
    generatedAt: new Date().toISOString(),
    note:
      "Comparativo diagnóstico — não altera a fonte oficial do painel (SalesOrder). NF-e usa valorLiquido (vProd-vDesc) e data fiscal xmlDhEmi quando disponível.",
    dashboardSource: "SalesOrder.nomusRawResponse.nfes",
    nfeSource: "NomusNfe",
    months,
    yearTotalSalesOrder,
    yearTotalNomusNfe,
    yearDifference: yearTotalNomusNfe - yearTotalSalesOrder,
  };
}
