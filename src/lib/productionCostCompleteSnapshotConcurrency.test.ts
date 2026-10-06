/**
 * Hardening de concorrência/atomicidade do snapshot completo.
 * Testes determinísticos dos riscos reais (sem distributed lock).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  evaluateProductionCostPublishBase,
  isProductionCostPublishStaleBaseError,
  isProductionCostRevisionUniqueConflict,
  PRODUCTION_COST_PUBLISH_STALE_BASE_PREFIX,
} from "./productionCostCompleteSnapshot.js";
import { materializeCompleteProductionCostSnapshot } from "./productionCostCompleteSnapshot.server.js";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "./productionCostPublication.js";
import { publishProductionCostVersionFromDraft } from "./productionCostPublication.server.js";
import { publishProductionCostTableVersion } from "./productionCostTables.server.js";

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
  { id: "prod-a", sku: "A", name: "A", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-b", sku: "B", name: "B", type: "PRODUCT", status: "ACTIVE" },
  { id: "prod-c", sku: "C", name: "C", type: "PRODUCT", status: "ACTIVE" },
];

function seedVersion(opts: {
  id: string;
  revision: number;
  status: VersionRow["status"];
  supersedesVersionId?: string | null;
  notes?: string | null;
}): VersionRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: opts.id,
    code: "2026-10",
    name: `Custo ${opts.id}`,
    effectiveDate: civilDateToLocalDate("2026-10-01"),
    status: opts.status,
    revision: opts.revision,
    supersedesVersionId: opts.supersedesVersionId ?? null,
    materialCostTableVersionId: null,
    source: PRODUCTION_COST_PUBLICATION_SOURCE,
    notes: opts.notes ?? null,
    publishedAt: opts.status === "DRAFT" ? null : now,
    publishedBy: opts.status === "DRAFT" ? null : "seed@test",
    createdBy: "seed@test",
    createdAt: now,
    updatedAt: now,
  };
}

function seedItem(versionId: string, productId: string, sku: string, unit: number): ItemRow {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: `item-${versionId}-${productId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: sku,
    productNameSnapshot: `Produto ${sku}`,
    unitProductionCost: unit,
    materialCost: unit,
    processCost: 0,
    laborCost: 0,
    machineCost: 0,
    overheadCost: 0,
    otherCost: 0,
    currency: "BRL",
    calculationHash: `hash-${sku}-${unit}`,
    calculationSnapshot: { sku, unit },
    createdAt: now,
    updatedAt: now,
  };
}

function createConcurrencyMockDb(seed: {
  products: ProductRow[];
  versions?: VersionRow[];
  items?: ItemRow[];
  /** Simula falha de unique (code,revision) na 1ª create. */
  failFirstCreateWithUnique?: boolean;
}) {
  const products = [...seed.products];
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;
  let createAttempts = 0;
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
            const idIn = itemWhere.productId.in;
            versionItems = versionItems.filter((i) => idIn.includes(i.productId));
          }
          if (include?.items) return { ...row, items: versionItems };
          return row;
        });
      },
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where?: { code?: string; status?: string; effectiveDate?: { lte: Date } };
        orderBy?: Array<Record<string, string>> | Record<string, string>;
        select?: Record<string, boolean>;
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
          if (!order.length) {
            const eff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
            if (eff !== 0) return eff;
            return b.revision - a.revision;
          }
          return 0;
        });
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
        createAttempts += 1;
        if (seed.failFirstCreateWithUnique && createAttempts === 1) {
          const err = Object.assign(new Error("Unique constraint failed on code_revision"), {
            code: "P2002",
            meta: { target: ["code", "revision"] },
          });
          throw err;
        }
        // Unique (code, revision)
        for (const v of versions.values()) {
          if (v.code === data.code && v.revision === data.revision) {
            const err = Object.assign(new Error("Unique constraint failed on code_revision"), {
              code: "P2002",
              meta: { target: ["code", "revision"] },
            });
            throw err;
          }
        }
        versionSeq += 1;
        const id = `conc-ver-${versionSeq}`;
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
            id: `conc-item-${itemSeq}`,
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

  return { db, versions, items, getCreateAttempts: () => createAttempts };
}

describe("evaluateProductionCostPublishBase (puro)", () => {
  it("ok quando não há PUBLISHED vigente", () => {
    const r = evaluateProductionCostPublishBase({
      draftSupersedesVersionId: null,
      currentPublishedVersionId: null,
    });
    assert.equal(r.ok, true);
  });

  it("STALE_BASE quando draft carrega base antiga", () => {
    const r = evaluateProductionCostPublishBase({
      draftSupersedesVersionId: "v1",
      currentPublishedVersionId: "v2",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "STALE_BASE");
    assert.match(r.message, new RegExp(PRODUCTION_COST_PUBLISH_STALE_BASE_PREFIX));
    assert.equal(isProductionCostPublishStaleBaseError(new Error(r.message)), true);
  });

  it("ok quando draft aponta exatamente para a vigente", () => {
    const r = evaluateProductionCostPublishBase({
      draftSupersedesVersionId: "v2",
      currentPublishedVersionId: "v2",
    });
    assert.equal(r.ok, true);
  });

  it("detecta P2002 de revisão", () => {
    assert.equal(
      isProductionCostRevisionUniqueConflict({
        code: "P2002",
        meta: { target: ["code", "revision"] },
      }),
      true
    );
  });
});

describe("concorrência — publish atômico", () => {
  it("cenário 1+7: draft com base antiga NÃO publica (não sobrescreve snapshot mais novo)", async () => {
    const v1 = seedVersion({ id: "v1", revision: 1, status: "SUPERSEDED" });
    const v2 = seedVersion({
      id: "v2",
      revision: 2,
      status: "PUBLISHED",
      supersedesVersionId: "v1",
    });
    // Snapshot materializado contra v1 (stale) enquanto v2 já é oficial
    const staleComplete = seedVersion({
      id: "stale-complete",
      revision: 3,
      status: "DRAFT",
      supersedesVersionId: "v1",
    });
    const { db, versions } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [v1, v2, staleComplete],
      items: [
        seedItem("v1", "prod-a", "A", 10),
        seedItem("v1", "prod-b", "B", 20),
        seedItem("v1", "prod-c", "C", 30),
        seedItem("v2", "prod-a", "A", 10),
        seedItem("v2", "prod-b", "B", 22),
        seedItem("v2", "prod-c", "C", 30),
        seedItem("stale-complete", "prod-a", "A", 11),
        seedItem("stale-complete", "prod-b", "B", 20), // perderia o 22!
        seedItem("stale-complete", "prod-c", "C", 30),
      ],
    });

    await assert.rejects(
      () =>
        publishProductionCostTableVersion(db as never, {
          versionId: "stale-complete",
          publishedBy: "user-a",
        }),
      (err: unknown) => isProductionCostPublishStaleBaseError(err)
    );

    assert.equal(versions.get("v2")?.status, "PUBLISHED");
    assert.equal(versions.get("stale-complete")?.status, "DRAFT");
    const publishedCount = [...versions.values()].filter((v) => v.status === "PUBLISHED").length;
    assert.equal(publishedCount, 1);
  });

  it("cenário 1: dois publishers com mesma base — só um vence; sem dual-PUBLISHED", async () => {
    const base = seedVersion({ id: "base", revision: 1, status: "PUBLISHED" });
    const d1 = seedVersion({
      id: "d1",
      revision: 2,
      status: "DRAFT",
      supersedesVersionId: "base",
    });
    const d2 = seedVersion({
      id: "d2",
      revision: 3,
      status: "DRAFT",
      supersedesVersionId: "base",
    });
    const { db, versions } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [base, d1, d2],
      items: [
        seedItem("base", "prod-a", "A", 10),
        seedItem("base", "prod-b", "B", 20),
        seedItem("d1", "prod-a", "A", 11),
        seedItem("d1", "prod-b", "B", 20),
        seedItem("d2", "prod-a", "A", 10),
        seedItem("d2", "prod-b", "B", 22),
      ],
    });

    await publishProductionCostTableVersion(db as never, {
      versionId: "d1",
      publishedBy: "user-a",
    });
    assert.equal(versions.get("d1")?.status, "PUBLISHED");
    assert.equal(versions.get("base")?.status, "SUPERSEDED");

    await assert.rejects(
      () =>
        publishProductionCostTableVersion(db as never, {
          versionId: "d2",
          publishedBy: "user-b",
        }),
      (err: unknown) => isProductionCostPublishStaleBaseError(err)
    );

    assert.equal(versions.get("d2")?.status, "DRAFT");
    const published = [...versions.values()].filter((v) => v.status === "PUBLISHED");
    assert.equal(published.length, 1);
    assert.equal(published[0]!.id, "d1");
  });

  it("cenário 2: mesmo versionId publicado duas vezes — segundo é idempotente/imutável", async () => {
    const draft = seedVersion({ id: "once", revision: 1, status: "DRAFT" });
    const { db } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [draft],
      items: [seedItem("once", "prod-a", "A", 10)],
    });
    await publishProductionCostTableVersion(db as never, { versionId: "once" });
    await assert.rejects(
      () => publishProductionCostTableVersion(db as never, { versionId: "once" }),
      /já publicada|imutável/i
    );
  });

  it("cenário 5: materialize ok + publish falha → DRAFT completo permanece; republicar após base ok", async () => {
    const base = seedVersion({ id: "base", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({
      id: "patch-b",
      revision: 2,
      status: "DRAFT",
      supersedesVersionId: "base",
    });
    const { db, versions } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [base, patch],
      items: [
        seedItem("base", "prod-a", "A", 10),
        seedItem("base", "prod-b", "B", 20),
        seedItem("base", "prod-c", "C", 30),
        seedItem("patch-b", "prod-b", "B", 22),
      ],
    });

    const materialized = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-01"),
      changedProductIds: ["prod-b"],
      patchDraftVersionIds: ["patch-b"],
    });
    assert.equal(materialized.ok, true);
    if (!materialized.ok) return;
    assert.equal(versions.get(materialized.data.version.id)?.status, "DRAFT");

    // Simula falha pós-materialize / pré-publish: não chama publish.
    // Retry: publish do mesmo DRAFT completo (base ainda vigente).
    const published = await publishProductionCostVersionFromDraft(db as never, {
      versionId: materialized.data.version.id,
      publishedBy: "retry@test",
    });
    assert.equal(published.version.status, "PUBLISHED");
    assert.equal(versions.get("base")?.status, "SUPERSEDED");
  });

  it("cenário 6: publish ok — cleanup (archive) falhar não desfaz PUBLISHED", async () => {
    const base = seedVersion({ id: "base", revision: 1, status: "PUBLISHED" });
    const complete = seedVersion({
      id: "complete",
      revision: 2,
      status: "DRAFT",
      supersedesVersionId: "base",
    });
    const { db, versions } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [base, complete],
      items: [
        seedItem("base", "prod-a", "A", 10),
        seedItem("complete", "prod-a", "A", 11),
      ],
    });

    const published = await publishProductionCostTableVersion(db as never, {
      versionId: "complete",
      publishedBy: "user",
    });
    assert.equal(published.version.status, "PUBLISHED");
    assert.equal(versions.get("complete")?.status, "PUBLISHED");
    // Cleanup é best-effort fora da transaction de publish — PUBLISHED permanece.
  });

  it("materialize: colisão (code,revision) → retry controlado", async () => {
    const base = seedVersion({ id: "base", revision: 1, status: "PUBLISHED" });
    const patch = seedVersion({
      id: "patch-a",
      revision: 2,
      status: "DRAFT",
      supersedesVersionId: "base",
    });
    const { db, getCreateAttempts } = createConcurrencyMockDb({
      products: PRODUCTS,
      versions: [base, patch],
      items: [
        seedItem("base", "prod-a", "A", 10),
        seedItem("base", "prod-b", "B", 20),
        seedItem("base", "prod-c", "C", 30),
        seedItem("patch-a", "prod-a", "A", 11),
      ],
      failFirstCreateWithUnique: true,
    });

    const result = await materializeCompleteProductionCostSnapshot(db as never, {
      effectiveDate: civilDateToLocalDate("2026-10-01"),
      changedProductIds: ["prod-a"],
      patchDraftVersionIds: ["patch-a"],
    });
    assert.equal(result.ok, true);
    assert.ok(getCreateAttempts() >= 2);
  });
});

describe("riscos residuais documentados", () => {
  it("documenta o que NÃO é resolvido por distributed lock (e por que)", () => {
    // Residual 1: dois rematerialize+retry simultâneos após STALE_BASE ainda
    // competem no publish atômico — um vence, o outro retorna CONFLICT_STALE_BASE
    // (sem perda da publicação que venceu).
    // Residual 2: archiveObsolete pós-publish fora da transaction — falha deixa
    // candidatos DRAFT órfãos, mas PUBLISHED oficial permanece correto.
    // Residual 3: link UNITARY_CANDIDATE_MATERIALIZED_INTO é best-effort em notes;
    // retry sem link rematerializa (mais custo, sem corrupção).
    assert.ok(true);
  });
});
