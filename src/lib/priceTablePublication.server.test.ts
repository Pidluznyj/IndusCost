import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  generatePriceTableVersionDraftFromProductionCosts,
  resolvePublishedPriceTableVersionForDate,
} from "./priceTablePublication.server.js";
import { PRICE_TABLE_PRODUCTION_COST_SOURCE } from "./priceTableProductionCostResolver.js";

type ProductionCostItemRow = {
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
  calculationHash: string | null;
  calculationSnapshot: unknown;
};

type ProductionCostVersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  revision: number;
  items: ProductionCostItemRow[];
};

type PriceTableVersionRow = {
  id: string;
  priceTableId: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  taxRuleId: string | null;
  productionCostTableVersionId: string | null;
  generatedAt: Date;
  notes: string | null;
  commissionPerc: number | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  publishedAt: Date | null;
  generationSummaryJson: unknown;
};

type PriceTableItemRow = {
  id: string;
  priceTableVersionId: string;
  productId: string;
  sku: string;
  productName: string;
  frozenTotalCost: number;
  frozenMaterialCost: number;
  frozenHhCost: number;
  frozenHmCost: number;
  frozenTaxCost: number;
  frozenOtherCost: number;
  marginPct: number;
  salePrice: number;
  commissionPerc: number;
  commissionValue: number;
  costSnapshotJson: unknown;
  formulaSnapshotJson: unknown;
};

function createMockDb(
  products: Array<{ id: string; sku: string; name: string; type?: string }>,
  options?: { defaultMarginPct?: number }
) {
  const normalized = products.map((p) => ({ ...p, type: p.type ?? "PRODUCT", status: "ACTIVE" }));
  const productionVersions = new Map<string, ProductionCostVersionRow>();
  const productionItems = new Map<string, ProductionCostItemRow>();
  const priceTableVersions = new Map<string, PriceTableVersionRow>();
  const priceTableItems = new Map<string, PriceTableItemRow>();
  let prodVersionSeq = 0;
  let prodItemSeq = 0;
  let priceVersionSeq = 0;
  let priceItemSeq = 0;

  const priceTableId = "price-table-1";
  const defaultMarginPct = options?.defaultMarginPct ?? 25;

  const db = {
    priceTable: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== priceTableId) return null;
        return { id: priceTableId, status: "ACTIVE", defaultMarginPct, code: "ATACADO", name: "Atacado" };
      },
    },
    product: {
      findMany: async ({
        where,
      }: {
        where: { status?: string; type?: { in: string[] }; id?: { in: string[] } };
      }) => {
        let rows = [...normalized];
        if (where.status) rows = rows.filter((p) => p.status === where.status);
        if (where.type?.in) rows = rows.filter((p) => where.type!.in.includes(p.type));
        if (where.id?.in) rows = rows.filter((p) => where.id!.in.includes(p.id));
        return rows.map(({ id, sku, name, type }) => ({ id, sku, name, type }));
      },
      count: async () => 0,
    },
    taxRule: {
      findUnique: async () => null,
    },
    productPricing: {
      findFirst: async () => ({
        commission: 5,
        otherVariables: 0,
        freightOut: 0,
        taxRuleId: null,
      }),
      findUnique: async () => null,
    },
    productionCostTableVersion: {
      findFirst: async ({
        where,
        include,
      }: {
        where: { status?: string; effectiveDate?: { lte: Date } };
        include?: { items?: boolean };
      }) => {
        let rows = [...productionVersions.values()];
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        if (where.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        rows.sort((a, b) => {
          const eff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
          if (eff !== 0) return eff;
          return b.revision - a.revision;
        });
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) {
          const items = [...productionItems.values()].filter((i) => i.costTableVersionId === row.id);
          return { ...row, items };
        }
        return row;
      },
    },
    priceTableVersion: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, string>> | Record<string, string>;
      }) => {
        let rows = [...priceTableVersions.values()];
        if (where.priceTableId) rows = rows.filter((v) => v.priceTableId === where.priceTableId);
        if (where.status) {
          if (typeof where.status === "string") {
            rows = rows.filter((v) => v.status === where.status);
          } else if (
            typeof where.status === "object" &&
            where.status !== null &&
            "in" in where.status &&
            Array.isArray((where.status as { in: string[] }).in)
          ) {
            const allowed = (where.status as { in: string[] }).in;
            rows = rows.filter((v) => allowed.includes(v.status));
          }
        }
        const andClauses = where.AND as Array<{ OR: Array<Record<string, unknown>> }> | undefined;
        if (andClauses) {
          for (const clause of andClauses) {
            const orList = clause.OR ?? [];
            for (const or of orList) {
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
        }
        const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        for (const order of [...orderList].reverse()) {
          if (order.effectiveFrom === "desc") {
            rows.sort((a, b) => (b.effectiveFrom?.getTime() ?? 0) - (a.effectiveFrom?.getTime() ?? 0));
          }
          if (order.publishedAt === "desc") {
            rows.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
          }
          if (order.versionNumber === "desc") {
            rows.sort((a, b) => b.versionNumber - a.versionNumber);
          }
        }
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        priceVersionSeq += 1;
        const row: PriceTableVersionRow = {
          id: `ptv-${priceVersionSeq}`,
          priceTableId: String(data.priceTableId),
          versionNumber: Number(data.versionNumber),
          status: data.status as PriceTableVersionRow["status"],
          taxRuleId: (data.taxRuleId as string | null) ?? null,
          productionCostTableVersionId: (data.productionCostTableVersionId as string | null) ?? null,
          generatedAt: (data.generatedAt as Date) ?? new Date(),
          notes: (data.notes as string | null) ?? null,
          commissionPerc: (data.commissionPerc as number | null) ?? null,
          effectiveFrom: null,
          effectiveTo: null,
          publishedAt: null,
          generationSummaryJson: null,
        };
        priceTableVersions.set(row.id, row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: { generationSummaryJson?: unknown };
        include?: { PriceTable?: boolean; TaxRule?: boolean };
      }) => {
        const row = priceTableVersions.get(where.id);
        if (!row) throw new Error("version not found");
        if (data.generationSummaryJson !== undefined) {
          row.generationSummaryJson = data.generationSummaryJson;
        }
        return {
          ...row,
          PriceTable: include?.PriceTable
            ? { id: priceTableId, code: "ATACADO", name: "Atacado", defaultMarginPct }
            : undefined,
          TaxRule: include?.TaxRule ? null : undefined,
        };
      },
    },
    priceTableItem: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        priceItemSeq += 1;
        const row: PriceTableItemRow = {
          id: `pti-${priceItemSeq}`,
          priceTableVersionId: String(data.priceTableVersionId),
          productId: String(data.productId),
          sku: String(data.sku),
          productName: String(data.productName),
          frozenTotalCost: Number(data.frozenTotalCost),
          frozenMaterialCost: Number(data.frozenMaterialCost),
          frozenHhCost: Number(data.frozenHhCost),
          frozenHmCost: Number(data.frozenHmCost),
          frozenTaxCost: Number(data.frozenTaxCost),
          frozenOtherCost: Number(data.frozenOtherCost),
          marginPct: Number(data.marginPct),
          salePrice: Number(data.salePrice),
          commissionPerc: Number(data.commissionPerc),
          commissionValue: Number(data.commissionValue),
          costSnapshotJson: data.costSnapshotJson,
          formulaSnapshotJson: data.formulaSnapshotJson,
        };
        priceTableItems.set(`${row.priceTableVersionId}:${row.productId}`, row);
        return row;
      },
      findUnique: async ({
        where,
      }: {
        where: { priceTableVersionId_productId: { priceTableVersionId: string; productId: string } };
      }) => {
        const key = `${where.priceTableVersionId_productId.priceTableVersionId}:${where.priceTableVersionId_productId.productId}`;
        return priceTableItems.get(key) ?? null;
      },
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    productionVersions,
    productionItems,
    priceTableVersions,
    priceTableItems,
    addPublishedProductionCost: (
      effectiveDate: string,
      revision: number,
      items: Array<{ productId: string; sku: string; name: string; unitCost: number }>
    ) => {
      prodVersionSeq += 1;
      const versionId = `pcv-${prodVersionSeq}`;
      const version: ProductionCostVersionRow = {
        id: versionId,
        code: effectiveDate.slice(0, 7),
        name: `Custo ${effectiveDate.slice(0, 7)} rev ${revision}`,
        effectiveDate: civilDateToLocalDate(effectiveDate),
        status: "PUBLISHED",
        revision,
        items: [],
      };
      for (const item of items) {
        prodItemSeq += 1;
        const row: ProductionCostItemRow = {
          id: `pci-${prodItemSeq}`,
          costTableVersionId: versionId,
          productId: item.productId,
          productCodeSnapshot: item.sku,
          productNameSnapshot: item.name,
          unitProductionCost: item.unitCost,
          materialCost: item.unitCost * 0.4,
          processCost: 0,
          laborCost: item.unitCost * 0.3,
          machineCost: item.unitCost * 0.2,
          overheadCost: item.unitCost * 0.1,
          otherCost: 0,
          calculationHash: `hash-${item.productId}-v${revision}`,
          calculationSnapshot: { frozenUnitCost: item.unitCost, revision },
        };
        productionItems.set(`${versionId}:${item.productId}`, row);
        version.items.push(row);
      }
      productionVersions.set(versionId, version);
      return version;
    },
    publishPriceVersion: (versionId: string, effectiveFrom: string) => {
      const row = priceTableVersions.get(versionId);
      if (!row) throw new Error("price version not found");
      for (const v of priceTableVersions.values()) {
        if (v.priceTableId === row.priceTableId && v.status === "PUBLISHED" && v.id !== versionId) {
          v.status = "ARCHIVED";
          v.effectiveTo = civilDateToLocalDate(effectiveFrom);
        }
      }
      row.status = "PUBLISHED";
      row.effectiveFrom = civilDateToLocalDate(effectiveFrom);
      row.publishedAt = new Date();
    },
  };
}

describe("priceTablePublication.server", () => {
  it("price draft uses published ProductionCostTableItem, not live engine", async () => {
    const products = [
      { id: "prod-a", sku: "PA", name: "Produto A", type: "PRODUCT" },
      { id: "comp-b", sku: "CB", name: "Componente B", type: "COMPONENT" },
    ];
    const { db, addPublishedProductionCost, priceTableItems } = createMockDb(products);
    addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 100 },
      { productId: "comp-b", sku: "CB", name: "Componente B", unitCost: 50 },
    ]);

    const result = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });

    assert.equal(result.version.productionCostTableVersionId, "pcv-1");
    assert.equal(result.summary.itemsCreated, 2);
    assert.equal(result.summary.componentsEvaluated, 1);

    const productItem = [...priceTableItems.values()].find((i) => i.productId === "prod-a");
    assert.ok(productItem);
    assert.equal(productItem!.frozenTotalCost, 100);
    const costSnap = productItem!.costSnapshotJson as { costSource: string; unitProductionCost: number };
    assert.equal(costSnap.costSource, PRICE_TABLE_PRODUCTION_COST_SOURCE);
    assert.equal(costSnap.unitProductionCost, 100);
  });

  it("component without production cost is reported as pending", async () => {
    const products = [
      { id: "prod-a", sku: "PA", name: "Produto A" },
      { id: "comp-x", sku: "CX", name: "Componente sem custo", type: "COMPONENT" },
    ];
    const { db, addPublishedProductionCost } = createMockDb(products);
    addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 80 },
    ]);

    const result = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });

    assert.equal(result.summary.itemsCreated, 1);
    assert.equal(result.summary.itemsSkipped, 1);
    assert.equal(result.summary.errors.length, 1);
    assert.equal(result.summary.errors[0]?.code, "SEM_CUSTO_PRODUCAO_OFICIAL");
    assert.equal(result.summary.errors[0]?.productType, "COMPONENT");
  });

  it("changing ProductionCostTable after price publish does not alter old PriceTableItem", async () => {
    const products = [{ id: "prod-a", sku: "PA", name: "Produto A" }];
    const { db, addPublishedProductionCost, priceTableVersions, publishPriceVersion, priceTableItems } =
      createMockDb(products);
    addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 100 },
    ]);

    const draft = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });
    publishPriceVersion(draft.version.id, "2026-06-01");
    const frozenSalePrice = priceTableItems.get(`${draft.version.id}:prod-a`)!.salePrice;

    addPublishedProductionCost("2026-07-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 999 },
    ]);

    const itemAfter = priceTableItems.get(`${draft.version.id}:prod-a`);
    assert.equal(itemAfter!.frozenTotalCost, 100);
    assert.equal(itemAfter!.salePrice, frozenSalePrice);
    assert.equal(priceTableVersions.get(draft.version.id)!.status, "PUBLISHED");
  });

  it("new ProductionCostTable + new PriceTableVersion can produce new price", async () => {
    const products = [{ id: "prod-a", sku: "PA", name: "Produto A" }];
    const { db, addPublishedProductionCost, priceTableItems } = createMockDb(products);
    addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 100 },
    ]);

    const v1 = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });

    addPublishedProductionCost("2026-07-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 200 },
    ]);

    const v2 = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-07-15"),
      includeAllActiveProducts: true,
    });

    assert.equal(
      priceTableItems.get(`${v1.version.id}:prod-a`)!.frozenTotalCost,
      100
    );
    assert.equal(
      priceTableItems.get(`${v2.version.id}:prod-a`)!.frozenTotalCost,
      200
    );
  });

  it("published price resolves by date", async () => {
    const { db, priceTableVersions } = createMockDb([]);
    priceTableVersions.set("old", {
      id: "old",
      priceTableId: "price-table-1",
      versionNumber: 1,
      status: "ARCHIVED",
      taxRuleId: null,
      productionCostTableVersionId: "pcv-old",
      generatedAt: new Date(),
      notes: null,
      commissionPerc: null,
      effectiveFrom: civilDateToLocalDate("2026-01-01"),
      effectiveTo: civilDateToLocalDate("2026-06-01"),
      publishedAt: new Date("2026-01-02"),
      generationSummaryJson: null,
    });
    priceTableVersions.set("current", {
      id: "current",
      priceTableId: "price-table-1",
      versionNumber: 2,
      status: "PUBLISHED",
      taxRuleId: null,
      productionCostTableVersionId: "pcv-new",
      generatedAt: new Date(),
      notes: null,
      commissionPerc: null,
      effectiveFrom: civilDateToLocalDate("2026-06-01"),
      effectiveTo: null,
      publishedAt: new Date("2026-06-02"),
      generationSummaryJson: null,
    });

    const may = await resolvePublishedPriceTableVersionForDate(
      db as never,
      "price-table-1",
      civilDateToLocalDate("2026-05-15")
    );
    const july = await resolvePublishedPriceTableVersionForDate(
      db as never,
      "price-table-1",
      civilDateToLocalDate("2026-07-01")
    );

    assert.equal(may?.id, "old");
    assert.equal(july?.id, "current");
  });

  it("old price table version remains archived when new one is published", async () => {
    const products = [{ id: "prod-a", sku: "PA", name: "Produto A" }];
    const { db, addPublishedProductionCost, publishPriceVersion, priceTableVersions } =
      createMockDb(products);
    addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 100 },
    ]);

    const v1 = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });
    publishPriceVersion(v1.version.id, "2026-06-01");

    addPublishedProductionCost("2026-07-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 120 },
    ]);
    const v2 = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-07-15"),
      includeAllActiveProducts: true,
    });
    publishPriceVersion(v2.version.id, "2026-07-01");

    assert.equal(priceTableVersions.get(v1.version.id)!.status, "ARCHIVED");
    assert.ok(priceTableVersions.get(v1.version.id)!.effectiveTo);
    assert.equal(priceTableVersions.get(v2.version.id)!.status, "PUBLISHED");
  });
});

describe("priceTablePublication.server — estabilidade vs MP viva", () => {
  it("published PriceTableItem frozenTotalCost is independent of later production cost catalog changes", async () => {
    const products = [{ id: "prod-a", sku: "PA", name: "Produto A" }];
    const { db, addPublishedProductionCost, priceTableItems } = createMockDb(products);
    const v1 = addPublishedProductionCost("2026-06-01", 1, [
      { productId: "prod-a", sku: "PA", name: "Produto A", unitCost: 100 },
    ]);

    const draft = await generatePriceTableVersionDraftFromProductionCosts(db as never, {
      priceTableId: "price-table-1",
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
    });
    const item = priceTableItems.get(`${draft.version.id}:prod-a`)!;
    const originalCost = item.frozenTotalCost;

    v1.items[0]!.unitProductionCost = 5000;
    const itemAfterLiveChange = priceTableItems.get(`${draft.version.id}:prod-a`)!;
    assert.equal(itemAfterLiveChange.frozenTotalCost, originalCost);
    assert.notEqual(v1.items[0]!.unitProductionCost, originalCost);
  });
});
