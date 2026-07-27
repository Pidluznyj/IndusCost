import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCommercialPublishedPricesApiResponse,
  NO_PUBLISHED_COMMERCIAL_PRICE_TABLES_MESSAGE,
  parseCommercialPublishedPricesQuery,
} from "./commercialPublishedPricesApi.js";
import { buildCommercialPublishedPriceGridSnapshot } from "./commercialPublishedPrices.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("commercialPublishedPricesApi", () => {
  it("parseia parâmetros de consulta da tela", () => {
    const query = parseCommercialPublishedPricesQuery({
      search: " 309.01 ",
      taxRuleId: "tax-1",
      marginRuleId: "30",
      commissionRuleId: "2,5",
      tableId: "tbl-1",
      page: "2",
      pageSize: "25",
      sort: "NAME_ASC",
    });

    assert.equal(query.search, "309.01");
    assert.equal(query.taxRuleId, "tax-1");
    assert.equal(query.marginRuleId, "30");
    assert.equal(query.commissionRuleId, "2,5");
    assert.equal(query.tableId, "tbl-1");
    assert.equal(query.page, 2);
    assert.equal(query.limit, 25);
    assert.equal(query.sort, "NAME_ASC");
  });

  it("sem tabela publicada retorna lista vazia com mensagem adequada", () => {
    const response = buildCommercialPublishedPricesApiResponse({
      referenceDate: "2026-07-01",
      tables: [],
      rows: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      totals: { tableCount: 0, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
    });

    assert.equal(response.tables.length, 0);
    assert.equal(response.rows.length, 0);
    assert.equal(response.message, NO_PUBLISHED_COMMERCIAL_PRICE_TABLES_MESSAGE);
  });

  it("com tabelas publicadas não inclui mensagem de ausência", () => {
    const response = buildCommercialPublishedPricesApiResponse({
      referenceDate: "2026-07-01",
      tables: [
        {
          tableId: "t1",
          tableName: "Atacado",
          tableCode: "ATACADO",
          versionId: "v1",
          versionNumber: 1,
          publishedAt: "2026-06-01T10:00:00.000Z",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          taxRuleId: "tax-1",
          taxRuleName: "Mercado Interno",
          status: "PUBLISHED",
        },
      ],
      rows: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      totals: { tableCount: 1, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
    });

    assert.equal(response.message, null);
  });
});

describe("commercialPublishedPricesRoutes", () => {
  const server = () => read("server.ts");

  it("endpoint retorna 200 e usa service único", () => {
    const src = server();
    assert.match(src, /\/api\/pricing\/commercial-published-prices/);
    assert.match(src, /buildCommercialPublishedPriceGridSnapshot/);
    assert.match(src, /parseCommercialPublishedPricesQuery/);
    assert.match(src, /buildCommercialPublishedPricesApiResponse/);
    assert.match(src, /res\.json\(buildCommercialPublishedPricesApiResponse/);
    assert.doesNotMatch(
      read("src/lib/pricing/commercialPublishedPricesApi.ts"),
      /getProductCostAnalysis/
    );
  });

  it("permissão e autenticação liberam consumidores comerciais (sem exigir Formação de Preço)", () => {
    const src = server();
    const routeBlock = src.slice(
      src.indexOf('"/api/pricing/commercial-published-prices"'),
      src.indexOf('app.post("/api/pricing"', src.indexOf('"/api/pricing/commercial-published-prices"'))
    );
    assert.match(routeBlock, /requireAppAuth/);
    assert.match(routeBlock, /requireAnyPermission\(\[/);
    assert.match(routeBlock, /price_table\.view/);
    assert.match(routeBlock, /proposals\.view/);
    assert.match(routeBlock, /sales_orders\.view/);
    assert.match(routeBlock, /pricing\.view/);
    assert.doesNotMatch(routeBlock, /requireResource\("commercial\.pricing"/);
  });

  it("rota específica registrada antes de parâmetros /api/pricing/:productId", () => {
    const src = server();
    const commercialIdx = src.indexOf('"/api/pricing/commercial-published-prices"');
    const paramIdx = src.indexOf('"/api/pricing/:productId/:taxRuleId/calculate"');
    assert.ok(commercialIdx > 0);
    assert.ok(paramIdx > commercialIdx);
  });

  it("endpoint não recalcula preço nem altera dados", () => {
    const routeBlock = server().slice(
      server().indexOf('"/api/pricing/commercial-published-prices"'),
      server().indexOf('app.post("/api/pricing"', server().indexOf('"/api/pricing/commercial-published-prices"'))
    );
    assert.doesNotMatch(routeBlock, /getProductCostAnalysis/);
    assert.doesNotMatch(routeBlock, /calculatePriceTableItemFromFrozenCost/);
    assert.doesNotMatch(routeBlock, /\.create\(/);
    assert.doesNotMatch(routeBlock, /\.update\(/);
    assert.doesNotMatch(routeBlock, /\.delete\(/);
    assert.doesNotMatch(routeBlock, /\.upsert\(/);
  });
});

describe("commercialPublishedPrices endpoint data contract", () => {
  const ref = new Date("2026-07-01T12:00:00.000Z");

  type VersionRow = {
    id: string;
    priceTableId: string;
    versionNumber: number;
    status: string;
    taxRuleId: string | null;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    publishedAt: Date | null;
  };

  function createGridDb(
    tables: Array<{ id: string; code: string; name: string }>,
    versions: VersionRow[],
    items: Array<{
      id: string;
      priceTableVersionId: string;
      productId: string;
      sku: string;
      productName: string;
      frozenTotalCost: number;
      marginPct: number;
      salePrice: number;
      commissionPerc: number;
      formulaSnapshotJson: Record<string, unknown>;
    }>
  ) {
    return {
      priceTable: {
        findMany: async () => tables.map((t) => ({ ...t, status: "ACTIVE" })),
      },
      priceTableVersion: {
        findFirst: async ({
          where,
        }: {
          where: {
            priceTableId?: string;
            status?: { in: string[] };
            AND?: Array<{ OR: Array<Record<string, unknown>> }>;
          };
        }) => {
          let rows = versions.filter((v) => v.priceTableId === where.priceTableId);
          if (where.status?.in) rows = rows.filter((v) => where.status!.in.includes(v.status));
          const andClauses = where.AND ?? [];
          for (const clause of andClauses) {
            for (const or of clause.OR ?? []) {
              if (or.effectiveFrom && typeof or.effectiveFrom === "object" && "lte" in or.effectiveFrom) {
                const refDate = (or.effectiveFrom as { lte: Date }).lte.getTime();
                rows = rows.filter((v) => !v.effectiveFrom || v.effectiveFrom.getTime() <= refDate);
              }
              if (or.effectiveTo && typeof or.effectiveTo === "object" && "gt" in or.effectiveTo) {
                const refDate = (or.effectiveTo as { gt: Date }).gt.getTime();
                rows = rows.filter((v) => !v.effectiveTo || v.effectiveTo.getTime() > refDate);
              }
            }
          }
          rows.sort((a, b) => b.versionNumber - a.versionNumber);
          return rows[0] ?? null;
        },
      },
      priceTableItem: {
        findMany: async ({
          where,
        }: {
          where: { priceTableVersionId: { in: string[] } };
        }) => items.filter((i) => where.priceTableVersionId.in.includes(i.priceTableVersionId)),
      },
      taxRule: {
        findUnique: async () => ({ name: "Mercado Interno" }),
      },
    };
  }

  it("busca por SKU via service usado pelo endpoint", async () => {
    const tables = [{ id: "t1", code: "ATACADO", name: "Atacado" }];
    const versions: VersionRow[] = [
      {
        id: "v1",
        priceTableId: "t1",
        versionNumber: 1,
        status: "PUBLISHED",
        taxRuleId: "tax-1",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        publishedAt: new Date("2026-06-01"),
      },
    ];
    const items = [
      {
        id: "i1",
        priceTableVersionId: "v1",
        productId: "p1",
        sku: "SKU-AAA",
        productName: "Produto A",
        frozenTotalCost: 10,
        marginPct: 20,
        salePrice: 15,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1, commissionRate: 0.02 } },
      },
      {
        id: "i2",
        priceTableVersionId: "v1",
        productId: "p2",
        sku: "SKU-BBB",
        productName: "Produto B",
        frozenTotalCost: 10,
        marginPct: 20,
        salePrice: 16,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1, commissionRate: 0.02 } },
      },
    ];

    const snapshot = await buildCommercialPublishedPriceGridSnapshot(createGridDb(tables, versions, items) as never, {
      referenceDate: ref,
      search: "sku-aaa",
    });
    const response = buildCommercialPublishedPricesApiResponse(snapshot);

    assert.equal(response.rows.length, 1);
    assert.equal(response.rows[0]?.sku, "SKU-AAA");
    assert.equal(response.rows[0]?.prices[0]?.salePrice, 15);
    assert.equal(response.rows[0]?.prices[0]?.status, "PUBLISHED");
  });

  it("busca por nome via service usado pelo endpoint", async () => {
    const tables = [{ id: "t1", code: "ATACADO", name: "Atacado" }];
    const versions: VersionRow[] = [
      {
        id: "v1",
        priceTableId: "t1",
        versionNumber: 1,
        status: "PUBLISHED",
        taxRuleId: "tax-1",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
        publishedAt: new Date("2026-06-01"),
      },
    ];
    const items = [
      {
        id: "i1",
        priceTableVersionId: "v1",
        productId: "p1",
        sku: "SKU-001",
        productName: "Mangote Iris",
        frozenTotalCost: 10,
        marginPct: 20,
        salePrice: 15,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1, commissionRate: 0.02 } },
      },
    ];

    const query = parseCommercialPublishedPricesQuery({ search: "iris" });
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(createGridDb(tables, versions, items) as never, {
      ...query,
      referenceDate: ref,
    });
    const response = buildCommercialPublishedPricesApiResponse(snapshot);

    assert.equal(response.rows.length, 1);
    assert.equal(response.rows[0]?.productName, "Mangote Iris");
  });

  it("produto com preço ausente em uma tabela não quebra resposta", async () => {
    const tables = [
      { id: "t1", code: "ATACADO", name: "Atacado" },
      { id: "t2", code: "VAREJO_1", name: "Varejo 1" },
    ];
    const versions: VersionRow[] = tables.map((t, index) => ({
      id: `v${index + 1}`,
      priceTableId: t.id,
      versionNumber: 1,
      status: "PUBLISHED",
      taxRuleId: "tax-1",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      publishedAt: new Date("2026-06-01"),
    }));
    const items = [
      {
        id: "i1",
        priceTableVersionId: "v1",
        productId: "p1",
        sku: "SKU-PARCIAL",
        productName: "Parcial",
        frozenTotalCost: 10,
        marginPct: 20,
        salePrice: 15,
        commissionPerc: 2,
        formulaSnapshotJson: { rates: { taxRate: 0.1, commissionRate: 0.02 } },
      },
    ];

    const snapshot = await buildCommercialPublishedPriceGridSnapshot(createGridDb(tables, versions, items) as never, {
      referenceDate: ref,
    });
    const response = buildCommercialPublishedPricesApiResponse(snapshot);

    assert.equal(response.tables.length, 2);
    assert.equal(response.rows.length, 1);
    assert.equal(response.rows[0]?.prices.length, 2);
    assert.equal(response.rows[0]?.prices[0]?.status, "PUBLISHED");
    assert.equal(response.rows[0]?.prices[1]?.status, "NO_PRICE");
    assert.equal(response.rows[0]?.prices[1]?.salePrice, null);
    assert.equal(response.rows[0]?.status, "PARTIAL");
  });
});
