/**
 * Regressão do consumidor comercial: prova que snapshot completo na origem
 * restaura o contrato antigo do priceTableProductionCostResolver — sem alterar Pricing.
 *
 * Não importa/altera regras de Formação de Preço; só consome o resolver existente.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import { materializeCompleteProductionCostSnapshot } from "./productionCostCompleteSnapshot.server.js";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "./productionCostPublication.js";
import { publishProductionCostVersionFromDraft } from "./productionCostPublication.server.js";
import {
  buildProductionCostItemsByProductId,
  buildPriceTableCostSnapshotJson,
  previewProductionCostTableSourceForPriceDraft,
  resolvePublishedProductionCostTableVersionForDate,
} from "./priceTableProductionCostResolver.js";

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

const PRODUCTS: ProductRow[] = [
  { id: "prod-a", sku: "A", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-b", sku: "B", name: "Produto B", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-c", sku: "C", name: "Produto C", type: "PRODUCT", status: "ACTIVE" },
];

function seedVersion(opts: {
  id: string;
  revision: number;
  status: VersionRow["status"];
  effectiveDate?: Date;
  supersedesVersionId?: string | null;
}): VersionRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: opts.id,
    code: "2026-10",
    name: `Custo ${opts.id}`,
    effectiveDate: opts.effectiveDate ?? civilDateToLocalDate("2026-10-01"),
    status: opts.status,
    revision: opts.revision,
    supersedesVersionId: opts.supersedesVersionId ?? null,
    materialCostTableVersionId: null,
    source: PRODUCTION_COST_PUBLICATION_SOURCE,
    notes: null,
    publishedAt: opts.status === "DRAFT" ? null : now,
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
  unit: number
): ItemRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: `item-${versionId}-${productId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: sku,
    productNameSnapshot: `Produto ${sku}`,
    unitProductionCost: unit,
    materialCost: unit * 0.5,
    processCost: 0,
    laborCost: unit * 0.2,
    machineCost: unit * 0.2,
    overheadCost: unit * 0.1,
    otherCost: 0,
    currency: "BRL",
    calculationHash: `hash-${sku}-${unit}`,
    calculationSnapshot: { sku, unit },
    createdAt: now,
    updatedAt: now,
  };
}

/** Mock suficiente para materialize + publish oficial + resolver comercial. */
function createCommercialContractMockDb(seed: {
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
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    product: {
      findMany: async ({
        where,
      }: {
        where?: {
          status?: string;
          type?: { in: string[] } | string;
          id?: { in: string[] };
        };
      } = {}) => {
        let rows = [...products];
        if (where?.status) rows = rows.filter((p) => p.status === where.status);
        if (where?.type && typeof where.type === "object" && "in" in where.type) {
          const typeIn = where.type.in;
          rows = rows.filter((p) => typeIn.includes(p.type));
        } else if (typeof where?.type === "string") {
          rows = rows.filter((p) => p.type === where.type);
        }
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
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
      } = {}) => {
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
          if (
            itemWhere?.productId &&
            typeof itemWhere.productId === "object" &&
            "in" in itemWhere.productId
          ) {
            versionItems = versionItems.filter((i) => itemWhere.productId!.in.includes(i.productId));
          }
          if (include?.items) return { ...row, items: versionItems };
          return row;
        });
      },
      findFirst: async ({
        where,
        orderBy,
        select,
        include,
      }: {
        where?: {
          code?: string;
          status?: string;
          effectiveDate?: { lte: Date };
        };
        orderBy?: Array<Record<string, string>> | Record<string, string>;
        select?: Record<string, boolean>;
        include?: { items?: boolean };
      } = {}) => {
        let rows = [...versions.values()];
        if (where?.code) rows = rows.filter((v) => v.code === where.code);
        if (where?.status) rows = rows.filter((v) => v.status === where.status);
        if (where?.effectiveDate?.lte) {
          const lim = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lim);
        }
        const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        rows.sort((a, b) => {
          for (const ord of order) {
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
          // Default comercial: effectiveDate desc, revision desc
          if (!order.length) {
            const eff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
            if (eff !== 0) return eff;
            return b.revision - a.revision;
          }
          return 0;
        });
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
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
        include,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
        include?: { items?: boolean };
      }) => {
        const row = versions.get(where.id) ?? null;
        if (!row) return null;
        if (include?.items) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
      create: async ({
        data,
      }: {
        data: Omit<VersionRow, "id" | "createdAt" | "updatedAt" | "publishedAt" | "publishedBy"> & {
          publishedAt?: Date | null;
          publishedBy?: string | null;
        };
      }) => {
        versionSeq += 1;
        const id = `commercial-ver-${versionSeq}`;
        const now = new Date();
        const row: VersionRow = {
          id,
          createdAt: now,
          updatedAt: now,
          publishedAt: data.publishedAt ?? null,
          publishedBy: data.publishedBy ?? null,
          materialCostTableVersionId: data.materialCostTableVersionId ?? null,
          ...data,
        };
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
        include?: { items?: boolean };
      }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
        if (include?.items) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Partial<VersionRow>;
      }) => {
        const row = versions.get(where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
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
        include,
      }: {
        where?: {
          id?: { in: string[] };
          costTableVersionId?: string | { in: string[] };
          productId?: string | { in: string[] };
          costTableVersion?: { status: string; id?: { not: string } };
        };
        select?: Record<string, boolean>;
        include?: { costTableVersion?: { select?: Record<string, boolean> } | boolean };
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
        } else if (
          where?.productId &&
          typeof where.productId === "object" &&
          "in" in where.productId
        ) {
          const productIn = where.productId.in;
          rows = rows.filter((i) => productIn.includes(i.productId));
        }
        if (where?.costTableVersion) {
          rows = rows.filter((i) => {
            const v = versions.get(i.costTableVersionId);
            if (!v) return false;
            if (where.costTableVersion!.status && v.status !== where.costTableVersion!.status) {
              return false;
            }
            if (where.costTableVersion!.id?.not && v.id === where.costTableVersion!.id.not) {
              return false;
            }
            return true;
          });
        }
        return rows.map((row) => {
          const out: Record<string, unknown> = { ...row };
          if (include?.costTableVersion) {
            const v = versions.get(row.costTableVersionId);
            if (v) {
              const sel =
                typeof include.costTableVersion === "object"
                  ? include.costTableVersion.select
                  : undefined;
              if (sel) {
                const picked: Record<string, unknown> = {};
                for (const key of Object.keys(sel)) {
                  if (sel[key]) picked[key] = (v as Record<string, unknown>)[key];
                }
                out.costTableVersion = picked;
              } else {
                out.costTableVersion = v;
              }
            }
          }
          if (select) {
            const picked: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) picked[key] = out[key];
            }
            if (out.costTableVersion) picked.costTableVersion = out.costTableVersion;
            return picked;
          }
          return out;
        });
      },
      findFirst: async ({
        where,
      }: {
        where?: { productId?: string; costTableVersionId?: string };
      }) => {
        let rows = [...items.values()];
        if (where?.productId) rows = rows.filter((i) => i.productId === where.productId);
        if (where?.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        return rows[0] ?? null;
      },
      createMany: async ({
        data,
      }: {
        data: Array<Omit<ItemRow, "id" | "createdAt" | "updatedAt">>;
      }) => {
        const now = new Date();
        for (const row of data) {
          itemSeq += 1;
          const full: ItemRow = {
            id: `commercial-item-${itemSeq}`,
            createdAt: now,
            updatedAt: now,
            ...row,
          };
          items.set(`${full.costTableVersionId}:${full.productId}`, full);
        }
        return { count: data.length };
      },
      count: async ({ where }: { where?: { costTableVersionId?: string } }) => {
        let rows = [...items.values()];
        if (where?.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        return rows.length;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [key, row] of items.entries()) {
          if (row.id === where.id) items.delete(key);
        }
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) {
          for (const [key, row] of items.entries()) {
            if (row.id === id) items.delete(key);
          }
        }
        return { count: where.id.in.length };
      },
    },
  };

  return { db, versions, items };
}

describe("contrato comercial — snapshot completo na origem (sem alterar Pricing)", () => {
  it("ANTES (legado parcial): resolver vê só 1 item → A/C sem custo no mapa comercial", async () => {
    const partial = seedVersion({ id: "partial-b", revision: 2, status: "PUBLISHED" });
    const { db } = createCommercialContractMockDb({
      products: PRODUCTS,
      versions: [partial],
      items: [seedItem("partial-b", "prod-b", "B", 22)],
    });

    const version = await resolvePublishedProductionCostTableVersionForDate(
      db as never,
      civilDateToLocalDate("2026-10-05")
    );
    assert.ok(version);
    assert.equal(version!.id, "partial-b");
    assert.equal(version!.items.length, 1);

    const byProduct = buildProductionCostItemsByProductId(version!.items);
    assert.equal(byProduct.size, 1);
    assert.ok(byProduct.has("prod-b"));
    assert.equal(byProduct.has("prod-a"), false);
    assert.equal(byProduct.has("prod-c"), false);

    const preview = await previewProductionCostTableSourceForPriceDraft(
      db as never,
      civilDateToLocalDate("2026-10-05")
    );
    assert.equal(preview.itemsCount, 1);
  });

  it("DEPOIS: base completa A/B/C + publish unitário de B → nova PUBLISHED completa; preço A antigo, B novo, C antigo", async () => {
    const base = seedVersion({ id: "base-full", revision: 1, status: "PUBLISHED" });
    const unitaryDraft = seedVersion({
      id: "draft-b",
      revision: 2,
      status: "DRAFT",
      supersedesVersionId: "base-full",
    });
    const { db, versions } = createCommercialContractMockDb({
      products: PRODUCTS,
      versions: [base, unitaryDraft],
      items: [
        seedItem("base-full", "prod-a", "A", 10),
        seedItem("base-full", "prod-b", "B", 20),
        seedItem("base-full", "prod-c", "C", 30),
        seedItem("draft-b", "prod-b", "B", 22),
      ],
    });

    // Mesmo caminho pós-revalidação do fluxo unitário: materialize completo + publish oficial.
    const materialized = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-01"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["draft-b"],
      notes: "unitary-formation · commercial-contract-test",
    });
    assert.equal(materialized.ok, true);
    if (!materialized.ok) return;
    assert.equal(materialized.data.summary.totalItems, 3);
    assert.equal(materialized.data.summary.changedCount, 1);
    assert.equal(materialized.data.summary.carriedForwardCount, 2);

    const published = await publishProductionCostVersionFromDraft(db as never, {
      versionId: materialized.data.version.id,
      publishedBy: "commercial-contract@test",
      auditContext: { source: "UNITARY_FORMATION" },
    });

    assert.equal(published.version.status, "PUBLISHED");
    assert.equal(versions.get("base-full")?.status, "SUPERSEDED");
    assert.notEqual(published.version.id, "draft-b");
    // Candidato parcial nunca vira PUBLISHED; pode ser ARCHIVED por equivalência pós-publish.
    assert.notEqual(versions.get("draft-b")?.status, "PUBLISHED");

    const resolved = await resolvePublishedProductionCostTableVersionForDate(
      db as never,
      civilDateToLocalDate("2026-10-05")
    );
    assert.ok(resolved);
    assert.equal(resolved!.id, published.version.id);
    assert.equal(resolved!.items.length, 3);

    const byProduct = buildProductionCostItemsByProductId(resolved!.items);
    assert.equal(byProduct.size, 3);
    assert.equal(byProduct.get("prod-a")?.unitProductionCost, 10);
    assert.equal(byProduct.get("prod-b")?.unitProductionCost, 22);
    assert.equal(byProduct.get("prod-c")?.unitProductionCost, 30);

    // Snapshots comerciais por SKU (contrato de Formação de Preço sem alterar o resolver).
    const effectiveDateKey = "2026-10-01";
    for (const [productId, expectedCost] of [
      ["prod-a", 10],
      ["prod-b", 22],
      ["prod-c", 30],
    ] as const) {
      const item = byProduct.get(productId)!;
      const snap = buildPriceTableCostSnapshotJson({
        productionCostTableVersionId: resolved!.id,
        productionCostTableVersionCode: resolved!.code,
        revision: resolved!.revision,
        effectiveDate: effectiveDateKey,
        item,
      });
      assert.equal(snap.unitProductionCost, expectedCost);
      assert.equal(snap.productionCostTableVersionId, published.version.id);
    }

    const preview = await previewProductionCostTableSourceForPriceDraft(
      db as never,
      civilDateToLocalDate("2026-10-05")
    );
    assert.equal(preview.available, true);
    assert.equal(preview.itemsCount, 3);
    assert.equal(preview.productionCostTableVersionId, published.version.id);
  });

  it("priceTableProductionCostResolver.ts permanece sem mudança de regra nesta feature", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const resolver = fs.readFileSync(
      path.join(process.cwd(), "src/lib/priceTableProductionCostResolver.ts"),
      "utf8"
    );
    // Contrato antigo intacto: última PUBLISHED vigente + items daquela versão.
    assert.match(resolver, /export async function resolvePublishedProductionCostTableVersionForDate/);
    assert.match(resolver, /export function buildProductionCostItemsByProductId/);
    assert.match(resolver, /status:\s*"PUBLISHED"/);
    assert.match(resolver, /include:\s*\{\s*items:\s*true/);
  });
});
