/**
 * Drill-down por linha do DRE Gerencial.
 * Reutiliza os mesmos predicados/motores oficiais — totais devem reconciliar.
 */

import { Prisma } from "@prisma/client";
import {
  fiscalNfeWhereSql,
  nfeCompetenceDateSql,
} from "@/src/lib/financeBillingNfeDashboard.js";
import { buildFinanceCostCenterDashboardDefault } from "@/src/lib/financeCostCenterDashboard.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import {
  mapExecutiveReportCompanyToEmitterCnpj,
  mapExecutiveReportCompanyToFilter,
} from "@/src/lib/financeExecutiveReportCompany.js";
import { loadCmvDrilldownBundle } from "@/src/lib/financeDreCmvFromNfe.server.js";
import {
  bucketCostCenterSpendByDreRole,
  DRE_ADMIN_EXCLUDED_ROLES,
  DRE_COST_CENTER_ROLE_LABELS,
  resolveDreCostCenterRole,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import { loadDreCostCenterRoleMap } from "@/src/lib/financeDreCostCenterMapping.server.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  amountInMonthRange,
  dreDrilldownTotalsMatch,
  financeDreCompositionChildren,
  financeDreLineLabel,
  isFinanceDreDrillableLine,
  isFinanceDreEstimatedTaxLine,
  isFinanceDreSourceDrillLine,
  scopeMonthRange,
  sumDreDrilldownAmounts,
} from "@/src/lib/financeDreDrilldownMath.js";
import {
  FINANCE_DRE_CSLL_RATE,
  FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
  FINANCE_DRE_IRPJ_ADDITIONAL_RATE,
  FINANCE_DRE_IRPJ_NORMAL_RATE,
} from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import type {
  FinanceDreDrilldownColumn,
  FinanceDreDrilldownKind,
  FinanceDreDrilldownPayload,
  FinanceDreDrilldownRow,
  FinanceDreDrilldownScope,
} from "@/src/lib/financeDreDrilldownTypes.js";
import { queryMonthlyFiscalNfeDeductions } from "@/src/lib/financeDreNfeQueries.server.js";
import {
  buildFinanceDreReport,
  FinanceDreParseError,
  parseFinanceDreQuery,
} from "@/src/lib/financeDreService.server.js";
import { financeDreMonthLabels, roundDreMoney } from "@/src/lib/financeDreMath.js";
import type { FinanceDreLineId } from "@/src/lib/financeDreTypes.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { endOfYear, startOfYear } from "@/src/lib/executiveDashboardWorkdays.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import { prisma } from "@/src/lib/prisma.js";
import { queryMonthlyFiscalNfe } from "@/src/lib/financeBillingNfeDashboard.js";

const ROW_LIMIT = 800;
const NFE_XML_DEST_XNOME_REGEXP = "<dest[^>]*>.*?<xNome>([^<]+)</xNome>";

function nfeXmlDestNameSql(xmlExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(TRIM((regexp_match(COALESCE(${xmlExpr}, ''), ${NFE_XML_DEST_XNOME_REGEXP}, 'is'))[1]), '')`;
}

function companyLabel(company: string): string {
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

function periodLabel(
  scope: FinanceDreDrilldownScope,
  year: number,
  highlightMonth: number
): string {
  const labels = financeDreMonthLabels();
  const monthName = labels[highlightMonth - 1] ?? String(highlightMonth);
  return scope === "ytd"
    ? `YTD ${monthName}/${year}`
    : `${monthName}/${year}`;
}

function nfeColumns(amountLabel: string): FinanceDreDrilldownColumn[] {
  return [
    { key: "orderCode", label: "Pedido" },
    { key: "customerName", label: "Cliente" },
    { key: "nfeNumber", label: "NF-e" },
    { key: "competenceDate", label: "Emissão" },
    { key: "amount", label: amountLabel, align: "right" },
  ];
}

function ccColumns(): FinanceDreDrilldownColumn[] {
  return [
    { key: "documentLabel", label: "Centro de custo" },
    { key: "extra", label: "Papel" },
    { key: "amount", label: "Valor", align: "right" },
  ];
}

function compositionColumns(): FinanceDreDrilldownColumn[] {
  return [
    { key: "documentLabel", label: "Linha do DRE" },
    { key: "amount", label: "Valor", align: "right" },
  ];
}

function monthFilterSql(
  dateExpr: Prisma.Sql,
  fromMonth: number,
  toMonth: number
): Prisma.Sql {
  if (fromMonth === toMonth) {
    return Prisma.sql`AND EXTRACT(MONTH FROM ${dateExpr})::int = ${fromMonth}`;
  }
  return Prisma.sql`AND EXTRACT(MONTH FROM ${dateExpr})::int BETWEEN ${fromMonth} AND ${toMonth}`;
}

type NfeDetailRaw = {
  id: string;
  external_id: number;
  numero: string | null;
  serie: string | null;
  dest_name: string | null;
  order_code: string | null;
  competence: Date;
  amount: unknown;
};

async function queryNfeDetailRows(input: {
  year: number;
  fromMonth: number;
  toMonth: number;
  emitterCnpjDigits?: string;
  amountSql: Prisma.Sql;
  whereExtra?: Prisma.Sql;
  useMarketRevenuePredicate: boolean;
}): Promise<NfeDetailRaw[]> {
  const from = startOfYear(new Date(input.year, 0, 1));
  const to = endOfYear(new Date(input.year, 0, 1));
  const dateExpr = nfeCompetenceDateSql("emissao", "n");
  const baseWhere = input.useMarketRevenuePredicate
    ? fiscalNfeWhereSql("emissao", input.emitterCnpjDigits, "n")
    : Prisma.sql`
        n."status" = ${NOMUS_NFE_STATUS_AUTHORIZED}
        AND ${dateExpr} IS NOT NULL
        ${
          input.emitterCnpjDigits && input.emitterCnpjDigits.length > 0
            ? Prisma.sql`AND regexp_replace(COALESCE(n."cnpjEmitente", ''), '[^0-9]', '', 'g') = ${input.emitterCnpjDigits}`
            : Prisma.empty
        }
      `;

  return prisma.$queryRaw<NfeDetailRaw[]>(
    Prisma.sql`
      SELECT
        n.id,
        n."externalId" AS external_id,
        n.numero,
        n.serie,
        COALESCE(
          NULLIF(TRIM(c."tradeName"), ''),
          NULLIF(TRIM(c."companyName"), ''),
          ${nfeXmlDestNameSql(Prisma.sql`n."xmlRaw"`)},
          n."xmlDestCnpjCpf",
          '—'
        ) AS dest_name,
        so_link.order_code,
        ${dateExpr} AS competence,
        ${input.amountSql} AS amount
      FROM "NomusNfe" n
      LEFT JOIN "NomusNfeFiscalSummary" fs ON fs."nomusNfeId" = n.id
      LEFT JOIN "Customer" c
        ON regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(n."xmlDestCnpjCpf", ''), '[^0-9]', '', 'g')
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          NULLIF(TRIM(so."orderCode"), ''),
          NULLIF(TRIM(lnk."orderCode"), ''),
          NULLIF(TRIM(lnk."externalSalesOrderCode"), '')
        ) AS order_code
        FROM "SalesOrderNfeLink" lnk
        LEFT JOIN "SalesOrder" so ON so.id = lnk."salesOrderId"
        WHERE lnk."nfeExternalId" = n."externalId"
           OR lnk."nomusNfeId" = n.id
        ORDER BY lnk."lastSeenAt" DESC NULLS LAST
        LIMIT 1
      ) so_link ON TRUE
      WHERE ${baseWhere}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
        ${monthFilterSql(dateExpr, input.fromMonth, input.toMonth)}
        ${input.whereExtra ?? Prisma.empty}
      ORDER BY amount DESC NULLS LAST, ${dateExpr} DESC
    `
  );
}

function mapNfeRows(raw: NfeDetailRaw[]): FinanceDreDrilldownRow[] {
  return raw.map((row) => {
    const amount = roundDreMoney(decimalToNumber(row.amount) ?? 0);
    const nfeLabel =
      row.numero != null && String(row.numero).trim()
        ? String(row.numero).trim()
        : String(row.external_id);
    return {
      id: row.id,
      orderCode: row.order_code?.trim() || null,
      customerName: row.dest_name?.trim() || null,
      nfeNumber: nfeLabel,
      nfeSerie: row.serie?.trim() || null,
      documentLabel: null,
      amount,
      competenceDate: row.competence
        ? new Date(row.competence).toISOString().slice(0, 10)
        : null,
      extra: row.serie?.trim() ? `Série ${row.serie.trim()}` : null,
    };
  });
}

async function enrichCmvRowsWithNfeMeta(
  cmvRows: Array<{ nomusNfeId: string; nfeExternalId: number; amount: number }>
): Promise<FinanceDreDrilldownRow[]> {
  if (cmvRows.length === 0) return [];
  const ids = cmvRows.map((r) => r.nomusNfeId);
  const direct = await prisma.$queryRaw<NfeDetailRaw[]>(
    Prisma.sql`
      SELECT
        n.id,
        n."externalId" AS external_id,
        n.numero,
        n.serie,
        COALESCE(
          NULLIF(TRIM(c."tradeName"), ''),
          NULLIF(TRIM(c."companyName"), ''),
          ${nfeXmlDestNameSql(Prisma.sql`n."xmlRaw"`)},
          n."xmlDestCnpjCpf",
          '—'
        ) AS dest_name,
        so_link.order_code,
        COALESCE(n."xmlDhEmi", n."dataProcessamento") AS competence,
        COALESCE(n."valorLiquido", 0) AS amount
      FROM "NomusNfe" n
      LEFT JOIN "Customer" c
        ON regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(n."xmlDestCnpjCpf", ''), '[^0-9]', '', 'g')
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          NULLIF(TRIM(so."orderCode"), ''),
          NULLIF(TRIM(lnk."orderCode"), ''),
          NULLIF(TRIM(lnk."externalSalesOrderCode"), '')
        ) AS order_code
        FROM "SalesOrderNfeLink" lnk
        LEFT JOIN "SalesOrder" so ON so.id = lnk."salesOrderId"
        WHERE lnk."nfeExternalId" = n."externalId"
           OR lnk."nomusNfeId" = n.id
        ORDER BY lnk."lastSeenAt" DESC NULLS LAST
        LIMIT 1
      ) so_link ON TRUE
      WHERE n.id IN (${Prisma.join(ids)})
    `
  );

  const byId = new Map(direct.map((r) => [r.id, r]));
  return cmvRows
    .map((row) => {
      const m = byId.get(row.nomusNfeId);
      const nfeLabel =
        m?.numero != null && String(m.numero).trim()
          ? String(m.numero).trim()
          : String(row.nfeExternalId);
      return {
        id: row.nomusNfeId,
        orderCode: m?.order_code?.trim() || null,
        customerName: m?.dest_name?.trim() || null,
        nfeNumber: nfeLabel,
        nfeSerie: m?.serie?.trim() || null,
        documentLabel: null,
        amount: roundDreMoney(row.amount),
        competenceDate: m?.competence
          ? new Date(m.competence).toISOString().slice(0, 10)
          : null,
        extra: null,
      } satisfies FinanceDreDrilldownRow;
    })
    .sort((a, b) => b.amount - a.amount);
}

function roleLabel(role: DreCostCenterRole): string {
  return DRE_COST_CENTER_ROLE_LABELS[role] ?? role;
}

async function buildCcDrilldown(input: {
  lineId: "fretes" | "embalagens" | "despesas_administrativas";
  year: number;
  highlightMonth: number;
  fromMonth: number;
  toMonth: number;
  companyFilter: string | undefined;
  referenceNow: Date;
}): Promise<{ rows: FinanceDreDrilldownRow[]; expectedTotal: number; sourceNote: string }> {
  const dashboard = await buildFinanceCostCenterDashboardDefault(
    buildExecutiveReportCostCenterDashboardFilters({
      year: input.year,
      month: null,
      companyName: input.companyFilter,
    }),
    input.referenceNow
  );

  const targetRole: DreCostCenterRole | "admin_bucket" =
    input.lineId === "fretes"
      ? "logistics"
      : input.lineId === "embalagens"
        ? "packaging"
        : "admin_bucket";

  const roleMap = await loadDreCostCenterRoleMap(prisma);
  const byKey = new Map<string, FinanceDreDrilldownRow>();
  for (const row of dashboard.monthlySeries.byCostCenter) {
    if (row.year !== input.year) continue;
    if (row.month < input.fromMonth || row.month > input.toMonth) continue;
    const role = resolveDreCostCenterRole(row.code, row.name, row.costCenterId, roleMap);
    const include =
      targetRole === "logistics"
        ? role === "logistics"
        : targetRole === "packaging"
          ? role === "packaging"
          : role === "partner_investment" || !DRE_ADMIN_EXCLUDED_ROLES.has(role);
    if (!include) continue;
    const key = row.costCenterId || `${row.code}::${row.name}`;
    const current = byKey.get(key);
    if (current) {
      current.amount = roundDreMoney(current.amount + row.amount);
    } else {
      byKey.set(key, {
        id: key,
        orderCode: null,
        customerName: null,
        nfeNumber: null,
        nfeSerie: null,
        documentLabel: `${row.code} — ${row.name}`,
        amount: roundDreMoney(row.amount),
        competenceDate: null,
        extra: roleLabel(
          role === "logistics" || role === "packaging" || role === "partner_investment"
            ? role
            : "admin"
        ),
      });
    }
  }

  if (input.lineId === "despesas_administrativas") {
    let unclassified = 0;
    for (const row of dashboard.monthlySeries.totals) {
      if (row.year !== input.year) continue;
      if (row.month < input.fromMonth || row.month > input.toMonth) continue;
      unclassified += row.unclassifiedAmount;
    }
    unclassified = roundDreMoney(unclassified);
    if (Math.abs(unclassified) > 0.009) {
      byKey.set("unclassified", {
        id: "unclassified",
        orderCode: null,
        customerName: null,
        nfeNumber: null,
        nfeSerie: null,
        documentLabel: "AP sem centro de custo (provisório)",
        amount: unclassified,
        competenceDate: null,
        extra: "Não classificado",
      });
    }
  }

  const rows = [...byKey.values()].sort((a, b) => b.amount - a.amount);

  // Expected = mesmo bucket do DRE (não a soma “óbvia” das linhas montadas).
  const { buckets } = bucketCostCenterSpendByDreRole(
    dashboard.monthlySeries.byCostCenter.map((row) => ({
      month: row.month,
      year: row.year,
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      amount: row.amount,
    })),
    input.year,
    dashboard.monthlySeries.totals.map((row) => ({
      month: row.month,
      year: row.year,
      unclassifiedAmount: row.unclassifiedAmount,
    })),
    input.highlightMonth,
    roleMap
  );
  const adminSeries = Array.from({ length: 12 }, (_, i) =>
    roundDreMoney((buckets.admin[i] ?? 0) + (buckets.unclassified[i] ?? 0))
  );
  const expectedSeries =
    input.lineId === "fretes"
      ? buckets.logistics
      : input.lineId === "embalagens"
        ? buckets.packaging
        : adminSeries;
  const expectedTotal = amountInMonthRange(expectedSeries, input.fromMonth, input.toMonth);

  return {
    rows,
    expectedTotal,
    sourceNote:
      input.lineId === "fretes"
        ? "AP alocado em CC Logística/Expedição (dashboard oficial de centros de custo)"
        : input.lineId === "embalagens"
          ? "AP alocado em CC Embalagens (dashboard oficial de centros de custo)"
          : "AP em CCs administrativos + não classificados (mesmo bucket do DRE)",
  };
}

function truncateRows(rows: FinanceDreDrilldownRow[]): {
  rows: FinanceDreDrilldownRow[];
  truncated: boolean;
  rowCount: number;
  rowsTotal: number;
} {
  const rowsTotal = sumDreDrilldownAmounts(rows.map((r) => r.amount));
  const rowCount = rows.length;
  if (rowCount <= ROW_LIMIT) {
    return { rows, truncated: false, rowCount, rowsTotal };
  }
  return {
    rows: rows.slice(0, ROW_LIMIT),
    truncated: true,
    rowCount,
    rowsTotal,
  };
}

export async function buildFinanceDreLineDrilldown(
  query: Record<string, unknown>,
  lineIdRaw: string,
  referenceNow: Date = new Date()
): Promise<FinanceDreDrilldownPayload> {
  if (!isFinanceDreDrillableLine(lineIdRaw)) {
    throw new FinanceDreParseError(`Linha DRE inválida: ${lineIdRaw}`);
  }
  const lineId = lineIdRaw as FinanceDreLineId;
  const filters = parseFinanceDreQuery(query, referenceNow);
  const scopeRaw = String(query.scope ?? "highlight").toLowerCase();
  const scope: FinanceDreDrilldownScope = scopeRaw === "ytd" ? "ytd" : "highlight";
  const { fromMonth, toMonth } = scopeMonthRange(scope, filters.highlightMonth);
  const emitterCnpj = mapExecutiveReportCompanyToEmitterCnpj(filters.company);
  const companyFilter = mapExecutiveReportCompanyToFilter(filters.company);

  const baseMeta = {
    schemaVersion: 1 as const,
    lineId,
    lineLabel: financeDreLineLabel(lineId),
    scope,
    year: filters.year,
    highlightMonth: filters.highlightMonth,
    company: filters.company,
    companyLabel: companyLabel(filters.company),
    periodLabel: periodLabel(scope, filters.year, filters.highlightMonth),
    disclaimer:
      "Detalhe gerado pelos mesmos motores oficiais do DRE. O total abaixo deve coincidir com a linha clicada.",
  };

  // Provisões estimadas IRPJ/CSLL — detalhe de cálculo (valores do payload do DRE).
  if (isFinanceDreEstimatedTaxLine(lineId) || lineId === "lucro_liquido_aproximado") {
    const report = await buildFinanceDreReport(
      {
        year: filters.year,
        month: filters.highlightMonth,
        company: filters.company,
      },
      referenceNow
    );
    const tax = scope === "ytd" ? report.estimatedCorporateTaxes.ytd : report.estimatedCorporateTaxes.month;
    const parent = report.lines.find((l) => l.id === lineId);
    const expectedTotal = Math.abs(
      scope === "ytd" ? (parent?.values.ytd ?? 0) : (parent?.values.highlight ?? 0)
    );

    const taxBlock = report.estimatedCorporateTaxes;
    const entityRows: FinanceDreDrilldownRow[] =
      scope === "highlight" && taxBlock.entitiesHighlightMonth.length > 1
        ? taxBlock.entitiesHighlightMonth.map((entity) => {
            const r = entity.result;
            return {
              id: `entity-${entity.companyKey}`,
              orderCode: null,
              customerName: null,
              nfeNumber: null,
              nfeSerie: null,
              documentLabel: `${entity.companyLabel} (${entity.cnpjMasked})`,
              amount: r.estimatedIrpjCsllProvision,
              competenceDate: null,
              extra:
                `Resultado antes IRPJ/CSLL ${r.estimatedTaxBase.toFixed(2)} · ` +
                `base positiva ${r.positiveBase.toFixed(2)} · ` +
                `CSLL 9% ${r.estimatedCsll.toFixed(2)} · ` +
                `IRPJ 15% ${r.estimatedIrpjNormal.toFixed(2)} · ` +
                `limite adicional ${r.estimatedIrpjAdditionalThreshold.toFixed(2)} · ` +
                `excedente ${r.estimatedIrpjAdditionalBase.toFixed(2)} · ` +
                `adicional 10% ${r.estimatedIrpjAdditional.toFixed(2)} · ` +
                `IRPJ total ${r.estimatedIrpjTotal.toFixed(2)} · ` +
                `após provisão ${r.estimatedNetIncomeAfterTaxes.toFixed(2)}`,
            };
          })
        : [];

    if (lineId === "csll_estimada") {
      const rows: FinanceDreDrilldownRow[] = [
        ...entityRows.map((row) => {
          const entity = taxBlock.entitiesHighlightMonth.find(
            (e) => `entity-${e.companyKey}` === row.id
          );
          return {
            ...row,
            amount: entity?.result.estimatedCsll ?? 0,
            extra: entity
              ? `Base positiva ${entity.result.positiveBase.toFixed(2)} · alíquota ${(FINANCE_DRE_CSLL_RATE * 100).toFixed(0)}%`
              : row.extra,
          };
        }),
        {
          id: "base",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel:
            scope === "ytd"
              ? "Base YTD (soma dos resultados mensais antes dos tributos)"
              : "Base estimada do mês (antes do IRPJ/CSLL)",
          amount: tax.estimatedTaxBase,
          competenceDate: null,
          extra:
            scope === "ytd"
              ? "YTD = soma das estimativas mensais — não é apuração acumulada"
              : "Resultado operacional — estimativa gerencial mensal",
        },
        {
          id: "csll",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: `CSLL estimada (alíquota ${(FINANCE_DRE_CSLL_RATE * 100).toFixed(0)}%)`,
          amount: tax.estimatedCsll,
          competenceDate: null,
          extra: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
        },
      ];
      return {
        ...baseMeta,
        kind: "composition",
        expectedTotal: roundDreMoney(expectedTotal),
        rowsTotal: roundDreMoney(tax.estimatedCsll),
        totalsMatch: dreDrilldownTotalsMatch(expectedTotal, tax.estimatedCsll),
        rowCount: rows.length,
        truncated: false,
        columns: compositionColumns(),
        rows,
        sourceNote: "Ver cálculo — CSLL estimada (provisão gerencial mensal)",
        disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
      };
    }

    if (lineId === "irpj_estimado") {
      const rows: FinanceDreDrilldownRow[] = [
        ...entityRows.map((row) => {
          const entity = taxBlock.entitiesHighlightMonth.find(
            (e) => `entity-${e.companyKey}` === row.id
          );
          return {
            ...row,
            amount: entity?.result.estimatedIrpjTotal ?? 0,
            extra: entity
              ? `Normal ${entity.result.estimatedIrpjNormal.toFixed(2)} + adicional ${entity.result.estimatedIrpjAdditional.toFixed(2)}`
              : row.extra,
          };
        }),
        {
          id: "base",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel:
            scope === "ytd"
              ? "Base YTD (soma dos resultados mensais)"
              : "Base estimada do mês (antes do IRPJ/CSLL)",
          amount: tax.estimatedTaxBase,
          competenceDate: null,
          extra:
            scope === "ytd"
              ? `Soma de ${tax.monthsSummed ?? taxBlock.ytd.monthsSummed ?? 1} mês(es) — limite de R$ 20.000 reaplicado a cada mês`
              : "Estimativa gerencial mensal independente",
        },
        {
          id: "normal",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: `IRPJ normal (alíquota ${(FINANCE_DRE_IRPJ_NORMAL_RATE * 100).toFixed(0)}%)`,
          amount: tax.estimatedIrpjNormal,
          competenceDate: null,
          extra: null,
        },
        {
          id: "threshold",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: "Limite mensal do adicional (R$ 20.000 por mês e PJ)",
          amount: tax.estimatedIrpjAdditionalThreshold,
          competenceDate: null,
          extra: "Não usar R$ 20.000 × meses no YTD — o YTD soma os meses",
        },
        {
          id: "excess_base",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: "Base excedente (soma dos excedentes mensais no YTD)",
          amount: tax.estimatedIrpjAdditionalBase,
          competenceDate: null,
          extra: null,
        },
        {
          id: "additional",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: `Adicional de IRPJ (alíquota ${(FINANCE_DRE_IRPJ_ADDITIONAL_RATE * 100).toFixed(0)}% sobre o excedente)`,
          amount: tax.estimatedIrpjAdditional,
          competenceDate: null,
          extra: null,
        },
        {
          id: "total",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: "IRPJ total estimado",
          amount: tax.estimatedIrpjTotal,
          competenceDate: null,
          extra: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
        },
      ];
      return {
        ...baseMeta,
        kind: "composition",
        expectedTotal: roundDreMoney(expectedTotal),
        rowsTotal: roundDreMoney(tax.estimatedIrpjTotal),
        totalsMatch: dreDrilldownTotalsMatch(expectedTotal, tax.estimatedIrpjTotal),
        rowCount: rows.length,
        truncated: false,
        columns: compositionColumns(),
        rows,
        sourceNote: "Ver cálculo — IRPJ estimado (mensal independente; YTD = soma dos meses)",
        disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
      };
    }

    if (lineId === "provisoes_estimadas_irpj_csll") {
      const rows: FinanceDreDrilldownRow[] = [
        ...entityRows,
        {
          id: "csll_estimada",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: financeDreLineLabel("csll_estimada"),
          amount: tax.estimatedCsll,
          competenceDate: null,
          childLineId: "csll_estimada",
          extra: "Estimativa gerencial mensal",
        },
        {
          id: "irpj_estimado",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: financeDreLineLabel("irpj_estimado"),
          amount: tax.estimatedIrpjTotal,
          competenceDate: null,
          childLineId: "irpj_estimado",
          extra: "Estimativa gerencial mensal",
        },
      ];
      const rowsTotal = sumDreDrilldownAmounts([
        tax.estimatedCsll,
        tax.estimatedIrpjTotal,
      ]);
      return {
        ...baseMeta,
        kind: "composition",
        expectedTotal: roundDreMoney(expectedTotal),
        rowsTotal: roundDreMoney(rowsTotal),
        totalsMatch: dreDrilldownTotalsMatch(expectedTotal, rowsTotal),
        rowCount: rows.length,
        truncated: false,
        columns: compositionColumns(),
        rows,
        sourceNote:
          entityRows.length > 0
            ? "Provisão consolidada = soma por pessoa jurídica (sem compensar prejuízo entre CNPJs)"
            : "Soma CSLL estimada + IRPJ estimado = provisão total",
        disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
      };
    }

    // lucro_liquido_aproximado — composição resultado − provisões
    const compositionRows: FinanceDreDrilldownRow[] = (
      financeDreCompositionChildren(lineId) ?? []
    ).map((childId) => {
      const child = report.lines.find((l) => l.id === childId);
      const amount = Math.abs(
        scope === "ytd" ? (child?.values.ytd ?? 0) : (child?.values.highlight ?? 0)
      );
      return {
        id: childId,
        orderCode: null,
        customerName: null,
        nfeNumber: null,
        nfeSerie: null,
        documentLabel: financeDreLineLabel(childId),
        amount: roundDreMoney(amount),
        competenceDate: null,
        childLineId: childId,
        extra: child?.sourceNote ?? null,
      };
    });
    return {
      ...baseMeta,
      kind: "composition",
      expectedTotal: roundDreMoney(expectedTotal),
      rowsTotal: roundDreMoney(expectedTotal),
      totalsMatch: true,
      rowCount: compositionRows.length,
      truncated: false,
      columns: compositionColumns(),
      rows: compositionRows,
      sourceNote:
        "Lucro líquido aproximado = resultado operacional − provisões estimadas de IRPJ e CSLL",
      disclaimer: FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
    };
  }

  // Composição (totais/resultados): filhos com valores do próprio DRE.
  const composition = financeDreCompositionChildren(lineId);
  if (composition && !isFinanceDreSourceDrillLine(lineId)) {
    const report = await buildFinanceDreReport(
      {
        year: filters.year,
        month: filters.highlightMonth,
        company: filters.company,
      },
      referenceNow
    );
    const parent = report.lines.find((l) => l.id === lineId);
    const expectedTotal = Math.abs(
      scope === "ytd" ? (parent?.values.ytd ?? 0) : (parent?.values.highlight ?? 0)
    );
    const rows: FinanceDreDrilldownRow[] = composition.map((childId) => {
      const child = report.lines.find((l) => l.id === childId);
      const amount = Math.abs(
        scope === "ytd" ? (child?.values.ytd ?? 0) : (child?.values.highlight ?? 0)
      );
      return {
        id: childId,
        orderCode: null,
        customerName: null,
        nfeNumber: null,
        nfeSerie: null,
        documentLabel: financeDreLineLabel(childId),
        amount: roundDreMoney(amount),
        competenceDate: null,
        childLineId: childId,
        extra: child?.sourceNote ?? null,
      };
    });
    // receita_liquida / lucro: soma dos |filhos| não é o resultado — expected = parent, rowsTotal = parent
    // (lucro_liquido_aproximado e provisões IRPJ/CSLL já foram tratados acima)
    const isNetStyle =
      lineId === "receita_liquida" ||
      lineId === "lucro_bruto" ||
      lineId === "resultado_operacional";
    const rowsTotal = isNetStyle
      ? expectedTotal
      : sumDreDrilldownAmounts(rows.map((r) => r.amount));
    return {
      ...baseMeta,
      kind: "composition",
      expectedTotal: roundDreMoney(expectedTotal),
      rowsTotal: roundDreMoney(rowsTotal),
      totalsMatch: dreDrilldownTotalsMatch(expectedTotal, rowsTotal),
      rowCount: rows.length,
      truncated: false,
      columns: compositionColumns(),
      rows,
      sourceNote: isNetStyle
        ? "Composição da linha de resultado — clique em um componente para ver a origem"
        : "Soma dos componentes = total da linha no DRE",
    };
  }

  let kind: FinanceDreDrilldownKind = "nfe";
  let columns = nfeColumns("Valor");
  let sourceNote = "";
  let expectedTotal = 0;
  let detailRows: FinanceDreDrilldownRow[] = [];

  if (lineId === "receita_bruta" || lineId === "venda_mercadorias") {
    const revenueMap = await queryMonthlyFiscalNfe(filters.year, "emissao", emitterCnpj);
    const series = Array.from({ length: 12 }, (_, i) => revenueMap.get(i + 1) ?? 0);
    expectedTotal = amountInMonthRange(series, fromMonth, toMonth);
    const raw = await queryNfeDetailRows({
      year: filters.year,
      fromMonth,
      toMonth,
      emitterCnpjDigits: emitterCnpj,
      useMarketRevenuePredicate: true,
      amountSql: Prisma.sql`COALESCE(n."valorLiquido", 0)`,
    });
    detailRows = mapNfeRows(raw);
    columns = nfeColumns("Receita (líq. NF-e)");
    sourceNote = "NF-e MARKET_REVENUE autorizada · valorLiquido (motor Faturamento)";
    kind = "nfe";
  } else if (
    lineId === "cofins" ||
    lineId === "icms" ||
    lineId === "icms_st" ||
    lineId === "ipi" ||
    lineId === "pis"
  ) {
    const deductions = await queryMonthlyFiscalNfeDeductions(
      filters.year,
      "emissao",
      emitterCnpj
    );
    const fieldMap = {
      cofins: { series: deductions.cofins, sql: Prisma.sql`COALESCE(fs."vCOFINS", 0)`, label: "COFINS" },
      icms: { series: deductions.icms, sql: Prisma.sql`COALESCE(fs."vICMS", 0)`, label: "ICMS" },
      icms_st: { series: deductions.icmsSt, sql: Prisma.sql`COALESCE(fs."vST", 0)`, label: "ICMS ST" },
      ipi: { series: deductions.ipi, sql: Prisma.sql`COALESCE(fs."vIPI", 0)`, label: "IPI" },
      pis: { series: deductions.pis, sql: Prisma.sql`COALESCE(fs."vPIS", 0)`, label: "PIS" },
    } as const;
    const cfg = fieldMap[lineId];
    expectedTotal = amountInMonthRange(cfg.series, fromMonth, toMonth);
    const raw = await queryNfeDetailRows({
      year: filters.year,
      fromMonth,
      toMonth,
      emitterCnpjDigits: emitterCnpj,
      useMarketRevenuePredicate: true,
      amountSql: cfg.sql,
      whereExtra: Prisma.sql`AND (${cfg.sql}) <> 0`,
    });
    detailRows = mapNfeRows(raw);
    columns = nfeColumns(cfg.label);
    sourceNote = `${cfg.label} destacado no NomusNfeFiscalSummary (mesmo universo MARKET_REVENUE do DRE)`;
    kind = "nfe";
  } else if (lineId === "devolucoes") {
    const deductions = await queryMonthlyFiscalNfeDeductions(
      filters.year,
      "emissao",
      emitterCnpj
    );
    expectedTotal = amountInMonthRange(deductions.devolucoes, fromMonth, toMonth);
    const raw = await queryNfeDetailRows({
      year: filters.year,
      fromMonth,
      toMonth,
      emitterCnpjDigits: emitterCnpj,
      useMarketRevenuePredicate: false,
      amountSql: Prisma.sql`ABS(COALESCE(n."valorLiquido", 0))`,
      whereExtra: Prisma.sql`AND COALESCE(fs."finalidade", n."finalidade") = 4`,
    });
    detailRows = mapNfeRows(raw);
    columns = nfeColumns("Devolução");
    sourceNote = "NF-e autorizadas com finalidade=4 (devolução), mesmo filtro do DRE";
    kind = "nfe";
  } else if (lineId === "cmv") {
    const { monthlyCmv, byNfe } = await loadCmvDrilldownBundle(
      filters.year,
      fromMonth,
      toMonth,
      emitterCnpj
    );
    expectedTotal = amountInMonthRange(monthlyCmv, fromMonth, toMonth);
    detailRows = await enrichCmvRowsWithNfeMeta(byNfe);
    columns = nfeColumns("CMV");
    sourceNote =
      "Quantidade faturada na NF-e × custo vigente na data de emissão (mesmo motor do DRE)";
    kind = "cmv";
  } else if (
    lineId === "fretes" ||
    lineId === "embalagens" ||
    lineId === "despesas_administrativas"
  ) {
    const cc = await buildCcDrilldown({
      lineId,
      year: filters.year,
      highlightMonth: filters.highlightMonth,
      fromMonth,
      toMonth,
      companyFilter,
      referenceNow,
    });
    expectedTotal = cc.expectedTotal;
    detailRows = cc.rows;
    columns = ccColumns();
    sourceNote = cc.sourceNote;
    kind = "cost_center";
  } else {
    // Fallback composição se alguma linha source não mapeada
    throw new FinanceDreParseError(`Drill-down não disponível para ${lineId}`);
  }

  const sliced = truncateRows(detailRows);
  return {
    ...baseMeta,
    kind,
    expectedTotal: roundDreMoney(expectedTotal),
    rowsTotal: sliced.rowsTotal,
    totalsMatch: dreDrilldownTotalsMatch(expectedTotal, sliced.rowsTotal),
    rowCount: sliced.rowCount,
    truncated: sliced.truncated,
    columns,
    rows: sliced.rows,
    sourceNote,
  };
}
