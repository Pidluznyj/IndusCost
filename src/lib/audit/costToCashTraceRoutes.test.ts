import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildEmptyCommissionTraceReport } from "./commissionTrace.js";
import { buildEmptyProductCostTraceReport } from "./productCostTrace.js";
import { buildEmptySalesOrderTraceReport } from "./salesOrderTrace.js";
import {
  CostToCashTraceApiValidationError,
  buildCommissionTraceApiResponse,
  buildCostToCashTraceApiResponse,
  buildProductCostTraceApiResponse,
  buildPublishedPriceTraceEmptyApiResponse,
  buildSalesOrderTraceApiResponse,
  parseCommissionTraceApiQuery,
  parseProductCostTraceApiQuery,
  parsePublishedPriceTraceApiQuery,
  parseSalesOrderTraceApiQuery,
} from "./costToCashTraceApi.js";
import { assembleCostToCashTrace, buildEmptyCostToCashTrace } from "./costToCashTrace.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("costToCashTraceApi parsers", () => {
  it("produto por sku aceita 618.08AA", () => {
    const query = parseProductCostTraceApiQuery({ sku: "618.08AA" });
    assert.equal(query.sku, "618.08AA");
  });

  it("preço por sku e tableCode aceita parâmetros", () => {
    const query = parsePublishedPriceTraceApiQuery({
      sku: "618.08AA",
      tableCode: "ATACADO",
    });
    assert.equal(query.sku, "618.08AA");
    assert.equal(query.tableCode, "ATACADO");
  });

  it("venda com customer sem year retorna 400 amigável", () => {
    assert.throws(
      () => parseSalesOrderTraceApiQuery({ customer: "ACME" }),
      (error: unknown) => {
        assert.ok(error instanceof CostToCashTraceApiValidationError);
        assert.match(error.message, /customer exige year/i);
        return true;
      }
    );
  });

  it("venda sem identificador retorna 400 amigável", () => {
    assert.throws(
      () => parseSalesOrderTraceApiQuery({ sku: "618.08AA" }),
      (error: unknown) => {
        assert.ok(error instanceof CostToCashTraceApiValidationError);
        return true;
      }
    );
  });

  it("comissão aceita orderNumber", () => {
    const query = parseCommissionTraceApiQuery({ orderNumber: "PED-1" });
    assert.equal(query.orderNumber, "PED-1");
  });
});

describe("costToCashTraceApi envelope", () => {
  it("produto inexistente retorna status EMPTY auditável, não erro interno", () => {
    const trace = buildEmptyProductCostTraceReport("2026-07-06", "Produto não encontrado");
    const response = buildProductCostTraceApiResponse(trace);
    assert.equal(response.status, "EMPTY");
    assert.ok(response.errors.some((e) => /não encontrado/i.test(e.message)));
    assert.equal(response.sections.product.status, "FAIL");
  });

  it("preço vazio retorna EMPTY com errors", () => {
    const response = buildPublishedPriceTraceEmptyApiResponse("SKU sem preço publicado");
    assert.equal(response.status, "EMPTY");
    assert.equal(response.sections.publishedPrice, null);
    assert.equal(response.errors[0]?.code, "NOT_FOUND");
  });

  it("comissão sem schedule retorna status auditável", () => {
    const trace = buildEmptyCommissionTraceReport("Pedido não encontrado");
    const response = buildCommissionTraceApiResponse(trace);
    assert.equal(response.status, "EMPTY");
    assert.ok(response.summary.message);
    assert.ok(Array.isArray(response.diagnostics));
  });

  it("payload inclui summary, sections, diagnostics, warnings, errors", () => {
    const sales = buildEmptySalesOrderTraceReport("Pedido não encontrado");
    const response = buildSalesOrderTraceApiResponse(sales);
    assert.ok(response.summary.title);
    assert.ok("salesOrder" in response.sections);
    assert.ok(Array.isArray(response.warnings));
    assert.ok(Array.isArray(response.errors));
  });

  it("cost-to-cash agrega cadeia completa", () => {
    const trace = assembleCostToCashTrace({
      product: buildEmptyProductCostTraceReport("2026-07-06", "x"),
      publishedPrice: null,
      salesOrder: null,
      commission: buildEmptyCommissionTraceReport("y"),
    });
    const response = buildCostToCashTraceApiResponse(trace);
    assert.ok("chain" in response.sections);
    assert.ok(response.summary.calculationMode);
  });

  it("trace vazio retorna EMPTY", () => {
    const response = buildCostToCashTraceApiResponse(buildEmptyCostToCashTrace("Sem parâmetros"));
    assert.equal(response.status, "EMPTY");
  });
});

describe("costToCashTraceRoutes", () => {
  it("registrado no server.ts", () => {
    assert.match(read("server.ts"), /registerCostToCashTraceRoutes/);
  });

  it("expõe endpoints read-only de audit", () => {
    const src = read("src/lib/audit/costToCashTraceRoutes.ts");
    const endpoints = [
      "/api/audit/product-cost-trace",
      "/api/audit/published-price-trace",
      "/api/audit/sales-order-trace",
      "/api/audit/commission-trace",
      "/api/audit/cost-to-cash-trace",
    ];
    for (const endpoint of endpoints) {
      assert.match(src, new RegExp(endpoint.replace(/\//g, "\\/")));
    }
  });

  it("endpoints exigem auth e permissão", () => {
    const src = read("src/lib/audit/costToCashTraceRoutes.ts");
    assert.match(src, /requireAppAuth/);
    assert.match(src, /requireAnyPermission/);
    assert.match(src, /PRODUCTION_COST_TABLE_VIEW_PERMISSIONS/);
    assert.match(src, /COMMISSIONS_AUDIT_VIEW_PERMISSIONS/);
    assert.match(src, /COST_TO_CASH_TRACE_VIEW_PERMISSIONS/);
  });

  it("reaproveita services sem duplicar lógica", () => {
    const src = read("src/lib/audit/costToCashTraceRoutes.ts");
    assert.match(src, /buildProductCostTrace/);
    assert.match(src, /buildPublishedPriceTrace/);
    assert.match(src, /buildSalesOrderTrace/);
    assert.match(src, /buildCommissionTrace/);
    assert.match(src, /buildCostToCashTrace/);
    assert.doesNotMatch(src, /recalculateCommissions|applyReceiptClosing|publish_tables|receipt-closing\/apply/i);
  });

  it("erros não expõem stack ao cliente", () => {
    const src = read("src/lib/audit/costToCashTraceRoutes.ts");
    assert.match(src, /costToCashTraceApiError/);
    assert.doesNotMatch(src, /stack/);
  });
});
