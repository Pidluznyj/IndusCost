import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostToCashTraceApiUrl,
  buildCostToCashTraceSearchParams,
  hasCostToCashSearchCriteria,
} from "./costToCashTraceClient.js";
import {
  TRACE_PAGE_UNAVAILABLE,
  buildTraceSummaryCards,
  formatTraceMoney,
  hasProductData,
  hasSalesOrderData,
} from "./costToCashTracePageView.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("costToCashTracePage client", () => {
  it("buscar 618.08AA monta URL da API", () => {
    const url = buildCostToCashTraceApiUrl({ sku: "618.08AA", tableCode: "ATACADO" });
    assert.match(url, /sku=618\.08AA/);
    assert.match(url, /tableCode=ATACADO/);
    assert.match(url, /\/api\/audit\/cost-to-cash-trace/);
  });

  it("sem critério de busca é rejeitado no hook", () => {
    assert.equal(hasCostToCashSearchCriteria({}), false);
    assert.equal(hasCostToCashSearchCriteria({ sku: "618.08AA" }), true);
    assert.equal(hasCostToCashSearchCriteria({ customer: "ACME", year: "2026" }), true);
  });

  it("sem venda mostra meta Sem venda encontrada nos cards", () => {
    const cards = buildTraceSummaryCards({
      status: "PASS",
      summary: {
        title: "x",
        message: null,
        auditedAt: new Date().toISOString(),
        calculationMode: "PUBLISHED",
      },
      sections: {
        product: null,
        publishedPrice: null,
        salesOrder: null,
        commission: null,
        chain: [],
      },
      diagnostics: [],
      warnings: [],
      errors: [],
    });
    const salesCard = cards.find((c) => c.label === "Venda (líquido)");
    assert.equal(salesCard?.meta, "Sem venda encontrada");
  });

  it("dados ausentes não quebram helpers de seção", () => {
    const sections = {
      product: null,
      publishedPrice: null,
      salesOrder: null,
      commission: null,
      chain: [],
    };
    assert.equal(hasProductData(sections), false);
    assert.equal(hasSalesOrderData(sections), false);
    assert.equal(formatTraceMoney(null), TRACE_PAGE_UNAVAILABLE);
  });
});

describe("costToCashTracePage wiring", () => {
  it("página registrada no App.tsx", () => {
    assert.match(read("src/App.tsx"), /CostToCashTracePage/);
    assert.match(read("src/App.tsx"), /reports\/cost-to-cash-trace/);
  });

  it("consome API sem recalcular no frontend", () => {
    const page = read("src/components/audit/CostToCashTracePage.tsx");
    assert.match(page, /fetchCostToCashTrace|useCostToCashTraceSearch/);
    assert.match(page, /read-only|read-only/i);
    assert.doesNotMatch(page, /recalculate|publish_tables|applyClosing/i);
  });

  it("hook isola erro de API", () => {
    const hook = read("src/lib/audit/useCostToCashTraceSearch.ts");
    assert.match(hook, /setError\(message\)/);
    assert.match(hook, /setData\(null\)/);
  });

  it("buildCostToCashTraceSearchParams serializa filtros", () => {
    const params = buildCostToCashTraceSearchParams({
      sku: "618.08AA",
      orderNumber: "PD1",
      receivableCode: "AR-1",
    });
    assert.equal(params.get("sku"), "618.08AA");
    assert.equal(params.get("orderNumber"), "PD1");
    assert.equal(hasCostToCashSearchCriteria({ sku: "618.08AA" }), true);
  });
});
