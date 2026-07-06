import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceBillingNfeExportCsv } from "./financeBillingNfeExport.js";
import { buildFinanceBillingExportQuery } from "./financeBillingNfeFiltersTypes.js";

describe("financeBillingNfeExport", () => {
  it("gera CSV com cabeçalhos esperados", () => {
    const csv = buildFinanceBillingNfeExportCsv([
      {
        id: "1",
        externalId: 100,
        numero: "12345",
        serie: "1",
        status: 1,
        billingClassification: "MARKET_REVENUE",
        xmlDestCnpjCpf: "12345678000199",
        xmlNatOp: "Venda",
        fiscalDate: "2026-06-01T00:00:00.000Z",
        dataProcessamento: "2026-06-02T00:00:00.000Z",
        valorLiquido: 1500.5,
        isMarketSale: true,
        syncedAt: "2026-06-06T12:00:00.000Z",
      },
    ]);
    assert.match(csv, /ID Nomus/);
    assert.match(csv, /12345/);
    assert.match(csv, /1\.500,50/);
  });

  it("export query inclui format=csv e filtros NF-e", () => {
    const qs = buildFinanceBillingExportQuery({
      year: "2026",
      month: "6",
      customerCnpj: "1234",
      documentNumber: "",
      classification: "market",
      status: "all",
    });
    assert.ok(qs.includes("format=csv"));
    assert.ok(qs.includes("year=2026"));
    assert.ok(qs.includes("month=6"));
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("/api/finance/billing/export"));
  });
});
