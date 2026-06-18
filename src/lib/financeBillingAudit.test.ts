import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBillingAuditFiltersSummary, parseBillingAuditFilters } from "./financeBillingAuditFilters.js";
import {
  evaluateNomusNfeForBilling,
  evaluateSalesOrderForBilling,
  resolveBillingAuditPeriod,
  sanitizeAuditMoney,
} from "./financeBillingAuditRules.js";
import { buildBillingAuditCsv, buildBillingAuditWorkbook } from "./financeBillingAuditExport.js";
import type { BillingAuditResult } from "./financeBillingAuditTypes.js";

function minimalAuditResult(): BillingAuditResult {
  return {
    generatedAt: "2026-06-09T12:00:00.000Z",
    exportedBy: "tester",
    filters: parseBillingAuditFilters({ year: "2026", month: "6" }),
    filtersSummary: buildBillingAuditFiltersSummary(
      parseBillingAuditFilters({ year: "2026", month: "6" })
    ),
    summary: {
      dataSourceOfficial: "SalesOrder",
      nfeFiscalTotal: 120000,
      salesOrderTotal: 90000,
      sourceComparisonDifference: 30000,
      dateBaseUsed: "processamento",
      dateBaseLabel: "dataProcessamento",
      valueModeUsed: "pedido_total_net",
      valueFieldLabel: "SalesOrder.totalNetValue",
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      periodLabel: "6/2026",
      dashboardDisplayedTotal: 90000,
      grossFoundTotal: 120000,
      includedTotal: 90000,
      excludedTotal: 30000,
      includedCount: 9,
      excludedCount: 3,
      itemCount: 0,
      firstDate: "2026-06-01",
      lastDate: "2026-06-30",
      lastNomusSyncAt: null,
      lastImportedNfeAt: null,
      divergenceHints: ["test"],
    },
    includedRows: [
      {
        id: "1",
        dataSource: "SalesOrder",
        includedInBilling: true,
        exclusionReason: null,
        exclusionReasonCode: null,
        companyName: null,
        companyDocument: null,
        nfNumber: "100",
        nfSeries: "1",
        nfKey: "key-1",
        nfStatus: "autorizada",
        operationNature: null,
        cfop: null,
        issueDate: "2026-06-10",
        processingDate: "2026-06-10",
        competenceDateUsed: "2026-06-10",
        importDate: null,
        customerName: "Cliente A",
        customerDocument: "123",
        sellerName: null,
        salesOrderCode: "PV-1",
        valueProducts: null,
        valueServices: null,
        valueFreight: null,
        valueDiscount: null,
        valueTaxes: null,
        valueTotalNf: 10000,
        valueNet: 10000,
        valueUsedInDashboard: 10000,
        valueCalculationMode: "SalesOrder.totalNetValue",
        billingClassification: "MARKET_REVENUE",
        syncedAt: null,
        originLabel: "Pedido",
        xmlPath: null,
        notes: null,
      },
    ],
    excludedRows: [
      {
        id: "2",
        dataSource: "SalesOrder",
        includedInBilling: false,
        exclusionReason: "Fora do período",
        exclusionReasonCode: "OUT_OF_DATE_RANGE",
        companyName: null,
        companyDocument: null,
        nfNumber: null,
        nfSeries: null,
        nfKey: null,
        nfStatus: null,
        operationNature: null,
        cfop: null,
        issueDate: "2025-12-01",
        processingDate: "2025-12-01",
        competenceDateUsed: "2025-12-01",
        importDate: null,
        customerName: "Cliente B",
        customerDocument: null,
        sellerName: null,
        salesOrderCode: "PV-2",
        valueProducts: null,
        valueServices: null,
        valueFreight: null,
        valueDiscount: null,
        valueTaxes: null,
        valueTotalNf: 5000,
        valueNet: 5000,
        valueUsedInDashboard: 5000,
        valueCalculationMode: "SalesOrder.totalNetValue",
        billingClassification: null,
        syncedAt: null,
        originLabel: "Pedido",
        xmlPath: null,
        notes: null,
      },
    ],
    itemRows: [],
    dailyTotals: [],
    dailySourceComparison: [
      { date: "2026-06-08", nfeTotal: 180232.34, salesOrderTotal: 12254.34, difference: 167978 },
    ],
    customerTotals: [],
    operationTotals: [],
    diagnostics: [],
    divergences: [],
    nomusComparisonNote: "manual",
  };
}

describe("financeBillingAudit", () => {
  const period = resolveBillingAuditPeriod(parseBillingAuditFilters({ year: "2026", month: "6" }));
  const filters = parseBillingAuditFilters({ year: "2026", month: "6" });

  it("auditoria separa incluídas e excluídas", () => {
    const result = minimalAuditResult();
    assert.equal(result.includedRows.every((r) => r.includedInBilling), true);
    assert.equal(result.excludedRows.every((r) => !r.includedInBilling), true);
    assert.ok(result.excludedRows.every((r) => r.exclusionReason));
  });

  it("registro fora do período → OUT_OF_DATE_RANGE", () => {
    const evalResult = evaluateSalesOrderForBilling(
      {
        id: "x",
        orderCode: "PV",
        status: "CONFIRMED",
        totalNetValue: 1000,
        customerName: "Mercado",
        customerTaxId: "99999999000199",
        invoiceDate: new Date("2025-01-15"),
        invoiceStatus: "autorizada",
      },
      filters,
      period
    );
    assert.equal(evalResult.included, false);
    assert.equal(evalResult.exclusionReasonCode, "OUT_OF_DATE_RANGE");
  });

  it("pedido cancelado → CANCELLED_NFE", () => {
    const evalResult = evaluateSalesOrderForBilling(
      {
        id: "x",
        orderCode: "PV",
        status: "CANCELLED",
        totalNetValue: 1000,
        customerName: "Mercado",
        customerTaxId: "99999999000199",
        invoiceDate: new Date("2026-06-10"),
        invoiceStatus: null,
      },
      filters,
      period
    );
    assert.equal(evalResult.exclusionReasonCode, "CANCELLED_NFE");
  });

  it("cliente do grupo → WRONG_COMPANY", () => {
    const evalResult = evaluateSalesOrderForBilling(
      {
        id: "x",
        orderCode: "PV",
        status: "CONFIRMED",
        totalNetValue: 1000,
        customerName: "Lazarios Industrial",
        customerTaxId: "72569510000195",
        invoiceDate: new Date("2026-06-10"),
        invoiceStatus: null,
      },
      filters,
      period
    );
    assert.equal(evalResult.exclusionReasonCode, "WRONG_COMPANY");
  });

  it("total incluído do resumo pode bater com dashboard no fixture", () => {
    const result = minimalAuditResult();
    assert.equal(result.summary.includedTotal, result.summary.dashboardDisplayedTotal);
    assert.ok(result.summary.grossFoundTotal >= result.summary.includedTotal);
  });

  it("total bruto >= total incluído", () => {
    const result = minimalAuditResult();
    assert.ok(result.summary.grossFoundTotal >= result.summary.includedTotal);
  });

  it("export XLSX contém abas mínimas e filtros no resumo", () => {
    const wb = buildBillingAuditWorkbook(minimalAuditResult());
    assert.ok(wb.SheetNames.includes("Resumo"));
    assert.ok(wb.SheetNames.includes("Incluídas"));
    assert.ok(wb.SheetNames.includes("Excluídas"));
    assert.ok(wb.SheetNames.includes("Divergências"));
    assert.ok(wb.SheetNames.includes("NF-e x Pedidos"));
  });

  it("auditoria compara NF-e x SalesOrder no resumo", () => {
    const result = minimalAuditResult();
    assert.equal(
      result.summary.sourceComparisonDifference,
      result.summary.nfeFiscalTotal - result.summary.salesOrderTotal
    );
    assert.ok(result.dailySourceComparison.length > 0);
  });

  it("status autorizado exige status 4 na NF-e", () => {
    const authorizedFilters = parseBillingAuditFilters({
      year: "2026",
      month: "6",
      status: "authorized",
    });
    const rejected = evaluateNomusNfeForBilling(
      {
        id: "n1",
        externalId: 1,
        numero: "1",
        serie: "1",
        chave: "k",
        status: 1,
        billingClassification: "MARKET_REVENUE",
        xmlNatOp: "VENDA",
        xmlDestCnpjCpf: "123",
        xmlDhEmi: new Date("2026-06-05"),
        dataProcessamento: new Date("2026-06-05"),
        xmlVProd: 100,
        xmlVDesc: 0,
        xmlVNF: 100,
        valorLiquido: 100,
        syncedAt: new Date(),
        isMarketSale: true,
      },
      authorizedFilters,
      period
    );
    assert.equal(rejected.included, false);
    assert.equal(rejected.exclusionReasonCode, "FILTERED_BY_STATUS");
  });

  it("export CSV contém colunas mínimas", () => {
    const csv = buildBillingAuditCsv(minimalAuditResult());
    assert.match(csv, /Incluído no faturamento/);
    assert.match(csv, /Motivo de exclusão/);
    assert.match(csv, /Valor usado no dashboard/);
  });

  it("data base emissão altera competência NomusNfe", () => {
    const emissaoFilters = parseBillingAuditFilters({
      year: "2026",
      month: "6",
      dateBase: "emissao",
    });
    const included = evaluateNomusNfeForBilling(
      {
        id: "n1",
        externalId: 1,
        numero: "1",
        serie: "1",
        chave: "k",
        status: 1,
        billingClassification: "MARKET_REVENUE",
        xmlNatOp: "VENDA",
        xmlDestCnpjCpf: "123",
        xmlDhEmi: new Date("2026-06-05"),
        dataProcessamento: new Date(2026, 6, 15),
        xmlVProd: 100,
        xmlVDesc: 0,
        xmlVNF: 100,
        valorLiquido: 100,
        syncedAt: new Date(),
        isMarketSale: true,
      },
      emissaoFilters,
      period
    );
    assert.equal(included.included, true);

    const processamentoFilters = parseBillingAuditFilters({
      year: "2026",
      month: "6",
      dateBase: "processamento",
    });
    const excluded = evaluateNomusNfeForBilling(
      {
        id: "n1",
        externalId: 1,
        numero: "1",
        serie: "1",
        chave: "k",
        status: 1,
        billingClassification: "MARKET_REVENUE",
        xmlNatOp: "VENDA",
        xmlDestCnpjCpf: "123",
        xmlDhEmi: new Date("2026-06-05"),
        dataProcessamento: new Date(2026, 6, 15),
        xmlVProd: 100,
        xmlVDesc: 0,
        xmlVNF: 100,
        valorLiquido: 100,
        syncedAt: new Date(),
        isMarketSale: true,
      },
      processamentoFilters,
      period
    );
    assert.equal(excluded.included, false);
    assert.equal(excluded.exclusionReasonCode, "OUT_OF_DATE_RANGE");
  });

  it("não retorna NaN ou Infinity", () => {
    assert.equal(Number.isFinite(sanitizeAuditMoney(10)), true);
    assert.equal(sanitizeAuditMoney(Number.NaN), 0);
    assert.equal(sanitizeAuditMoney(Number.POSITIVE_INFINITY), 0);
  });

  it("rotas e UI de auditoria existem sem tocar AR/AP", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "financeBillingRoutes.ts"), "utf8");
    const page = readFileSync(join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"), "utf8");
    assert.match(routes, /billing\/audit/);
    assert.match(page, /Auditar base do faturamento/);
    assert.match(page, /FinanceDataAuditDrawer/);
    assert.match(page, /audit/);
    assert.equal(routes.includes("financeAccountsReceivable"), false);
    assert.equal(routes.includes("financeAccountsPayable"), false);
    assert.equal(routes.includes("financeCashFlow"), false);
  });
});
