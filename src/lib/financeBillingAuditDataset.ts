import { Prisma } from "@prisma/client";
import { billingMarketCustomerFilterSql } from "@/src/lib/billingMarketCustomerSql.js";
import { decimalToNumber, safeMetricNumber } from "@/src/lib/executiveDashboardHelpers.js";
import {
  buildBillingAuditFiltersSummary,
  parseBillingAuditFilters,
} from "@/src/lib/financeBillingAuditFilters.js";
import {
  evaluateNomusNfeForBilling,
  evaluateSalesOrderForBilling,
  exclusionLabel,
  resolveBillingAuditPeriod,
  sanitizeAuditMoney,
} from "@/src/lib/financeBillingAuditRules.js";
import type {
  BillingAuditCustomerTotal,
  BillingAuditDailyTotal,
  BillingAuditDiagnostic,
  BillingAuditDivergenceRow,
  BillingAuditItemRow,
  BillingAuditOperationTotal,
  BillingAuditResult,
  BillingAuditRow,
  BillingAuditSummary,
} from "@/src/lib/financeBillingAuditTypes.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  nfeProcessamentoDateSql,
  nomusNfesElementsSql,
  orderInvoicedInPeriodSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const MARKET_CUSTOMER = billingMarketCustomerFilterSql("c");

function isoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

function ymd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

async function queryDashboardYearTotal(year: number, from: Date, to: Date): Promise<number> {
  const fromYmd = toPgDateYmd(from);
  const toYmd = toPgDateYmd(to);
  const [row] = await prisma.$queryRaw<{ v: unknown }[]>(
    Prisma.sql`
      SELECT COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderInvoicedInPeriodSql("so", fromYmd, toYmd)}
    `
  );
  return sanitizeAuditMoney(decimalToNumber(row?.v));
}

async function querySalesOrderAuditRows(year: number) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  const fromYmd = toPgDateYmd(yearStart);
  const toYmd = toPgDateYmd(yearEnd);

  return prisma.$queryRaw<
    {
      id: string;
      order_code: string;
      status: string;
      total_net_value: unknown;
      customer_name: string;
      customer_tax_id: string | null;
      invoice_date: Date | null;
      invoice_status: string | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        so.status,
        so."totalNetValue" AS total_net_value,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        c."taxId" AS customer_tax_id,
        inv.invoice_date,
        inv.invoice_status
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN LATERAL (
        SELECT
          MAX((${nfeProcessamentoDateSql()})) AS invoice_date,
          MAX(NULLIF(TRIM(nfe->>'status'), '')) AS invoice_status
        FROM ${nomusNfesElementsSql("so")}
        WHERE (${nfeProcessamentoDateSql()}) IS NOT NULL
      ) inv ON true
      WHERE (
        inv.invoice_date IS NOT NULL
        AND inv.invoice_date >= ${fromYmd}::date
        AND inv.invoice_date <= ${toYmd}::date
      )
      OR (
        so."issueDate" >= ${yearStart}
        AND so."issueDate" <= ${yearEnd}
      )
      OR EXISTS (
        SELECT 1 FROM ${nomusNfesElementsSql("so")}
      )
      ORDER BY inv.invoice_date DESC NULLS LAST, so."issueDate" DESC
    `
  );
}

async function queryNomusNfeAuditRows(year: number) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  return prisma.nomusNfe.findMany({
    where: {
      OR: [
        { xmlDhEmi: { gte: yearStart, lte: yearEnd } },
        { xmlDhEmi: null, dataProcessamento: { gte: yearStart, lte: yearEnd } },
      ],
    },
    orderBy: [{ xmlDhEmi: "desc" }, { dataProcessamento: "desc" }],
    select: {
      id: true,
      externalId: true,
      numero: true,
      serie: true,
      chave: true,
      status: true,
      billingClassification: true,
      xmlNatOp: true,
      xmlDestCnpjCpf: true,
      xmlDhEmi: true,
      dataProcessamento: true,
      xmlVProd: true,
      xmlVDesc: true,
      xmlVNF: true,
      valorLiquido: true,
      syncedAt: true,
      isMarketSale: true,
    },
  });
}

function aggregateDaily(rows: BillingAuditRow[]): BillingAuditDailyTotal[] {
  const map = new Map<string, BillingAuditDailyTotal>();
  for (const row of rows) {
    const date = row.competenceDateUsed ?? row.processingDate ?? row.issueDate ?? "sem-data";
    const bucket =
      map.get(date) ??
      ({
        date,
        includedTotal: 0,
        excludedTotal: 0,
        includedCount: 0,
        excludedCount: 0,
      } satisfies BillingAuditDailyTotal);
    const value = sanitizeAuditMoney(row.valueUsedInDashboard);
    if (row.includedInBilling) {
      bucket.includedTotal += value;
      bucket.includedCount += 1;
    } else {
      bucket.excludedTotal += value;
      bucket.excludedCount += 1;
    }
    map.set(date, bucket);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateCustomers(rows: BillingAuditRow[]): BillingAuditCustomerTotal[] {
  const map = new Map<string, BillingAuditCustomerTotal>();
  for (const row of rows) {
    const key = row.customerName ?? "—";
    const bucket =
      map.get(key) ??
      ({
        customerName: key,
        customerDocument: row.customerDocument,
        includedTotal: 0,
        excludedTotal: 0,
        noteCount: 0,
      } satisfies BillingAuditCustomerTotal);
    const value = sanitizeAuditMoney(row.valueUsedInDashboard);
    if (row.includedInBilling) bucket.includedTotal += value;
    else bucket.excludedTotal += value;
    bucket.noteCount += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.includedTotal - a.includedTotal);
}

function aggregateOperations(rows: BillingAuditRow[]): BillingAuditOperationTotal[] {
  const map = new Map<string, BillingAuditOperationTotal>();
  for (const row of rows) {
    const key = `${row.cfop ?? "—"}|${row.operationNature ?? "—"}`;
    const bucket =
      map.get(key) ??
      ({
        cfop: row.cfop,
        operationNature: row.operationNature,
        includedTotal: 0,
        excludedTotal: 0,
        noteCount: 0,
        ruleApplied: row.billingClassification ?? "SalesOrder mercado",
      } satisfies BillingAuditOperationTotal);
    const value = sanitizeAuditMoney(row.valueUsedInDashboard);
    if (row.includedInBilling) bucket.includedTotal += value;
    else bucket.excludedTotal += value;
    bucket.noteCount += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.includedTotal - a.includedTotal);
}

function buildDiagnostics(
  allRows: BillingAuditRow[],
  summary: BillingAuditSummary
): BillingAuditDiagnostic[] {
  const byReason = new Map<string, number>();
  for (const row of allRows.filter((r) => !r.includedInBilling)) {
    const code = row.exclusionReasonCode ?? "UNKNOWN_REASON";
    byReason.set(code, (byReason.get(code) ?? 0) + 1);
  }

  const diagnostics: BillingAuditDiagnostic[] = [
    {
      code: "OFFICIAL_SOURCE",
      label: "Fonte oficial do dashboard",
      value: summary.dataSourceOfficial,
    },
    {
      code: "DATE_BASE",
      label: "Data base do filtro",
      value: summary.dateBaseLabel,
    },
    {
      code: "VALUE_FIELD",
      label: "Campo de valor",
      value: summary.valueFieldLabel,
    },
    {
      code: "DASHBOARD_TOTAL",
      label: "Total exibido no dashboard (período)",
      value: summary.dashboardDisplayedTotal,
    },
    {
      code: "INCLUDED_TOTAL",
      label: "Total incluído na auditoria",
      value: summary.includedTotal,
    },
    {
      code: "EXCLUDED_TOTAL",
      label: "Total excluído",
      value: summary.excludedTotal,
    },
  ];

  for (const [code, count] of byReason) {
    diagnostics.push({
      code,
      label: exclusionLabel(code as Parameters<typeof exclusionLabel>[0]),
      value: count,
      hint: "Quantidade de registros excluídos por este motivo",
    });
  }

  return diagnostics;
}

function buildDivergenceHints(summary: BillingAuditSummary): string[] {
  const hints = [
    "Existem NF fora da data base usada",
    "Existem NF de outra empresa/cliente do grupo",
    "Existem NF não importadas na base local",
    "Existem NF excluídas por status/natureza/classificação",
    "O valor usado no dashboard (totalNetValue do pedido) pode diferir do valor total da NF (valorLiquido)",
    "A última sincronização pode não ter trazido as notas mais recentes",
  ];
  if (summary.excludedCount > 0) {
    hints.unshift(
      "Há registros excluídos ou fora do período que podem explicar divergência com o Nomus. Exporte a auditoria para comparar."
    );
  }
  return hints;
}

function compareNomusVsSalesOrder(
  salesRows: BillingAuditRow[],
  nomusRows: BillingAuditRow[]
): BillingAuditDivergenceRow[] {
  const soByKey = new Map<string, BillingAuditRow>();
  for (const row of salesRows) {
    if (row.nfKey) soByKey.set(row.nfKey, row);
  }
  const divergences: BillingAuditDivergenceRow[] = [];
  for (const nfe of nomusRows) {
    if (!nfe.nfKey) continue;
    const so = soByKey.get(nfe.nfKey);
    if (!so) {
      divergences.push({
        kind: "nomus_only",
        nfKey: nfe.nfKey,
        nfNumber: nfe.nfNumber,
        nomusValue: nfe.valueUsedInDashboard,
        systemValue: null,
        nomusDate: nfe.competenceDateUsed,
        systemDate: null,
        notes: "NF na base NomusNfe sem correspondência clara no pedido auditado",
      });
      continue;
    }
    const nomusVal = sanitizeAuditMoney(nfe.valueNet);
    const soVal = sanitizeAuditMoney(so.valueUsedInDashboard);
    if (Math.abs(nomusVal - soVal) > 0.01) {
      divergences.push({
        kind: "value_mismatch",
        nfKey: nfe.nfKey,
        nfNumber: nfe.nfNumber,
        nomusValue: nomusVal,
        systemValue: soVal,
        nomusDate: nfe.competenceDateUsed,
        systemDate: so.competenceDateUsed,
        notes: "Valor NomusNfe difere do pedido SalesOrder",
      });
    }
  }
  return divergences.slice(0, 500);
}

export async function buildBillingAuditDataset(
  query: Record<string, unknown>,
  exportedBy: string | null = null
): Promise<BillingAuditResult> {
  const filters = parseBillingAuditFilters(query);
  const period = resolveBillingAuditPeriod(filters);
  const dashboardDisplayedTotal = await queryDashboardYearTotal(
    filters.year,
    period.from,
    period.to
  );

  const [soRaw, nomusRaw, lastSync] = await Promise.all([
    querySalesOrderAuditRows(filters.year),
    queryNomusNfeAuditRows(filters.year),
    prisma.nomusNfe.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true, xmlDhEmi: true, dataProcessamento: true },
    }),
  ]);

  const salesRows: BillingAuditRow[] = soRaw.map((row) => {
    const input = {
      id: row.id,
      orderCode: row.order_code,
      status: row.status,
      totalNetValue: decimalToNumber(row.total_net_value),
      customerName: row.customer_name,
      customerTaxId: row.customer_tax_id,
      invoiceDate: row.invoice_date,
      invoiceStatus: row.invoice_status,
    };
    const evalResult = evaluateSalesOrderForBilling(input, filters, period);
    return {
      id: row.id,
      dataSource: "SalesOrder",
      includedInBilling: evalResult.included,
      exclusionReason: evalResult.exclusionReasonCode
        ? exclusionLabel(evalResult.exclusionReasonCode)
        : null,
      exclusionReasonCode: evalResult.exclusionReasonCode,
      companyName: null,
      companyDocument: null,
      nfNumber: null,
      nfSeries: null,
      nfKey: null,
      nfStatus: row.invoice_status,
      operationNature: null,
      cfop: null,
      issueDate: ymd(row.invoice_date),
      processingDate: ymd(row.invoice_date),
      competenceDateUsed: ymd(evalResult.competenceDate),
      importDate: null,
      customerName: row.customer_name,
      customerDocument: row.customer_tax_id,
      sellerName: null,
      salesOrderCode: row.order_code,
      valueProducts: null,
      valueServices: null,
      valueFreight: null,
      valueDiscount: null,
      valueTaxes: null,
      valueTotalNf: decimalToNumber(row.total_net_value),
      valueNet: decimalToNumber(row.total_net_value),
      valueUsedInDashboard: evalResult.valueUsed,
      valueCalculationMode: "SalesOrder.totalNetValue (dataProcessamento da NF no pedido)",
      billingClassification: "MARKET_REVENUE",
      syncedAt: null,
      originLabel: "Pedido + NF em nomusRawResponse",
      xmlPath: null,
      notes: null,
    };
  });

  const nomusRows: BillingAuditRow[] = nomusRaw.map((row) => {
    const input = {
      id: row.id,
      externalId: row.externalId,
      numero: row.numero,
      serie: row.serie,
      chave: row.chave,
      status: row.status,
      billingClassification: row.billingClassification,
      xmlNatOp: row.xmlNatOp,
      xmlDestCnpjCpf: row.xmlDestCnpjCpf,
      xmlDhEmi: row.xmlDhEmi,
      dataProcessamento: row.dataProcessamento,
      xmlVProd: decimalToNumber(row.xmlVProd),
      xmlVDesc: decimalToNumber(row.xmlVDesc),
      xmlVNF: decimalToNumber(row.xmlVNF),
      valorLiquido: decimalToNumber(row.valorLiquido),
      syncedAt: row.syncedAt,
      isMarketSale: row.isMarketSale,
    };
    const evalResult = evaluateNomusNfeForBilling(input, filters, period);
    return {
      id: row.id,
      dataSource: "NomusNfe",
      includedInBilling: evalResult.included,
      exclusionReason: evalResult.exclusionReasonCode
        ? exclusionLabel(evalResult.exclusionReasonCode)
        : null,
      exclusionReasonCode: evalResult.exclusionReasonCode,
      companyName: null,
      companyDocument: null,
      nfNumber: row.numero,
      nfSeries: row.serie,
      nfKey: row.chave,
      nfStatus: row.status != null ? String(row.status) : null,
      operationNature: row.xmlNatOp,
      cfop: null,
      issueDate: ymd(row.xmlDhEmi),
      processingDate: ymd(row.dataProcessamento),
      competenceDateUsed: ymd(evalResult.competenceDate),
      importDate: isoDate(row.syncedAt),
      customerName: null,
      customerDocument: row.xmlDestCnpjCpf,
      sellerName: null,
      salesOrderCode: null,
      valueProducts: decimalToNumber(row.xmlVProd),
      valueServices: null,
      valueFreight: null,
      valueDiscount: decimalToNumber(row.xmlVDesc),
      valueTaxes: null,
      valueTotalNf: decimalToNumber(row.xmlVNF),
      valueNet: decimalToNumber(row.valorLiquido),
      valueUsedInDashboard: evalResult.valueUsed,
      valueCalculationMode: `NomusNfe (${filters.valueMode})`,
      billingClassification: row.billingClassification,
      syncedAt: isoDate(row.syncedAt),
      originLabel: "Nomus API / XML",
      xmlPath: null,
      notes: null,
    };
  });

  const officialRows = salesRows;
  const includedRows = officialRows.filter((r) => r.includedInBilling);
  const excludedRows = officialRows.filter((r) => !r.includedInBilling);
  const allOfficial = officialRows;

  const includedTotal = includedRows.reduce(
    (s, r) => s + sanitizeAuditMoney(r.valueUsedInDashboard),
    0
  );
  const excludedTotal = excludedRows.reduce(
    (s, r) => s + sanitizeAuditMoney(r.valueUsedInDashboard),
    0
  );
  const grossFoundTotal = allOfficial.reduce(
    (s, r) => s + sanitizeAuditMoney(r.valueUsedInDashboard ?? r.valueNet),
    0
  );

  const dates = allOfficial
    .map((r) => r.competenceDateUsed)
    .filter((d): d is string => Boolean(d))
    .sort();

  const summary: BillingAuditSummary = {
    dataSourceOfficial: "SalesOrder",
    dateBaseUsed: filters.dateBase,
    dateBaseLabel:
      filters.dateBase === "processamento"
        ? "dataProcessamento (NF no pedido)"
        : filters.dateBase,
    valueModeUsed: filters.valueMode,
    valueFieldLabel: "SalesOrder.totalNetValue",
    periodFrom: ymd(period.from)!,
    periodTo: ymd(period.to)!,
    periodLabel: period.label,
    dashboardDisplayedTotal: safeMetricNumber(dashboardDisplayedTotal),
    grossFoundTotal: sanitizeAuditMoney(grossFoundTotal),
    includedTotal: sanitizeAuditMoney(includedTotal),
    excludedTotal: sanitizeAuditMoney(excludedTotal),
    includedCount: includedRows.length,
    excludedCount: excludedRows.length,
    itemCount: 0,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    lastNomusSyncAt: isoDate(lastSync?.syncedAt),
    lastImportedNfeAt: isoDate(lastSync?.xmlDhEmi ?? lastSync?.dataProcessamento),
    divergenceHints: [],
  };
  summary.divergenceHints = buildDivergenceHints(summary);

  const itemRows: BillingAuditItemRow[] = [];
  const dailyTotals = aggregateDaily(allOfficial);
  const customerTotals = aggregateCustomers(allOfficial);
  const operationTotals = aggregateOperations([...allOfficial, ...nomusRows]);
  const diagnostics = buildDiagnostics(allOfficial, summary);
  const divergences = compareNomusVsSalesOrder(salesRows, nomusRows);

  return {
    generatedAt: new Date().toISOString(),
    exportedBy,
    filters,
    filtersSummary: buildBillingAuditFiltersSummary(filters),
    summary,
    includedRows,
    excludedRows,
    itemRows,
    dailyTotals,
    customerTotals,
    operationTotals,
    diagnostics,
    divergences,
    nomusComparisonNote:
      "Comparação automática com Nomus depende de importação/consulta da base Nomus. Use a exportação de composição para comparar manualmente com o relatório do Nomus.",
  };
}
