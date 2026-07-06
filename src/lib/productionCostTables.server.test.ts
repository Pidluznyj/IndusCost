import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  addOrUpdateProductionCostTableDraftItem,
  createProductionCostTableDraft,
  publishProductionCostTableVersion,
  assertProductionCostTableVersionMutable,
} from "./productionCostTables.server.js";

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

function createMockDb() {
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;

  const itemKey = (versionId: string, productId: string) => `${versionId}:${productId}`;

  const db = {
    productionCostTableVersion: {
        findFirst: async ({ where, orderBy }: { where: { code: string }; orderBy: { revision: "desc" } }) => {
          const rows = [...versions.values()].filter((v) => v.code === where.code);
          if (orderBy.revision === "desc") {
            rows.sort((a, b) => b.revision - a.revision);
          }
          return rows[0] ?? null;
        },
        findUnique: async ({ where, select, include }: { where: { id: string }; select?: unknown; include?: unknown }) => {
          const row = versions.get(where.id);
          if (!row) return null;
          if (include && typeof include === "object" && "items" in include) {
            const versionItems = [...items.values()].filter((i) => i.costTableVersionId === row.id);
            return { ...row, items: versionItems };
          }
          if (select) return row;
          return row;
        },
        create: async ({ data }: { data: Omit<VersionRow, "id" | "createdAt" | "updatedAt"> }) => {
          versionSeq += 1;
          const id = `ver-${versionSeq}`;
          const now = new Date();
          const row: VersionRow = {
            id,
            createdAt: now,
            updatedAt: now,
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
          include?: unknown;
        }) => {
          const row = versions.get(where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data, { updatedAt: new Date() });
          if (include) {
            const versionItems = [...items.values()].filter((i) => i.costTableVersionId === row.id);
            return { ...row, items: versionItems };
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
          const row: ItemRow = {
            id: `item-${itemSeq}`,
            createdAt: now,
            updatedAt: now,
            ...create,
          };
          items.set(key, row);
          return row;
        },
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) {
            for (const [key, row] of items.entries()) {
              if (row.id === id) items.delete(key);
            }
          }
          return { count: where.id.in.length };
        },
        findMany: async ({
          where,
          include,
        }: {
          where: {
            productId?: string;
            costTableVersionId?: string;
            costTableVersion?: { status: string; id?: { not: string } };
          };
          include?: { costTableVersion?: { select: { id: boolean; code: boolean } } };
        }) => {
          let rows = [...items.values()];
          if (where.productId) {
            rows = rows.filter((row) => row.productId === where.productId);
          }
          if (where.costTableVersionId) {
            rows = rows.filter((row) => row.costTableVersionId === where.costTableVersionId);
          }
          if (where.costTableVersion) {
            rows = rows.filter((row) => {
              const version = versions.get(row.costTableVersionId);
              if (!version) return false;
              if (where.costTableVersion!.status && version.status !== where.costTableVersion!.status) {
                return false;
              }
              if (where.costTableVersion!.id?.not && version.id === where.costTableVersion!.id.not) {
                return false;
              }
              return true;
            });
          }
          return rows.map((row) => {
            const version = versions.get(row.costTableVersionId);
            if (include?.costTableVersion) {
              return {
                ...row,
                costTableVersion: version
                  ? { id: version.id, code: version.code }
                  : null,
              };
            }
            return row;
          });
        },
      },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id ? { id: where.id } : null,
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return { versions, items, db };
}

describe("productionCostTables.server", () => {
  it("cria DRAFT e adiciona item", async () => {
    const { db } = createMockDb();
    const draft = await createProductionCostTableDraft(db as never, {
      code: "2026-06",
      name: "Custo Jun/2026",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
    });
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.revision, 1);

    const row = await addOrUpdateProductionCostTableDraftItem(db as never, draft.id, {
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "Produto A",
      unitProductionCost: 10,
    });
    assert.equal(Number(row.unitProductionCost), 10);
  });

  it("publica versão DRAFT e bloqueia edição posterior", async () => {
    const { db } = createMockDb();
    const draft = await createProductionCostTableDraft(db as never, {
      code: "2026-06",
      name: "Custo Jun/2026",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
    });
    await addOrUpdateProductionCostTableDraftItem(db as never, draft.id, {
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "Produto A",
      unitProductionCost: 10,
    });

    const published = await publishProductionCostTableVersion(db as never, {
      versionId: draft.id,
      publishedBy: "auditor",
    });
    assert.equal(published.version.status, "PUBLISHED");
    assert.ok(published.version.publishedAt);

    await assert.rejects(
      () => assertProductionCostTableVersionMutable(db as never, draft.id, "editar"),
      /imutável/
    );

    await assert.rejects(
      () =>
        addOrUpdateProductionCostTableDraftItem(db as never, draft.id, {
          productId: "prod-b",
          productCodeSnapshot: "PB",
          productNameSnapshot: "Produto B",
          unitProductionCost: 20,
        }),
      /imutável/
    );
  });

  it("nova revisão DRAFT pode superseder versão publicada", async () => {
    const { db, versions } = createMockDb();
    const v1 = await createProductionCostTableDraft(db as never, {
      code: "2026-06",
      name: "Jun v1",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
    });
    await addOrUpdateProductionCostTableDraftItem(db as never, v1.id, {
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "A",
      unitProductionCost: 10,
    });
    await publishProductionCostTableVersion(db as never, { versionId: v1.id });

    const v2 = await createProductionCostTableDraft(db as never, {
      code: "2026-06",
      name: "Jun v2",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      supersedesVersionId: v1.id,
    });
    assert.equal(v2.revision, 2);

    await addOrUpdateProductionCostTableDraftItem(db as never, v2.id, {
      productId: "prod-a",
      productCodeSnapshot: "PA",
      productNameSnapshot: "A",
      unitProductionCost: 11.5,
    });

    await publishProductionCostTableVersion(db as never, {
      versionId: v2.id,
      supersedeVersionId: v1.id,
    });

    assert.equal(versions.get(v1.id)?.status, "SUPERSEDED");
    assert.equal(versions.get(v2.id)?.status, "PUBLISHED");
  });

  it("publicação arquiva DRAFT AUTO com mesmo custo do produto publicado", async () => {
    const { db, versions } = createMockDb();
    const staleDraft = await createProductionCostTableDraft(db as never, {
      code: "AUTO-2026-07-01-618.08AA",
      name: "Snapshot engenharia",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateProductionCostTableDraftItem(db as never, staleDraft.id, {
      productId: "prod-618",
      productCodeSnapshot: "618.08AA",
      productNameSnapshot: "618.08AA",
      unitProductionCost: 0.912785,
    });

    const officialDraft = await createProductionCostTableDraft(db as never, {
      code: "2026-07",
      name: "Custo Jul/2026",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateProductionCostTableDraftItem(db as never, officialDraft.id, {
      productId: "prod-618",
      productCodeSnapshot: "618.08AA",
      productNameSnapshot: "618.08AA",
      unitProductionCost: 0.912785,
    });

    await publishProductionCostTableVersion(db as never, { versionId: officialDraft.id });

    assert.equal(versions.get(staleDraft.id)?.status, "ARCHIVED");
    assert.equal(versions.get(officialDraft.id)?.status, "PUBLISHED");
  });
});
