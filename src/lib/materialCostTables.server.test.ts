import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  addOrUpdateMaterialCostTableDraftItem,
  assertMaterialCostTableVersionMutable,
  createMaterialCostTableDraft,
  getEffectiveMaterialCost,
  publishMaterialCostTableVersion,
} from "./materialCostTables.server.js";

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
  materialCostTableVersionId: string;
  materialId: string;
  materialCodeSnapshot: string;
  materialDescriptionSnapshot: string;
  unitSnapshot: string;
  currentCostSnapshot: number;
  freightSnapshot: number;
  landedCostSnapshot: number;
  averageCostSnapshot: number | null;
  standardCostSnapshot: number | null;
  standardLossSnapshot: number | null;
  costSource: string;
  warningsJson: unknown;
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

  const itemKey = (versionId: string, materialId: string) => `${versionId}:${materialId}`;

  const db = {
    materialCostTableVersion: {
      findFirst: async ({ where, orderBy }: { where: { code: string }; orderBy: { revision: "desc" } }) => {
        const rows = [...versions.values()].filter((v) => v.code === where.code);
        if (orderBy.revision === "desc") rows.sort((a, b) => b.revision - a.revision);
        return rows[0] ?? null;
      },
      findUnique: async ({ where, select, include }: { where: { id: string }; select?: unknown; include?: unknown }) => {
        const row = versions.get(where.id);
        if (!row) return null;
        if (include && typeof include === "object" && "items" in include) {
          const versionItems = [...items.values()].filter((i) => i.materialCostTableVersionId === row.id);
          return { ...row, items: versionItems };
        }
        if (select) return row;
        return row;
      },
      findMany: async ({
        where,
        include,
        orderBy,
      }: {
        where?: { status?: { in: string[] }; effectiveDate?: { lte: Date } };
        include?: unknown;
        orderBy?: unknown;
      }) => {
        let rows = [...versions.values()];
        if (where?.status?.in) {
          rows = rows.filter((v) => where.status!.in.includes(v.status));
        }
        if (where?.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        return rows.map((row) => {
          if (include && typeof include === "object" && "items" in include) {
            const versionItems = [...items.values()].filter((i) => i.materialCostTableVersionId === row.id);
            return { ...row, items: versionItems };
          }
          return row;
        });
      },
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
          const versionItems = [...items.values()].filter((i) => i.materialCostTableVersionId === row.id);
          return { ...row, items: versionItems };
        }
        return row;
      },
    },
    materialCostTableItem: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { materialCostTableVersionId_materialId: { materialCostTableVersionId: string; materialId: string } };
        create: Omit<ItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<ItemRow>;
      }) => {
        const key = itemKey(
          where.materialCostTableVersionId_materialId.materialCostTableVersionId,
          where.materialCostTableVersionId_materialId.materialId
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
    material: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id ? { id: where.id } : null,
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return { versions, items, db };
}

describe("materialCostTables.server", () => {
  it("cria DRAFT e adiciona item", async () => {
    const { db } = createMockDb();
    const draft = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Custo Jul/2026",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.revision, 1);

    const row = await addOrUpdateMaterialCostTableDraftItem(db as never, draft.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "Polipropileno",
      unitSnapshot: "kg",
      currentCostSnapshot: 11,
      freightSnapshot: 0.5,
      landedCostSnapshot: 11.5,
    });
    assert.equal(Number(row.landedCostSnapshot), 11.5);
  });

  it("publica versão DRAFT e bloqueia edição posterior", async () => {
    const { db } = createMockDb();
    const draft = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Custo Jul/2026",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateMaterialCostTableDraftItem(db as never, draft.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "Polipropileno",
      unitSnapshot: "kg",
      currentCostSnapshot: 11.5,
      landedCostSnapshot: 11.5,
    });

    const published = await publishMaterialCostTableVersion(db as never, {
      versionId: draft.id,
      publishedBy: "auditor",
    });
    assert.equal(published.status, "PUBLISHED");
    assert.ok(published.publishedAt);

    await assert.rejects(
      () => assertMaterialCostTableVersionMutable(db as never, draft.id, "editar"),
      /imutável/
    );

    await assert.rejects(
      () =>
        addOrUpdateMaterialCostTableDraftItem(db as never, draft.id, {
          materialId: "mp-b",
          materialCodeSnapshot: "MP-B",
          materialDescriptionSnapshot: "Outra MP",
          unitSnapshot: "kg",
          currentCostSnapshot: 5,
          landedCostSnapshot: 5,
        }),
      /imutável/
    );
  });

  it("não publica versão com landed cost zero", async () => {
    const { db } = createMockDb();
    const draft = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Custo Jul/2026",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateMaterialCostTableDraftItem(db as never, draft.id, {
      materialId: "mp-zero",
      materialCodeSnapshot: "ZERO",
      materialDescriptionSnapshot: "Sem custo",
      unitSnapshot: "kg",
      currentCostSnapshot: 0,
      landedCostSnapshot: 0,
    });

    await assert.rejects(
      () => publishMaterialCostTableVersion(db as never, { versionId: draft.id }),
      /> 0/
    );
  });

  it("nova revisão DRAFT pode superseder versão publicada", async () => {
    const { db, versions } = createMockDb();
    const v1 = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Jul v1",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateMaterialCostTableDraftItem(db as never, v1.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "A",
      unitSnapshot: "kg",
      currentCostSnapshot: 16.5,
      landedCostSnapshot: 16.5,
    });
    await publishMaterialCostTableVersion(db as never, { versionId: v1.id });

    const v2 = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Jul v2",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      supersedesVersionId: v1.id,
    });
    assert.equal(v2.revision, 2);

    await addOrUpdateMaterialCostTableDraftItem(db as never, v2.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "A",
      unitSnapshot: "kg",
      currentCostSnapshot: 11.5,
      landedCostSnapshot: 11.5,
    });

    await publishMaterialCostTableVersion(db as never, {
      versionId: v2.id,
      supersedeVersionId: v1.id,
    });

    assert.equal(versions.get(v1.id)?.status, "SUPERSEDED");
    assert.equal(versions.get(v2.id)?.status, "PUBLISHED");
  });

  it("getEffectiveMaterialCost resolve por data", async () => {
    const { db } = createMockDb();
    const may = await createMaterialCostTableDraft(db as never, {
      code: "2026-05",
      name: "Mai",
      effectiveDate: civilDateToLocalDate("2026-05-01"),
    });
    await addOrUpdateMaterialCostTableDraftItem(db as never, may.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "A",
      unitSnapshot: "kg",
      currentCostSnapshot: 16.5,
      landedCostSnapshot: 16.5,
    });
    await publishMaterialCostTableVersion(db as never, { versionId: may.id });

    const jul = await createMaterialCostTableDraft(db as never, {
      code: "2026-07",
      name: "Jul",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
    });
    await addOrUpdateMaterialCostTableDraftItem(db as never, jul.id, {
      materialId: "mp-a",
      materialCodeSnapshot: "PP H503",
      materialDescriptionSnapshot: "A",
      unitSnapshot: "kg",
      currentCostSnapshot: 11.5,
      landedCostSnapshot: 11.5,
    });
    await publishMaterialCostTableVersion(db as never, { versionId: jul.id });

    const mayResolved = await getEffectiveMaterialCost(
      db as never,
      "mp-a",
      civilDateToLocalDate("2026-05-15")
    );
    const julResolved = await getEffectiveMaterialCost(
      db as never,
      "mp-a",
      civilDateToLocalDate("2026-07-15")
    );

    assert.equal(mayResolved.status, "OK");
    if (mayResolved.status === "OK") assert.equal(mayResolved.landedCostSnapshot, 16.5);
    assert.equal(julResolved.status, "OK");
    if (julResolved.status === "OK") assert.equal(julResolved.landedCostSnapshot, 11.5);
  });
});
