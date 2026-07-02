import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  addOrUpdateProductionCostTableDraftItem,
} from "./productionCostTables.server.js";
import {
  generateProductionCostTableDraftFromProducts,
  publishProductionCostVersionFromDraft,
} from "./productionCostPublication.server.js";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";

type VersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  revision: number;
  supersedesVersionId: string | null;
  source: string | null;
  notes: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ItemRow = {
  id: string;
  costTableVersionId: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: number;
  materialCost: number;
  processCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  otherCost: number;
  currency: string;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function createMockDb(products: Array<{ id: string; sku: string; name: string; type?: string }>) {
  const normalized = products.map((p) => ({ ...p, type: p.type ?? "PRODUCT" }));
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;

  const itemKey = (versionId: string, productId: string) => `${versionId}:${productId}`;

  const db = {
    productionCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: { code?: string; status?: string };
        orderBy?: Array<{ revision?: "desc"; publishedAt?: "desc" }>;
        select?: unknown;
      }) => {
        let rows = [...versions.values()];
        if (where.code) rows = rows.filter((v) => v.code === where.code);
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (orderList.some((o) => o && typeof o === "object" && "revision" in o && o.revision === "desc")) {
          rows.sort((a, b) => b.revision - a.revision);
        }
        const row = rows[0] ?? null;
        if (!row) return null;
        if (select) {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select as Record<string, boolean>)) {
            picked[key] = row[key as keyof VersionRow];
          }
          return picked;
        }
        return row;
      },
      findUnique: async ({
        where,
        include,
        select,
      }: {
        where: { id: string };
        include?: unknown;
        select?: unknown;
      }) => {
        const row = versions.get(where.id);
        if (!row) return null;
        const result: Record<string, unknown> = { ...row };
        if (include && typeof include === "object") {
          if ("items" in include) {
            result.items = [...items.values()].filter((i) => i.costTableVersionId === row.id);
          }
          if ("_count" in include) {
            result._count = {
              items: [...items.values()].filter((i) => i.costTableVersionId === row.id).length,
            };
          }
          if ("supersedesVersion" in include && row.supersedesVersionId) {
            result.supersedesVersion = versions.get(row.supersedesVersionId) ?? null;
          }
        }
        if (select) return row;
        return result;
      },
      findMany: async () => [...versions.values()],
      create: async ({ data }: { data: Omit<VersionRow, "id" | "createdAt" | "updatedAt"> }) => {
        versionSeq += 1;
        const id = `ver-${versionSeq}`;
        const now = new Date();
        const row: VersionRow = { id, createdAt: now, updatedAt: now, ...data };
        versions.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Partial<VersionRow>;
        include?: unknown;
      }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
        if (include) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        return row;
      },
    },
    productionCostTableItem: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { costTableVersionId_productId: { costTableVersionId: string; productId: string } };
        create: Omit<ItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<ItemRow>;
      }) => {
        const key = itemKey(
          where.costTableVersionId_productId.costTableVersionId,
          where.costTableVersionId_productId.productId
        );
        const existing = items.get(key);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        itemSeq += 1;
        const row: ItemRow = { id: `item-${itemSeq}`, createdAt: now, updatedAt: now, ...create };
        items.set(key, row);
        return row;
      },
    },
    product: {
      findMany: async ({
        where,
      }: {
        where: {
          id?: { in: string[] };
          status?: string;
          type?: string | { in: string[] };
        };
      }) => {
        if (where.id?.in?.length === 0) return [];
        let rows = normalized;
        if (where.type && typeof where.type === "object" && Array.isArray(where.type.in)) {
          rows = rows.filter((p) => where.type.in.includes(p.type));
        } else if (where.type === "PRODUCT") {
          rows = rows.filter((p) => p.type === "PRODUCT");
        }
        const ids = where.id?.in;
        return ids ? rows.filter((p) => ids.includes(p.id)) : rows;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        normalized.find((p) => p.id === where.id) ?? null,
      count: async () => 0,
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return { versions, items, db };
}

function createMockEngine(
  costs: Record<string, { total: number; partial?: boolean } | "FAIL">
): ProductCostAnalysisEngine {
  return {
    initAnalysisCache: async () => ({} as never),
    getProductCostAnalysis: async (productId: string) => {
      const entry = costs[productId];
      if (entry === "FAIL") return { error: "CONFIG_MISSING", message: "Config ausente." };
      if (!entry) return null;
      return {
        productId,
        sku: productId,
        summary: {
          totalIndustrialCost: entry.total,
          totalMaterialCost: entry.total * 0.5,
          totalHH_Unit: entry.total * 0.2,
          totalHM_Unit: entry.total * 0.15,
          totalCIF_Unit: entry.total * 0.1,
          totalOPEX_Unit: entry.total * 0.05,
          costAnalysisPartial: entry.partial ?? false,
        },
      };
    },
    isCostAnalysisFailure: (x: unknown): x is { error: string; message?: string } =>
      !!x && typeof x === "object" && "error" in x,
    describeCostAnalysisFailure: (failure: unknown) =>
      String((failure as { message?: string }).message ?? "Erro"),
  };
}

describe("productionCostPublication.server", () => {
  it("gera DRAFT com vigência e snapshot por produto", async () => {
    const products = [
      { id: "prod-a", sku: "PA", name: "Produto A" },
      { id: "prod-b", sku: "PB", name: "Produto B" },
    ];
    const { db, versions } = createMockDb(products);
    const engine = createMockEngine({ "prod-a": { total: 10 }, "prod-b": { total: 20 } });

    const { version, summary } = await generateProductionCostTableDraftFromProducts(
      db as never,
      engine,
      {
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        productIds: ["prod-a", "prod-b"],
      }
    );

    assert.ok(version);
    assert.equal(summary.itemsCreated, 2);
    assert.equal(summary.itemsSkipped, 0);
    assert.equal(versions.get(version!.id)?.status, "DRAFT");
    assert.equal(versions.get(version!.id)?.revision, 1);
  });

  it("publica segunda revisão e supersede anterior; resolver usa novo item só para produto alterado", async () => {
    const products = [
      { id: "prod-a", sku: "PA", name: "Produto A" },
      { id: "prod-b", sku: "PB", name: "Produto B" },
    ];
    const { db, versions, items } = createMockDb(products);
    const engineV1 = createMockEngine({
      "prod-a": { total: 10 },
      "prod-b": { total: 20 },
    });

    const gen1 = await generateProductionCostTableDraftFromProducts(db as never, engineV1, {
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      productIds: ["prod-a", "prod-b"],
    });
    await publishProductionCostVersionFromDraft(db as never, { versionId: gen1.version!.id });

    const engineV2 = createMockEngine({ "prod-a": { total: 11.5 } });
    const gen2 = await generateProductionCostTableDraftFromProducts(db as never, engineV2, {
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      productIds: ["prod-a"],
    });
    assert.equal(gen2.version?.revision, 2);
    await publishProductionCostVersionFromDraft(db as never, { versionId: gen2.version!.id });

    assert.equal(versions.get(gen1.version!.id)?.status, "SUPERSEDED");
    assert.equal(versions.get(gen2.version!.id)?.status, "PUBLISHED");

    const mapItem = (i: ItemRow) => ({
      id: i.id,
      costTableVersionId: i.costTableVersionId,
      productId: i.productId,
      productCodeSnapshot: i.productCodeSnapshot,
      productNameSnapshot: i.productNameSnapshot,
      unitProductionCost: Number(i.unitProductionCost),
      currency: i.currency,
      calculationHash: i.calculationHash,
      calculationSnapshot: i.calculationSnapshot,
      createdAt: i.createdAt,
      breakdown: {
        materialCost: i.materialCost,
        processCost: i.processCost,
        laborCost: i.laborCost,
        machineCost: i.machineCost,
        overheadCost: i.overheadCost,
        otherCost: i.otherCost,
      },
    });

    const catalog: ProductionCostTableVersionWithItems[] = [
      {
        id: gen1.version!.id,
        code: "2026-06",
        name: "v1",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        status: "SUPERSEDED",
        revision: 1,
        publishedAt: new Date(),
        createdAt: new Date(),
        items: [...items.values()]
          .filter((i) => i.costTableVersionId === gen1.version!.id)
          .map(mapItem),
      },
      {
        id: gen2.version!.id,
        code: "2026-06",
        name: "v2",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        status: "PUBLISHED",
        revision: 2,
        publishedAt: new Date(),
        createdAt: new Date(),
        items: [...items.values()]
          .filter((i) => i.costTableVersionId === gen2.version!.id)
          .map(mapItem),
      },
    ];

    const ref = civilDateToLocalDate("2026-06-15");
    const costA = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-a", ref);
    const costB = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-b", ref);
    assert.equal(costA.status, "OK");
    if (costA.status === "OK") assert.equal(costA.unitProductionCost, 11.5);
    assert.equal(costB.status, "OK");
    if (costB.status === "OK") assert.equal(costB.unitProductionCost, 20);
  });

  it("gera DRAFT com componente calculável (309.86AA)", async () => {
    const products = [
      {
        id: "comp-309",
        sku: "309.86AA",
        name: "Mangote Azul - Esmaltec",
        type: "COMPONENT",
      },
    ];
    const { db } = createMockDb(products);
    const engine = createMockEngine({ "comp-309": { total: 0.537299 } });

    const { version, summary } = await generateProductionCostTableDraftFromProducts(
      db as never,
      engine,
      {
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        productIds: ["comp-309"],
      }
    );

    assert.ok(version);
    assert.equal(summary.itemsCreated, 1);
    assert.equal(summary.componentsEvaluated, 1);
    assert.equal(summary.productsEvaluated, 0);
    assert.equal(summary.itemsEvaluated, 1);
  });

  it("versão publicada não pode ser editada após publicação", async () => {
    const products = [{ id: "prod-a", sku: "PA", name: "Produto A" }];
    const { db } = createMockDb(products);
    const engine = createMockEngine({ "prod-a": { total: 10 } });

    const gen = await generateProductionCostTableDraftFromProducts(db as never, engine, {
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      productIds: ["prod-a"],
    });
    await publishProductionCostVersionFromDraft(db as never, { versionId: gen.version!.id });

    await assert.rejects(
      () =>
        addOrUpdateProductionCostTableDraftItem(db as never, gen.version!.id, {
          productId: "prod-a",
          productCodeSnapshot: "PA",
          productNameSnapshot: "Produto A",
          unitProductionCost: 99,
        }),
      /imutável/
    );
  });
});
