import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderReportFilterLabels } from "./salesOrderReport.js";

/**
 * Regressão: `filters.startDate`/`endDate` devem ser `string | null` (chave civil,
 * ex. "2026-01-01"), nunca `Date`. Um `Date` bruto chegando aqui derruba a rota com
 * "(value ?? "").trim is not a function" — já aconteceu quando um caller passou
 * `parsed.startDate` (Date) direto sem converter via `civilDateKey`.
 */
describe("buildSalesOrderReportFilterLabels", () => {
  it("não derruba com startDate/endDate string preenchidos", () => {
    const lines = buildSalesOrderReportFilterLabels({
      customerId: "",
      customerName: null,
      status: "",
      sellerKey: "",
      sellerLabel: null,
      startDate: "2026-01-01",
      endDate: "2026-08-07",
      year: 2026,
      month: null,
      search: "",
    });
    const emissao = lines.find((l) => l.label === "Emissão");
    assert.ok(emissao);
    assert.equal(emissao?.value, "2026-01-01 — 2026-08-07");
  });

  it("lida com startDate/endDate ausentes sem lançar", () => {
    assert.doesNotThrow(() =>
      buildSalesOrderReportFilterLabels({
        customerId: "",
        customerName: null,
        status: "",
        sellerKey: "",
        sellerLabel: null,
        startDate: null,
        endDate: null,
        year: null,
        month: null,
        search: "",
      })
    );
  });
});
