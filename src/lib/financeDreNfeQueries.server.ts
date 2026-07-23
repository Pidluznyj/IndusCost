/**
 * Consultas NF-e do DRE — reutilizam o predicado oficial do Faturamento.
 * Não reinventam elegibilidade MARKET_REVENUE.
 */

import { Prisma } from "@prisma/client";
import {
  fiscalNfeWhereSql,
  nfeCompetenceDateSql,
} from "@/src/lib/financeBillingNfeDashboard.js";
import type { FinanceBillingDateBase } from "@/src/lib/financeBillingSourceTypes.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { endOfYear, startOfYear } from "@/src/lib/executiveDashboardWorkdays.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import { prisma } from "@/src/lib/prisma.js";
import { createEmptyMonthlySeries, addToMonth } from "@/src/lib/financeDreCostCenterRoles.js";
import { roundDreMoney } from "@/src/lib/financeDreMath.js";

export type MonthlyFiscalDeductions = {
  cofins: number[];
  icms: number[];
  icmsSt: number[];
  ipi: number[];
  pis: number[];
  devolucoes: number[];
  taxSummaryGapCount: number;
};

function mapMonthTotals(
  rows: Array<{ month: number; total: unknown }>
): number[] {
  const series = createEmptyMonthlySeries();
  for (const row of rows) {
    addToMonth(series, row.month, decimalToNumber(row.total) ?? 0);
  }
  return series.map(roundDreMoney);
}

/**
 * Impostos destacados das NF-e MARKET_REVENUE do ano (HEADER do fiscal summary).
 */
export async function queryMonthlyFiscalNfeDeductions(
  year: number,
  dateBase: FinanceBillingDateBase = "emissao",
  emitterCnpjDigits?: string
): Promise<MonthlyFiscalDeductions> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const dateExpr = nfeCompetenceDateSql(dateBase, "n");

  const taxRows = await prisma.$queryRaw<
    {
      month: number;
      cofins: unknown;
      icms: unknown;
      icms_st: unknown;
      ipi: unknown;
      pis: unknown;
      gap_count: bigint;
    }[]
  >(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM ${dateExpr})::int AS month,
        COALESCE(SUM(fs."vCOFINS"), 0) AS cofins,
        COALESCE(SUM(fs."vICMS"), 0) AS icms,
        COALESCE(SUM(fs."vST"), 0) AS icms_st,
        COALESCE(SUM(fs."vIPI"), 0) AS ipi,
        COALESCE(SUM(fs."vPIS"), 0) AS pis,
        COUNT(*) FILTER (WHERE fs.id IS NULL)::bigint AS gap_count
      FROM "NomusNfe" n
      LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n.id
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits, "n")}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
      GROUP BY 1
      ORDER BY 1
    `
  );

  const cofins = createEmptyMonthlySeries();
  const icms = createEmptyMonthlySeries();
  const icmsSt = createEmptyMonthlySeries();
  const ipi = createEmptyMonthlySeries();
  const pis = createEmptyMonthlySeries();
  let taxSummaryGapCount = 0;

  for (const row of taxRows) {
    addToMonth(cofins, row.month, decimalToNumber(row.cofins) ?? 0);
    addToMonth(icms, row.month, decimalToNumber(row.icms) ?? 0);
    addToMonth(icmsSt, row.month, decimalToNumber(row.icms_st) ?? 0);
    addToMonth(ipi, row.month, decimalToNumber(row.ipi) ?? 0);
    addToMonth(pis, row.month, decimalToNumber(row.pis) ?? 0);
    taxSummaryGapCount += Number(row.gap_count ?? 0n);
  }

  // Devoluções: finalidade XML = 4 (finNFe), autorizadas, no mesmo ano/empresa.
  const returnRows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM ${dateExpr})::int AS month,
        COALESCE(SUM(ABS(COALESCE(n."valorLiquido", 0))), 0) AS total
      FROM "NomusNfe" n
      LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n.id
      WHERE n."status" = ${NOMUS_NFE_STATUS_AUTHORIZED}
        AND ${dateExpr} IS NOT NULL
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
        AND (
          COALESCE(fs."finalidade", n."finalidade") = 4
        )
        ${
          emitterCnpjDigits && emitterCnpjDigits.length > 0
            ? Prisma.sql`AND regexp_replace(COALESCE(n."cnpjEmitente", ''), '[^0-9]', '', 'g') = ${emitterCnpjDigits}`
            : Prisma.empty
        }
      GROUP BY 1
      ORDER BY 1
    `
  );

  return {
    cofins: cofins.map(roundDreMoney),
    icms: icms.map(roundDreMoney),
    icmsSt: icmsSt.map(roundDreMoney),
    ipi: ipi.map(roundDreMoney),
    pis: pis.map(roundDreMoney),
    devolucoes: mapMonthTotals(returnRows),
    taxSummaryGapCount,
  };
}

export type DreNfeForCmvRow = {
  nomusNfeId: string;
  nfeExternalId: number;
  month: number;
  valorLiquido: number;
};

/** NF-e MARKET_REVENUE do ano para alocação de CMV (competência emissão). */
export async function queryFiscalNfesForDreCmv(
  year: number,
  dateBase: FinanceBillingDateBase = "emissao",
  emitterCnpjDigits?: string
): Promise<DreNfeForCmvRow[]> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const dateExpr = nfeCompetenceDateSql(dateBase, "n");

  const rows = await prisma.$queryRaw<
    {
      id: string;
      external_id: number;
      month: number;
      valor: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT
        n.id,
        n."externalId" AS external_id,
        EXTRACT(MONTH FROM ${dateExpr})::int AS month,
        n."valorLiquido" AS valor
      FROM "NomusNfe" n
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits, "n")}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
    `
  );

  return rows.map((row) => ({
    nomusNfeId: row.id,
    nfeExternalId: row.external_id,
    month: row.month,
    valorLiquido: decimalToNumber(row.valor) ?? 0,
  }));
}
