/**
 * Testes T07 — inteligência tributária: KPIs, filtros, agregação, export, auth helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildFiscalTaxIntelKpisFromParts,
  computeFiscalLoadOnRevenue,
  FISCAL_TAX_INTEL_COLUMN_SOURCES,
  FISCAL_TAX_INTEL_GROUP_BY,
  parseFiscalTaxIntelGroupBy,
  roundFiscalIntelMoney,
  type FiscalTaxIntelPayload,
} from "./fiscalTaxIntelligenceClient.js";
import {
  buildFiscalTaxIntelligenceExportBuffer,
  buildFiscalTaxIntelligenceExportFilename,
  buildFiscalTaxIntelligenceExportWorkbook,
} from "./fiscalTaxIntelligenceExport.js";
import {
  buildFiscalTaxIntelligenceReport,
  parseFiscalTaxIntelFilters,
} from "./fiscalTaxIntelligenceService.server.js";
import {
  canViewFiscalSettlements,
  FISCAL_SETTLEMENT_VIEW_PERMISSIONS,
} from "./fiscalSettlementPermissions.js";

function money(n: number) {
  return {
    toNumber: () => n,
    toFixed: (d: number) => n.toFixed(d),
    valueOf: () => n,
  };
}

function samplePayload(
  overrides?: Partial<FiscalTaxIntelPayload>
): FiscalTaxIntelPayload {
  return {
    ok: true,
    generatedAt: "2026-07-16T12:00:00.000Z",
    filters: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      groupBy: "taxType",
      taxType: null,
      jurisdiction: null,
      guideStatus: null,
      customerId: null,
      salesOrderId: null,
    },
    columnSources: FISCAL_TAX_INTEL_COLUMN_SOURCES,
    disclaimer: "Destacado ≠ Apurado ≠ Pago ≠ Alocado.",
    kpis: buildFiscalTaxIntelKpisFromParts({
      highlightedAmount: 100,
      creditsAmount: 10,
      assessedAmount: 90,
      amountDue: 80,
      amountPaid: 70,
      interestAmount: 1,
      fineAmount: 2,
      guideBalanceDue: 10,
      allocatedAmount: 50,
      revenueBase: 1000,
      cancelledGuideCount: 1,
      validGuideCount: 2,
      nfeCount: 3,
    }),
    rows: [
      {
        groupKey: "IPI",
        groupLabel: "IPI",
        groupBy: "taxType",
        highlightedAmount: 100,
        creditsAmount: 10,
        assessedAmount: 90,
        amountDue: 80,
        amountPaid: 70,
        interestAmount: 1,
        fineAmount: 2,
        guideBalanceDue: 10,
        allocatedAmount: 50,
        revenueBase: 1000,
        highlightedVsAssessed: 10,
        assessedVsPaid: 20,
        fiscalLoadOnRevenue: 7,
        taxType: "IPI",
      },
    ],
    ...overrides,
  };
}

describe("fiscalTaxIntelligenceClient", () => {
  it("arredonda dinheiro e carga fiscal", () => {
    assert.equal(roundFiscalIntelMoney(1.006), 1.01);
    assert.equal(computeFiscalLoadOnRevenue(70, 1000), 7);
    assert.equal(computeFiscalLoadOnRevenue(10, 0), null);
  });

  it("KPIs derivam diferenças A−B e B−C", () => {
    const k = buildFiscalTaxIntelKpisFromParts({
      highlightedAmount: 100,
      creditsAmount: 5,
      assessedAmount: 80,
      amountDue: 75,
      amountPaid: 60,
      interestAmount: 0,
      fineAmount: 0,
      guideBalanceDue: 15,
      allocatedAmount: 0,
      revenueBase: 500,
      cancelledGuideCount: 0,
      validGuideCount: 1,
      nfeCount: 1,
    });
    assert.equal(k.highlightedVsAssessed, 20);
    assert.equal(k.assessedVsPaid, 20);
    assert.equal(k.fiscalLoadOnRevenue, 12);
  });

  it("parseFiscalTaxIntelGroupBy valida e faz fallback", () => {
    assert.equal(parseFiscalTaxIntelGroupBy("ncm"), "ncm");
    assert.equal(parseFiscalTaxIntelGroupBy("product"), "product");
    assert.equal(parseFiscalTaxIntelGroupBy("nope"), "taxType");
    assert.ok(FISCAL_TAX_INTEL_GROUP_BY.includes("company"));
  });

  it("cada coluna de métrica tem natureza/fonte", () => {
    for (const key of Object.keys(FISCAL_TAX_INTEL_COLUMN_SOURCES)) {
      const meta =
        FISCAL_TAX_INTEL_COLUMN_SOURCES[
          key as keyof typeof FISCAL_TAX_INTEL_COLUMN_SOURCES
        ];
      assert.ok(meta.source.length > 0);
      assert.ok(meta.nature.length > 0);
    }
  });
});

describe("fiscalTaxIntelligence filters", () => {
  it("parseFiscalTaxIntelFilters aplica defaults e filtros", () => {
    const f = parseFiscalTaxIntelFilters({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      taxType: "ipi",
      guideStatus: "paid",
      groupBy: "period",
    });
    assert.equal(f.periodStart, "2026-01-01");
    assert.equal(f.taxType, "IPI");
    assert.equal(f.guideStatus, "PAID");
    assert.equal(f.groupBy, "period");
  });
});

describe("fiscalTaxIntelligence permissions", () => {
  it("view exige tax_apuration.view ou taxes.view", () => {
    assert.equal(
      canViewFiscalSettlements({ hasPermission: () => false }),
      false
    );
    assert.equal(
      canViewFiscalSettlements({
        hasPermission: (k) => k === "taxes.view",
      }),
      true
    );
    assert.ok(FISCAL_SETTLEMENT_VIEW_PERMISSIONS.includes("finance.tax_apuration.view"));
  });
});

describe("fiscalTaxIntelligenceExport", () => {
  it("gera workbook com abas KPIs Fontes Detalhe Filtros e fonte nas colunas", () => {
    const payload = samplePayload();
    const wb = buildFiscalTaxIntelligenceExportWorkbook(payload);
    assert.deepEqual(wb.SheetNames, ["KPIs", "Fontes", "Detalhe", "Filtros"]);
    const detalhe = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets.Detalhe!
    );
    assert.ok(detalhe.length >= 1);
    const headers = Object.keys(detalhe[0]!);
    assert.ok(headers.some((h) => h.includes("HEADER") || h.includes("Destacado")));
    const buf = buildFiscalTaxIntelligenceExportBuffer(payload);
    assert.ok(buf.byteLength > 100);
    assert.match(
      buildFiscalTaxIntelligenceExportFilename(payload),
      /inteligencia-tributaria_20260701_20260731_taxType\.xlsx/
    );
  });
});

describe("fiscalTaxIntelligenceService aggregation", () => {
  it("agrega destacado HEADER, pago de guia válida e ignora cancelada", async () => {
    const prisma = {
      fiscalPaymentGuide: {
        findMany: async () => [
          {
            id: "g1",
            taxType: "IPI",
            jurisdiction: "FEDERAL",
            guideType: "DARF",
            guideNumber: "1",
            status: "PAID",
            periodStart: new Date("2026-07-01"),
            periodEnd: new Date("2026-07-31"),
            assessedAmount: money(90),
            creditsAmount: money(0),
            amountDue: money(90),
            amountPaid: money(90),
            interestAmount: money(0),
            fineAmount: money(0),
            balanceDue: money(0),
            allocations: [],
            period: { id: "p1", status: "CLOSED", uf: null, companyName: "Empresa A" },
          },
          {
            id: "g2",
            taxType: "IPI",
            jurisdiction: "FEDERAL",
            guideType: "DARF",
            guideNumber: "2",
            status: "CANCELLED",
            periodStart: new Date("2026-07-01"),
            periodEnd: new Date("2026-07-31"),
            assessedAmount: money(50),
            creditsAmount: money(0),
            amountDue: money(50),
            amountPaid: money(50),
            interestAmount: money(0),
            fineAmount: money(0),
            balanceDue: money(0),
            allocations: [],
            period: null,
          },
        ],
      },
      fiscalApurationLine: {
        findMany: async () => [],
      },
      nomusNfe: {
        findMany: async () => [
          {
            id: "nfe1",
            externalId: 10,
            numero: "100",
            serie: "1",
            status: 1,
            cnpjEmitente: "11.111.111/0001-11",
            xmlDhEmi: new Date("2026-07-10"),
            dataProcessamento: null,
            valorLiquido: money(1000),
            xmlVProd: money(1000),
            xmlVDesc: money(0),
            fiscalSummary: {
              vProd: money(1000),
              vDesc: money(0),
              isCancelled: false,
              taxLines: [
                {
                  taxType: "IPI",
                  amount: money(100),
                  ncm: null,
                  cfop: null,
                  scope: "HEADER",
                  itemNumber: null,
                },
              ],
            },
          },
        ],
      },
      salesOrderNfeLink: { findMany: async () => [] },
      salesOrder: { findMany: async () => [] },
    };

    const report = await buildFiscalTaxIntelligenceReport(prisma as never, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      groupBy: "taxType",
      taxType: null,
      jurisdiction: null,
      guideStatus: null,
      customerId: null,
      salesOrderId: null,
    });

    assert.equal(report.kpis.highlightedAmount, 100);
    assert.equal(report.kpis.amountPaid, 90);
    assert.equal(report.kpis.assessedAmount, 90);
    assert.equal(report.kpis.cancelledGuideCount, 1);
    assert.equal(report.kpis.validGuideCount, 1);
    assert.equal(report.kpis.highlightedVsAssessed, 10);
    assert.equal(report.kpis.assessedVsPaid, 0);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0]!.groupKey, "IPI");
    assert.equal(report.rows[0]!.highlightedAmount, 100);
    assert.equal(report.rows[0]!.amountPaid, 90);
  });

  it("rejeita periodEnd < periodStart", async () => {
    await assert.rejects(
      () =>
        buildFiscalTaxIntelligenceReport({} as never, {
          periodStart: "2026-07-31",
          periodEnd: "2026-07-01",
          groupBy: "taxType",
        }),
      /periodEnd/
    );
  });
});
