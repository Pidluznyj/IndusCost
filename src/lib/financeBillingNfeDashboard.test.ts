import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBillingSourceDailyComparison } from "./financeBillingAuditDataset.js";
import { billingTabMetricsAreFinite } from "./financeBillingDashboard.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "./nomusNfeClassification.js";
import type { BillingAuditRow } from "./financeBillingAuditTypes.js";

function auditRow(
  partial: Partial<BillingAuditRow> & Pick<BillingAuditRow, "id" | "dataSource" | "includedInBilling">
): BillingAuditRow {
  return {
    exclusionReason: null,
    exclusionReasonCode: null,
    companyName: null,
    companyDocument: null,
    nfNumber: null,
    nfSeries: null,
    nfKey: null,
    nfStatus: null,
    operationNature: null,
    cfop: null,
    issueDate: null,
    processingDate: null,
    competenceDateUsed: null,
    importDate: null,
    customerName: null,
    customerDocument: null,
    sellerName: null,
    salesOrderCode: null,
    valueProducts: null,
    valueServices: null,
    valueFreight: null,
    valueDiscount: null,
    valueTaxes: null,
    valueTotalNf: null,
    valueNet: null,
    valueUsedInDashboard: 0,
    valueCalculationMode: null,
    billingClassification: null,
    syncedAt: null,
    originLabel: null,
    xmlPath: null,
    notes: null,
    ...partial,
  };
}

describe("financeBillingNfeDashboard", () => {
  it("SQL fiscal usa status autorizado, mercado e valorLiquido", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );
    assert.match(src, /NOMUS_NFE_STATUS_AUTHORIZED/);
    assert.match(src, /isMarketSale/);
    assert.match(src, /MARKET_REVENUE/);
    assert.match(src, /valorLiquido/);
    assert.equal(NOMUS_NFE_STATUS_AUTHORIZED, 4);
  });

  it("cards NF-e rotulam mês atual com fonte fiscal", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );
    assert.match(src, /Mês atual — NF-e fiscal/);
  });

  it("junho/2026 fixture: NF-e ~284k vs SalesOrder ~92k", () => {
    const juneDays: Array<[string, number, number]> = [
      ["2026-06-01", 1048.9, 1108.9],
      ["2026-06-02", 24970, 20562],
      ["2026-06-03", 37830.91, 17132.51],
      ["2026-06-08", 180232.34, 12254.34],
      ["2026-06-09", 1459.25, 1601.25],
      ["2026-06-10", 36582.96, 36704.32],
      ["2026-06-11", 2781.3, 2697],
    ];

    const nfeRows = juneDays.flatMap(([date, nfe]) => {
      const rows: BillingAuditRow[] = [
        auditRow({
          id: `nfe-${date}`,
          dataSource: "NomusNfe",
          includedInBilling: true,
          competenceDateUsed: date,
          valueUsedInDashboard: nfe,
          nfNumber: date === "2026-06-08" ? "7052" : "x",
          valueNet: date === "2026-06-08" ? 168075 : nfe,
        }),
      ];
      return rows;
    });

    const salesRows = juneDays.map(([date, , sales]) =>
      auditRow({
        id: `so-${date}`,
        dataSource: "SalesOrder",
        includedInBilling: true,
        competenceDateUsed: date,
        valueUsedInDashboard: sales,
      })
    );

    const daily = buildBillingSourceDailyComparison(nfeRows, salesRows);
    const nfeTotal = daily.reduce((s, r) => s + r.nfeTotal, 0);
    const salesTotal = daily.reduce((s, r) => s + r.salesOrderTotal, 0);

    assert.ok(Math.abs(nfeTotal - 284905.66) < 1);
    assert.ok(Math.abs(salesTotal - 92060.32) < 1);

    const day08 = daily.find((r) => r.date === "2026-06-08");
    assert.ok(day08);
    assert.ok(Math.abs(day08!.difference - 167978) < 1);

    const nf7052 = nfeRows.find((r) => r.nfNumber === "7052");
    assert.equal(nf7052?.valueNet, 168075);
  });

  it("comparação diária não produz NaN", () => {
    const daily = buildBillingSourceDailyComparison(
      [
        auditRow({
          id: "1",
          dataSource: "NomusNfe",
          includedInBilling: true,
          competenceDateUsed: "2026-06-01",
          valueUsedInDashboard: 100,
        }),
      ],
      []
    );
    assert.equal(daily[0]!.difference, 100);
    assert.equal(Number.isFinite(daily[0]!.nfeTotal), true);
  });

  it("billingTabMetricsAreFinite está disponível para validação de métricas", () => {
    assert.equal(typeof billingTabMetricsAreFinite, "function");
  });
});
