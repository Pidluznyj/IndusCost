import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCommercialPublishedPriceGridSnapshot,
  MAX_COMMERCIAL_PUBLISHED_TABLES,
  readPublishedPriceItemMetrics,
  resolveCommercialPublishedTableContexts,
} from "./commercialPublishedPrices.server.js";

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

type ItemRow = {
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
};

function createGridDb(
  tables: Array<{ id: string; code: string; name: string }>,
  versions: VersionRow[],
  items: ItemRow[]
) {
  const taxRules = new Map([["tax-1", { name: "Mercado Interno" }]]);

  return {
    priceTable: {
      findMany: async ({
        where,
      }: {
        where?: { status?: string; id?: string };
      }) => {
        let rows = tables.map((t) => ({ ...t, status: "ACTIVE" }));
        if (where?.id) rows = rows.filter((t) => t.id === where.id);
        if (where?.status) rows = rows.filter((t) => t.status === where.status);
        return rows.sort((a, b) => a.code.localeCompare(b.code));
      },
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
        if (where.status?.in) {
          rows = rows.filter((v) => where.status!.in.includes(v.status));
        }
        const andClauses = where.AND ?? [];
        for (const clause of andClauses) {
          for (const or of clause.OR ?? []) {
            if (or.effectiveFrom && typeof or.effectiveFrom === "object" && "lte" in or.effectiveFrom) {
              const ref = (or.effectiveFrom as { lte: Date }).lte.getTime();
              rows = rows.filter((v) => !v.effectiveFrom || v.effectiveFrom.getTime() <= ref);
            }
            if (or.effectiveTo && typeof or.effectiveTo === "object" && "gt" in or.effectiveTo) {
              const ref = (or.effectiveTo as { gt: Date }).gt.getTime();
              rows = rows.filter((v) => !v.effectiveTo || v.effectiveTo.getTime() > ref);
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
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = taxRules.get(where.id);
        return row ? { name: row.name } : null;
      },
    },
  };
}

function formulaSnapshot(overrides?: Partial<{ taxRate: number; commissionRate: number }>) {
  return {
    rates: {
      taxRate: overrides?.taxRate ?? 0.2725,
      commissionRate: overrides?.commissionRate ?? 0.02,
    },
  };
}

describe("commercialPublishedPrices.server", () => {
  const productId = "prod-1";
  const ref = new Date("2026-07-01T12:00:00.000Z");

  const fourTables = [
    { id: "t-atacado", code: "ATACADO", name: "Atacado" },
    { id: "t-v1", code: "VAREJO_1", name: "Varejo 1" },
    { id: "t-v2", code: "VAREJO_2", name: "Varejo 2" },
    { id: "t-v3", code: "VAREJO_3", name: "Varejo 3" },
  ];

  const fourVersions: VersionRow[] = fourTables.map((t, index) => ({
    id: `ver-${t.code}`,
    priceTableId: t.id,
    versionNumber: 1,
    status: "PUBLISHED",
    taxRuleId: "tax-1",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    publishedAt: new Date(`2026-06-0${index + 1}T10:00:00.000Z`),
  }));

  it("retorna tabelas publicadas vigentes", async () => {
    const db = createGridDb(fourTables, fourVersions, []);
    const tables = await resolveCommercialPublishedTableContexts(db as never, { referenceDate: ref });
    assert.equal(tables.length, 4);
    assert.equal(tables[0]?.tableCode, "ATACADO");
    assert.equal(tables[3]?.tableCode, "VAREJO_3");
    assert.equal(tables[0]?.status, "PUBLISHED");
  });

  it("produto com preço em 4 tabelas retorna 4 preços", async () => {
    const items: ItemRow[] = fourVersions.map((version, index) => ({
      id: `item-${index}`,
      priceTableVersionId: version.id,
      productId,
      sku: "309.01AA",
      productName: "Produto Teste",
      frozenTotalCost: 10,
      marginPct: 30,
      salePrice: 20 + index,
      commissionPerc: 2,
      formulaSnapshotJson: formulaSnapshot(),
    }));

    const db = createGridDb(fourTables, fourVersions, items);
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
      limit: 10,
    });

    assert.equal(snapshot.tables.length, 4);
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.prices.length, 4);
    assert.equal(snapshot.rows[0]?.prices.every((p) => p.status === "PUBLISHED"), true);
    assert.equal(snapshot.rows[0]?.prices[0]?.salePrice, 20);
    assert.equal(snapshot.rows[0]?.prices[3]?.salePrice, 23);
  });

  it("produto sem preço em uma tabela retorna null nessa tabela", async () => {
    const items: ItemRow[] = fourVersions.slice(0, 3).map((version, index) => ({
      id: `item-${index}`,
      priceTableVersionId: version.id,
      productId,
      sku: "309.02AA",
      productName: "Parcial",
      frozenTotalCost: 8,
      marginPct: 25,
      salePrice: 15,
      commissionPerc: 1,
      formulaSnapshotJson: formulaSnapshot(),
    }));

    const db = createGridDb(fourTables, fourVersions, items);
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
    });

    const prices = snapshot.rows[0]?.prices ?? [];
    assert.equal(prices.length, 4);
    assert.equal(prices.filter((p) => p.status === "PUBLISHED").length, 3);
    const missing = prices.find((p) => p.tableCode === undefined && p.tableId === "t-v3");
    assert.equal(prices[3]?.status, "NO_PRICE");
    assert.equal(prices[3]?.salePrice, null);
    assert.equal(snapshot.rows[0]?.status, "PARTIAL");
    assert.equal(missing?.salePrice ?? null, null);
  });

  it("busca por SKU funciona", async () => {
    const items: ItemRow[] = [
      {
        id: "item-a",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-a",
        sku: "AAA-111",
        productName: "Alpha",
        frozenTotalCost: 5,
        marginPct: 20,
        salePrice: 10,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
      {
        id: "item-b",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-b",
        sku: "BBB-222",
        productName: "Beta",
        frozenTotalCost: 6,
        marginPct: 20,
        salePrice: 11,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
    ];

    const db = createGridDb(fourTables.slice(0, 1), fourVersions.slice(0, 1), items);
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
      search: "aaa-111",
    });

    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.sku, "AAA-111");
  });

  it("busca por nome funciona", async () => {
    const items: ItemRow[] = [
      {
        id: "item-a",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-a",
        sku: "AAA-111",
        productName: "Mangote Iris",
        frozenTotalCost: 5,
        marginPct: 20,
        salePrice: 10,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
    ];

    const db = createGridDb(fourTables.slice(0, 1), fourVersions.slice(0, 1), items);
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
      search: "iris",
    });

    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.productName, "Mangote Iris");
  });

  it("não chama motor de cálculo ao montar grid", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "pricing", "commercialPublishedPrices.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /getProductCostAnalysis/);
    assert.doesNotMatch(source, /calculatePriceTableItemFromFrozenCost/);
    assert.doesNotMatch(source, /calculateSalePriceFromCost/);
    assert.doesNotMatch(source, /productPricing/);
  });

  it("ordenação e paginação funcionam", async () => {
    const items: ItemRow[] = [
      {
        id: "item-1",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-1",
        sku: "Z-999",
        productName: "Zulu",
        frozenTotalCost: 5,
        marginPct: 20,
        salePrice: 10,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
      {
        id: "item-2",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-2",
        sku: "A-001",
        productName: "Alpha",
        frozenTotalCost: 5,
        marginPct: 20,
        salePrice: 10,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
      {
        id: "item-3",
        priceTableVersionId: fourVersions[0]!.id,
        productId: "p-3",
        sku: "M-050",
        productName: "Mike",
        frozenTotalCost: 5,
        marginPct: 20,
        salePrice: 10,
        commissionPerc: 1,
        formulaSnapshotJson: formulaSnapshot(),
      },
    ];

    const db = createGridDb(fourTables.slice(0, 1), fourVersions.slice(0, 1), items);

    const page1 = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
      sort: "SKU_ASC",
      page: 1,
      limit: 2,
    });
    assert.equal(page1.pagination.total, 3);
    assert.equal(page1.pagination.totalPages, 2);
    assert.equal(page1.rows.length, 2);
    assert.equal(page1.rows[0]?.sku, "A-001");

    const page2 = await buildCommercialPublishedPriceGridSnapshot(db as never, {
      referenceDate: ref,
      sort: "SKU_ASC",
      page: 2,
      limit: 2,
    });
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.rows[0]?.sku, "Z-999");
  });

  it("limita a no máximo 4 tabelas vigentes dinamicamente", async () => {
    const extraTables = [
      ...fourTables,
      { id: "t-v4", code: "VAREJO_4", name: "Varejo 4" },
    ];
    const extraVersions: VersionRow[] = extraTables.map((t, index) => ({
      id: `ver-${t.code}`,
      priceTableId: t.id,
      versionNumber: 1,
      status: "PUBLISHED",
      taxRuleId: "tax-1",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      publishedAt: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
    }));

    const db = createGridDb(extraTables, extraVersions, []);
    const tables = await resolveCommercialPublishedTableContexts(db as never, { referenceDate: ref });
    assert.equal(tables.length, MAX_COMMERCIAL_PUBLISHED_TABLES);
    assert.equal(tables.some((t) => t.tableCode === "VAREJO_4"), false);
  });

  it("readPublishedPriceItemMetrics lê salePrice e taxa do snapshot publicado", () => {
    const metrics = readPublishedPriceItemMetrics({
      salePrice: 100,
      frozenTotalCost: 50,
      marginPct: 30,
      commissionPerc: 2,
      formulaSnapshotJson: formulaSnapshot({ taxRate: 0.1, commissionRate: 0.05 }),
    });
    assert.equal(metrics.salePrice, 100);
    assert.equal(metrics.taxPercent, 10);
    assert.equal(metrics.commissionPercent, 2);
    assert.equal(metrics.markup, 100);
  });
});
