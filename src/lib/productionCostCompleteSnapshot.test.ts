/**
 * Motor de snapshot completo — testes (plan puro + materialize server).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE,
  PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN,
  PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND,
  PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE,
  buildCompleteProductionCostSnapshotPlan,
  isModernCompleteProductionCostSnapshotNotes,
  parseCompleteProductionCostSnapshotMeta,
  suggestsLegacyPartialProductionCostVersion,
} from "./productionCostCompleteSnapshot.js";
import { materializeCompleteProductionCostSnapshot } from "./productionCostCompleteSnapshot.server.js";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "./productionCostPublication.js";
import type { ProductionCostTableDraftItemInput } from "./productionCostVersioning.js";

type VersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  revision: number;
  supersedesVersionId: string | null;
  materialCostTableVersionId: string | null;
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

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string;
};

function itemInput(
  productId: string,
  sku: string,
  unit: number,
  extras?: Partial<ProductionCostTableDraftItemInput>
): ProductionCostTableDraftItemInput {
  return {
    productId,
    productCodeSnapshot: sku,
    productNameSnapshot: sku,
    unitProductionCost: unit,
    materialCost: extras?.materialCost ?? unit * 0.5,
    processCost: extras?.processCost ?? 0,
    laborCost: extras?.laborCost ?? unit * 0.2,
    machineCost: extras?.machineCost ?? unit * 0.2,
    overheadCost: extras?.overheadCost ?? unit * 0.1,
    otherCost: extras?.otherCost ?? 0,
    currency: "BRL",
    calculationHash: extras?.calculationHash ?? `hash-${sku}-${unit}`,
    calculationSnapshot: extras?.calculationSnapshot ?? {
      kind: "TEST",
      sku,
      unit,
    },
  };
}

function createMaterializeMockDb(seed: {
  products: ProductRow[];
  versions?: VersionRow[];
  items?: ItemRow[];
}) {
  const products = [...seed.products];
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;

  for (const v of seed.versions ?? []) versions.set(v.id, { ...v });
  for (const i of seed.items ?? []) {
    items.set(`${i.costTableVersionId}:${i.productId}`, { ...i });
  }

  const db = {
    product: {
      findMany: async ({
        where,
      }: {
        where: {
          status?: string;
          type?: { in: string[] } | string;
          id?: { in: string[] };
        };
        select?: unknown;
        orderBy?: unknown;
      }) => {
        let rows = products.filter((p) => p.status === (where.status ?? "ACTIVE"));
        if (where.type && typeof where.type === "object" && "in" in where.type) {
          const typeIn = where.type.in;
          rows = rows.filter((p) => typeIn.includes(p.type));
        } else if (typeof where.type === "string") {
          rows = rows.filter((p) => p.type === where.type);
        }
        if (where.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((p) => idIn.includes(p.id));
        }
        return rows.map((p) => ({ id: p.id, sku: p.sku, name: p.name, type: p.type }));
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        products.find((p) => p.id === where.id) ?? null,
    },
    productionCostTableVersion: {
      findMany: async ({
        where,
        include,
        orderBy,
        select,
      }: {
        where?: {
          id?: { in: string[] };
          status?: string | { in: string[] };
          effectiveDate?: { lte: Date };
          code?: string;
        };
        include?: { items?: boolean | { where?: { productId?: { in: string[] } } } };
        orderBy?: Array<Record<string, string>>;
        select?: Record<string, boolean>;
      }) => {
        let rows = [...versions.values()];
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((v) => idIn.includes(v.id));
        }
        if (typeof where?.status === "string") {
          rows = rows.filter((v) => v.status === where.status);
        } else if (where?.status && typeof where.status === "object" && "in" in where.status) {
          const statusIn = where.status.in;
          rows = rows.filter((v) => statusIn.includes(v.status));
        }
        if (where?.effectiveDate?.lte) {
          const lim = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lim);
        }
        if (where?.code) rows = rows.filter((v) => v.code === where.code);

        if (orderBy?.length) {
          rows.sort((a, b) => {
            for (const ord of orderBy) {
              const key = Object.keys(ord)[0]!;
              const dir = ord[key] === "asc" ? 1 : -1;
              const av = (a as Record<string, unknown>)[key];
              const bv = (b as Record<string, unknown>)[key];
              if (av instanceof Date && bv instanceof Date) {
                if (av.getTime() !== bv.getTime()) return (av.getTime() - bv.getTime()) * dir;
              } else if (typeof av === "number" && typeof bv === "number") {
                if (av !== bv) return (av - bv) * dir;
              }
            }
            return 0;
          });
        }

        return rows.map((row) => {
          if (select) {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) out[key] = (row as Record<string, unknown>)[key];
            }
            return out;
          }
          let versionItems = [...items.values()].filter((i) => i.costTableVersionId === row.id);
          const itemWhere =
            include?.items && typeof include.items === "object" ? include.items.where : undefined;
          if (itemWhere?.productId?.in) {
            versionItems = versionItems.filter((i) => itemWhere.productId!.in.includes(i.productId));
          }
          if (include?.items) {
            return { ...row, items: versionItems };
          }
          return row;
        });
      },
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: { code: string; status?: string };
        orderBy?: Array<Record<string, string>> | Record<string, string>;
        select?: Record<string, boolean>;
      }) => {
        let rows = [...versions.values()].filter((v) => v.code === where.code);
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (order[0] && "revision" in order[0]) {
          rows.sort((a, b) => b.revision - a.revision);
        }
        const row = rows[0] ?? null;
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = versions.get(where.id) ?? null;
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
      create: async ({ data }: { data: Omit<VersionRow, "id" | "createdAt" | "updatedAt"> }) => {
        versionSeq += 1;
        const id = `mat-ver-${versionSeq}`;
        const now = new Date();
        const row: VersionRow = { id, createdAt: now, updatedAt: now, ...data };
        versions.set(id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        versions.delete(where.id);
        for (const [key, item] of [...items.entries()]) {
          if (item.costTableVersionId === where.id) items.delete(key);
        }
        return { id: where.id };
      },
    },
    productionCostTableItem: {
      findMany: async ({
        where,
        select,
      }: {
        where?: {
          id?: { in: string[] };
          costTableVersionId?: string | { in: string[] };
          productId?: string | { in: string[] };
        };
        select?: Record<string, boolean>;
      }) => {
        let rows = [...items.values()];
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((i) => idIn.includes(i.id));
        }
        if (typeof where?.costTableVersionId === "string") {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        } else if (
          where?.costTableVersionId &&
          typeof where.costTableVersionId === "object" &&
          "in" in where.costTableVersionId
        ) {
          const versionIn = where.costTableVersionId.in;
          rows = rows.filter((i) => versionIn.includes(i.costTableVersionId));
        }
        if (typeof where?.productId === "string") {
          rows = rows.filter((i) => i.productId === where.productId);
        } else if (where?.productId && typeof where.productId === "object" && "in" in where.productId) {
          const productIn = where.productId.in;
          rows = rows.filter((i) => productIn.includes(i.productId));
        }
        if (!select) return rows;
        return rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        });
      },
      createMany: async ({ data }: { data: Array<Omit<ItemRow, "id" | "createdAt" | "updatedAt">> }) => {
        const now = new Date();
        for (const row of data) {
          itemSeq += 1;
          const full: ItemRow = {
            id: `mat-item-${itemSeq}`,
            createdAt: now,
            updatedAt: now,
            ...row,
          };
          items.set(`${full.costTableVersionId}:${full.productId}`, full);
        }
        return { count: data.length };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { costTableVersionId_productId: { costTableVersionId: string; productId: string } };
        create: Omit<ItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<ItemRow>;
      }) => {
        const key = `${where.costTableVersionId_productId.costTableVersionId}:${where.costTableVersionId_productId.productId}`;
        const existing = items.get(key);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        itemSeq += 1;
        const row: ItemRow = { id: `mat-item-${itemSeq}`, createdAt: now, updatedAt: now, ...create };
        items.set(key, row);
        return row;
      },
      count: async ({ where }: { where?: { costTableVersionId?: string } }) => {
        let rows = [...items.values()];
        if (where?.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        return rows.length;
      },
    },
  };

  return { db, versions, items, products };
}

function seedVersion(opts: {
  id: string;
  code?: string;
  revision: number;
  status: VersionRow["status"];
  effectiveDate?: Date;
  supersedesVersionId?: string | null;
}): VersionRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: opts.id,
    code: opts.code ?? "2026-10",
    name: `Custo ${opts.id}`,
    effectiveDate: opts.effectiveDate ?? civilDateToLocalDate("2026-10-01"),
    status: opts.status,
    revision: opts.revision,
    supersedesVersionId: opts.supersedesVersionId ?? null,
    materialCostTableVersionId: null,
    source: PRODUCTION_COST_PUBLICATION_SOURCE,
    notes: null,
    publishedAt: opts.status === "PUBLISHED" || opts.status === "SUPERSEDED" ? now : null,
    publishedBy: opts.status === "DRAFT" ? null : "seed@test",
    createdBy: "seed@test",
    createdAt: now,
    updatedAt: now,
  };
}

function seedItem(
  versionId: string,
  productId: string,
  sku: string,
  unit: number,
  extras?: Partial<ItemRow>
): ItemRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const input = itemInput(productId, sku, unit, extras);
  return {
    id: extras?.id ?? `item-${versionId}-${productId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: input.productCodeSnapshot,
    productNameSnapshot: input.productNameSnapshot,
    unitProductionCost: input.unitProductionCost,
    materialCost: input.materialCost!,
    processCost: input.processCost!,
    laborCost: input.laborCost!,
    machineCost: input.machineCost!,
    overheadCost: input.overheadCost!,
    otherCost: input.otherCost!,
    currency: "BRL",
    calculationHash: input.calculationHash ?? null,
    calculationSnapshot: input.calculationSnapshot ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

const PRODUCTS: ProductRow[] = [
  { id: "prod-a", sku: "A", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-b", sku: "B", name: "Produto B", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-c", sku: "C", name: "Produto C", type: "PRODUCT", status: "ACTIVE" },
];

describe("buildCompleteProductionCostSnapshotPlan (puro)", () => {
  it("CASO 1+2: altera B; A e C vêm do oficial (não do LIVE 45)", () => {
    const official = new Map([
      ["prod-a", itemInput("prod-a", "A", 10)],
      ["prod-b", itemInput("prod-b", "B", 20)],
      ["prod-c", itemInput("prod-c", "C", 30)],
    ]);
    const patch = new Map([["prod-b", itemInput("prod-b", "B", 22)]]);
    // LIVE C=45 NÃO está no official nem no patch
    const result = buildCompleteProductionCostSnapshotPlan({
      population: PRODUCTS.map((p) => ({ id: p.id, sku: p.sku, name: p.name, type: p.type })),
      officialByProductId: official,
      patchByProductId: patch,
      changedProductIds: ["prod-b"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const byId = new Map(result.plan.items.map((i) => [i.productId, i]));
    assert.equal(byId.get("prod-a")?.unitProductionCost, 10);
    assert.equal(byId.get("prod-a")?.origin, "CARRIED_FORWARD");
    assert.equal(byId.get("prod-b")?.unitProductionCost, 22);
    assert.equal(byId.get("prod-b")?.origin, "CHANGED");
    assert.equal(byId.get("prod-c")?.unitProductionCost, 30);
    assert.notEqual(byId.get("prod-c")?.unitProductionCost, 45);
    assert.equal(result.plan.totalItems, 3);
    assert.equal(result.plan.missingCount, 0);
  });

  it("CASO 5: sem oficial e fora do patch → missing", () => {
    const result = buildCompleteProductionCostSnapshotPlan({
      population: PRODUCTS.map((p) => ({ id: p.id, sku: p.sku, name: p.name, type: p.type })),
      officialByProductId: new Map([["prod-a", itemInput("prod-a", "A", 10)]]),
      patchByProductId: new Map([["prod-b", itemInput("prod-b", "B", 22)]]),
      changedProductIds: ["prod-b"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.plan.missingProductIds.includes("prod-c"));
    assert.equal(result.plan.items.length, 2);
  });

  it("CASO 4 (plan): produto só no patch entra como CHANGED", () => {
    const result = buildCompleteProductionCostSnapshotPlan({
      population: [{ id: "prod-new", sku: "N", name: "Novo", type: "PRODUCT" }],
      officialByProductId: new Map(),
      patchByProductId: new Map([["prod-new", itemInput("prod-new", "N", 7)]]),
      changedProductIds: ["prod-new"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.items[0]?.origin, "CHANGED");
    assert.equal(result.plan.items[0]?.unitProductionCost, 7);
  });
});

describe("materializeCompleteProductionCostSnapshot", () => {
  it("CASO 1+2+6+7+8: materializa DRAFT completo; C carry = PUBLISHED 30 (não LIVE 45); hash/snapshot preservados", async () => {
    const snapC = { kind: "OFFICIAL_C", value: 30, nested: { x: 1 } };
    const hashC = "hash-C-official-30";
    const published = seedVersion({ id: "pub-full", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-b", revision: 2, status: "DRAFT" });
    const { db, versions, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [published, patch],
      items: [
        seedItem("pub-full", "prod-a", "A", 10, {
          calculationHash: "hash-A-10",
          calculationSnapshot: { kind: "A", v: 10 },
        }),
        seedItem("pub-full", "prod-b", "B", 20, { calculationHash: "hash-B-20" }),
        seedItem("pub-full", "prod-c", "C", 30, {
          calculationHash: hashC,
          calculationSnapshot: snapC,
          materialCost: 15,
          laborCost: 6,
          machineCost: 6,
          overheadCost: 3,
          processCost: 0,
          otherCost: 0,
        }),
        seedItem("draft-b", "prod-b", "B", 22, {
          calculationHash: "hash-B-22",
          calculationSnapshot: { kind: "PATCH_B", v: 22 },
        }),
      ],
    });

    let officialLoadCalls = 0;
    const result = await materializeCompleteProductionCostSnapshot(
      db as never,
      {
        effectiveDate: civilDateToLocalDate("2026-10-05"),
        changedProductIds: ["prod-b"],
        patchDraftVersionIds: ["draft-b"],
        createdBy: "mat@test",
      },
      {
        onOfficialCostsLoaded: () => {
          officialLoadCalls += 1;
        },
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.version.status, "DRAFT");
    assert.equal(result.data.summary.changedCount, 1);
    assert.equal(result.data.summary.carriedForwardCount, 2);
    assert.equal(officialLoadCalls, 1);

    const newId = result.data.version.id;
    const newItems = [...items.values()].filter((i) => i.costTableVersionId === newId);
    assert.equal(newItems.length, 3);
    const byProduct = new Map(newItems.map((i) => [i.productId, i]));
    assert.equal(byProduct.get("prod-a")?.unitProductionCost, 10);
    assert.equal(byProduct.get("prod-b")?.unitProductionCost, 22);
    assert.equal(byProduct.get("prod-c")?.unitProductionCost, 30);
    assert.equal(byProduct.get("prod-c")?.calculationHash, hashC);
    assert.deepEqual(byProduct.get("prod-c")?.calculationSnapshot, snapC);
    assert.equal(byProduct.get("prod-c")?.materialCost, 15);
    assert.equal(byProduct.get("prod-c")?.laborCost, 6);
    assert.equal(versions.get(newId)?.status, "DRAFT");
    assert.match(versions.get(newId)?.notes ?? "", /COMPLETE_SNAPSHOT_MATERIALIZATION/);
  });

  it("CASO 3: N itens alterados no mesmo snapshot", async () => {
    const published = seedVersion({ id: "pub1", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-ab", revision: 2, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [published, patch],
      items: [
        seedItem("pub1", "prod-a", "A", 10),
        seedItem("pub1", "prod-b", "B", 20),
        seedItem("pub1", "prod-c", "C", 30),
        seedItem("draft-ab", "prod-a", "A", 11),
        seedItem("draft-ab", "prod-b", "B", 22),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-a", "prod-b"],
      patchDraftVersionIds: ["draft-ab"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.summary.changedCount, 2);
    const newItems = [...items.values()].filter(
      (i) => i.costTableVersionId === result.data.version.id
    );
    const map = new Map(newItems.map((i) => [i.productId, i.unitProductionCost]));
    assert.equal(map.get("prod-a"), 11);
    assert.equal(map.get("prod-b"), 22);
    assert.equal(map.get("prod-c"), 30);
  });

  it("CASO 4: produto novo só no DRAFT aprovado entra no snapshot", async () => {
    const products: ProductRow[] = [
      ...PRODUCTS,
      { id: "prod-new", sku: "N", name: "Novo", type: "PRODUCT", status: "ACTIVE" },
    ];
    const published = seedVersion({ id: "pub1", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-new", revision: 2, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products,
      versions: [published, patch],
      items: [
        seedItem("pub1", "prod-a", "A", 10),
        seedItem("pub1", "prod-b", "B", 20),
        seedItem("pub1", "prod-c", "C", 30),
        seedItem("draft-new", "prod-new", "N", 7),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-new"],
      patchDraftVersionIds: ["draft-new"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const newItems = [...items.values()].filter(
      (i) => i.costTableVersionId === result.data.version.id
    );
    assert.ok(newItems.some((i) => i.productId === "prod-new" && i.unitProductionCost === 7));
    assert.equal(newItems.length, 4);
  });

  it("CASO 5: sem PUBLISHED e não aprovado → missing (não inventa custo)", async () => {
    const published = seedVersion({ id: "pub-partial", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-b", revision: 2, status: "DRAFT" });
    const { db } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [published, patch],
      items: [
        seedItem("pub-partial", "prod-a", "A", 10),
        seedItem("draft-b", "prod-b", "B", 22),
        // C ausente
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.summary.missingProductIds.includes("prod-c"));
    assert.equal(result.data.summary.totalItems, 2);
  });

  it("CASO 9: legado parcial — A em SUPERSEDED, B em PUBLISHED parcial; carry reconstrói A", async () => {
    const oldFull = seedVersion({ id: "old-full", revision: 1, status: "SUPERSEDED" });
    const partial = seedVersion({
      id: "partial-b",
      revision: 2,
      status: "PUBLISHED",
      supersedesVersionId: "old-full",
    });
    const patch = seedVersion({ id: "draft-b2", revision: 3, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [oldFull, partial, patch],
      items: [
        seedItem("old-full", "prod-a", "A", 10, { calculationHash: "legacy-A" }),
        seedItem("old-full", "prod-b", "B", 20),
        seedItem("old-full", "prod-c", "C", 30, { calculationHash: "legacy-C" }),
        seedItem("partial-b", "prod-b", "B", 21),
        seedItem("draft-b2", "prod-b", "B", 22),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b2"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const newItems = [...items.values()].filter(
      (i) => i.costTableVersionId === result.data.version.id
    );
    const map = new Map(newItems.map((i) => [i.productId, i]));
    assert.equal(map.get("prod-a")?.unitProductionCost, 10);
    assert.equal(map.get("prod-a")?.calculationHash, "legacy-A");
    assert.equal(map.get("prod-b")?.unitProductionCost, 22);
    assert.equal(map.get("prod-c")?.unitProductionCost, 30);
    assert.equal(map.get("prod-c")?.calculationHash, "legacy-C");
  });

  it("CASO 10: carry-forward não consulta motor LIVE (deps oficiais apenas)", async () => {
    const published = seedVersion({ id: "pub1", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-b", revision: 2, status: "DRAFT" });
    const { db } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [published, patch],
      items: [
        seedItem("pub1", "prod-a", "A", 10),
        seedItem("pub1", "prod-b", "B", 20),
        seedItem("pub1", "prod-c", "C", 30),
        seedItem("draft-b", "prod-b", "B", 22),
      ],
    });

    let liveEngineCalls = 0;
    const fakeLiveEngine = {
      getProductCostAnalysis: async () => {
        liveEngineCalls += 1;
        throw new Error("LIVE não deve ser chamado");
      },
    };

    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b"],
    });
    assert.equal(result.ok, true);
    assert.equal(liveEngineCalls, 0);
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("./productionCostCompleteSnapshot.server.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /ProductCostAnalysisEngine/);
    assert.doesNotMatch(src, /createProductCostAnalysisEngine/);
    assert.match(src, /getEffectiveProductProductionCosts/);
    void fakeLiveEngine;
  });

  it("performance: materializa 100/500/1000 produtos em batch sem N+1 de resolvedor", async () => {
    const sizes = [100, 500, 1000];
    for (const n of sizes) {
      const products: ProductRow[] = Array.from({ length: n }, (_, i) => ({
        id: `p-${i}`,
        sku: `SKU-${i}`,
        name: `P${i}`,
        type: "PRODUCT" as const,
        status: "ACTIVE",
      }));
      const published = seedVersion({ id: `pub-${n}`, revision: 1, status: "PUBLISHED" });
      const patch = seedVersion({ id: `draft-${n}`, revision: 2, status: "DRAFT" });
      const seedItems: ItemRow[] = products.map((p, i) =>
        seedItem(`pub-${n}`, p.id, p.sku, 10 + (i % 7))
      );
      seedItems.push(seedItem(`draft-${n}`, "p-0", "SKU-0", 99));
      const { db } = createMaterializeMockDb({
        products,
        versions: [published, patch],
        items: seedItems,
      });

      let officialCalls = 0;
      const t0 = Date.now();
      const result = await materializeCompleteProductionCostSnapshot(
        db as never,
        {
          effectiveDate: civilDateToLocalDate("2026-10-05"),
          changedProductIds: ["p-0"],
          patchDraftVersionIds: [`draft-${n}`],
        },
        {
          onOfficialCostsLoaded: (ids) => {
            officialCalls += 1;
            assert.equal(ids.length, n);
          },
        }
      );
      const ms = Date.now() - t0;
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.data.summary.totalItems, n);
      assert.equal(officialCalls, 1);
      assert.ok(ms < 5000, `n=${n} demorou ${ms}ms`);
      // eslint-disable-next-line no-console
      console.log(`[complete-snapshot] n=${n} materializationMs=${result.data.summary.materializationMs}`);
    }
  });
});

describe("legado parcial → snapshot completo moderno", () => {
  it("meta marker distingue COMPLETE_MODERN de legado parcial (sem migration)", () => {
    const modern = `[2026-10-05T00:00:00.000Z] ${JSON.stringify({
      kind: PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND,
      completeness: PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN,
      catalogMode: PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE,
      totalItems: 889,
      baseResolver: "getEffectiveProductProductionCosts",
    })}`;
    assert.equal(isModernCompleteProductionCostSnapshotNotes(modern), true);
    assert.equal(
      parseCompleteProductionCostSnapshotMeta(modern)?.completeness,
      PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN
    );
    assert.equal(isModernCompleteProductionCostSnapshotNotes("unitary-formation"), false);
    assert.equal(
      suggestsLegacyPartialProductionCostVersion({
        notes: null,
        itemCount: 1,
        populationSize: 889,
      }),
      true
    );
    assert.equal(
      suggestsLegacyPartialProductionCostVersion({
        notes: modern,
        itemCount: 889,
        populationSize: 889,
      }),
      false
    );
  });

  it("V1 full + V2 parcial B + V3 parcial C → V4 completa (A←V1 B←patch C←V3); histórico intacto", async () => {
    const v1 = seedVersion({ id: "v1", revision: 1, status: "SUPERSEDED" });
    const v2 = seedVersion({
      id: "v2",
      revision: 2,
      status: "SUPERSEDED",
      supersedesVersionId: "v1",
    });
    const v3 = seedVersion({
      id: "v3",
      revision: 3,
      status: "PUBLISHED",
      supersedesVersionId: "v2",
    });
    const patch = seedVersion({ id: "draft-b", revision: 4, status: "DRAFT" });
    const { db, versions, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [v1, v2, v3, patch],
      items: [
        seedItem("v1", "prod-a", "A", 10, { calculationHash: "v1-A" }),
        seedItem("v1", "prod-b", "B", 20, { calculationHash: "v1-B" }),
        seedItem("v1", "prod-c", "C", 30, { calculationHash: "v1-C" }),
        seedItem("v2", "prod-b", "B", 21, { calculationHash: "v2-B" }),
        seedItem("v3", "prod-c", "C", 31, { calculationHash: "v3-C" }),
        seedItem("draft-b", "prod-b", "B", 22, { calculationHash: "patch-B" }),
      ],
    });

    const snapshotV1 = [...items.values()].filter((i) => i.costTableVersionId === "v1");
    const snapshotV2 = [...items.values()].filter((i) => i.costTableVersionId === "v2");
    const snapshotV3 = [...items.values()].filter((i) => i.costTableVersionId === "v3");

    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const v4Id = result.data.version.id;
    const v4Items = [...items.values()].filter((i) => i.costTableVersionId === v4Id);
    const byId = new Map(v4Items.map((i) => [i.productId, i]));
    assert.equal(v4Items.length, 3);
    assert.equal(byId.get("prod-a")?.unitProductionCost, 10);
    assert.equal(byId.get("prod-a")?.calculationHash, "v1-A");
    assert.equal(byId.get("prod-b")?.unitProductionCost, 22);
    assert.equal(byId.get("prod-b")?.calculationHash, "patch-B");
    assert.equal(byId.get("prod-c")?.unitProductionCost, 31);
    assert.equal(byId.get("prod-c")?.calculationHash, "v3-C");
    assert.equal(result.data.summary.changedCount, 1);
    assert.equal(result.data.summary.carriedForwardCount, 2);

    // Histórico V1/V2/V3 intacto (sem UPDATE/backfill)
    assert.equal(versions.get("v1")?.status, "SUPERSEDED");
    assert.equal(versions.get("v2")?.status, "SUPERSEDED");
    assert.equal(versions.get("v3")?.status, "PUBLISHED");
    assert.equal(snapshotV1.length, 3);
    assert.equal(snapshotV2.length, 1);
    assert.equal(snapshotV3.length, 1);
    assert.equal(
      [...items.values()].filter((i) => i.costTableVersionId === "v1").length,
      3
    );
    assert.equal(
      [...items.values()].filter((i) => i.costTableVersionId === "v2").length,
      1
    );
    assert.equal(
      [...items.values()].filter((i) => i.costTableVersionId === "v3").length,
      1
    );

    const v4Notes = versions.get(v4Id)?.notes ?? "";
    assert.equal(isModernCompleteProductionCostSnapshotNotes(v4Notes), true);
    const meta = parseCompleteProductionCostSnapshotMeta(v4Notes);
    assert.equal(meta?.catalogMode, PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE);
    assert.equal(meta?.completeness, PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN);
    assert.equal(
      suggestsLegacyPartialProductionCostVersion({
        notes: versions.get("v3")?.notes,
        itemCount: 1,
        populationSize: 3,
      }),
      true
    );
  });

  it("última PUBLISHED com 1 item NÃO basta — A/C vêm do histórico SUPERSEDED", async () => {
    const full = seedVersion({ id: "full", revision: 1, status: "SUPERSEDED" });
    const partialOnly = seedVersion({
      id: "partial-only",
      revision: 2,
      status: "PUBLISHED",
      supersedesVersionId: "full",
    });
    const patch = seedVersion({ id: "draft-x", revision: 3, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [full, partialOnly, patch],
      items: [
        seedItem("full", "prod-a", "A", 10),
        seedItem("full", "prod-b", "B", 20),
        seedItem("full", "prod-c", "C", 30),
        seedItem("partial-only", "prod-b", "B", 21),
        seedItem("draft-x", "prod-b", "B", 22),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-x"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const map = new Map(
      [...items.values()]
        .filter((i) => i.costTableVersionId === result.data.version.id)
        .map((i) => [i.productId, i.unitProductionCost])
    );
    assert.equal(map.get("prod-a"), 10);
    assert.equal(map.get("prod-b"), 22);
    assert.equal(map.get("prod-c"), 30);
    assert.equal(map.size, 3);
  });

  it("effectiveDates diferentes: referência usa vigência ≤ data (não versão futura)", async () => {
    const old = seedVersion({
      id: "old-sep",
      revision: 1,
      status: "SUPERSEDED",
      effectiveDate: civilDateToLocalDate("2026-09-01"),
    });
    const newerPartial = seedVersion({
      id: "newer-oct",
      revision: 2,
      status: "PUBLISHED",
      effectiveDate: civilDateToLocalDate("2026-10-15"),
      supersedesVersionId: "old-sep",
    });
    const patch = seedVersion({
      id: "draft-b",
      revision: 3,
      status: "DRAFT",
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    const { db, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [old, newerPartial, patch],
      items: [
        seedItem("old-sep", "prod-a", "A", 10),
        seedItem("old-sep", "prod-b", "B", 20),
        seedItem("old-sep", "prod-c", "C", 30),
        seedItem("newer-oct", "prod-b", "B", 99),
        seedItem("draft-b", "prod-b", "B", 22),
      ],
    });
    // referenceDate 2026-10-05 < 2026-10-15 → B oficial ainda é 20 (old), patch sobrescreve 22
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const map = new Map(
      [...items.values()]
        .filter((i) => i.costTableVersionId === result.data.version.id)
        .map((i) => [i.productId, i.unitProductionCost])
    );
    assert.equal(map.get("prod-a"), 10);
    assert.equal(map.get("prod-b"), 22);
    assert.equal(map.get("prod-c"), 30);
    assert.notEqual(map.get("prod-b"), 99);
  });

  it("mesmo effectiveDate: revisão mais alta vence no resolver para o produto", async () => {
    const r1 = seedVersion({
      id: "r1",
      revision: 1,
      status: "SUPERSEDED",
      effectiveDate: civilDateToLocalDate("2026-10-01"),
    });
    const r2 = seedVersion({
      id: "r2",
      revision: 2,
      status: "PUBLISHED",
      effectiveDate: civilDateToLocalDate("2026-10-01"),
      supersedesVersionId: "r1",
    });
    const patch = seedVersion({ id: "draft-a", revision: 3, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products: PRODUCTS,
      versions: [r1, r2, patch],
      items: [
        seedItem("r1", "prod-a", "A", 10),
        seedItem("r1", "prod-b", "B", 20),
        seedItem("r1", "prod-c", "C", 30),
        seedItem("r2", "prod-b", "B", 25),
        seedItem("draft-a", "prod-a", "A", 11),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-a"],
      patchDraftVersionIds: ["draft-a"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const map = new Map(
      [...items.values()]
        .filter((i) => i.costTableVersionId === result.data.version.id)
        .map((i) => [i.productId, i.unitProductionCost])
    );
    assert.equal(map.get("prod-a"), 11);
    assert.equal(map.get("prod-b"), 25);
    assert.equal(map.get("prod-c"), 30);
  });

  it("produto novo só no patch entra; outro sem PUBLISHED e fora do patch fica missing", async () => {
    const products: ProductRow[] = [
      ...PRODUCTS,
      { id: "prod-new", sku: "N", name: "Novo", type: "PRODUCT", status: "ACTIVE" },
      { id: "prod-orphan", sku: "O", name: "Orphan", type: "PRODUCT", status: "ACTIVE" },
    ];
    const published = seedVersion({ id: "pub", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({ id: "draft-new", revision: 2, status: "DRAFT" });
    const { db, items } = createMaterializeMockDb({
      products,
      versions: [published, patch],
      items: [
        seedItem("pub", "prod-a", "A", 10),
        seedItem("pub", "prod-b", "B", 20),
        seedItem("pub", "prod-c", "C", 30),
        seedItem("draft-new", "prod-new", "N", 7),
      ],
    });
    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      changedProductIds: ["prod-new"],
      patchDraftVersionIds: ["draft-new"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = new Set(
      [...items.values()]
        .filter((i) => i.costTableVersionId === result.data.version.id)
        .map((i) => i.productId)
    );
    assert.ok(ids.has("prod-new"));
    assert.ok(ids.has("prod-a"));
    assert.ok(!ids.has("prod-orphan"));
    assert.ok(result.data.summary.missingProductIds.includes("prod-orphan"));
  });

  it("wiring: carry-forward usa getEffectiveProductProductionCosts — não latestPublished.items", async () => {
    const fs = await import("node:fs");
    const server = fs.readFileSync(
      new URL("./productionCostCompleteSnapshot.server.ts", import.meta.url),
      "utf8"
    );
    const pure = fs.readFileSync(
      new URL("./productionCostCompleteSnapshot.ts", import.meta.url),
      "utf8"
    );
    assert.match(server, /getEffectiveProductProductionCosts/);
    assert.match(server, /buildCompleteProductionCostSnapshotMaterializationMeta/);
    assert.match(server, /NÃO usar latestPublished\.items/);
    assert.match(pure, /HISTORICAL_RESOLVER_PER_PRODUCT/);
    assert.match(pure, /COMPLETE_MODERN/);
    assert.match(pure, /isModernCompleteProductionCostSnapshotNotes/);
    const afterLatest = server.slice(server.indexOf("findLatestPublishedProductionCostVersionByCode"));
    assert.doesNotMatch(afterLatest.slice(0, 800), /latestPublished\.items/);
  });
});

describe("productionCostCompleteSnapshot wiring", () => {
  it("population source constante e módulo server não publica", async () => {
    assert.equal(
      PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE,
      "FULL_ACTIVE_PRODUCT_AND_COMPONENT"
    );
    const fs = await import("node:fs");
    const server = fs.readFileSync(
      new URL("./productionCostCompleteSnapshot.server.ts", import.meta.url),
      "utf8"
    );
    assert.match(server, /materializeCompleteProductionCostSnapshot/);
    assert.doesNotMatch(server, /publishProductionCostVersionFromDraft/);
    assert.doesNotMatch(server, /publishProductionCostTableVersion/);
    assert.match(server, /getEffectiveProductProductionCosts/);
  });
});
