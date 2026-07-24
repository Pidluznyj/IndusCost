/**
 * Drill-down da Validação das fontes oficiais do DRE.
 * Mostra os registros que geram OK / Atenção / Info.
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
import { listUnclassifiedAccountsPayableDefault } from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  loadCmvGapsForMonthRange,
  type DreCmvGapRow,
} from "@/src/lib/financeDreCmvFromNfe.server.js";
import {
  classifyDreCostCenterRole,
  DRE_PERSONNEL_ROLES,
} from "@/src/lib/financeDreCostCenterRoles.js";
import {
  amountInMonthRange,
  scopeMonthRange,
  sumDreDrilldownAmounts,
} from "@/src/lib/financeDreDrilldownMath.js";
import type {
  FinanceDreDrilldownColumn,
  FinanceDreDrilldownPayload,
  FinanceDreDrilldownRow,
  FinanceDreDrilldownScope,
} from "@/src/lib/financeDreDrilldownTypes.js";
import {
  buildFinanceDreLineDrilldown,
} from "@/src/lib/financeDreDrilldown.server.js";
import {
  cmvGapKindLabel,
  financeDreSourceCheckLabel,
  isFinanceDreSourceCheckId,
  type FinanceDreSourceCheckId,
} from "@/src/lib/financeDreSourceCheckDrilldownMath.js";
import {
  FinanceDreParseError,
  parseFinanceDreQuery,
} from "@/src/lib/financeDreService.server.js";
import { financeDreMonthLabels, roundDreMoney } from "@/src/lib/financeDreMath.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { endOfYear, startOfYear } from "@/src/lib/executiveDashboardWorkdays.js";
import { prisma } from "@/src/lib/prisma.js";

const ROW_LIMIT = 800;
const NFE_XML_DEST_XNOME_REGEXP = "<dest[^>]*>.*?<xNome>([^<]+)</xNome>";

function nfeXmlDestNameSql(xmlExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(TRIM((regexp_match(COALESCE(${xmlExpr}, ''), ${NFE_XML_DEST_XNOME_REGEXP}, 'is'))[1]), '')`;
}

function periodLabel(
  scope: FinanceDreDrilldownScope,
  year: number,
  highlightMonth: number
): string {
  const labels = financeDreMonthLabels();
  const monthName = labels[highlightMonth - 1] ?? String(highlightMonth);
  return scope === "ytd" ? `YTD ${monthName}/${year}` : `${monthName}/${year}`;
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

function truncate(rows: FinanceDreDrilldownRow[]): {
  rows: FinanceDreDrilldownRow[];
  truncated: boolean;
  rowCount: number;
  rowsTotal: number;
} {
  const rowsTotal = sumDreDrilldownAmounts(rows.map((r) => r.amount));
  const rowCount = rows.length;
  if (rowCount <= ROW_LIMIT) return { rows, truncated: false, rowCount, rowsTotal };
  return { rows: rows.slice(0, ROW_LIMIT), truncated: true, rowCount, rowsTotal };
}

async function enrichNfeMeta(ids: string[]): Promise<
  Map<
    string,
    {
      numero: string | null;
      serie: string | null;
      destName: string | null;
      orderCode: string | null;
      competence: Date | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      numero: string | null;
      serie: string | null;
      destName: string | null;
      orderCode: string | null;
      competence: Date | null;
    }
  >();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      numero: string | null;
      serie: string | null;
      dest_name: string | null;
      order_code: string | null;
      competence: Date | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        n.id,
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
        COALESCE(n."xmlDhEmi", n."dataProcessamento") AS competence
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
  for (const row of rows) {
    out.set(row.id, {
      numero: row.numero,
      serie: row.serie,
      destName: row.dest_name,
      orderCode: row.order_code,
      competence: row.competence,
    });
  }
  return out;
}

async function mapCmvGapsToRows(gaps: DreCmvGapRow[]): Promise<FinanceDreDrilldownRow[]> {
  const meta = await enrichNfeMeta([...new Set(gaps.map((g) => g.nomusNfeId))]);
  const productIds = [
    ...new Set(gaps.map((g) => g.productId).filter((id): id is string => Boolean(id))),
  ];
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, name: true },
        })
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  return gaps
    .map((gap, index) => {
      const m = meta.get(gap.nomusNfeId);
      const product = gap.productId ? productById.get(gap.productId) : null;
      const productLabel =
        product?.sku?.trim() ||
        gap.sku?.trim() ||
        (gap.externalProductId != null ? `Ext ${gap.externalProductId}` : null) ||
        (product?.name?.trim() ? product.name.trim() : null) ||
        "—";
      const nfeLabel =
        m?.numero != null && String(m.numero).trim()
          ? String(m.numero).trim()
          : String(gap.nfeExternalId);
      return {
        id: `${gap.kind}-${gap.nomusNfeId}-${index}`,
        orderCode: m?.orderCode?.trim() || null,
        customerName: m?.destName?.trim() || null,
        nfeNumber: nfeLabel,
        nfeSerie: m?.serie?.trim() || null,
        documentLabel: cmvGapKindLabel(gap.kind),
        amount: roundDreMoney(gap.amount),
        competenceDate: (m?.competence ?? gap.competenceDate)
          ? new Date(m?.competence ?? gap.competenceDate).toISOString().slice(0, 10)
          : null,
        extra:
          gap.kind === "missing_items"
            ? "Sem itens no payload/estoque"
            : gap.quantity != null
              ? `${productLabel} · qtd ${gap.quantity}`
              : productLabel,
      } satisfies FinanceDreDrilldownRow;
    })
    .sort((a, b) => b.amount - a.amount);
}

async function queryTaxSummaryGapNfes(input: {
  year: number;
  fromMonth: number;
  toMonth: number;
  emitterCnpjDigits?: string;
}): Promise<FinanceDreDrilldownRow[]> {
  const from = startOfYear(new Date(input.year, 0, 1));
  const to = endOfYear(new Date(input.year, 0, 1));
  const dateExpr = nfeCompetenceDateSql("emissao", "n");
  const monthSql =
    input.fromMonth === input.toMonth
      ? Prisma.sql`AND EXTRACT(MONTH FROM ${dateExpr})::int = ${input.fromMonth}`
      : Prisma.sql`AND EXTRACT(MONTH FROM ${dateExpr})::int BETWEEN ${input.fromMonth} AND ${input.toMonth}`;

  const rows = await prisma.$queryRaw<
    {
      id: string;
      external_id: number;
      numero: string | null;
      serie: string | null;
      dest_name: string | null;
      order_code: string | null;
      competence: Date;
      amount: unknown;
    }[]
  >(
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
        COALESCE(n."valorLiquido", 0) AS amount
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
      WHERE ${fiscalNfeWhereSql("emissao", input.emitterCnpjDigits, "n")}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
        ${monthSql}
        AND fs.id IS NULL
      ORDER BY amount DESC NULLS LAST
    `
  );

  return rows.map((row) => ({
    id: row.id,
    orderCode: row.order_code?.trim() || null,
    customerName: row.dest_name?.trim() || null,
    nfeNumber:
      row.numero != null && String(row.numero).trim()
        ? String(row.numero).trim()
        : String(row.external_id),
    nfeSerie: row.serie?.trim() || null,
    documentLabel: "Sem NomusNfeFiscalSummary",
    amount: roundDreMoney(decimalToNumber(row.amount) ?? 0),
    competenceDate: row.competence
      ? new Date(row.competence).toISOString().slice(0, 10)
      : null,
    extra: "Impostos da dedução podem estar incompletos",
  }));
}

function wrapLineDrilldownAsSource(
  checkId: FinanceDreSourceCheckId,
  linePayload: FinanceDreDrilldownPayload,
  sourceNote: string
): FinanceDreDrilldownPayload {
  return {
    ...linePayload,
    lineId: linePayload.lineId,
    lineLabel: financeDreSourceCheckLabel(checkId),
    sourceNote,
    disclaimer:
      "Detalhe da fonte oficial do DRE. Totais devem coincidir com a série usada na montagem.",
  };
}

export async function buildFinanceDreSourceCheckDrilldown(
  query: Record<string, unknown>,
  checkIdRaw: string,
  referenceNow: Date = new Date()
): Promise<FinanceDreDrilldownPayload> {
  if (!isFinanceDreSourceCheckId(checkIdRaw)) {
    throw new FinanceDreParseError(`Validação de fonte inválida: ${checkIdRaw}`);
  }
  const checkId = checkIdRaw;
  const filters = parseFinanceDreQuery(query, referenceNow);
  const scopeRaw = String(query.scope ?? "ytd").toLowerCase();
  const scope: FinanceDreDrilldownScope = scopeRaw === "highlight" ? "highlight" : "ytd";
  const { fromMonth, toMonth } = scopeMonthRange(scope, filters.highlightMonth);
  const emitterCnpj = mapExecutiveReportCompanyToEmitterCnpj(filters.company);
  const companyFilter = mapExecutiveReportCompanyToFilter(filters.company);

  const baseMeta = {
    schemaVersion: 1 as const,
    scope,
    year: filters.year,
    highlightMonth: filters.highlightMonth,
    company: filters.company,
    companyLabel: companyLabel(filters.company),
    periodLabel: periodLabel(scope, filters.year, filters.highlightMonth),
    disclaimer:
      "Registros que explicam o status da validação de fontes oficiais do DRE Gerencial.",
  };

  // Fontes com detalhe de linha DRE já existente
  if (checkId === "receita_nfe") {
    const line = await buildFinanceDreLineDrilldown(
      { ...query, scope },
      "receita_bruta",
      referenceNow
    );
    return wrapLineDrilldownAsSource(
      checkId,
      line,
      "NF-e MARKET_REVENUE autorizadas que compõem a receita bruta"
    );
  }
  if (checkId === "fretes_cc") {
    const line = await buildFinanceDreLineDrilldown(
      { ...query, scope },
      "fretes",
      referenceNow
    );
    return wrapLineDrilldownAsSource(
      checkId,
      line,
      "Centros de custo Logística/Expedição usados em Fretes"
    );
  }
  if (checkId === "embalagens_cc") {
    const line = await buildFinanceDreLineDrilldown(
      { ...query, scope },
      "embalagens",
      referenceNow
    );
    return wrapLineDrilldownAsSource(
      checkId,
      line,
      "Centros de custo Embalagens usados no DRE"
    );
  }

  if (checkId === "financeiro_ir") {
    return {
      ...baseMeta,
      lineId: "lucro_liquido_aproximado",
      lineLabel: financeDreSourceCheckLabel(checkId),
      kind: "composition",
      expectedTotal: 0,
      rowsTotal: 0,
      totalsMatch: true,
      rowCount: 0,
      truncated: false,
      columns: [
        { key: "documentLabel", label: "Situação" },
        { key: "extra", label: "Detalhe" },
        { key: "amount", label: "Valor", align: "right" },
      ],
      rows: [
        {
          id: "financeiro",
          orderCode: null,
          customerName: null,
          nfeNumber: null,
          nfeSerie: null,
          documentLabel: "Fora do escopo v1",
          amount: 0,
          competenceDate: null,
          extra:
            "Resultado financeiro e IR/CSLL não entram no DRE gerencial — não há motor oficial no IndusCost para este bloco.",
        },
      ],
      sourceNote: "Informativo — não impacta o resultado operacional",
    };
  }

  if (checkId === "cmv_nfe_custo") {
    const gaps = await loadCmvGapsForMonthRange(
      filters.year,
      fromMonth,
      toMonth,
      emitterCnpj
    );
    const detailRows = await mapCmvGapsToRows(gaps);
    const sliced = truncate(detailRows);
    const columns: FinanceDreDrilldownColumn[] = [
      { key: "documentLabel", label: "Problema" },
      { key: "orderCode", label: "Pedido" },
      { key: "customerName", label: "Cliente" },
      { key: "nfeNumber", label: "NF-e" },
      { key: "extra", label: "Produto / detalhe" },
      { key: "competenceDate", label: "Emissão" },
      { key: "amount", label: "Receita associada", align: "right" },
    ];
    return {
      ...baseMeta,
      lineId: "cmv",
      lineLabel: financeDreSourceCheckLabel(checkId),
      kind: "cmv",
      expectedTotal: sliced.rowsTotal,
      rowsTotal: sliced.rowsTotal,
      totalsMatch: true,
      rowCount: sliced.rowCount,
      truncated: sliced.truncated,
      columns,
      rows: sliced.rows,
      sourceNote:
        gaps.length === 0
          ? "Nenhuma lacuna no período — CMV precificado integralmente"
          : "Lacunas do mesmo motor do CMV: sem itens, produto não resolvido ou sem custo vigente na data da nota",
    };
  }

  if (checkId === "deducoes_fiscais") {
    const gapRows = await queryTaxSummaryGapNfes({
      year: filters.year,
      fromMonth,
      toMonth,
      emitterCnpjDigits: emitterCnpj,
    });
    if (gapRows.length > 0) {
      const sliced = truncate(gapRows);
      return {
        ...baseMeta,
        lineId: "deducoes",
        lineLabel: financeDreSourceCheckLabel(checkId),
        kind: "nfe",
        expectedTotal: sliced.rowsTotal,
        rowsTotal: sliced.rowsTotal,
        totalsMatch: true,
        rowCount: sliced.rowCount,
        truncated: sliced.truncated,
        columns: [
          { key: "documentLabel", label: "Problema" },
          { key: "orderCode", label: "Pedido" },
          { key: "customerName", label: "Cliente" },
          { key: "nfeNumber", label: "NF-e" },
          { key: "competenceDate", label: "Emissão" },
          { key: "amount", label: "Receita NF-e", align: "right" },
        ],
        rows: sliced.rows,
        sourceNote:
          "NF-e MARKET_REVENUE sem NomusNfeFiscalSummary — impostos da dedução podem ficar incompletos",
      };
    }
    const line = await buildFinanceDreLineDrilldown(
      { ...query, scope },
      "deducoes",
      referenceNow
    );
    return wrapLineDrilldownAsSource(
      checkId,
      line,
      "Sem lacuna de resumo fiscal — composição das deduções do DRE"
    );
  }

  if (checkId === "admin_cc") {
    const unclassified = await listUnclassifiedAccountsPayableDefault({
      companyName: companyFilter,
      openOnly: false,
    });
    const rows: FinanceDreDrilldownRow[] = unclassified.items
      .map((item) => ({
        id: String(item.externalId),
        orderCode: null,
        customerName: item.supplierName?.trim() || item.personName?.trim() || null,
        nfeNumber: null,
        nfeSerie: null,
        documentLabel: `AP ${item.externalId}`,
        amount: roundDreMoney(item.titleAmount),
        competenceDate: null,
        extra: `${item.cause}${item.companyName ? ` · ${item.companyName}` : ""}`,
      }))
      .sort((a, b) => b.amount - a.amount);
    const sliced = truncate(rows);

    // Expected do bucket unclassified YTD/mês via dashboard (mesmo motor do DRE)
    const dashboard = await buildFinanceCostCenterDashboardDefault(
      buildExecutiveReportCostCenterDashboardFilters({
        year: filters.year,
        month: null,
        companyName: companyFilter,
      }),
      referenceNow
    );
    const unclassifiedSeries = Array.from({ length: 12 }, () => 0);
    for (const row of dashboard.monthlySeries.totals) {
      if (row.year !== filters.year) continue;
      if (row.month >= 1 && row.month <= 12) {
        unclassifiedSeries[row.month - 1] = row.unclassifiedAmount;
      }
    }
    const expectedTotal = amountInMonthRange(unclassifiedSeries, fromMonth, toMonth);

    return {
      ...baseMeta,
      lineId: "despesas_administrativas",
      lineLabel: financeDreSourceCheckLabel(checkId),
      kind: "cost_center",
      expectedTotal,
      rowsTotal: sliced.rowsTotal,
      totalsMatch: true,
      rowCount: sliced.rowCount,
      truncated: sliced.truncated,
      columns: [
        { key: "documentLabel", label: "Título AP" },
        { key: "customerName", label: "Fornecedor" },
        { key: "extra", label: "Causa" },
        { key: "amount", label: "Valor sem CC", align: "right" },
      ],
      rows: sliced.rows,
      sourceNote:
        rows.length === 0
          ? "Nenhum AP sem centro de custo no filtro atual"
          : `AP sem CC (lista oficial). Bucket DRE no período: ${expectedTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — a lista AP pode cobrir títulos além do mês/YTD filtrado.`,
    };
  }

  if (checkId === "pessoal_cc") {
    const dashboard = await buildFinanceCostCenterDashboardDefault(
      buildExecutiveReportCostCenterDashboardFilters({
        year: filters.year,
        month: null,
        companyName: companyFilter,
      }),
      referenceNow
    );
    const byKey = new Map<string, FinanceDreDrilldownRow>();
    for (const row of dashboard.monthlySeries.byCostCenter) {
      if (row.year !== filters.year) continue;
      if (row.month < fromMonth || row.month > toMonth) continue;
      const role = classifyDreCostCenterRole(row.code, row.name);
      if (!DRE_PERSONNEL_ROLES.has(role)) continue;
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
          extra: role,
        });
      }
    }
    const rows = [...byKey.values()].sort((a, b) => b.amount - a.amount);
    const sliced = truncate(rows);
    return {
      ...baseMeta,
      lineId: "despesas_operacionais",
      lineLabel: financeDreSourceCheckLabel(checkId),
      kind: "cost_center",
      expectedTotal: sliced.rowsTotal,
      rowsTotal: sliced.rowsTotal,
      totalsMatch: true,
      rowCount: sliced.rowCount,
      truncated: sliced.truncated,
      columns: [
        { key: "documentLabel", label: "Centro de custo" },
        { key: "extra", label: "Papel" },
        { key: "amount", label: "Valor", align: "right" },
      ],
      rows: sliced.rows,
      sourceNote:
        "Informativo — Folha/Benefícios/Montagem/MO não entram no resultado (já embutidos no CMV da ficha)",
    };
  }

  throw new FinanceDreParseError(`Drill-down não disponível para ${checkId}`);
}
