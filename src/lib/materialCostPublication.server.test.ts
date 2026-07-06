import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  generateMaterialCostTableDraftFromMaterials,
  publishMaterialCostVersionFromDraft,
} from "./materialCostPublication.server.js";
import {
  addOrUpdateMaterialCostTableDraftItem,
  getEffectiveMaterialCost,
} from "./materialCostTables.server.js";
import { resolveEffectiveMaterialCostFromCatalog, type MaterialCostTableVersionWithItems } from "./materialCostVersioning.js";

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
  summaryJson?: unknown;
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

type MaterialRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  currentCost: number;
  averageCost: number | null;
  standardCost: number | null;
  freight: number;
  standardLoss: number | null;
  status: string;
};

function createMockDb(materials: MaterialRow[]) {
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;

  const itemKey = (versionId: string, materialId: string) => `${versionId}:${materialId}`;

  const db = {
    materialCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: { code?: string; status?: string };
        orderBy?: Array<{ revision?: "desc"; publishedAt?: "desc" }> | { revision: "desc" };
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
            result.items = [...items.values()].filter((i) => i.materialCostTableVersionId === row.id);
          }
          if ("_count" in include) {
            result._count = {
              items: [...items.values()].filter((i) => i.materialCostTableVersionId === row.id).length,
            };
          }
        }
        if (select) return row;
        return result;
      },
      findMany: async ({
        where,
        include,
      }: {
        where?: { status?: { in: string[] }; effectiveDate?: { lte: Date } };
        include?: unknown;
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
          return {
            ...row,
            items: [...items.values()].filter((i) => i.materialCostTableVersionId === row.id),
          };
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
      findMany: async ({
        where,
      }: {
        where: {
          status?: string;
          id?: { in: string[] };
        };
      }) => {
        if (where.id?.in?.length === 0) return [];
        let rows = materials.filter((m) => m.status === "ACTIVE");
        const ids = where.id?.in;
        return ids ? rows.filter((m) => ids.includes(m.id)) : rows;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        materials.find((m) => m.id === where.id) ?? null,
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return { versions, items, materials, db };
}

describe("materialCostPublication.server", () => {
  it("gera DRAFT a partir de materiais ativos com custo válido", async () => {
    const materials: MaterialRow[] = [
      {
        id: "mp-a",
        code: "PP H503",
        description: "Polipropileno H503",
        unit: "kg",
        currentCost: 11,
        freight: 0.5,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
      {
        id: "mp-b",
        code: "ABS",
        description: "ABS",
        unit: "kg",
        currentCost: 8,
        freight: 0,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
    ];
    const { db, versions } = createMockDb(materials);

    const { version, summary } = await generateMaterialCostTableDraftFromMaterials(db as never, {
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      includeAllActiveMaterials: true,
    });

    assert.ok(version);
    assert.equal(summary.itemsCreated, 2);
    assert.equal(summary.itemsSkipped, 0);
    assert.equal(versions.get(version!.id)?.status, "DRAFT");
    assert.equal(versions.get(version!.id)?.revision, 1);
  });

  it("material sem custo é skipped — não entra no DRAFT como zero", async () => {
    const materials: MaterialRow[] = [
      {
        id: "mp-ok",
        code: "OK",
        description: "Com custo",
        unit: "kg",
        currentCost: 10,
        freight: 0,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
      {
        id: "mp-zero",
        code: "ZERO",
        description: "Sem custo",
        unit: "kg",
        currentCost: 0,
        freight: 0,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
    ];
    const { db, items } = createMockDb(materials);

    const { summary } = await generateMaterialCostTableDraftFromMaterials(db as never, {
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      includeAllActiveMaterials: true,
    });

    assert.equal(summary.itemsCreated, 1);
    assert.equal(summary.itemsSkipped, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0]?.code, "SEM_CUSTO");
    assert.equal([...items.values()].length, 1);
    assert.equal([...items.values()][0]?.materialId, "mp-ok");
  });

  it("publica versão e supersede anterior", async () => {
    const materials: MaterialRow[] = [
      {
        id: "mp-a",
        code: "PP H503",
        description: "A",
        unit: "kg",
        currentCost: 16.5,
        freight: 0,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
    ];
    const { db, versions } = createMockDb(materials);

    const gen1 = await generateMaterialCostTableDraftFromMaterials(db as never, {
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      includeAllActiveMaterials: true,
    });
    await publishMaterialCostVersionFromDraft(db as never, { versionId: gen1.version!.id });

    materials[0]!.currentCost = 11.5;
    const gen2 = await generateMaterialCostTableDraftFromMaterials(db as never, {
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      includeAllActiveMaterials: true,
    });
    await publishMaterialCostVersionFromDraft(db as never, { versionId: gen2.version!.id });

    assert.equal(versions.get(gen1.version!.id)?.status, "SUPERSEDED");
    assert.equal(versions.get(gen2.version!.id)?.status, "PUBLISHED");
  });

  it("Material.currentCost vivo não altera item publicado", async () => {
    const materials: MaterialRow[] = [
      {
        id: "mp-a",
        code: "PP H503",
        description: "A",
        unit: "kg",
        currentCost: 16.5,
        freight: 0,
        averageCost: null,
        standardCost: null,
        standardLoss: null,
        status: "ACTIVE",
      },
    ];
    const { db, items, versions } = createMockDb(materials);

    const gen = await generateMaterialCostTableDraftFromMaterials(db as never, {
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      includeAllActiveMaterials: true,
    });
    await publishMaterialCostVersionFromDraft(db as never, { versionId: gen.version!.id });

    const publishedItem = [...items.values()].find((i) => i.materialCostTableVersionId === gen.version!.id);
    assert.ok(publishedItem);
    assert.equal(Number(publishedItem!.landedCostSnapshot), 16.5);

    materials[0]!.currentCost = 99;
    const resolved = await getEffectiveMaterialCost(
      db as never,
      "mp-a",
      civilDateToLocalDate("2026-07-15")
    );
    assert.equal(resolved.status, "OK");
    if (resolved.status === "OK") {
      assert.equal(resolved.landedCostSnapshot, 16.5);
      assert.notEqual(resolved.landedCostSnapshot, materials[0]!.currentCost);
    }

    const mapItem = (i: ItemRow) => ({
      id: i.id,
      materialCostTableVersionId: i.materialCostTableVersionId,
      materialId: i.materialId,
      materialCodeSnapshot: i.materialCodeSnapshot,
      materialDescriptionSnapshot: i.materialDescriptionSnapshot,
      unitSnapshot: i.unitSnapshot,
      currentCostSnapshot: Number(i.currentCostSnapshot),
      freightSnapshot: Number(i.freightSnapshot),
      landedCostSnapshot: Number(i.landedCostSnapshot),
      averageCostSnapshot: i.averageCostSnapshot,
      standardCostSnapshot: i.standardCostSnapshot,
      standardLossSnapshot: i.standardLossSnapshot,
      costSource: i.costSource,
      warningsJson: i.warningsJson,
      calculationHash: i.calculationHash,
      calculationSnapshot: i.calculationSnapshot,
      createdAt: i.createdAt,
    });

    const ver = versions.get(gen.version!.id)!;
    const catalog: MaterialCostTableVersionWithItems[] = [
      {
        id: ver.id,
        code: ver.code,
        name: ver.name,
        effectiveDate: ver.effectiveDate,
        status: "PUBLISHED",
        revision: ver.revision,
        publishedAt: ver.publishedAt,
        createdAt: ver.createdAt,
        items: [...items.values()]
          .filter((i) => i.materialCostTableVersionId === ver.id)
          .map(mapItem),
      },
    ];
    const fromCatalog = resolveEffectiveMaterialCostFromCatalog(
      catalog,
      "mp-a",
      civilDateToLocalDate("2026-07-15")
    );
    assert.equal(fromCatalog.status, "OK");
    if (fromCatalog.status === "OK") assert.equal(fromCatalog.landedCostSnapshot, 16.5);

    await assert.rejects(
      () =>
        addOrUpdateMaterialCostTableDraftItem(db as never, gen.version!.id, {
          materialId: "mp-a",
          materialCodeSnapshot: "PP H503",
          materialDescriptionSnapshot: "A",
          unitSnapshot: "kg",
          currentCostSnapshot: 99,
          landedCostSnapshot: 99,
        }),
      /imutável/
    );
  });
});
