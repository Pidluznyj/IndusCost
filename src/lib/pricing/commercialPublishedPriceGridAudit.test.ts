import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CommercialPublishedPriceGridRow } from "./commercialPublishedPrices.types.js";
import {
  buildCommercialPublishedPriceGridCsv,
  buildTopProductsByPrice,
  collectPartialProducts,
  compareGridCellToPublishedItem,
  filterAuditRows,
} from "./commercialPublishedPriceGridAudit.server.js";

function sampleRow(overrides?: Partial<CommercialPublishedPriceGridRow>): CommercialPublishedPriceGridRow {
  return {
    productId: "prod-1",
    sku: "SKU-001",
    productName: "Produto A",
    taxInfo: { fiscalRuleId: "tax-1", fiscalRuleName: "Mercado Interno", taxPercent: 10 },
    prices: [
      {
        tableId: "t1",
        tableName: "Atacado",
        versionId: "v1",
        priceItemId: "item-1",
        salePrice: 100,
        marginPercent: 20,
        markup: 50,
        commissionPercent: 2,
        taxPercent: 10,
        status: "PUBLISHED",
      },
      {
        tableId: "t2",
        tableName: "Varejo 1",
        versionId: "v2",
        priceItemId: null,
        salePrice: null,
        marginPercent: null,
        markup: null,
        commissionPercent: null,
        taxPercent: null,
        status: "NO_PRICE",
      },
    ],
    lastPublishedAt: "2026-07-06T10:00:00.000Z",
    status: "PARTIAL",
    ...overrides,
  };
}

describe("commercialPublishedPriceGridAudit", () => {
  const tables = [
    {
      tableId: "t1",
      tableName: "Atacado",
      tableCode: "ATACADO",
      versionId: "v1",
      versionNumber: 3,
      publishedAt: "2026-07-06T10:00:00.000Z",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      taxRuleId: "tax-1",
      taxRuleName: "Mercado Interno",
      status: "PUBLISHED",
      isPrimary: true,
    },
    {
      tableId: "t2",
      tableName: "Varejo 1",
      tableCode: "VAREJO_1",
      versionId: "v2",
      versionNumber: 2,
      publishedAt: "2026-07-05T10:00:00.000Z",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      taxRuleId: "tax-1",
      taxRuleName: "Mercado Interno",
      status: "PUBLISHED",
    },
  ];

  it("filtra SKU específico para auditoria", () => {
    const rows = filterAuditRows(
      [sampleRow(), sampleRow({ productId: "prod-2", sku: "SKU-002" })],
      { sku: "SKU-001" }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sku, "SKU-001");
  });

  it("detecta divergência de salePrice entre grid e item publicado", () => {
    const mismatches = compareGridCellToPublishedItem({
      row: sampleRow(),
      table: tables[0]!,
      cellIndex: 0,
      publishedItem: {
        id: "item-1",
        priceTableVersionId: "v1",
        productId: "prod-1",
        sku: "SKU-001",
        salePrice: 99.5,
        frozenTotalCost: 50,
        marginPct: 20,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1 } },
      },
    });
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0]?.field, "salePrice");
    assert.equal(mismatches[0]?.gridValue, 100);
    assert.equal(mismatches[0]?.publishedValue, 99.5);
  });

  it("PASS quando grid e item publicado coincidem", () => {
    const mismatches = compareGridCellToPublishedItem({
      row: sampleRow(),
      table: tables[0]!,
      cellIndex: 0,
      publishedItem: {
        id: "item-1",
        priceTableVersionId: "v1",
        productId: "prod-1",
        sku: "SKU-001",
        salePrice: 100,
        frozenTotalCost: 50,
        marginPct: 20,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1 } },
      },
    });
    assert.equal(mismatches.length, 0);
  });

  it("identifica produtos sem preço em alguma tabela", () => {
    const partial = collectPartialProducts([sampleRow()], tables);
    assert.equal(partial.length, 1);
    assert.equal(partial[0]?.status, "PARTIAL");
    assert.deepEqual(partial[0]?.missingTableCodes, ["VAREJO_1"]);
  });

  it("CSV usa mesma fonte do grid com colunas dinâmicas", () => {
    const csv = buildCommercialPublishedPriceGridCsv({
      tables,
      rows: [sampleRow()],
    });
    const lines = csv.split("\n");
    assert.match(lines[0]!, /SKU,Produto,Info tributária,Tabela 1 preço,Tabela 2 preço/);
    assert.match(lines[1]!, /SKU-001,Produto A,Mercado Interno 10%,100,/);
    assert.match(lines[1]!, /PARTIAL/);
  });

  it("ranking top por preço usa salePrice publicado do grid", () => {
    const top = buildTopProductsByPrice(
      [
        sampleRow(),
        sampleRow({
          productId: "prod-2",
          sku: "SKU-002",
          prices: [
            { ...sampleRow().prices[0]!, salePrice: 250, priceItemId: "item-2" },
            sampleRow().prices[1]!,
          ],
        }),
      ],
      tables,
      2
    );
    assert.equal(top[0]?.sku, "SKU-002");
    assert.equal(top[0]?.maxSalePrice, 250);
  });
});

describe("auditCommercialPriceGridScript", () => {
  const scriptSrc = () =>
    readFileSync(join(process.cwd(), "scripts/audit-commercial-price-grid.ts"), "utf8");
  const auditSrc = () =>
    readFileSync(join(process.cwd(), "src/lib/pricing/commercialPublishedPriceGridAudit.server.ts"), "utf8");

  it("script usa o mesmo service do endpoint", () => {
    assert.match(auditSrc(), /buildCommercialPublishedPriceGridSnapshot/);
    assert.match(auditSrc(), /resolveCommercialPublishedTableContexts/);
    assert.doesNotMatch(auditSrc(), /getProductCostAnalysis/);
    assert.doesNotMatch(auditSrc(), /calculatePriceTableItemFromFrozenCost/);
  });

  it("script suporta sku, search, json e csv", () => {
    assert.match(scriptSrc(), /--sku/);
    assert.match(scriptSrc(), /--search/);
    assert.match(scriptSrc(), /--product-id/);
    assert.match(scriptSrc(), /--json/);
    assert.match(scriptSrc(), /--csv/);
  });
});
