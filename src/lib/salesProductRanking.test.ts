import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  aggregateSoldProductsNcmByProduct,
  aggregateSoldProductsRanking,
  buildSoldProductsCustomerMix,
  buildSoldProductsNcmSummary,
  buildSoldProductsSummary,
  computeSoldProductsAverageUnitPrice,
  computeSoldProductsSharePercent,
  filterSoldProductsLines,
  resolveSoldProductsLineAmount,
  type SoldProductsLineContext,
} from "./salesProductRanking.js";
import {
  buildSoldProductsDashboardQuery,
  createDefaultSoldProductsUiFilters,
  formatSoldProductsIsoDateDisplay,
  isDefaultSoldProductsUiFilters,
  isGroupEconomyCustomer,
  matchesSoldProductsCustomerScope,
  matchesSoldProductsIssuerCompany,
  normalizeSoldProductsUiFilters,
  orderMatchesSoldProductsStatus,
  parseSalesProductRankingFilters,
  resolveSoldProductsDateRange,
} from "./salesProductRankingFilters.js";
import {
  buildSalesProductRankingExportWorkbook,
  soldProductsRankingExportFilename,
  soldProductsRankingWorkbookToBytes,
} from "./salesProductRankingExport.js";
import type { SoldProductsDashboardPayload } from "./salesProductRankingTypes.js";

const REF = new Date(2026, 5, 15, 12, 0, 0, 0);

function line(partial: Partial<SoldProductsLineContext> & Pick<SoldProductsLineContext, "productId" | "quantity" | "lineAmount" | "orderId" | "customerId">): SoldProductsLineContext {
  return {
    lineId: partial.lineId ?? `line-${partial.productId}-${partial.orderId}`,
    productCode: partial.productCode ?? partial.productId,
    productName: partial.productName ?? `Produto ${partial.productId}`,
    productNcm: partial.productNcm ?? null,
    unitPrice: partial.unitPrice ?? partial.lineAmount / Math.max(partial.quantity, 1),
    orderCode: partial.orderCode ?? partial.orderId,
    orderDate: partial.orderDate ?? new Date(2026, 2, 10),
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    sellerName: partial.sellerName ?? "Vendedor A",
    companyLabel: partial.companyLabel ?? "Koppetel",
    customerName: partial.customerName ?? "Cliente X",
    customerTaxId: partial.customerTaxId ?? "12345678000199",
    ...partial,
  };
}

describe("salesProductRanking", () => {
  it("ranking por quantidade coloca produto A em primeiro", () => {
    const lines = [
      line({ productId: "p-a", productCode: "A", quantity: 100, lineAmount: 1000, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-b", productCode: "B", quantity: 50, lineAmount: 2000, orderId: "o2", customerId: "c2" }),
    ];
    const ranking = aggregateSoldProductsRanking(lines, "quantity", 10);
    assert.equal(ranking[0]?.productCode, "A");
    assert.equal(ranking[0]?.quantitySold, 100);
    assert.equal(ranking[1]?.productCode, "B");
  });

  it("ordenação por valor funciona", () => {
    const lines = [
      line({ productId: "p-a", quantity: 100, lineAmount: 1000, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-b", quantity: 10, lineAmount: 5000, orderId: "o2", customerId: "c2" }),
    ];
    const ranking = aggregateSoldProductsRanking(lines, "amount", 10);
    assert.equal(ranking[0]?.productId, "p-b");
  });

  it("preço médio e percentuais sem NaN", () => {
    assert.equal(computeSoldProductsAverageUnitPrice(0, 100), null);
    assert.equal(computeSoldProductsAverageUnitPrice(10, 250), 25);
    assert.equal(computeSoldProductsSharePercent(50, 0), 0);
    assert.equal(computeSoldProductsSharePercent(25, 100), 25);
    assert.equal(resolveSoldProductsLineAmount(2, 10, 0), 20);
    assert.equal(resolveSoldProductsLineAmount(2, 10, 99), 99);
  });

  it("exclui pedidos cancelados no filtro padrão valid", () => {
    assert.equal(orderMatchesSoldProductsStatus("CANCELLED", "valid"), false);
    assert.equal(orderMatchesSoldProductsStatus("SENT_TO_NOMUS", "valid"), true);
    const lines = filterSoldProductsLines(
      [
        line({ productId: "p1", quantity: 1, lineAmount: 1, orderId: "o1", customerId: "c1", orderStatus: "CANCELLED" }),
        line({ productId: "p2", quantity: 2, lineAmount: 2, orderId: "o2", customerId: "c2", orderStatus: "SENT_TO_NOMUS" }),
      ],
      parseSalesProductRankingFilters({ year: "2026" }, REF)
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.productId, "p2");
  });

  it("filtro de cliente externo exclui grupo econômico", () => {
    const external = { taxId: "12345678000199", companyName: "Cliente Mercado" };
    const group = { taxId: "14.055.501/0001-80", companyName: "Koppetel Comercio" };
    assert.equal(matchesSoldProductsCustomerScope(external, "external"), true);
    assert.equal(matchesSoldProductsCustomerScope(group, "external"), false);
    assert.equal(matchesSoldProductsCustomerScope(group, "group"), true);
    assert.equal(isGroupEconomyCustomer(group), true);
  });

  it("filtro de empresa emissora por nomeEmpresa", () => {
    assert.equal(
      matchesSoldProductsIssuerCompany({ nomusRawResponse: { nomeEmpresa: "Koppetel Comercio" } }, "koppetel"),
      true
    );
    assert.equal(
      matchesSoldProductsIssuerCompany({ nomusRawResponse: { nomeEmpresa: "Koppetel Comercio" } }, "lazarios"),
      false
    );
  });

  it("período padrão usa ano corrente", () => {
    const defaults = createDefaultSoldProductsUiFilters(REF);
    assert.equal(defaults.year, "2026");
    assert.equal(isDefaultSoldProductsUiFilters(defaults, REF), true);
    const range = resolveSoldProductsDateRange(defaults, REF);
    assert.equal(range.startDate.getFullYear(), 2026);
    assert.equal(range.endDate.getMonth(), 11);
    const qs = buildSoldProductsDashboardQuery(defaults);
    assert.match(qs, /year=2026/);
  });

  it("parse filtros com mês", () => {
    const filters = parseSalesProductRankingFilters({ year: "2026", month: "3" }, REF);
    assert.equal(filters.startDate.getMonth(), 2);
    assert.equal(filters.endDate.getDate(), 31);
  });

  it("customer mix calcula participação do cliente no produto", () => {
    const lines = [
      line({ productId: "p1", quantity: 60, lineAmount: 600, orderId: "o1", customerId: "c1", customerName: "A" }),
      line({ productId: "p1", quantity: 40, lineAmount: 400, orderId: "o2", customerId: "c2", customerName: "B" }),
    ];
    const ranking = aggregateSoldProductsRanking(lines, "quantity", 10);
    const mix = buildSoldProductsCustomerMix(lines, ranking);
    const clientA = mix.find((m) => m.customerId === "c1");
    assert.equal(clientA?.customerSharePercent, 60);
  });

  it("summary agrega totais", () => {
    const lines = [
      line({ productId: "p1", quantity: 10, lineAmount: 100, orderId: "o1", customerId: "c1" }),
      line({ productId: "p2", quantity: 5, lineAmount: 50, orderId: "o2", customerId: "c2" }),
    ];
    const ranking = aggregateSoldProductsRanking(lines, "quantity", 10);
    const summary = buildSoldProductsSummary(lines, ranking);
    assert.equal(summary.totalQuantity, 15);
    assert.equal(summary.totalAmount, 150);
    assert.equal(summary.productsCount, 2);
    assert.equal(summary.ordersCount, 2);
  });

  it("NCM x Produto: mesmo NCM em produtos diferentes gera DUAS linhas (nunca agrega só pelo NCM)", () => {
    const lines = [
      line({ productId: "p-a", productCode: "100.20", productNcm: "39269090", quantity: 100, lineAmount: 5000, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-b", productCode: "100.21", productNcm: "39269090", quantity: 250, lineAmount: 15000, orderId: "o2", customerId: "c2" }),
    ];
    const rows = aggregateSoldProductsNcmByProduct(lines);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.ncm, "39269090");
    assert.equal(rows[1]?.ncm, "39269090");
    assert.notEqual(rows[0]?.productId, rows[1]?.productId);
  });

  it("NCM x Produto: produto sem NCM não desaparece (ncm=null, números preservados) e vai para o fim", () => {
    const lines = [
      line({ productId: "p-sem", productCode: "XPTO", productNcm: null, quantity: 500, lineAmount: 4000, orderId: "o3", customerId: "c3" }),
      line({ productId: "p-com", productCode: "100.20", productNcm: "48191000", quantity: 10, lineAmount: 100, orderId: "o1", customerId: "c1" }),
    ];
    const rows = aggregateSoldProductsNcmByProduct(lines);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.ncm, "48191000");
    assert.equal(rows[1]?.ncm, null);
    assert.equal(rows[1]?.quantitySold, 500);
    assert.equal(rows[1]?.soldValue, 4000);
    const summary = buildSoldProductsNcmSummary(rows);
    assert.equal(summary.productsWithoutNcmCount, 1);
    assert.equal(summary.totalQuantity, 510);
    assert.equal(summary.totalSoldValue, 4100);
  });

  it("NCM x Produto: ordenação NCM ASC depois SKU ASC; zero à esquerda intacto", () => {
    const lines = [
      line({ productId: "p-2", productCode: "200.10", productNcm: "39269090", quantity: 1, lineAmount: 10, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-1", productCode: "100.10", productNcm: "39269090", quantity: 1, lineAmount: 10, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-0", productCode: "300.10", productNcm: "01234567", quantity: 1, lineAmount: 10, orderId: "o1", customerId: "c1" }),
    ];
    const rows = aggregateSoldProductsNcmByProduct(lines);
    assert.equal(rows[0]?.ncm, "01234567");
    assert.equal(rows[1]?.sku, "100.10");
    assert.equal(rows[2]?.sku, "200.10");
  });

  it("NCM x Produto: linha sem productCode/Product resolvido NÃO desaparece — SKU cai para fallback e números permanecem", () => {
    // Estruturalmente SalesOrderItem.productId é NOT NULL (FK obrigatória),
    // mas a agregação não pode depender disso: nenhuma linha é descartada.
    const lines = [
      line({ productId: "p-x", productCode: null, productNcm: null, quantity: 500, lineAmount: 4000, orderId: "o9", customerId: "c9" }),
    ];
    const rows = aggregateSoldProductsNcmByProduct(lines);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sku, "—");
    assert.equal(rows[0]?.ncm, null);
    assert.equal(rows[0]?.quantitySold, 500);
    assert.equal(rows[0]?.soldValue, 4000);
    const summary = buildSoldProductsNcmSummary(rows);
    assert.equal(summary.totalQuantity, 500);
    assert.equal(summary.totalSoldValue, 4000);
  });

  it("RECONCILIAÇÃO OBRIGATÓRIA: SUM(NCM x Produto) = totais do Produtos Vendidos, mesma população", () => {
    const lines = [
      line({ productId: "p-a", productNcm: "39269090", quantity: 100, lineAmount: 5000.25, orderId: "o1", customerId: "c1" }),
      line({ productId: "p-a", productNcm: "39269090", quantity: 50, lineAmount: 2499.75, orderId: "o2", customerId: "c2" }),
      line({ productId: "p-b", productNcm: null, quantity: 30, lineAmount: 900.5, orderId: "o3", customerId: "c1" }),
    ];
    const ranking = aggregateSoldProductsRanking(lines, "quantity", null);
    const currentReport = buildSoldProductsSummary(lines, ranking);
    const ncmRows = aggregateSoldProductsNcmByProduct(lines);
    const sumQty = ncmRows.reduce((acc, r) => acc + r.quantitySold, 0);
    const sumValue = ncmRows.reduce((acc, r) => acc + r.soldValue, 0);
    assert.equal(sumQty, currentReport.totalQuantity);
    assert.ok(Math.abs(sumValue - currentReport.totalAmount) < 0.005);
    const ncmSummary = buildSoldProductsNcmSummary(ncmRows);
    assert.equal(ncmSummary.totalQuantity, currentReport.totalQuantity);
    assert.ok(Math.abs(ncmSummary.totalSoldValue - currentReport.totalAmount) < 0.005);
  });

  it("export XLSX contém abas esperadas", () => {
    const payload: SoldProductsDashboardPayload = {
      generatedAt: REF.toISOString(),
      filters: {
        periodLabel: "Ano 2026",
        dateBasis: "issueDate",
        dateBasisLabel: "Data de emissão do pedido",
        company: "all",
        companyLabel: "Todas",
        orderStatus: "valid",
        orderStatusLabel: "Válidos",
        customerScope: "external",
        customerScopeLabel: "Clientes externos",
        sortBy: "quantity",
        sortByLabel: "Quantidade vendida",
        topN: "50",
        topNLabel: "Top 50",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        year: 2026,
      },
      summary: {
        totalQuantity: 10,
        totalAmount: 100,
        productsCount: 1,
        customersCount: 1,
        ordersCount: 1,
        averageUnitPrice: 10,
        topProductByQuantity: null,
        topProductByAmount: null,
      },
      ranking: [
        {
          rank: 1,
          productId: "p1",
          productCode: "SKU1",
          productName: "Produto 1",
          quantitySold: 10,
          amountSold: 100,
          averageUnitPrice: 10,
          ordersCount: 1,
          customersCount: 1,
          lastSaleDate: "2026-03-10",
          quantitySharePercent: 100,
          amountSharePercent: 100,
        },
      ],
      customerMix: [],
      monthlyEvolution: [],
      ncmByProduct: [
        {
          ncm: "39269090",
          productId: "p1",
          sku: "SKU1",
          productName: "Produto 1",
          quantitySold: 10,
          soldValue: 100,
        },
        {
          ncm: null,
          productId: "p2",
          sku: "XPTO",
          productName: "Produto Sem Cadastro",
          quantitySold: 5,
          soldValue: 40,
        },
      ],
      ncmSummary: {
        totalQuantity: 10,
        totalSoldValue: 100,
        productsCount: 1,
        productsWithoutNcmCount: 0,
      },
      detailRows: [],
      detailPagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
    };
    const wb = buildSalesProductRankingExportWorkbook(payload);
    assert.deepEqual(wb.SheetNames, [
      "Resumo",
      "Ranking",
      "Produto x Cliente",
      "Evolução Mensal",
      "NCM x Produto",
      "Detalhamento",
      "Filtros Aplicados",
    ]);
    // Conteúdo da aba NCM x Produto: colunas exigidas + "Sem NCM" para null.
    const ncmSheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["NCM x Produto"]!
    );
    assert.deepEqual(Object.keys(ncmSheet[0]!), [
      "NCM",
      "SKU",
      "Produto",
      "Quantidade Vendida",
      "Valor Vendido",
    ]);
    assert.equal(ncmSheet[0]!.NCM, "39269090");
    assert.equal(ncmSheet[1]!.NCM, "Sem NCM");
    assert.equal(ncmSheet[1]!.SKU, "XPTO");
    assert.equal(ncmSheet[1]!["Quantidade Vendida"], 5);
    assert.equal(ncmSheet[1]!["Valor Vendido"], 40);
    const bytes = soldProductsRankingWorkbookToBytes(wb);
    assert.ok(bytes.byteLength > 100);
    assert.match(soldProductsRankingExportFilename(REF), /^produtos-vendidos-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("normalize mantém defaults seguros", () => {
    const n = normalizeSoldProductsUiFilters({});
    assert.equal(n.orderStatus, "valid");
    assert.equal(n.customerScope, "external");
    assert.equal(n.sortBy, "quantity");
    assert.equal(n.topN, "50");
  });

  it("query string inclui productId quando informado", () => {
    const qs = buildSoldProductsDashboardQuery({
      ...createDefaultSoldProductsUiFilters(),
      productId: "prod-uuid-1",
    });
    assert.match(qs, /productId=prod-uuid-1/);
  });

  it("query string envia startDate e endDate em ISO YYYY-MM-DD", () => {
    const qs = buildSoldProductsDashboardQuery({
      ...createDefaultSoldProductsUiFilters(),
      startDate: "2026-01-01",
      endDate: "2026-06-17",
    });
    assert.match(qs, /startDate=2026-01-01/);
    assert.match(qs, /endDate=2026-06-17/);
  });

  it("formatSoldProductsIsoDateDisplay exibe DD/MM/AAAA", () => {
    assert.equal(formatSoldProductsIsoDateDisplay("2026-01-01"), "01/01/2026");
    assert.equal(formatSoldProductsIsoDateDisplay("2026-06-17"), "17/06/2026");
  });

  it("limpar filtros restaura datas vazias", () => {
    const defaults = createDefaultSoldProductsUiFilters(new Date(2026, 5, 17));
    assert.equal(defaults.startDate, "");
    assert.equal(defaults.endDate, "");
    assert.equal(isDefaultSoldProductsUiFilters(defaults, new Date(2026, 5, 17)), true);
  });

  it("página possui impressão e export Excel", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "commercial", "SoldProductsReportPage.tsx"),
      "utf8"
    );
    const printDoc = readFileSync(
      join(process.cwd(), "src", "components", "commercial", "SoldProductsPrintDocument.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Imprimir / PDF"));
    assert.ok(page.includes("Exportar Excel"));
    assert.ok(page.includes("CSV do ranking"));
    assert.ok(page.includes("Ranking completo de produtos"));
    assert.ok(page.includes("sold-products-print-route"));
    assert.ok(page.includes("sold-products-no-print"));
    assert.ok(page.includes("createPortal"));
    assert.ok(page.includes("SoldProductsPrintDocument"));
    assert.ok(page.includes("/api/commercial/sold-products/filter-options"));
    assert.ok(page.includes("FilterSearchableSelect"));
    assert.ok(page.includes("/api/commercial/sold-products/export.xlsx"));
    assert.ok(page.includes("SortableTh"));
    assert.ok(page.includes("Clique para ordenar"));
    assert.ok(page.includes('label="Data inicial"'));
    assert.ok(page.includes('type="date"'));
    assert.ok(page.includes("formatSoldProductsIsoDateDisplay"));
    assert.ok(page.includes("prepareRankingTableRows"));
    assert.ok(page.includes("ExecutiveSummarySection"));
    assert.ok(page.includes("SummaryKpiGrid"));
    assert.ok(page.includes("amountFormat"));
    assert.ok(printDoc.includes("rootId=\"sold-products-print-root\""));
    assert.ok(printDoc.includes("PrintHeader"));
    assert.ok(printDoc.includes("PRODUTOS VENDIDOS"));

    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "salesProductRankingRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("/api/commercial/sold-products/filter-options"));
    assert.ok(routes.includes("buildSoldProductsFilterOptions"));
    assert.ok(routes.includes("/api/commercial/sold-products/:productId/customers"));
    assert.ok(page.includes("Ver clientes"));
    assert.ok(page.includes("buildSoldProductCustomersPath"));
  });
});
